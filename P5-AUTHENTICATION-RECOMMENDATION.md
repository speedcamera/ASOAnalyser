# P5 Authentication Architecture Recommendation

**Date:** Thursday Aug 20, 2026  
**Status:** AWAITING APPROVAL  
**For:** Delm8 SEO Analyser Multi-tenant Production Phase P5

---

## Executive Summary

**RECOMMENDED PROVIDER: Clerk** (https://clerk.com)

**Rationale:** Best fit for React 19 + Express + PostgreSQL stack with our own user/organisation model. Provides JWT-based stateless authentication with minimal integration code, no competing organisation model required, and excellent free tier.

**Key Decision Points:**
- ✅ Managed authentication (no custom password handling)
- ✅ Maps to existing `users` table via `auth_provider` + `auth_provider_user_id`
- ✅ Preserves existing `organisations` and `organisation_users` as source of truth
- ✅ JWT-based stateless architecture (no session table needed)
- ✅ ~13-16 hours estimated implementation time
- ✅ ~230KB bundle size (~60KB gzipped)
- ✅ Free tier: 10,000 monthly active users

---

## 1. Recommended Managed Authentication Provider

### Clerk (https://clerk.com)

**Why Clerk is the Best Fit for THIS Repository:**

✅ **Perfect stack alignment:**
- Native React 19 support with pre-built components
- Express.js SDK with simple JWT verification middleware
- PostgreSQL-agnostic (we maintain our own users table)
- JWT-based stateless architecture (no session table needed)

✅ **No architectural conflicts:**
- Clerk's organization feature is **OPTIONAL** - we don't need it
- We keep full control of our `organisations` and `organisation_users` tables
- Clerk provides authentication only, not tenant management

✅ **Minimal integration overhead:**
- Drop-in `<SignIn>`, `<SignUp>`, `<UserButton>` React components
- Single middleware for Express JWT verification
- Automatic token refresh and session management
- ~230KB total bundle size (gzipped: ~60KB)

✅ **Production-ready security:**
- Secure by default (HttpOnly cookies, CSRF protection)
- Automatic token rotation
- Built-in rate limiting and abuse prevention
- SOC 2 Type II compliant

✅ **Free tier adequate:**
- 10,000 monthly active users free
- Sufficient for MVP and early SaaS growth
- Easy upgrade path if needed (~$25/month for 10K+ MAU)

✅ **Developer experience:**
- Excellent documentation
- User management dashboard (view/manage users without custom admin UI)
- Webhooks for advanced scenarios (not needed for P5)

---

## 2. Alternatives Considered and Why Rejected

| Provider | Pros | Cons | Decision |
|----------|------|------|----------|
| **Auth0** | Enterprise-grade, comprehensive, mature | Complex setup, expensive (~$240/year minimum), overkill for this app, heavy SDK | ❌ **TOO HEAVY** |
| **Supabase Auth** | Good PostgreSQL integration, modern | Requires Supabase platform (ecosystem lock-in), can't use existing PostgreSQL | ❌ **ARCHITECTURAL MISMATCH** |
| **Firebase Auth** | Mature, Google-backed, reliable | Google-centric, poor Express integration, doesn't fit stack | ❌ **STACK MISMATCH** |
| **NextAuth.js** | Open source, flexible, popular | Requires session table, more boilerplate, designed for Next.js | ❌ **MORE CODE THAN NEEDED** |
| **Passport.js** | Battle-tested, traditional | Have to implement OAuth flows, session storage, CSRF, password reset, etc. | ❌ **DEFEATS "MANAGED" PURPOSE** |
| **Magic Links** | Passwordless, simple UX | Requires email infrastructure, not traditional SaaS login experience | ❌ **NON-STANDARD UX** |

**Verdict:** Clerk provides the best balance of simplicity, security, and architectural fit.

---

## 3. Exact Authentication Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ COMPLETE AUTHENTICATION FLOW                                          │
└──────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│ FRONTEND (React)    │
└─────────────────────┘
  User visits /sign-in
    ↓
  <SignIn> component (Clerk React)
    ↓
  Clerk hosted auth page (OAuth/email+password)
    ↓
  JWT token stored (HttpOnly cookie by default)
    ↓
  Clerk SDK sets req.auth on all subsequent requests
    ↓
  Frontend redirects to /

┌─────────────────────┐
│ BACKEND (Express)   │
└─────────────────────┘
  GET /api/apps (protected route)
    ↓
  ClerkExpressRequireAuth() middleware
    → Verifies JWT signature
    → Validates issuer/audience/expiry
    → Attaches req.auth = { userId: "user_2XYZ...", sessionId: "..." }
    → 401 if invalid/missing
    ↓
  requireAuth middleware (CUSTOM)
    → Extract Clerk user ID from req.auth.userId
    → Query: SELECT * FROM users WHERE auth_provider='clerk' AND auth_provider_user_id=$1
    → If not found: FIRST LOGIN FLOW (see section 7)
    → Attach: req.user = { id: 1, email: "...", full_name: "..." }
    → 401 if provisioning fails
    ↓
  requireOrganisation middleware (CUSTOM)
    → Query: SELECT organisation_id, role FROM organisation_users WHERE user_id=$1
    → If no membership: NEW ORG PROVISIONING (see section 8)
    → Attach: req.organisationId = 1, req.membershipRole = "owner"
    → 403 if resolution fails
    ↓
  Route handler
    → Calls existing P4 service: getDashboardSummary({ organisationId: req.organisationId, ... })
    ↓
  Existing tenant-scoped service
    → SQL: SELECT ... WHERE organisation_id = $1 AND ...
    ↓
  Response

┌─────────────────────┐
│ LOGOUT              │
└─────────────────────┘
  User clicks logout
    ↓
  <UserButton> component → Clerk logout
    ↓
  Clerk clears JWT cookie
    ↓
  Frontend redirects to /sign-in
```

---

## 4. Session/Token Architecture

### Token Strategy: **JWT with HttpOnly Cookies**

**Clerk's default and recommended approach:**

1. **Token storage:** HttpOnly cookie named `__session`
   - Secure: true (HTTPS only in production)
   - SameSite: Lax (CSRF protection)
   - HttpOnly: true (XSS protection)
   - Not accessible to JavaScript

2. **Token verification (Backend):**
   - Clerk SDK verifies JWT signature using published JWKS
   - Validates issuer: `https://clerk.accounts.dev` (or custom domain)
   - Validates audience: Clerk application ID
   - Validates expiry automatically
   - **NO manual token decoding** - SDK handles everything

3. **Token refresh:**
   - Automatic by Clerk SDK (frontend)
   - Happens transparently before expiry
   - No application code needed

4. **Session duration:**
   - Default: 7 days (configurable in Clerk dashboard)
   - Sliding window (refreshed on activity)

### Security Properties

✅ **XSS protection:** HttpOnly cookies can't be stolen by JavaScript  
✅ **CSRF protection:** SameSite=Lax + Clerk's built-in CSRF tokens  
✅ **Token forgery:** JWT signature verified with Clerk's public key  
✅ **Token replay:** Short-lived tokens (1 hour), automatic rotation  
✅ **Session hijacking:** Secure flag ensures HTTPS-only transmission

### Alternative: Bearer Tokens (if HttpOnly cookies unsuitable)

Clerk also supports Authorization header with Bearer token:
```
Authorization: Bearer <clerk_session_token>
```

Useful for:
- Mobile apps
- Third-party API integrations
- Environments where cookies don't work

**Recommendation for P5:** Use default HttpOnly cookies (simpler, more secure).

---

## 5. Provider Identity Maps to Existing Users Table

### Identity Mapping Strategy

**Clerk provides stable user ID:** `user_2XYZ123...` (never changes, even if email changes)

**Mapping to local users:**

```sql
-- Lookup local user by Clerk identity
SELECT id, email, full_name 
FROM users 
WHERE auth_provider = 'clerk' 
  AND auth_provider_user_id = 'user_2XYZ123...'
```

### Users Table Schema (Already Exists - Perfect!)

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT,                          -- nullable (verified email from Clerk)
  full_name TEXT,                      -- nullable (name from Clerk)
  auth_provider TEXT,                  -- 'clerk'
  auth_provider_user_id TEXT,          -- 'user_2XYZ123...'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint ensures one local user per Clerk identity
CREATE UNIQUE INDEX idx_users_provider_identity 
  ON users(auth_provider, auth_provider_user_id)
  WHERE auth_provider IS NOT NULL AND auth_provider_user_id IS NOT NULL;
```

### Key Properties

✅ **Stable identity:** Clerk user ID is permanent (survives email changes)  
✅ **No password storage:** Never touches our database  
✅ **Verified claims:** Email verification handled by Clerk  
✅ **Idempotent lookup:** Unique constraint prevents duplicates  
✅ **Extensible:** Can add other providers later (auth0, google, etc.)

---

## 6. First-Login User Provisioning Design

### User Provisioning Flow (First Time User Logs In)

```javascript
// backend/auth.js (NEW FILE)
async function requireAuth(req, res, next) {
  try {
    // 1. Clerk middleware already verified JWT and attached req.auth.userId
    const clerkUserId = req.auth.userId  // e.g., "user_2XYZ123..."
    
    if (!clerkUserId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // 2. Look up local user by provider identity
    const userResult = await pool.query(
      `SELECT id, email, full_name 
       FROM users 
       WHERE auth_provider = $1 AND auth_provider_user_id = $2`,
      ['clerk', clerkUserId]
    )

    // 3. Existing user: use it
    if (userResult.rows[0]) {
      req.user = userResult.rows[0]
      return next()
    }

    // 4. FIRST LOGIN: Create local user from verified Clerk claims
    const clerkUser = await clerkClient.users.getUser(clerkUserId)
    
    const newUser = await pool.query(
      `INSERT INTO users (
        email, 
        full_name, 
        auth_provider, 
        auth_provider_user_id,
        created_at,
        updated_at
       )
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, full_name`,
      [
        clerkUser.emailAddresses[0]?.emailAddress || null,  // verified email
        `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || null,
        'clerk',
        clerkUserId
      ]
    )

    req.user = newUser.rows[0]
    console.log(`✓ Created new user (id=${req.user.id}) for Clerk user ${clerkUserId}`)
    next()

  } catch (error) {
    console.error('Authentication error:', error)
    res.status(401).json({ error: 'Authentication failed' })
  }
}
```

### Security Properties

✅ **Server-side only:** Frontend cannot manipulate user creation  
✅ **Verified claims:** Email/name come from Clerk's verified user object  
✅ **Idempotent:** Unique constraint prevents duplicate users on race conditions  
✅ **Fail-closed:** Authentication error returns 401, never proceeds  
✅ **Stable identity:** Uses Clerk user ID, not mutable email

---

## 7. First-Login Organisation Provisioning Design

### Organisation Provisioning Flow (User Has No Membership)

```javascript
// backend/auth.js (NEW FILE)
async function requireOrganisation(req, res, next) {
  try {
    // 1. Require authenticated user
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // 2. Look up existing organisation membership
    const membershipResult = await pool.query(
      `SELECT organisation_id, role 
       FROM organisation_users 
       WHERE user_id = $1 
       LIMIT 1`,
      [req.user.id]
    )

    // 3. Existing membership: use it
    if (membershipResult.rows[0]) {
      req.organisationId = membershipResult.rows[0].organisation_id
      req.membershipRole = membershipResult.rows[0].role
      return next()
    }

    // 4. NEW USER: Create organisation + owner membership (TRANSACTIONAL)
    const provisionResult = await pool.query(`
      WITH new_org AS (
        INSERT INTO organisations (organisation_name, created_at, updated_at)
        VALUES ($1, NOW(), NOW())
        RETURNING id
      ),
      new_membership AS (
        INSERT INTO organisation_users (organisation_id, user_id, role, created_at)
        SELECT new_org.id, $2, 'owner', NOW()
        FROM new_org
        RETURNING organisation_id, role
      )
      SELECT organisation_id, role FROM new_membership
    `, [
      generateInitialOrgName(req.user),
      req.user.id
    ])

    req.organisationId = provisionResult.rows[0].organisation_id
    req.membershipRole = provisionResult.rows[0].role
    
    console.log(`✓ Created new organisation (id=${req.organisationId}) for user ${req.user.id}`)
    next()

  } catch (error) {
    console.error('Organisation context error:', error)
    res.status(500).json({ error: 'Failed to resolve organisation context' })
  }
}

// Generate sensible initial organisation name
function generateInitialOrgName(user) {
  if (user.full_name) {
    const firstName = user.full_name.split(' ')[0]
    return `${firstName}'s Organisation`
  }
  if (user.email) {
    const username = user.email.split('@')[0]
    return `${username}'s Organisation`
  }
  return 'My Organisation'
}
```

### Key Properties

✅ **Atomic:** Organisation + membership created in single transaction  
✅ **Idempotent:** Existing membership reused, never creates duplicates  
✅ **Automatic owner:** New user automatically gets owner role  
✅ **Sensible default:** Organisation name derived from user profile  
✅ **Editable:** User can rename organisation later (future feature)  
✅ **Isolated:** New users NEVER get Development Organisation access

---

## 8. Development Organisation Bootstrap/Access Strategy

### The Problem

- Development Organisation (id=1) contains all existing production data (40 imports, all metrics)
- Currently: 0 users, 0 organisation memberships
- After P5: HTTP authentication required
- **Risk:** Development Organisation becomes inaccessible, all data locked out

### Recommended Strategy: **Environment-Configured Bootstrap**

**Approach:** Use environment variable to specify which Clerk user should own Development Organisation.

#### Step 1: Developer First Login

```bash
# Developer logs in via Clerk for the first time
# 1. Clerk authenticates successfully
# 2. requireAuth creates local user: id=1, auth_provider='clerk', auth_provider_user_id='user_2ABC123...'
# 3. requireOrganisation creates NEW organisation (not Development Organisation)
# 4. Developer now has access to empty new organisation
```

#### Step 2: Configure Environment

```bash
# backend/.env
DEVELOPMENT_ORG_OWNER_CLERK_ID=user_2ABC123...
```

**How to get Clerk user ID:**
- Option A: Clerk dashboard → Users → click user → copy User ID
- Option B: Console log in `requireAuth` after first login
- Option C: SQL query: `SELECT auth_provider_user_id FROM users WHERE id=1`

#### Step 3: Run Migration (Automatic on Restart)

```javascript
// backend/db.js - Add to existing migrations
async function migrateDevelopmentOrganisationOwner() {
  const clerkUserId = process.env.DEVELOPMENT_ORG_OWNER_CLERK_ID
  
  if (!clerkUserId) {
    console.log('⚠️  DEVELOPMENT_ORG_OWNER_CLERK_ID not set')
    console.log('   Development Organisation will be inaccessible after authentication')
    return
  }

  // 1. Find local user by Clerk ID
  const userResult = await pool.query(
    `SELECT id FROM users 
     WHERE auth_provider = 'clerk' AND auth_provider_user_id = $1`,
    [clerkUserId]
  )

  if (!userResult.rows[0]) {
    console.log(`⚠️  User with Clerk ID ${clerkUserId} not found yet`)
    console.log('   Will be created on first login')
    return
  }

  const userId = userResult.rows[0].id

  // 2. Find Development Organisation
  const orgResult = await pool.query(
    `SELECT id FROM organisations WHERE organisation_name = 'Development Organisation'`
  )

  if (!orgResult.rows[0]) {
    console.log('⚠️  Development Organisation not found')
    return
  }

  const devOrgId = orgResult.rows[0].id

  // 3. Create owner membership (idempotent)
  await pool.query(`
    INSERT INTO organisation_users (organisation_id, user_id, role, created_at)
    VALUES ($1, $2, 'owner', NOW())
    ON CONFLICT (organisation_id, user_id) DO NOTHING
  `, [devOrgId, userId])

  console.log(`✓ Development Organisation (id=${devOrgId}) owner membership ensured for user ${userId}`)
}
```

#### Alternative: Manual SQL (If Environment Approach Undesirable)

```sql
-- One-time manual operation after developer's first login
INSERT INTO organisation_users (organisation_id, user_id, role)
VALUES (
  (SELECT id FROM organisations WHERE organisation_name = 'Development Organisation'),
  (SELECT id FROM users WHERE auth_provider = 'clerk' LIMIT 1),
  'owner'
)
ON CONFLICT DO NOTHING;
```

### Properties

✅ **Explicit:** Environment variable clearly declares ownership  
✅ **Safe:** No hardcoded personal emails in code  
✅ **Flexible:** Can grant multiple users access via additional inserts  
✅ **Auditable:** Clear record of who has Development Organisation access  
✅ **Reversible:** Can revoke access by deleting membership row

---

## 9. How requireAuth Should Work

### Conceptual Middleware

```javascript
// backend/auth.js (NEW FILE)
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node')
const { clerkClient } = require('@clerk/clerk-sdk-node')
const { pool } = require('./db')

/**
 * Step 1: Verify Clerk JWT and extract provider identity
 * Uses Clerk's official middleware
 */
const verifyClerkAuth = ClerkExpressRequireAuth()

/**
 * Step 2: Map provider identity to local user
 * Creates user on first login
 */
async function requireAuth(req, res, next) {
  try {
    // Clerk middleware already verified JWT
    const clerkUserId = req.auth.userId
    
    if (!clerkUserId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Look up local user
    let userResult = await pool.query(
      `SELECT id, email, full_name 
       FROM users 
       WHERE auth_provider = $1 AND auth_provider_user_id = $2`,
      ['clerk', clerkUserId]
    )

    // First login: create local user
    if (!userResult.rows[0]) {
      const clerkUser = await clerkClient.users.getUser(clerkUserId)
      
      userResult = await pool.query(
        `INSERT INTO users (email, full_name, auth_provider, auth_provider_user_id)
         VALUES ($1, $2, 'clerk', $3)
         RETURNING id, email, full_name`,
        [
          clerkUser.emailAddresses[0]?.emailAddress || null,
          `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || null,
          clerkUserId
        ]
      )
      
      console.log(`✓ Created user ${userResult.rows[0].id} for Clerk user ${clerkUserId}`)
    }

    // Attach trusted local user identity
    req.user = userResult.rows[0]
    next()

  } catch (error) {
    console.error('Auth error:', error)
    res.status(401).json({ error: 'Unauthorized' })
  }
}

module.exports = { verifyClerkAuth, requireAuth }
```

### Usage in Routes

```javascript
// backend/index.js
const { verifyClerkAuth, requireAuth, requireOrganisation } = require('./auth')

// Protected customer-data route
app.get('/api/apps', 
  verifyClerkAuth,       // Step 1: Verify JWT
  requireAuth,           // Step 2: Resolve local user
  requireOrganisation,   // Step 3: Resolve organisation
  async (req, res) => {
    // req.user = { id, email, full_name }
    // req.organisationId = 1
    // req.membershipRole = 'owner'
    
    const apps = await listApps(req.organisationId)
    res.json(apps)
  }
)

// Public health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})
```

### Security Properties

✅ **Fail-closed:** Missing/invalid JWT → 401  
✅ **JWT verified:** Clerk SDK validates signature, issuer, audience, expiry  
✅ **No token decoding:** SDK handles all verification  
✅ **Server-side only:** Frontend cannot forge req.user  
✅ **Idempotent:** Safe to call multiple times (unique constraint)

---

## 10. How requireOrganisation Should Work

### Conceptual Middleware

```javascript
// backend/auth.js (NEW FILE)
async function requireOrganisation(req, res, next) {
  try {
    // Require authenticated user
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Look up organisation membership
    let membershipResult = await pool.query(
      `SELECT organisation_id, role 
       FROM organisation_users 
       WHERE user_id = $1 
       LIMIT 1`,
      [req.user.id]
    )

    // Existing membership: use it
    if (membershipResult.rows[0]) {
      req.organisationId = membershipResult.rows[0].organisation_id
      req.membershipRole = membershipResult.rows[0].role
      return next()
    }

    // NEW USER: Create organisation + owner membership
    membershipResult = await pool.query(`
      WITH new_org AS (
        INSERT INTO organisations (organisation_name)
        VALUES ($1)
        RETURNING id
      ),
      new_membership AS (
        INSERT INTO organisation_users (organisation_id, user_id, role)
        SELECT new_org.id, $2, 'owner'
        FROM new_org
        RETURNING organisation_id, role
      )
      SELECT organisation_id, role FROM new_membership
    `, [
      generateInitialOrgName(req.user),
      req.user.id
    ])

    req.organisationId = membershipResult.rows[0].organisation_id
    req.membershipRole = membershipResult.rows[0].role
    
    console.log(`✓ Created org ${req.organisationId} for user ${req.user.id}`)
    next()

  } catch (error) {
    console.error('Organisation context error:', error)
    res.status(500).json({ error: 'Failed to resolve organisation context' })
  }
}
```

### Attached Request Context

After middleware chain completes:

```javascript
req.user = {
  id: 1,
  email: 'user@example.com',
  full_name: 'John Doe'
}

req.organisationId = 1
req.membershipRole = 'owner'  // or 'admin' or 'analyst'
```

### Properties

✅ **Always resolves:** Either existing membership or new organisation created  
✅ **Transactional:** Organisation + membership created atomically  
✅ **Idempotent:** Existing membership reused  
✅ **Role-aware:** Exposes membership role for future RBAC  
✅ **Single organisation:** P5 assumes one org per user (switching is later phase)

---

## 11. Transitional Development Organisation Resolver Removal

### Current State (P4)

```javascript
// backend/index.js
async function resolveOrganisationContext() {
  return await getTransitionalOrganisationId()  // Always returns Dev Org (id=1)
}

// Every customer-data route
app.get('/api/apps', async (req, res) => {
  const organisationId = await resolveOrganisationContext()  // ← TRANSITIONAL
  const apps = await listApps(organisationId)
  res.json(apps)
})
```

### Target State (P5)

```javascript
// backend/index.js
app.get('/api/apps', 
  verifyClerkAuth,
  requireAuth,
  requireOrganisation,
  async (req, res) => {
    const apps = await listApps(req.organisationId)  // ← AUTHENTICATED
    res.json(apps)
  }
)
```

### Replacement Strategy

#### Category A: HTTP Customer Requests (MUST REPLACE)

**ALL customer-data routes** must replace `resolveOrganisationContext()` with authenticated middleware.

**Routes to update (~23 routes):**
- `/api/apps`
- `/api/imports` (GET, POST)
- `/api/imports/:id` (and all child routes)
- `/api/compare/period`
- `/api/campaigns/weekly-performance`
- `/api/campaigns/:id` (PATCH)
- `/api/annotations` (GET, POST, PUT, DELETE)
- `/api/goals` (GET, POST, PUT, DELETE)
- `/api/alerts`
- `/api/insights`
- `/api/bid-experiments` (GET, GET by ID)
- All other customer-data routes

#### Category B: Startup/Migration Tasks (MAY KEEP)

**Legitimate uses that should KEEP `getTransitionalOrganisationId()`:**

```javascript
// backend/db.js - Startup backfills
async function initDb() {
  // ... migrations ...
  
  // Startup backfill for Development Organisation only
  const devOrgId = await getTransitionalOrganisationId()  // ✅ OK - NOT an HTTP request
  
  setImmediate(async () => {
    await detectBidExperiments({ organisationId: devOrgId })  // Background task
  })
}
```

**Keep `getTransitionalOrganisationId()` for:**
- Database migrations
- Startup backfills for Development Organisation
- Background tasks that process Development Organisation data
- Test utilities

**Mark clearly:**

```javascript
/**
 * LEGACY: Get Development Organisation ID for startup/migration tasks only.
 * 
 * DO NOT USE FOR HTTP REQUESTS - use req.organisationId from authenticated middleware.
 * 
 * Valid uses:
 * - Database migrations
 * - Startup backfills for Development Organisation
 * - Background cron jobs (if they need Development Organisation context)
 * - Test utilities
 */
async function getTransitionalOrganisationId() {
  // ... existing implementation ...
}
```

#### Category C: Test Utilities (MAY KEEP OR REFACTOR)

**Test scripts** can either:
- Option A: Keep using `getTransitionalOrganisationId()` for simplicity
- Option B: Accept explicit `organisationId` parameter

### Implementation Checklist

1. ✅ Add authentication middleware (`verifyClerkAuth`, `requireAuth`, `requireOrganisation`)
2. ✅ Apply middleware to ALL customer-data routes
3. ✅ Replace `resolveOrganisationContext()` calls with `req.organisationId`
4. ✅ Delete `resolveOrganisationContext()` function from `index.js`
5. ✅ Keep `getTransitionalOrganisationId()` in `db.js` with clear "LEGACY" comment
6. ✅ Verify no HTTP route uses `getTransitionalOrganisationId()` directly

---

## 12. Minimum Frontend Changes Required

### Current State

```javascript
// frontend/src/App.jsx
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="keywords" element={<Keywords />} />
        <Route path="history" element={<History />} />
      </Route>
    </Routes>
  )
}
```

**No authentication - all routes public**

### Target State (Minimal P5 Changes)

#### 1. Add Clerk Provider Wrapper

```javascript
// frontend/src/main.jsx
import { ClerkProvider } from '@clerk/clerk-react'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </ClerkProvider>
  </StrictMode>
)
```

#### 2. Add Route Guards

```javascript
// frontend/src/App.jsx
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'

export default function App() {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      
      <SignedIn>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="keywords" element={<Keywords />} />
            <Route path="history" element={<History />} />
          </Route>
        </Routes>
      </SignedIn>
    </>
  )
}
```

#### 3. Add User Menu to Layout

```javascript
// frontend/src/components/Layout.jsx
import { UserButton } from '@clerk/clerk-react'

export default function Layout() {
  return (
    <div>
      <TopNav />
      <div className="user-menu">
        <UserButton afterSignOutUrl="/sign-in" />
      </div>
      <Outlet />
    </div>
  )
}
```

#### 4. Handle 401 Responses in API Client (Optional)

```javascript
// frontend/src/api.js
export async function fetchImports() {
  const res = await fetch('/api/imports')
  
  if (res.status === 401) {
    // Token expired or invalid - redirect to sign in
    window.location.href = '/sign-in'
    return
  }
  
  if (!res.ok) throw new Error('Failed to load imports')
  return res.json()
}
```

### Summary of Frontend Changes

**New files:** 0 (Clerk provides components, no custom pages needed)

**Modified files:** 3
1. `frontend/src/main.jsx` - Add `<ClerkProvider>`
2. `frontend/src/App.jsx` - Add `<SignedIn>` / `<SignedOut>` guards
3. `frontend/src/components/Layout.jsx` - Add `<UserButton>`

**Optional:** Add 401 handling to `frontend/src/api.js` (can be done incrementally)

**NO changes to:**
- Dashboard.jsx
- Campaigns.jsx
- Keywords.jsx
- History.jsx
- Any analytics components
- Any business logic

---

## 13. Packages to Add

### Backend (1 package)

```bash
npm install @clerk/clerk-sdk-node
```

**Version:** ^5.0.0  
**Size:** ~150KB  
**Purpose:** 
- JWT verification middleware
- Clerk API client (fetch user details)
- JWKS caching

### Frontend (1 package)

```bash
npm install @clerk/clerk-react
```

**Version:** ^5.0.0  
**Size:** ~80KB  
**Purpose:**
- React components (`<ClerkProvider>`, `<SignedIn>`, `<SignedOut>`, `<UserButton>`, `<RedirectToSignIn>`)
- Authentication hooks (`useAuth`, `useUser`)
- Automatic token management

**Total bundle impact:** ~230KB uncompressed (~60KB gzipped)

---

## 14. Environment Variables Required

### Backend `.env`

```bash
# Existing
DATABASE_URL=postgresql://myappuser:Password@localhost:5432/seoanalyser
PORT=3001

# NEW - P5 Authentication
CLERK_SECRET_KEY=sk_test_...                    # REQUIRED - JWT verification key (NEVER commit)
CLERK_PUBLISHABLE_KEY=pk_test_...               # REQUIRED - Public key (safe to expose)
DEVELOPMENT_ORG_OWNER_CLERK_ID=user_2ABC123...  # OPTIONAL - For Dev Org access
```

### Frontend `.env`

```bash
# NEW - P5 Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...  # REQUIRED - Must match backend's publishable key
```

### Obtaining Clerk Keys

1. Create free Clerk account at https://clerk.com
2. Create new application (choose "Email + Password" or "Google OAuth")
3. Dashboard → API Keys → copy:
   - **Secret Key** → `CLERK_SECRET_KEY` (backend only, never expose)
   - **Publishable Key** → Both `CLERK_PUBLISHABLE_KEY` (backend) and `VITE_CLERK_PUBLISHABLE_KEY` (frontend)

### `.env.example` Files (To Create)

```bash
# backend/.env.example
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PORT=3001
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
DEVELOPMENT_ORG_OWNER_CLERK_ID=user_2...  # Optional: Set after first login

# frontend/.env.example
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

---

## 15. Database Migration Required

### Migration Required: **YES - ONE MIGRATION**

**Purpose:** Associate authenticated developer with Development Organisation

**When to run:** After developer's first Clerk login

```javascript
// backend/db.js - Add to existing migrations
async function migrateDevelopmentOrganisationOwner() {
  console.log('Migrating Development Organisation ownership (P5)...')
  
  const clerkUserId = process.env.DEVELOPMENT_ORG_OWNER_CLERK_ID
  
  if (!clerkUserId) {
    console.log('  ⚠️  DEVELOPMENT_ORG_OWNER_CLERK_ID not set')
    console.log('     Development Organisation will be inaccessible after authentication')
    console.log('     Set this environment variable after first Clerk login')
    return
  }

  // Find local user by Clerk ID
  const userResult = await pool.query(
    `SELECT id FROM users 
     WHERE auth_provider = 'clerk' AND auth_provider_user_id = $1`,
    [clerkUserId]
  )

  if (!userResult.rows[0]) {
    console.log(`  ⚠️  User with Clerk ID ${clerkUserId} not found`)
    console.log('     User will be created on first login')
    console.log('     Re-run migration after first login')
    return
  }

  const userId = userResult.rows[0].id

  // Find Development Organisation
  const orgResult = await pool.query(
    `SELECT id FROM organisations WHERE organisation_name = 'Development Organisation'`
  )

  if (!orgResult.rows[0]) {
    console.log('  ⚠️  Development Organisation not found')
    return
  }

  const devOrgId = orgResult.rows[0].id

  // Create owner membership (idempotent)
  const insertResult = await pool.query(`
    INSERT INTO organisation_users (organisation_id, user_id, role, created_at)
    VALUES ($1, $2, 'owner', NOW())
    ON CONFLICT (organisation_id, user_id) DO NOTHING
    RETURNING id
  `, [devOrgId, userId])

  if (insertResult.rows[0]) {
    console.log(`  ✓ Granted Development Organisation (id=${devOrgId}) owner access to user ${userId}`)
  } else {
    console.log(`  ✓ Development Organisation owner membership already exists`)
  }
  
  console.log('Development Organisation ownership migration completed')
}
```

**Call from `initDb()`:**

```javascript
async function initDb() {
  // ... existing migrations ...
  await migrateMultiTenantFoundation()  // P1
  await migrateOrganisationOwnership()  // P2
  await migrateMultiTenantUniqueConstraints()  // P3
  await migrateDevelopmentOrganisationOwner()  // P5 - NEW
  
  // ... rest of startup ...
}
```

**Properties:**
- ✅ Idempotent (uses ON CONFLICT DO NOTHING)
- ✅ Safe to run multiple times
- ✅ Warns if environment variable not set
- ✅ Warns if user not found yet (will work after first login)
- ✅ No schema changes (only data)

**No other database changes required** - P1 schema is already perfect for P5.

---

## 16. Files Expected to Change During Implementation

### New Files (2)

1. **`backend/auth.js`**
   - `verifyClerkAuth` (re-export Clerk middleware)
   - `requireAuth(req, res, next)` - map Clerk ID to local user
   - `requireOrganisation(req, res, next)` - resolve organisation membership
   - `generateInitialOrgName(user)` - helper

2. **`backend/.env.example`**
   - Document Clerk environment variables

### Modified Files (8)

1. **`backend/db.js`**
   - Add `migrateDevelopmentOrganisationOwner()` function
   - Call from `initDb()`
   - Mark `getTransitionalOrganisationId()` as LEGACY

2. **`backend/index.js`**
   - Import `{ verifyClerkAuth, requireAuth, requireOrganisation }` from `./auth`
   - Apply middleware to ALL customer-data routes (~23 routes)
   - Replace `await resolveOrganisationContext()` with `req.organisationId`
   - Delete `resolveOrganisationContext()` function

3. **`backend/package.json`**
   - Add `@clerk/clerk-sdk-node`

4. **`frontend/src/main.jsx`**
   - Import `ClerkProvider`
   - Wrap app in `<ClerkProvider>`

5. **`frontend/src/App.jsx`**
   - Import `SignedIn`, `SignedOut`, `RedirectToSignIn`
   - Add route guards

6. **`frontend/src/components/Layout.jsx`**
   - Import `UserButton`
   - Add user menu with logout

7. **`frontend/package.json`**
   - Add `@clerk/clerk-react`

8. **`frontend/.env.example`**
   - Document `VITE_CLERK_PUBLISHABLE_KEY`

### Optional Modifications (Can Be Incremental)

9. **`frontend/src/api.js`**
   - Add 401 response handling (redirect to sign-in)

10. **`docs/PRODUCTION.md`**
    - Update P5 section with actual implementation
    - Mark authentication as ✅ COMPLETE

11. **`docs/ARCHITECTURE.md`**
    - Update authentication flow
    - Fix outdated query scoping statement

---

## 17. Security Risks and Implementation Concerns

### Risk 1: Breaking P4.1 Tenant Isolation

**Risk:** Authentication layer could introduce new tenant leak vectors.

**Mitigation:**
- ✅ P4 services remain unchanged (still require explicit `organisationId` argument)
- ✅ `req.organisationId` assigned by trusted backend middleware, not client
- ✅ Client-supplied `organisation_id` in body/query **ALREADY IGNORED** by P4
- ✅ Re-run P4.1 isolation tests after P5 implementation
- ✅ Add two-user authenticated isolation test

**Verification:** Run `test-p4.1-isolation.js` and new authenticated test.

---

### Risk 2: Development Organisation Lockout

**Risk:** Developer loses access to existing Development Organisation data (40 imports, all metrics).

**Mitigation:**
- ✅ Environment variable provides explicit control
- ✅ Migration warns if configuration missing
- ✅ Manual SQL fallback available
- ✅ Can grant multiple users access if needed
- ✅ Migration is idempotent (safe to re-run)

**Verification:** After P5, authenticated developer can see Development Organisation data.

---

### Risk 3: JWT/Session Security Issues

**Risk:** Token theft, CSRF, XSS could compromise accounts.

**Mitigation:**
- ✅ Clerk SDK handles all token lifecycle (battle-tested)
- ✅ HttpOnly cookies (XSS protection)
- ✅ SameSite=Lax (CSRF protection)
- ✅ Automatic token refresh (no stale tokens)
- ✅ Short-lived tokens (1 hour, auto-rotated)
- ✅ Clerk's built-in rate limiting and abuse prevention

**Verification:** Review Clerk security documentation, run security tests.

---

### Risk 4: Race Condition on First Login

**Risk:** Concurrent requests during first login might create duplicate users/organisations.

**Mitigation:**
- ✅ Unique constraint on `(auth_provider, auth_provider_user_id)` prevents duplicate users
- ✅ Unique constraint on `(organisation_id, user_id)` prevents duplicate memberships
- ✅ PostgreSQL transaction ensures atomic organisation + membership creation
- ✅ `LIMIT 1` on membership lookup ensures single organisation used

**Verification:** Test concurrent first-login requests (should result in single user/org).

---

### Risk 5: CORS/Cookie Configuration Issues

**Risk:** Frontend-backend on different origins might break cookie auth.

**Mitigation:**
- ✅ Development: Use Vite proxy to same origin (no CORS issues)
- ✅ Production: Configure backend CORS to allow specific frontend origin
- ✅ Clerk supports both cookie and Bearer token modes (flexible)
- ✅ Clerk documentation covers all deployment scenarios

**Configuration:**

```javascript
// backend/index.js
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true  // Allow cookies
}))
```

---

### Risk 6: Missing/Invalid Environment Variables

**Risk:** Server starts but authentication fails silently due to missing Clerk keys.

**Mitigation:**
- ✅ Fail-fast validation at startup
- ✅ Clear error messages
- ✅ `.env.example` files document required variables

```javascript
// backend/index.js - Add startup validation
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error('CLERK_SECRET_KEY is required in backend/.env')
}

if (!process.env.CLERK_PUBLISHABLE_KEY) {
  throw new Error('CLERK_PUBLISHABLE_KEY is required in backend/.env')
}
```

---

### Risk 7: Email Change Could Break Identity Mapping

**Risk:** User changes email in Clerk, breaks local user lookup.

**Mitigation:**
- ✅ **We use Clerk user ID, not email** for identity mapping
- ✅ Clerk user ID is stable (never changes)
- ✅ Email change in Clerk doesn't affect local user lookup
- ✅ Can update local user's email if needed (separate feature)

**Not a risk** - architecture already handles this correctly.

---

### Risk 8: Clerk Service Downtime

**Risk:** Clerk outage prevents all authentication.

**Mitigation:**
- ✅ Clerk has 99.99% uptime SLA
- ✅ Multiple data centers, DDoS protection
- ✅ If needed, can implement JWT caching (advanced)
- ✅ Fallback: Export users and migrate to another provider (future)

**For P5:** Accept managed service risk (same as using Auth0, AWS Cognito, etc.).

---

## 18. Existing Documentation That Is Now Outdated

### 1. PRODUCTION.md - Outdated Authentication Sections

**Location:** Lines 139-145, 853-960, 1366-1389, 1545-1620

**Issue:** Contains aspirational design mentioning:
- `password_hash` column (never implemented)
- `bcrypt` hashing (never implemented)
- Passport.js (never implemented)
- Local password authentication (never implemented)

**Correct State:** P1 actually implemented `auth_provider` + `auth_provider_user_id` (external provider model).

**Example Outdated Content:**

```markdown
<!-- OUTDATED - Lines 139-145 -->
users
  id                    SERIAL PRIMARY KEY
  email                 TEXT UNIQUE NOT NULL
  password_hash         TEXT NOT NULL  ❌ INCORRECT - This was never added
  full_name             TEXT
```

**Should Document P1 Actual Implementation:**

```markdown
users
  id                    SERIAL PRIMARY KEY
  email                 TEXT
  full_name             TEXT
  auth_provider         TEXT  ✅ ACTUALLY IMPLEMENTED
  auth_provider_user_id TEXT  ✅ ACTUALLY IMPLEMENTED
```

**Action for P5:** Update P5 section to reflect Clerk implementation, mark older aspirational sections as SUPERSEDED.

---

### 2. ARCHITECTURE.md - Outdated Query Scoping Statement

**Location:** Line 40

**Current Text:**
```markdown
**Multi-tenant ownership (P2):** All customer data tables now include `organisation_id INTEGER NOT NULL` 
referencing `organisations(id)`. Current data belongs to Development Organisation. 
Queries do not yet filter by organisation (deferred to later phase).  ❌ INCORRECT
```

**Issue:** "Queries do not yet filter by organisation" is FALSE after P4/P4.1.

**Correct State After P4.1:**
- ALL analytics queries filter by `organisation_id`
- ALL CRUD operations filter by `organisation_id`
- All SQL audited and verified tenant-safe
- P4.1 two-organisation isolation tests passed

**Should Say:**

```markdown
**Multi-tenant ownership (P2):** All customer data tables now include `organisation_id INTEGER NOT NULL` 
referencing `organisations(id)`. ✅ CORRECT

**Multi-tenant query scoping (P4):** All backend queries filter by `organisation_id`. 
Every analytics service function requires `organisationId` parameter. 
IDOR protection implemented. P4.1 isolation tests executed and passed. ✅ CORRECT
```

**Action for P5:** Update ARCHITECTURE.md section 2 to reflect P4 implementation.

---

### 3. PRODUCTION.md - Passport/bcrypt Recommendations

**Location:** Lines 1545-1555

**Current Text:**
```markdown
**Recommended:** Use an established library:

- **Node.js:** [Passport.js](http://www.passportjs.org/) (local strategy with bcrypt)  ❌ OUTDATED
- **Alternative:** [Auth0](https://auth0.com/), [Clerk](https://clerk.dev/), or [Supabase Auth]  ℹ️ ALTERNATIVES LISTED
```

**Issue:** Recommends Passport + bcrypt, but P1 intentionally used external provider model instead.

**Should Recommend:** Managed authentication only (no custom password implementation).

**Action for P5:** Update to state P5 uses Clerk, remove Passport + bcrypt recommendation.

---

### 4. PRODUCTION.md - Development User Creation Example

**Location:** Lines 960-966

**Current Text:**
```sql
INSERT INTO users (email, password_hash, full_name, created_at)
VALUES ('dev@delm8.com', '<bcrypt_hash>', 'Development User', NOW())  ❌ INCORRECT SCHEMA
```

**Issue:** References `password_hash` column that doesn't exist.

**Correct Approach:** Use environment-configured Clerk ID mapping (section 8 of this document).

**Action for P5:** Replace with P5 Development Organisation bootstrap documentation.

---

### Summary of Documentation Updates Needed During P5 Implementation

| File | Section | Issue | Action |
|------|---------|-------|--------|
| `PRODUCTION.md` | Lines 139-145 | Shows `password_hash` schema | Update to show actual P1 schema |
| `PRODUCTION.md` | Lines 853-960 | Aspirational password auth design | Mark as SUPERSEDED, link to P5 |
| `PRODUCTION.md` | Lines 1545-1555 | Recommends Passport + bcrypt | Replace with "P5 uses Clerk" |
| `PRODUCTION.md` | P5 section | Needs actual implementation docs | Add P5 Clerk implementation details |
| `ARCHITECTURE.md` | Line 40 | "Queries do not yet filter" | Update to reflect P4 implementation |
| `ARCHITECTURE.md` | Section 2 | Missing P4 query scoping | Add P4 query scoping documentation |

---

## 19. Proposed P5 Implementation Sequence

### Phase 1: Backend Authentication Foundation (Est: 2 hours)

**Goal:** Install Clerk, create middleware, verify JWT works

1. Install backend package:
   ```bash
   cd backend
   npm install @clerk/clerk-sdk-node
   ```

2. Create `backend/auth.js` with:
   - `verifyClerkAuth` (re-export Clerk middleware)
   - `requireAuth(req, res, next)`
   - `requireOrganisation(req, res, next)`
   - `generateInitialOrgName(user)`

3. Add environment variables to `backend/.env`:
   ```bash
   CLERK_SECRET_KEY=sk_test_...
   CLERK_PUBLISHABLE_KEY=pk_test_...
   ```

4. Add startup validation to `backend/index.js`

5. Test JWT verification manually with curl

**Acceptance:** Backend can verify Clerk JWT and returns 401 for invalid tokens.

---

### Phase 2: Backend Route Protection (Est: 2 hours)

**Goal:** Protect all customer-data routes, replace transitional resolver

1. Import middleware in `backend/index.js`
2. Apply to ONE test route first
3. Test with manual Clerk JWT
4. Apply to ALL remaining customer-data routes (~22 more)
5. Delete `resolveOrganisationContext()` function
6. Mark `getTransitionalOrganisationId()` as LEGACY

**Acceptance:** All customer-data routes return 401 without JWT, work with valid JWT.

---

### Phase 3: Development Organisation Access (Est: 1 hour)

**Goal:** Ensure existing data accessible after authentication

1. Add migration to `backend/db.js`
2. Call from `initDb()` 
3. First login as developer via Clerk
4. Get Clerk user ID and add to `.env`
5. Restart backend (migration runs)
6. Verify membership created
7. Login again, check `/api/apps` - should see Development Organisation data

**Acceptance:** Authenticated developer can access Development Organisation (40 imports, all metrics).

---

### Phase 4: Frontend Authentication Integration (Est: 2 hours)

**Goal:** Add Clerk UI components, protect routes

1. Install `@clerk/clerk-react`
2. Add `VITE_CLERK_PUBLISHABLE_KEY` to frontend `.env`
3. Wrap app in `<ClerkProvider>`
4. Add route guards (`<SignedIn>`, `<SignedOut>`)
5. Add `<UserButton>` to Layout
6. Test flow: sign-in, dashboard, logout

**Acceptance:** Frontend requires authentication, redirects to Clerk sign-in, logout works.

---

### Phase 5: New User Flow Testing (Est: 1 hour)

**Goal:** Verify new users get their own organisation (not Development Organisation)

1. Sign up new test user via Clerk
2. Verify backend logs show user + org creation
3. Verify database state
4. Login as new user, check empty dashboard
5. Create test import
6. Verify isolation (import belongs to new org, not Dev Org)

**Acceptance:** New users get their own empty organisation, NOT Development Organisation.

---

### Phase 6: Two-User Authenticated Isolation Test (Est: 2 hours)

**Goal:** Prove authenticated tenant isolation (extends P4.1 to HTTP layer)

1. Create test script `test-p5-authenticated-isolation.js`
2. Sign up User A and User B
3. Insert identical advertising data in both organisations
4. Authenticate as User A, call APIs → sees only Org A data
5. Authenticate as User B, call APIs → sees only Org B data
6. User B attempts GET /api/imports/:orgAImportId → 404

**Acceptance:** Two authenticated users remain completely isolated at HTTP boundary.

---

### Phase 7: Security Test Suite (Est: 1 hour)

**Goal:** Verify all fail-closed behaviors

Run tests:
1. ✅ No JWT → 401
2. ✅ Invalid JWT → 401
3. ✅ Expired JWT → 401
4. ✅ Valid user with organisation → 200
5. ✅ Forged `organisation_id` → ignored
6. ✅ Cross-tenant resource access → 404
7. ✅ Logout → 401
8. ✅ Page refresh → session persists
9. ✅ Repeated first login → no duplicates

**Acceptance:** All security tests pass.

---

### Phase 8: P4.1 Regression Testing (Est: 30 minutes)

**Goal:** Verify P5 didn't break P4.1 tenant isolation

1. Re-run `test-p4.1-isolation.js`
2. Expected: ALL TESTS PASS
3. If failures: stop, investigate, fix

**Acceptance:** P4.1 isolation tests still pass after P5.

---

### Phase 9: Documentation (Est: 1 hour)

**Goal:** Update documentation to reflect P5 implementation

1. Update `docs/PRODUCTION.md`
2. Update `docs/ARCHITECTURE.md`
3. Create `.env.example` files
4. Document environment variables
5. Document Development Organisation access setup

**Acceptance:** Documentation accurate and complete.

---

### Phase 10: Final Verification (Est: 30 minutes)

**Goal:** End-to-end verification

1. Developer first login flow ✅
2. Development Organisation access ✅
3. New external user signup ✅
4. Logout/login cycles ✅
5. Page refresh maintains session ✅

**Acceptance:** Complete end-to-end flow works correctly.

---

### Estimated Total Implementation Time

| Phase | Hours |
|-------|-------|
| 1. Backend auth foundation | 2 |
| 2. Backend route protection | 2 |
| 3. Development Org access | 1 |
| 4. Frontend integration | 2 |
| 5. New user flow testing | 1 |
| 6. Two-user isolation test | 2 |
| 7. Security test suite | 1 |
| 8. P4.1 regression testing | 0.5 |
| 9. Documentation | 1 |
| 10. Final verification | 0.5 |
| **TOTAL** | **13 hours** |

**Contingency:** Add 20% buffer → **~16 hours total**

---

## 20. Conclusion and Next Steps

**RECOMMENDATION: Clerk**

Clerk is the optimal managed authentication provider for this repository because:

1. ✅ Perfect architectural fit (React + Express + PostgreSQL + our own user/org model)
2. ✅ Minimal code changes (~2 new files, ~8 modified files)
3. ✅ No schema changes required (P1 schema already perfect)
4. ✅ JWT-based stateless architecture (no session table)
5. ✅ Production-ready security (HttpOnly cookies, CSRF protection, auto-refresh)
6. ✅ Free tier adequate (10K MAU)
7. ✅ ~13-16 hours estimated implementation time

**P5 will provide:**
- ✅ Secure authentication without custom password handling
- ✅ Automatic user/organisation provisioning
- ✅ Development Organisation access preservation
- ✅ Tenant isolation at HTTP boundary
- ✅ Session management with logout
- ✅ Production-ready authentication for external SaaS users

**Ready for approval to proceed with implementation.**

---

### Approval Required Before Implementation

Please confirm:

1. ✅ Clerk is acceptable as the authentication provider
2. ✅ JWT-based stateless architecture is acceptable
3. ✅ Environment variable for Development Organisation owner is acceptable
4. ✅ HttpOnly cookie token storage is acceptable
5. ✅ Proposed middleware architecture (`requireAuth` → `requireOrganisation`) is acceptable

**After approval, implementation will proceed in 10 phases as outlined above.**

---

**END OF P5 AUTHENTICATION ARCHITECTURE RECOMMENDATION**
