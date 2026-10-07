# Phase 8 Frontend Fix: Insight Explanations - Diagnosis

## Root Cause

**The API returns full insight objects with rich data, but this data is being stripped away during frontend mapping and never reaches the UI components.**

### Data Flow Problem

```
┌─────────────────────────────────────────────────────────────┐
│ 1. API Response (backend/insightsEngine.js)                 │
│    Full insight object:                                      │
│    - id                                                      │
│    - type                                                    │
│    - severity                                                │
│    - title                                                   │
│    - summary                                                 │
│    - explanation ✅                                          │
│    - currentValue ✅                                         │
│    - previousValue ✅                                        │
│    - percentageChange ✅                                     │
│    - metric                                                  │
│    - appId, campaignId, keywordId                           │
│    - generatedAt                                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Frontend Fetch (Dashboard.jsx)                           │
│    Stores full objects in `insightsData` state              │
│    ✅ All fields present                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Mapping Function (dashboardHelpers.js)                   │
│    mapInsightsToCards(apiInsights)                          │
│                                                              │
│    ❌ PROBLEM: Strips away rich data                        │
│                                                              │
│    return apiInsights.map(insight => ({                     │
│      type: typeMap[insight.type] || 'Info',                 │
│      text: insight.summary,                                 │
│      tone: toneMap[insight.severity] || 'neutral',          │
│    }))                                                       │
│                                                              │
│    Only keeps: type, text, tone                             │
│    Lost: explanation, values, percentageChange, etc.        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. InsightsBar Component                                    │
│    Receives simplified cards                                │
│    Displays: type badge, text                               │
│    ❌ No explanation (not in data)                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼ (User clicks "View details")
                     │
┌─────────────────────────────────────────────────────────────┐
│ 5. setSelectedInsight(item)                                 │
│    Stores the SIMPLIFIED card object                        │
│    Only has: { type, text, tone }                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. InsightDetailsDrawer                                     │
│    Receives simplified object                               │
│    Can only display: insight.type, insight.text             │
│    ❌ insight.explanation = undefined                       │
│    ❌ insight.currentValue = undefined                      │
│    ❌ insight.percentageChange = undefined                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Specific Issues

### Issue 1: Mapping Function Strips Data
**File**: `frontend/src/utils/dashboardHelpers.js`  
**Function**: `mapInsightsToCards()`

**Current Code** (lines 54-75):
```javascript
return apiInsights.map(insight => {
  // Map severity to tone
  const toneMap = {
    positive: 'good',
    info: 'neutral',
    warning: 'bad',
    critical: 'bad',
  }

  // Map insight type to card type
  const typeMap = {
    cpa_increase: 'Alert',
    cpa_decrease: 'Trend',
    // ... etc
  }

  return {
    type: typeMap[insight.type] || 'Info',
    text: insight.summary,
    tone: toneMap[insight.severity] || 'neutral',
  }
})
```

**Problem**: Only maps 3 fields, discards the rest.

---

### Issue 2: Drawer Receives Wrong Data
**File**: `frontend/src/pages/Dashboard.jsx`

**Current Code** (line 332):
```javascript
<InsightsBar insights={insights} onViewDetails={setSelectedInsight} />
```

**Problem**: `insights` contains simplified cards, not original API objects.

When user clicks "View details":
```javascript
onViewDetails(item) → setSelectedInsight(item)
```

`item` is a simplified card: `{ type, text, tone }`

**Drawer receives**:
```javascript
insight = { type: 'Alert', text: 'CPA increased 18%', tone: 'bad' }
```

**Drawer expects**:
```javascript
insight = {
  type: 'cpa_increase',
  severity: 'warning',
  title: 'CPA increased',
  summary: 'CPA increased 18%',
  explanation: 'Spend increased 14% while tap-through installs fell 9%...',
  currentValue: 5.90,
  previousValue: 5.00,
  percentageChange: 18.0,
  metric: 'cpa',
  generatedAt: '...'
}
```

---

### Issue 3: Drawer Hardcoded for Old Format
**File**: `frontend/src/components/InsightDetailsDrawer.jsx`

**Current Code**:
- Line 31: `insight.type` (works, but shows mapped type like "Alert")
- Line 46: `insight.text` (works, shows summary)
- Line 67: `formatNoteTimestamp(new Date())` (wrong - uses current time, not `insight.generatedAt`)
- Lines 72-84: Hardcoded placeholder message (should show explanation)

**Missing**:
- No display of `insight.explanation`
- No display of `insight.currentValue` / `insight.previousValue`
- No display of `insight.percentageChange`
- No display of `insight.metric`

---

## Solution

### Option A: Pass Full API Objects to Drawer (Recommended)
1. Keep `insightsData` (full API objects) in Dashboard state
2. Create `insights` (simplified cards) for InsightsBar display
3. When "View details" clicked, find the matching full object from `insightsData`
4. Pass full object to drawer
5. Update drawer to display all fields

### Option B: Keep Full Data in Cards
1. Modify `mapInsightsToCards()` to include all fields
2. Cards display simplified view
3. Drawer accesses full fields from same object

**Recommendation**: Option A is cleaner separation of concerns.

---

## Required Changes

### 1. Dashboard.jsx
- Store both `insightsData` (full) and `insights` (cards)
- Modify `onViewDetails` handler to find full object
- Pass full object to drawer

### 2. InsightDetailsDrawer.jsx
- Add sections for explanation, values, metrics
- Use `insight.explanation` instead of placeholder
- Display current/previous values and change
- Use `insight.generatedAt` not current time
- Handle missing explanation gracefully

### 3. InsightsBar.jsx (Optional)
- Could show brief explanation excerpt in card
- Limited by space constraints

---

## Verification

**Test that these fields are displayed**:
- ✅ `insight.title`
- ✅ `insight.summary`
- ✅ `insight.explanation`
- ✅ `insight.severity`
- ✅ `insight.currentValue`
- ✅ `insight.previousValue`
- ✅ `insight.percentageChange`
- ✅ `insight.metric`
- ✅ `insight.generatedAt`

**Test fallback**:
- When `explanation` is null/empty, section should be hidden
