require('dotenv').config()

const { Pool } = require('pg')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in backend/.env')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imports (
      id SERIAL PRIMARY KEY,
      original_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      row_count INTEGER NOT NULL DEFAULT 0,
      column_headers JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS import_rows (
      id BIGSERIAL PRIMARY KEY,
      import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      data JSONB NOT NULL,
      UNIQUE (import_id, row_number)
    );

    ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS record_key TEXT;
    ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS source_import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL;
  `)

  const { backfillRecordKeys } = require('./imports')
  await backfillRecordKeys()

  const organisationColumn = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'import_rows'
       AND column_name = 'organisation_id'`,
  )
  if (organisationColumn.rows.length === 0) {
    await pool.query(`
      DROP INDEX IF EXISTS idx_import_rows_record_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_import_rows_record_key
      ON import_rows (record_key);
    `)
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS annotations (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'note',
      note_text TEXT NOT NULL,
      is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_entity
    ON annotations (entity_type, entity_key);

    CREATE INDEX IF NOT EXISTS idx_annotations_entity_pinned_created
    ON annotations (entity_type, entity_key, is_pinned DESC, created_at DESC);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS performance_goals (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold NUMERIC NOT NULL,
      period_days INTEGER NOT NULL DEFAULT 7,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_performance_goals_entity
    ON performance_goals (entity_type, entity_key);

    CREATE INDEX IF NOT EXISTS idx_performance_goals_active
    ON performance_goals (is_active, entity_type);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_campaign_metrics (
      id BIGSERIAL PRIMARY KEY,
      app_id TEXT NOT NULL,
      app_name TEXT,
      campaign_name TEXT NOT NULL,
      report_date DATE NOT NULL,
      spend NUMERIC,
      impressions INTEGER,
      taps INTEGER,
      installs INTEGER,
      daily_budget NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_daily_campaign UNIQUE (app_id, report_date, campaign_name)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_campaign_app_date 
      ON daily_campaign_metrics(app_id, report_date);
    CREATE INDEX IF NOT EXISTS idx_daily_campaign_date 
      ON daily_campaign_metrics(report_date);
    CREATE INDEX IF NOT EXISTS idx_daily_campaign_name 
      ON daily_campaign_metrics(campaign_name);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_keyword_metrics (
      id BIGSERIAL PRIMARY KEY,
      app_id TEXT NOT NULL,
      app_name TEXT,
      campaign_id INTEGER,
      campaign_name TEXT NOT NULL,
      ad_group_name TEXT NOT NULL,
      keyword_id INTEGER,
      keyword_text TEXT NOT NULL,
      bid_strategy TEXT,
      report_date DATE NOT NULL,
      spend NUMERIC,
      impressions INTEGER,
      taps INTEGER,
      installs INTEGER,
      keyword_max_cpt_bid NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_daily_keyword UNIQUE (
        app_id,
        report_date,
        campaign_name,
        ad_group_name,
        keyword_text,
        bid_strategy
      )
    );

    CREATE INDEX IF NOT EXISTS idx_daily_keyword_app_date 
      ON daily_keyword_metrics(app_id, report_date);
    CREATE INDEX IF NOT EXISTS idx_daily_keyword_date 
      ON daily_keyword_metrics(report_date);
    CREATE INDEX IF NOT EXISTS idx_daily_keyword_campaign 
      ON daily_keyword_metrics(campaign_name);
    CREATE INDEX IF NOT EXISTS idx_daily_keyword_text 
      ON daily_keyword_metrics(keyword_text);
    CREATE INDEX IF NOT EXISTS idx_daily_keyword_campaign_id 
      ON daily_keyword_metrics(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_daily_keyword_keyword_id 
      ON daily_keyword_metrics(keyword_id);
  `)

  await migrateToDailyTables()
  await migrateInstallColumns()
  await migrateCampaignsTable()
  await migrateBidExperiments()
  await migrateMultiTenantFoundation()
  await migrateOrganisationOwnership()
  await migrateMultiTenantUniqueConstraints()
  await migrateKeywordBidHistory()
  
  // Backfill daily metrics AFTER all migrations complete
  setImmediate(async () => {
    try {
      const { backfillDailyMetricsFromImportRows } = require('./imports')
      await backfillDailyMetricsFromImportRows()
    } catch (err) {
      console.error('Backfill error:', err.message)
      console.error('Error detail:', err.detail || 'No detail')
      console.error('Error hint:', err.hint || 'No hint')
      if (err.position) console.error('Error position:', err.position)
    }

    try {
      const { backfillBidExperiments } = require('./bidExperiments')
      await backfillBidExperiments()
    } catch (err) {
      console.error('Bid experiment backfill error:', err.message)
      console.error('Error detail:', err.detail || 'No detail')
      console.error('Error hint:', err.hint || 'No hint')
    }
  })
}

async function migrateBidExperiments() {
  console.log('Migrating bid experiments tables...')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS application_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    INSERT INTO application_settings (setting_key, setting_value, updated_at)
    VALUES ('bid_experiment_default_observation_days', '7', NOW())
    ON CONFLICT (setting_key) DO NOTHING
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bid_experiments (
      id BIGSERIAL PRIMARY KEY,
      app_id TEXT NOT NULL,
      app_name TEXT,
      campaign_name TEXT NOT NULL,
      ad_group_name TEXT NOT NULL DEFAULT '',
      keyword_text TEXT NOT NULL,
      bid_strategy TEXT NOT NULL DEFAULT '',
      keyword_identity_key TEXT NOT NULL,
      change_date DATE NOT NULL,
      previous_max_cpt_bid NUMERIC(12, 2) NOT NULL,
      new_max_cpt_bid NUMERIC(12, 2) NOT NULL,
      bid_change_amount NUMERIC(12, 2) NOT NULL,
      bid_change_percent NUMERIC,
      direction TEXT NOT NULL,
      requested_observation_days INTEGER NOT NULL,
      actual_observation_days INTEGER,
      status TEXT NOT NULL,
      interruption_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // Incremental column adds for partially migrated DBs
  await pool.query(`
    ALTER TABLE bid_experiments
      ADD COLUMN IF NOT EXISTS app_id TEXT,
      ADD COLUMN IF NOT EXISTS app_name TEXT,
      ADD COLUMN IF NOT EXISTS campaign_name TEXT,
      ADD COLUMN IF NOT EXISTS ad_group_name TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS keyword_text TEXT,
      ADD COLUMN IF NOT EXISTS bid_strategy TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS keyword_identity_key TEXT,
      ADD COLUMN IF NOT EXISTS change_date DATE,
      ADD COLUMN IF NOT EXISTS previous_max_cpt_bid NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS new_max_cpt_bid NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS bid_change_amount NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS bid_change_percent NUMERIC,
      ADD COLUMN IF NOT EXISTS direction TEXT,
      ADD COLUMN IF NOT EXISTS requested_observation_days INTEGER,
      ADD COLUMN IF NOT EXISTS actual_observation_days INTEGER,
      ADD COLUMN IF NOT EXISTS status TEXT,
      ADD COLUMN IF NOT EXISTS interruption_date DATE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `)

  // Constraints (idempotent — catch duplicate_object and duplicate_table/index)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE bid_experiments
        ADD CONSTRAINT chk_bid_experiment_direction
        CHECK (direction IN ('increase', 'decrease'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table THEN NULL;
    END $$;
  `)

  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE bid_experiments
        ADD CONSTRAINT chk_bid_experiment_status
        CHECK (status IN ('observing', 'completed', 'interrupted', 'insufficient_data'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table THEN NULL;
    END $$;
  `)

  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE bid_experiments
        ADD CONSTRAINT chk_bid_experiment_observation_days
        CHECK (requested_observation_days IN (3, 7, 14, 30));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table THEN NULL;
    END $$;
  `)

  // Prefer unique index IF NOT EXISTS — safer than ADD CONSTRAINT on re-runs
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bid_experiment
      ON bid_experiments (
        keyword_identity_key,
        change_date,
        previous_max_cpt_bid,
        new_max_cpt_bid
      );
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bid_experiments_identity_date
      ON bid_experiments (keyword_identity_key, change_date DESC);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bid_experiments_app_date
      ON bid_experiments (app_id, change_date DESC);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bid_experiments_status
      ON bid_experiments (status);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bid_experiments_keyword
      ON bid_experiments (app_id, campaign_name, ad_group_name, keyword_text);
  `)

  console.log('Bid experiments migration completed')
}

async function migrateCampaignsTable() {
  console.log('Migrating campaigns table...')
  
  // Step 1: Create table with minimal schema (only guaranteed columns)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      campaign_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  
  // Step 2: Add columns incrementally (safe for existing tables)
  await pool.query(`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS app_id TEXT,
      ADD COLUMN IF NOT EXISTS segment TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `)
  
  // Step 3: Set default for segment column if it exists but has no default
  await pool.query(`
    ALTER TABLE campaigns
      ALTER COLUMN segment SET DEFAULT 'Other';
  `)
  
  // Step 4: Backfill segment for any rows with NULL segment
  const segmentBackfillResult = await pool.query(`
    UPDATE campaigns
    SET segment = 'Other'
    WHERE segment IS NULL
  `)
  
  if (segmentBackfillResult.rowCount > 0) {
    console.log(`  Backfilled segment for ${segmentBackfillResult.rowCount} campaigns`)
  }
  
  // Step 5: Check for campaigns missing app_id
  const missingAppIdResult = await pool.query(`
    SELECT COUNT(*) as count FROM campaigns WHERE app_id IS NULL
  `)
  const missingAppIdCount = parseInt(missingAppIdResult.rows[0].count)
  
  if (missingAppIdCount > 0) {
    console.log(`  Warning: ${missingAppIdCount} campaigns have NULL app_id`)
    console.log(`  These campaigns were created before app_id was added`)
    console.log(`  They will be populated on next data import`)
  }
  
  // Step 6: Create indexes (now safe after columns exist)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_app_id
      ON campaigns(app_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_segment
      ON campaigns(segment);
  `)
  
  // Step 7: Check for duplicate (app_id, campaign_name) pairs before adding constraint
  const duplicatesResult = await pool.query(`
    SELECT app_id, campaign_name, COUNT(*) as count
    FROM campaigns
    WHERE app_id IS NOT NULL
    GROUP BY app_id, campaign_name
    HAVING COUNT(*) > 1
  `)
  
  if (duplicatesResult.rows.length > 0) {
    console.log(`  Warning: Found ${duplicatesResult.rows.length} duplicate (app_id, campaign_name) pairs`)
    console.log(`  Skipping unique constraint creation until duplicates are resolved`)
    duplicatesResult.rows.forEach(row => {
      console.log(`    - app_id: ${row.app_id}, campaign: ${row.campaign_name} (${row.count} rows)`)
    })
  } else {
    // Step 8: Add unique constraint only if no duplicates exist
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'uq_campaign'
        ) THEN
          ALTER TABLE campaigns
            ADD CONSTRAINT uq_campaign UNIQUE (app_id, campaign_name);
        END IF;
      END $$;
    `)
    console.log('  Unique constraint uq_campaign created')
  }
  
  console.log('Campaigns table migration completed')
}

async function migrateInstallColumns() {
  console.log('Adding install type columns to daily tables...')
  
  // Step 1: Ensure created_at and updated_at columns exist
  await pool.query(`
    ALTER TABLE daily_campaign_metrics
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `)

  await pool.query(`
    ALTER TABLE daily_keyword_metrics
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `)
  
  // Step 2: Add install type columns
  await pool.query(`
    ALTER TABLE daily_campaign_metrics 
      ADD COLUMN IF NOT EXISTS installs_tap_through INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS installs_view_through INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS installs_total INTEGER NOT NULL DEFAULT 0
  `)

  await pool.query(`
    ALTER TABLE daily_keyword_metrics
      ADD COLUMN IF NOT EXISTS installs_tap_through INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS installs_view_through INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS installs_total INTEGER NOT NULL DEFAULT 0
  `)

  // Step 3: Backfill install totals
  await pool.query(`
    UPDATE daily_campaign_metrics 
      SET installs_total = COALESCE(installs, 0) 
      WHERE installs_total = 0 AND installs IS NOT NULL AND installs > 0
  `)

  await pool.query(`
    UPDATE daily_keyword_metrics
      SET installs_total = COALESCE(installs, 0)
      WHERE installs_total = 0 AND installs IS NOT NULL AND installs > 0
  `)

  console.log('Install columns added successfully')
}

async function migrateToDailyTables() {
  const checkKeywordMetrics = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'keyword_metrics'
    )
  `)

  if (checkKeywordMetrics.rows[0].exists) {
    console.log('Found existing keyword_metrics table')
    
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'keyword_metrics'
    `)
    
    const columnNames = columns.rows.map(r => r.column_name)
    const hasRequiredColumns = ['app_id', 'report_date', 'campaign_name'].every(c => 
      columnNames.includes(c)
    )
    
    if (hasRequiredColumns) {
      console.log('Migrating keyword_metrics to daily_keyword_metrics...')
      await pool.query(`ALTER TABLE keyword_metrics RENAME TO keyword_metrics_old`)
      
      await pool.query(`
        INSERT INTO daily_keyword_metrics (
          app_id, app_name, campaign_id, campaign_name, ad_group_name,
          keyword_id, keyword_text, bid_strategy, report_date,
          spend, impressions, taps, installs, keyword_max_cpt_bid,
          created_at, updated_at
        )
        SELECT 
          app_id, app_name, campaign_id, campaign_name, ad_group_name,
          keyword_id, keyword_text, bid_strategy, report_date,
          spend, impressions, taps, installs, keyword_max_cpt_bid,
          created_at, updated_at
        FROM keyword_metrics_old
        ON CONFLICT (app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)
        DO UPDATE SET
          spend = EXCLUDED.spend,
          impressions = EXCLUDED.impressions,
          taps = EXCLUDED.taps,
          installs = EXCLUDED.installs,
          keyword_max_cpt_bid = EXCLUDED.keyword_max_cpt_bid,
          campaign_id = COALESCE(EXCLUDED.campaign_id, daily_keyword_metrics.campaign_id),
          keyword_id = COALESCE(EXCLUDED.keyword_id, daily_keyword_metrics.keyword_id),
          updated_at = NOW()
      `)
      
      console.log('Migration complete. Old table renamed to keyword_metrics_old')
    } else {
      console.log('Skipping migration - keyword_metrics schema incompatible')
      console.log('Dropping incompatible keyword_metrics table...')
      await pool.query(`DROP TABLE keyword_metrics CASCADE`)
    }
  }
}

async function migrateMultiTenantFoundation() {
  console.log('Migrating multi-tenant foundation tables...')

  // Create users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT,
      full_name TEXT,
      auth_provider TEXT,
      auth_provider_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // Unique email index (where not null)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email 
      ON users (email) WHERE email IS NOT NULL;
  `)

  // Unique provider identity (where both not null)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_identity 
      ON users (auth_provider, auth_provider_user_id) 
      WHERE auth_provider IS NOT NULL AND auth_provider_user_id IS NOT NULL;
  `)

  // Create organisations table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organisations (
      id SERIAL PRIMARY KEY,
      organisation_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // Create organisation_users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organisation_users (
      id SERIAL PRIMARY KEY,
      organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // Unique constraint for organisation_users
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE organisation_users
        ADD CONSTRAINT uq_organisation_user UNIQUE (organisation_id, user_id);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table THEN NULL;
    END $$;
  `)

  // Indexes for organisation_users
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_organisation_users_user 
      ON organisation_users(user_id);
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_organisation_users_org 
      ON organisation_users(organisation_id);
  `)

  // Seed development organisation (idempotent)
  const existing = await pool.query(
    `SELECT id, organisation_name, created_at 
     FROM organisations 
     WHERE organisation_name = 'Development Organisation'`
  )

  if (existing.rows.length === 0) {
    const result = await pool.query(
      `INSERT INTO organisations (organisation_name, created_at)
       VALUES ('Development Organisation', NOW())
       RETURNING id, organisation_name, created_at`
    )
    console.log(`  ✓ Created development organisation (id=${result.rows[0].id})`)
  } else {
    console.log(`  ✓ Development organisation already exists (id=${existing.rows[0].id})`)
  }

  console.log('Multi-tenant foundation migration completed')
}

async function migrateOrganisationOwnership() {
  console.log('Migrating organisation ownership (P2)...')

  // Step 1: Resolve Development Organisation
  const devOrgResult = await pool.query(
    `SELECT id FROM organisations WHERE organisation_name = 'Development Organisation'`
  )

  if (devOrgResult.rows.length === 0) {
    throw new Error('Development Organisation not found. P1 migration must complete first.')
  }

  const devOrgId = devOrgResult.rows[0].id
  console.log(`  ✓ Resolved Development Organisation (id=${devOrgId})`)

  // Step 2: Add nullable organisation_id columns
  console.log('  Adding organisation_id columns...')
  
  await pool.query(`
    ALTER TABLE imports ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE daily_campaign_metrics ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE daily_keyword_metrics ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE annotations ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE performance_goals ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)
  
  await pool.query(`
    ALTER TABLE bid_experiments ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);
  `)

  console.log('  ✓ Organisation ownership columns added')

  // Step 3: Add indexes
  console.log('  Adding organisation indexes...')
  
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_imports_org ON imports(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_rows_org ON import_rows(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_daily_campaign_metrics_org ON daily_campaign_metrics(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_daily_keyword_metrics_org ON daily_keyword_metrics(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_annotations_org ON annotations(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_performance_goals_org ON performance_goals(organisation_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bid_experiments_org ON bid_experiments(organisation_id);`)

  console.log('  ✓ Organisation indexes created')

  // Step 4: Backfill existing rows (idempotent)
  console.log('  Backfilling organisation ownership...')
  
  const backfillResults = {}
  
  backfillResults.imports = await pool.query(
    `UPDATE imports SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )
  
  // Backfill import_rows from parent import
  backfillResults.import_rows = await pool.query(
    `UPDATE import_rows ir 
     SET organisation_id = i.organisation_id
     FROM imports i
     WHERE ir.import_id = i.id AND ir.organisation_id IS NULL`,
    []
  )
  
  backfillResults.campaigns = await pool.query(
    `UPDATE campaigns SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )
  
  backfillResults.daily_campaign_metrics = await pool.query(
    `UPDATE daily_campaign_metrics SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )
  
  backfillResults.daily_keyword_metrics = await pool.query(
    `UPDATE daily_keyword_metrics SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )
  
  backfillResults.annotations = await pool.query(
    `UPDATE annotations SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )
  
  backfillResults.performance_goals = await pool.query(
    `UPDATE performance_goals SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )
  
  backfillResults.bid_experiments = await pool.query(
    `UPDATE bid_experiments SET organisation_id = $1 WHERE organisation_id IS NULL`,
    [devOrgId]
  )

  console.log('  ✓ Backfill complete:')
  Object.entries(backfillResults).forEach(([table, result]) => {
    console.log(`    - ${table}: ${result.rowCount} rows`)
  })

  // Step 5: Verify no NULL ownership
  console.log('  Verifying ownership completeness...')
  
  const verifyQueries = [
    'SELECT COUNT(*) as count FROM imports WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM import_rows WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM campaigns WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM daily_campaign_metrics WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM daily_keyword_metrics WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM annotations WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM performance_goals WHERE organisation_id IS NULL',
    'SELECT COUNT(*) as count FROM bid_experiments WHERE organisation_id IS NULL'
  ]

  const tables = ['imports', 'import_rows', 'campaigns', 'daily_campaign_metrics', 
                  'daily_keyword_metrics', 'annotations', 'performance_goals', 'bid_experiments']
  
  let nullCountFound = false
  for (let i = 0; i < verifyQueries.length; i++) {
    const result = await pool.query(verifyQueries[i])
    const count = parseInt(result.rows[0].count)
    if (count > 0) {
      console.log(`  ⚠ WARNING: ${tables[i]} has ${count} rows with NULL organisation_id`)
      nullCountFound = true
    }
  }

  if (nullCountFound) {
    console.log('  ⚠ NOT NULL constraints NOT applied due to incomplete backfill')
    console.log('Organisation ownership migration completed with warnings')
    return
  }

  console.log('  ✓ All rows have valid organisation ownership')

  // Step 6: Apply NOT NULL constraints
  console.log('  Applying NOT NULL constraints...')
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE imports ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set imports.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE import_rows ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set import_rows.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE campaigns ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set campaigns.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE daily_campaign_metrics ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set daily_campaign_metrics.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE daily_keyword_metrics ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set daily_keyword_metrics.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE annotations ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set annotations.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE performance_goals ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set performance_goals.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)
  
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE bid_experiments ALTER COLUMN organisation_id SET NOT NULL;
    EXCEPTION
      WHEN others THEN 
        RAISE NOTICE 'Could not set bid_experiments.organisation_id NOT NULL: %', SQLERRM;
    END $$;
  `)

  console.log('  ✓ NOT NULL constraints applied')
  console.log('Organisation ownership migration (P2) completed successfully')
}

/**
 * Phase P3: Migrate unique constraints to be tenant-scoped
 * 
 * Updates all unique constraints/indexes to include organisation_id.
 * This allows multiple organisations to independently store identical data
 * while maintaining deduplication within each organisation.
 */
async function migrateMultiTenantUniqueConstraints() {
  console.log('Migrating multi-tenant unique constraints (P3)...')

  // 1. import_rows: organisation_id + record_key
  console.log('  Updating import_rows uniqueness...')
  await pool.query(`DROP INDEX IF EXISTS idx_import_rows_record_key CASCADE;`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_import_rows_record_key
    ON import_rows (organisation_id, record_key);
  `)
  console.log('  ✓ import_rows: UNIQUE (organisation_id, record_key)')

  // 2. campaigns: organisation_id + app_id + campaign_name
  console.log('  Updating campaigns uniqueness...')
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS uq_campaign;
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `)
  await pool.query(`DROP INDEX IF EXISTS uq_campaign CASCADE;`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign
    ON campaigns (organisation_id, app_id, campaign_name);
  `)
  console.log('  ✓ campaigns: UNIQUE (organisation_id, app_id, campaign_name)')

  // 3. daily_campaign_metrics: organisation_id + app_id + report_date + campaign_name
  console.log('  Updating daily_campaign_metrics uniqueness...')
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE daily_campaign_metrics DROP CONSTRAINT IF EXISTS uq_daily_campaign;
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `)
  await pool.query(`DROP INDEX IF EXISTS uq_daily_campaign CASCADE;`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_campaign
    ON daily_campaign_metrics (organisation_id, app_id, report_date, campaign_name);
  `)
  console.log('  ✓ daily_campaign_metrics: UNIQUE (organisation_id, app_id, report_date, campaign_name)')

  // 4. daily_keyword_metrics: organisation_id + app_id + report_date + campaign_name + ad_group_name + keyword_text + bid_strategy
  console.log('  Updating daily_keyword_metrics uniqueness...')
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE daily_keyword_metrics DROP CONSTRAINT IF EXISTS uq_daily_keyword;
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `)
  await pool.query(`DROP INDEX IF EXISTS uq_daily_keyword CASCADE;`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_keyword
    ON daily_keyword_metrics (organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy);
  `)
  console.log('  ✓ daily_keyword_metrics: UNIQUE (organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)')

  // 5. bid_experiments: organisation_id + keyword_identity_key + change_date + previous_max_cpt_bid + new_max_cpt_bid
  console.log('  Updating bid_experiments uniqueness...')
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE bid_experiments DROP CONSTRAINT IF EXISTS uq_bid_experiment;
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END $$;
  `)
  await pool.query(`DROP INDEX IF EXISTS uq_bid_experiment CASCADE;`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bid_experiment
    ON bid_experiments (organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid);
  `)
  console.log('  ✓ bid_experiments: UNIQUE (organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)')

  console.log('Multi-tenant unique constraints migration (P3) completed successfully')
}

/**
 * Migrate keyword bid history table
 * 
 * Apple Search Ads CSVs contain "Keyword Max Bid", but this value represents the CURRENT bid
 * at report generation time, not the historical bid for each date. Apple retrospectively applies
 * the current bid to all historical dates, making daily_keyword_metrics.keyword_max_cpt_bid
 * unreliable for bid change tracking.
 * 
 * This migration creates keyword_bid_history to track genuine bid observations at import time.
 */
async function migrateKeywordBidHistory() {
  console.log('Migrating keyword bid history table...')
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keyword_bid_history (
      id BIGSERIAL PRIMARY KEY,
      organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      ad_group_name TEXT NOT NULL,
      keyword_text TEXT NOT NULL,
      bid_amount NUMERIC(12, 2) NOT NULL,
      currency TEXT DEFAULT 'GBP',
      observed_at TIMESTAMPTZ NOT NULL,
      report_snapshot_date DATE,
      import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  
  // Add report_snapshot_date column if it doesn't exist (migration safety)
  await pool.query(`
    ALTER TABLE keyword_bid_history 
    ADD COLUMN IF NOT EXISTS report_snapshot_date DATE;
  `)
  
  // Indexes for lookups by keyword identity
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_keyword_bid_history_identity
    ON keyword_bid_history (organisation_id, app_id, campaign_name, ad_group_name, keyword_text, report_snapshot_date DESC NULLS LAST, observed_at DESC);
  `)
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_keyword_bid_history_observed
    ON keyword_bid_history (organisation_id, app_id, campaign_name, ad_group_name, keyword_text, observed_at DESC);
  `)
  
  // Index for lookups by import
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_keyword_bid_history_import
    ON keyword_bid_history (import_id);
  `)
  
  // Index for tenant-scoped queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_keyword_bid_history_org
    ON keyword_bid_history (organisation_id, observed_at DESC);
  `)
  
  console.log('Keyword bid history migration completed successfully')
}

module.exports = { pool, initDb }
