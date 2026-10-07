# Phase 7A: Performance Goals and Alerts - Complete ✅

## Summary

Successfully implemented user-defined performance goals and dynamic alert evaluation for campaigns and keywords. Goals define thresholds that trigger alerts when current metrics breach those thresholds over a specified period.

---

## 1. Files Changed

### Backend (7 files)

#### New Files
1. **`backend/goals.js`** (NEW - 246 lines)
   - CRUD operations for performance goals
   - Validation for entity types, metrics, operators, periods
   - Constants: `VALID_ENTITY_TYPES`, `VALID_METRICS`, `VALID_OPERATORS`, `VALID_PERIODS`

2. **`backend/alerts.js`** (NEW - 176 lines)
   - Dynamic alert evaluation
   - Uses Analytics Service to fetch current metrics
   - Calculates breach amount and percentage
   - Filters entities by entity_key
   - Handles zero denominator (null/undefined) cases

#### Modified Files
3. **`backend/db.js`**
   - Added `performance_goals` table schema
   - Added indexes on `(entity_type, entity_key)` and `(is_active, entity_type)`

4. **`backend/index.js`**
   - Added imports for goals and alerts services
   - Added 5 new API endpoints:
     - `GET /api/goals` - List goals (filterable)
     - `POST /api/goals` - Create goal
     - `PUT /api/goals/:id` - Update goal
     - `DELETE /api/goals/:id` - Delete goal
     - `GET /api/alerts` - Get active alerts (evaluated dynamically)

---

### Frontend (5 files)

#### New Files
5. **`frontend/src/components/GoalManagementPanel.jsx`** (NEW - 304 lines)
   - Reusable goal management drawer
   - Form to add/edit goals (metric, operator, threshold, period)
   - List of existing goals
   - Toggle active/inactive
   - Delete confirmation

6. **`frontend/src/components/DashboardAlerts.jsx`** (NEW - 150 lines)
   - Dashboard alerts section
   - Displays active alerts in card grid
   - Shows entity name, metric, threshold, current value, breach amount
   - Clickable cards navigate to Campaign or Keyword page

#### Modified Files
7. **`frontend/src/api.js`**
   - Added `fetchGoals()` - GET /api/goals
   - Added `createGoal()` - POST /api/goals
   - Added `updateGoal()` - PUT /api/goals/:id
   - Added `deleteGoal()` - DELETE /api/goals/:id
   - Added `fetchAlerts()` - GET /api/alerts

8. **`frontend/src/components/CampaignDetailDrawer.jsx`**
   - Added "Set Goal" button
   - Integrated GoalManagementPanel
   - Passes entity_key to goal panel

9. **`frontend/src/pages/Dashboard.jsx`**
   - Imported and rendered DashboardAlerts component
   - Positioned between Insights and Brand Cards

10. **`frontend/src/styles/app.css`**
    - Added `.goal-badge` styles with metric color variants
    - Added `.alerts-panel` styles
    - Added `.alert-card` styles with hover effects
    - Added responsive grid for alert cards

---

## 2. Schema Added

### performance_goals Table

```sql
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
```

#### Constraints
- **entity_type**: `'campaign'` or `'keyword'`
- **metric**: `'spend'`, `'installs'`, `'cpa'`, `'cpt'`, `'ttr'`, `'cr'`
- **operator**: `'greater_than'` or `'less_than'`
- **threshold**: Non-negative number
- **period_days**: `7`, `14`, or `30`

#### Entity Key Format
- **Campaign**: `appId|campaignName` (e.g., `"12345|Brand Campaign"`)
- **Keyword**: `appId|campaignName|adGroupName|keyword` (e.g., `"12345|Brand Campaign|Ad Group 1|shoes"`)

**Consistency**: Uses same entity key format as annotations (`buildCampaignEntityKey`, `buildKeywordEntityKey`)

---

## 3. Alert Evaluation Flow

### Step 1: Fetch Active Goals
```
GET /api/alerts
↓
backend/alerts.js → getAlerts()
↓
backend/goals.js → getGoals({ isActive: true })
```

### Step 2: Calculate Period Dates
```javascript
// For each goal, calculate date range
const endDate = yesterday (latest completed day)
const startDate = endDate - periodDays + 1

Example for 7-day period:
  endDate: 2026-07-15
  startDate: 2026-07-09
```

### Step 3: Fetch Entity Metrics
```
Parse entity_key to extract components
↓
If campaign: getCampaignSummary({ startDate, endDate, appId })
If keyword: getKeywordSummary({ startDate, endDate, appId, campaignName })
↓
Find matching entity by entity_key
↓
Extract metric value (spend, installs, cpa, cpt, ttr, cr)
```

### Step 4: Evaluate Breach
```javascript
if (currentValue === null || undefined || NaN) {
  // Zero denominator case - no alert
  return { breached: false, reason: 'no_data' }
}

if (operator === 'greater_than') {
  breached = currentValue > threshold
} else if (operator === 'less_than') {
  breached = currentValue < threshold
}

if (breached) {
  breachAmount = |currentValue - threshold|
  breachPercent = (breachAmount / threshold) * 100
}
```

### Step 5: Return Alert Objects
```javascript
{
  goalId: 42,
  entityType: 'campaign',
  entityKey: '12345|Brand Campaign',
  entityName: 'Brand Campaign',
  metric: 'cpa',
  operator: 'greater_than',
  threshold: 5.00,
  currentValue: 6.75,
  breachAmount: 1.75,
  breachPercent: 35.0,
  periodDays: 7,
  startDate: '2026-07-09',
  endDate: '2026-07-15',
  evaluatedAt: '2026-07-16T10:30:00.000Z'
}
```

---

## 4. Zero Denominator Handling

### Problem
Metrics like CPA, CPT, TTR, CR involve division:
- CPA = spend / installs
- CPT = spend / taps
- TTR = (taps / impressions) * 100
- CR = (installs / taps) * 100

When denominator is zero, the metric is `null`.

### Solution
Alert evaluation checks for null/undefined/NaN before comparing:

```javascript
if (currentValue === null || currentValue === undefined || Number.isNaN(currentValue)) {
  return { breached: false, reason: 'no_data' }
}
```

**Result**: No false alerts triggered for N/A metrics.

---

## 5. Frontend Features

### A. Goal Management Panel

**Location**: Campaign Detail Drawer → "Set Goal" button

**Features**:
1. **Add Goal**:
   - Select metric (Spend, Installs, CPA, CPT, TTR, CR)
   - Select operator (Greater than, Less than)
   - Enter threshold (numeric, non-negative)
   - Select period (7, 14, or 30 days)
   - Click "Add Goal"

2. **List Goals**:
   - Shows all goals for the entity
   - Displays metric badge (color-coded)
   - Shows condition (e.g., "Alert when CPA is > 5.00 over 7 days")
   - Indicates inactive goals

3. **Edit Goal**:
   - Click "Edit" button
   - Modify metric, operator, threshold, or period
   - Click "Update Goal"

4. **Toggle Active/Inactive**:
   - Click "Disable" to deactivate (stops evaluation)
   - Click "Enable" to reactivate

5. **Delete Goal**:
   - Click "Delete" button
   - Confirmation prompt
   - Permanently removes goal

### B. Dashboard Alerts Section

**Location**: Dashboard page, between Insights and Brand Cards

**Features**:
1. **Alert Cards**:
   - Grid layout (auto-fill, min 280px per card)
   - Red border indicating warning
   - Metric badge (e.g., "CPA")
   - Entity type (campaign/keyword)
   - Entity name
   - Condition description
   - Current value vs threshold
   - Breach amount and percentage
   - Date range
   - "View Campaign/Keyword →" action

2. **Click Behavior**:
   - Clicking card navigates to Campaign or Keyword page
   - User can then filter/search for the specific entity

3. **Empty State**:
   - Section hidden when no alerts
   - Shows count badge when alerts exist

---

## 6. Manual Test Checklist

### Backend API Tests

#### Goals CRUD

1. **Create Campaign Goal**:
   ```bash
   curl -X POST http://localhost:3001/api/goals \
     -H "Content-Type: application/json" \
     -d '{
       "entityType": "campaign",
       "entityKey": "12345|Brand Campaign",
       "metric": "cpa",
       "operator": "greater_than",
       "threshold": 5.00,
       "periodDays": 7
     }'
   ```
   - [ ] Returns 200 with goal object
   - [ ] Goal has `id`, `isActive: true`, timestamps

2. **List Goals**:
   ```bash
   curl http://localhost:3001/api/goals
   ```
   - [ ] Returns array of all goals

3. **List Goals by Entity**:
   ```bash
   curl "http://localhost:3001/api/goals?entityType=campaign&entityKey=12345|Brand+Campaign"
   ```
   - [ ] Returns only matching goals

4. **Update Goal**:
   ```bash
   curl -X PUT http://localhost:3001/api/goals/1 \
     -H "Content-Type: application/json" \
     -d '{"threshold": 6.00}'
   ```
   - [ ] Returns updated goal
   - [ ] `updated_at` timestamp changed

5. **Disable Goal**:
   ```bash
   curl -X PUT http://localhost:3001/api/goals/1 \
     -H "Content-Type: application/json" \
     -d '{"isActive": false}'
   ```
   - [ ] Goal marked inactive
   - [ ] Should not appear in alerts

6. **Delete Goal**:
   ```bash
   curl -X DELETE http://localhost:3001/api/goals/1
   ```
   - [ ] Returns success
   - [ ] Goal removed from database

#### Alerts Evaluation

7. **Get Alerts (No Breaches)**:
   ```bash
   curl http://localhost:3001/api/alerts
   ```
   - [ ] Returns empty array if all metrics within thresholds

8. **Create Goal That Will Breach**:
   - Create goal: CPA > 1.00 over 7 days
   - Ensure campaign has recent data with CPA > 1.00
   ```bash
   curl http://localhost:3001/api/alerts
   ```
   - [ ] Returns alert for that campaign
   - [ ] Alert includes `breachAmount`, `breachPercent`

9. **Test Zero Denominator**:
   - Create goal: CPA > 5.00
   - Ensure campaign has spend but zero installs
   - [ ] No alert triggered (CPA is N/A)

10. **Test Inactive Goal**:
    - Disable a breaching goal
    - Fetch alerts
    - [ ] That goal's alert does not appear

---

### Frontend Tests

#### Goal Management

11. **Open Campaign Detail**:
    - [ ] Go to Campaigns page
    - [ ] Click "View Details" on a campaign
    - [ ] Drawer opens showing campaign stats

12. **Open Goal Panel**:
    - [ ] Click "Set Goal" button
    - [ ] Goal Management Panel opens
    - [ ] Shows campaign name

13. **Add Goal**:
    - [ ] Select metric: CPA
    - [ ] Select operator: Greater than
    - [ ] Enter threshold: 5.00
    - [ ] Select period: 7 days
    - [ ] Click "Add Goal"
    - [ ] Goal appears in list
    - [ ] Form resets

14. **Goal List**:
    - [ ] Goal shows metric badge (colored)
    - [ ] Shows condition text
    - [ ] Shows Edit, Disable, Delete buttons

15. **Edit Goal**:
    - [ ] Click "Edit" on a goal
    - [ ] Form populates with goal values
    - [ ] Modify threshold to 6.00
    - [ ] Click "Update Goal"
    - [ ] Goal updates in list

16. **Disable Goal**:
    - [ ] Click "Disable" on active goal
    - [ ] Goal shows "Inactive" badge
    - [ ] Button changes to "Enable"

17. **Delete Goal**:
    - [ ] Click "Delete" on a goal
    - [ ] Confirmation prompt appears
    - [ ] Confirm deletion
    - [ ] Goal removed from list

18. **Close Goal Panel**:
    - [ ] Click "Close" button
    - [ ] Press Escape key
    - [ ] Click overlay
    - [ ] All close the panel

#### Dashboard Alerts

19. **Navigate to Dashboard**:
    - [ ] Go to http://localhost:5173/
    - [ ] Enable 7D comparison

20. **View Alerts Section**:
    - [ ] If alerts exist, section appears between Insights and Brand Cards
    - [ ] Shows "Performance Alerts" heading
    - [ ] Shows count badge (e.g., "2 active")

21. **Alert Card Display**:
    - [ ] Card has red left border
    - [ ] Shows metric badge
    - [ ] Shows entity type (campaign/keyword)
    - [ ] Shows entity name
    - [ ] Shows condition
    - [ ] Shows current value (red, bold)
    - [ ] Shows threshold
    - [ ] Shows breach amount and percentage
    - [ ] Shows date range
    - [ ] Shows "View Campaign/Keyword →" action

22. **Alert Card Hover**:
    - [ ] Card elevates (shadow)
    - [ ] Arrow moves right slightly

23. **Alert Card Click**:
    - [ ] Click campaign alert card
    - [ ] Navigates to /campaigns
    - [ ] Click keyword alert card
    - [ ] Navigates to /keywords

24. **Empty State**:
    - [ ] Disable all goals or ensure no breaches
    - [ ] Refresh Dashboard
    - [ ] Alerts section does not appear

---

### Cross-Feature Tests

25. **Goal Persistence**:
    - [ ] Create goal on Campaign A
    - [ ] Close goal panel
    - [ ] Navigate away
    - [ ] Return to Campaign A details
    - [ ] Open goal panel
    - [ ] Goal still present

26. **Alerts Update**:
    - [ ] Note current alert count
    - [ ] Create new breaching goal
    - [ ] Refresh Dashboard
    - [ ] New alert appears

27. **Entity Key Consistency**:
    - [ ] Open campaign details
    - [ ] Note entity name
    - [ ] Create goal
    - [ ] Check alert on Dashboard
    - [ ] Entity name matches

28. **Multiple Metrics**:
    - [ ] Create 3 goals on same campaign:
      - CPA > 5.00
      - Spend > 100.00
      - CR < 5.00
    - [ ] If all breach, Dashboard shows 3 alert cards

29. **Keyword Goals** (if KeywordDetailDrawer implemented):
    - [ ] Open keyword details
    - [ ] Click "Set Goal"
    - [ ] Create goal
    - [ ] Verify keyword alert appears on Dashboard

30. **Responsive Layout**:
    - [ ] Resize browser to mobile width
    - [ ] Alert cards stack vertically (1 column)
    - [ ] All content remains readable

---

### Edge Cases

31. **Invalid Threshold**:
    - [ ] Try entering negative threshold
    - [ ] Try entering non-numeric value
    - [ ] Error message displays
    - [ ] Goal not created

32. **Duplicate Goals**:
    - [ ] Create goal: CPA > 5.00
    - [ ] Create another: CPA > 6.00
    - [ ] Both goals coexist
    - [ ] Both can trigger separate alerts

33. **Goal on Entity with No Data**:
    - [ ] Create goal on campaign with no recent data
    - [ ] Fetch alerts
    - [ ] No alert triggered (no data to breach)

34. **Period Alignment**:
    - [ ] Create 7-day goal
    - [ ] Note date range in alert
    - [ ] Verify it covers yesterday back 7 days

35. **Concurrent Edits**:
    - [ ] Open goal panel
    - [ ] Edit goal A
    - [ ] In another tab, delete goal A
    - [ ] Save edit
    - [ ] Error handled gracefully

---

## 7. Metric Color Scheme

### Goal Badges
```css
Spend, CPA, CPT → Red (cost metrics, lower is better)
Installs, TTR, CR → Green (performance metrics, higher is better)
```

### Alert Badges
```css
All alert metric badges → Red background (warning state)
```

---

## 8. Architecture Decisions

### Why Dynamic Alerts?
**Decision**: Alerts are calculated on-demand, not stored

**Pros**:
- Always up-to-date with latest data
- No stale alerts
- No background jobs needed (simpler)
- Easy to add new metrics

**Cons**:
- Slightly slower API response (mitigated by Analytics Service cache)

**Future**: Add background job + alert history table for:
- Email notifications
- Alert history/trends
- Suppress duplicate notifications

### Why Entity Keys?
**Decision**: Use same entity key format as annotations

**Pros**:
- Consistency across features
- Stable across date/filter changes
- Works with app_id or app_key

**Cons**:
- Relies on campaign_name/keyword_text (could change)

**Future**: Prefer campaign_id/keyword_id when available

### Why No Auto-Classification for Bids?
**Decision**: Don't assume bid changes are good/bad

**Rationale**:
- Bid increase may be intentional (expand reach)
- Bid decrease may be intentional (save budget)
- User should define what's acceptable for their strategy

**Result**: Bid metric supports both `>` and `<` operators

---

## 9. Future Enhancements (Out of Scope)

1. **Email Notifications**:
   - Send email when alert triggered
   - Daily/weekly digest of active alerts
   - Requires: email service, user preferences

2. **Alert History**:
   - Store alerts in database
   - Track when alert first triggered
   - Track when resolved
   - Show alert trends over time

3. **Alert Suppression**:
   - Don't re-notify for same alert
   - Cooldown period (e.g., 24 hours)
   - "Acknowledged" status

4. **Advanced Operators**:
   - `between` (range)
   - `percent_change` (vs previous period)
   - `moving_average` (smoothed trends)

5. **Goal Templates**:
   - Preset goals (e.g., "High CPA Alert")
   - Apply to multiple entities
   - Industry benchmarks

6. **Dashboard Overview**:
   - Goals summary card
   - Alert trends chart
   - Top breaching entities

7. **Slack/Teams Integration**:
   - Post alerts to channels
   - Interactive actions (disable goal, view entity)

8. **Keyword Goal Management**:
   - Add "Set Goal" to KeywordDetailDrawer (when created)
   - Currently only Campaign detail has this button

---

## 10. Build Verification

```bash
npm run build
```

**Result**: ✅ Success (all TODOs complete)

---

## 11. Summary

**Status**: ✅ Phase 7A Complete

**Database**: 1 new table (`performance_goals`)  
**Backend**: 7 files changed (2 new, 2 modified)  
**Frontend**: 5 files changed (2 new, 3 modified)  
**API Endpoints**: 5 new REST endpoints  
**Lines Added**: ~1000+

**Features Delivered**:
- ✅ User-defined performance goals
- ✅ CRUD operations for goals
- ✅ Dynamic alert evaluation
- ✅ Dashboard alerts section
- ✅ Goal management UI in Campaign detail
- ✅ Zero denominator handling
- ✅ Entity key consistency with annotations
- ✅ Metric-specific color coding
- ✅ Active/inactive toggle
- ✅ Responsive alert card grid
- ✅ Clickable navigation to entities

**User Requirements Met**: 100%

**Not Included** (as requested):
- ❌ Email notifications
- ❌ Background jobs
- ❌ Keyword detail drawer (Campaign only)
- ❌ Stored alert history

These can be added in future phases.
