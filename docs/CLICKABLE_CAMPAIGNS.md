# Clickable Campaign Names - Implementation Summary

## Overview

Implemented clickable campaign names in the Campaigns table that navigate to the Keywords page with the campaign pre-selected.

**Status:** ✅ Complete

---

## Goal

When a user clicks a campaign name in the Campaigns table:
1. Navigate to the Keywords page
2. Automatically select the campaign's source app
3. Automatically select the clicked campaign
4. Display only keywords belonging to that campaign

---

## Implementation Details

### 1. Campaign Name Links (`CampaignPerformanceTable.jsx`)

**Before:**
```jsx
<td className="campaign-table__name" title={row.campaign_name}>
  {row.campaign_name}
</td>
```

**After:**
```jsx
<td className="campaign-table__name">
  <button
    type="button"
    className="campaign-name-link"
    onClick={() => navigateToKeywords(row)}
    title={`View keywords for ${row.campaign_name}`}
  >
    {row.campaign_name}
  </button>
</td>
```

**Navigation Handler:**
```javascript
function navigateToKeywords(row) {
  const params = new URLSearchParams()
  params.set('app', row.app_name)
  params.set('campaign', row.campaign_name)
  navigate(`/keywords?${params.toString()}`)
}
```

**URL Format:**
```
/keywords?app=<appName>&campaign=<campaignName>
```

**Example:**
```
/keywords?app=Delm8+Pro&campaign=Delm8_route_planner_Discovery
```

---

### 2. URL Parameter Reading (`Keywords.jsx`)

**Added:**
- `useSearchParams` hook from React Router
- `urlFiltersApplied` state to track whether URL params have been processed
- `useEffect` to read URL params and apply to filters on mount

**Logic:**
```javascript
useEffect(() => {
  if (urlFiltersApplied || sourceRows.length === 0) return

  const urlApp = searchParams.get('app')
  const urlCampaign = searchParams.get('campaign')

  if (urlApp || urlCampaign) {
    setFilters(prev => {
      const next = { ...prev }
      
      // Set app first if provided
      if (urlApp) {
        next.app = urlApp
      }
      
      // Set campaign if provided
      if (urlCampaign) {
        next.campaign = urlCampaign
      }
      
      return next
    })
    setUrlFiltersApplied(true)
  } else {
    setUrlFiltersApplied(true)
  }
}, [searchParams, sourceRows, urlFiltersApplied])
```

**Key Points:**
- Only applies URL params once (on mount)
- Waits for `sourceRows` to be available (avoids race condition)
- Sets app first, then campaign (respects dependency)

---

### 3. Filter Bar Initialization (`FilterBar.jsx`)

**Added:**
- `initialFilters` prop to accept pre-set filter values
- Initial state from `initialFilters` prop
- `useEffect` to sync state with `initialFilters` changes
- `useEffect` to emit initial filters on mount

**State Initialization:**
```javascript
const [app, setApp] = useState(initialFilters.app || 'all')
const [search, setSearch] = useState(initialFilters.search || '')
const [segment, setSegment] = useState(initialFilters.segment || 'all')
const [campaign, setCampaign] = useState(initialFilters.campaign || 'all')
const [minSpend, setMinSpend] = useState(initialFilters.minSpend || '')
const [minInstalls, setMinInstalls] = useState(initialFilters.minInstalls || '')
```

**Sync Effect:**
```javascript
useEffect(() => {
  if (initialFilters.app && initialFilters.app !== app) {
    setApp(initialFilters.app)
  }
  if (initialFilters.campaign && initialFilters.campaign !== campaign) {
    setCampaign(initialFilters.campaign)
  }
  // ... other filters
}, [initialFilters, app, campaign, search, segment, minSpend, minInstalls])
```

**Emit Initial Filters:**
```javascript
useEffect(() => {
  emit()
}, [])
```

---

### 4. CSS Styling (`app.css`)

**Campaign Name Link Styles:**
```css
.campaign-name-link {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: #3b82f6;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  display: inline;
}

.campaign-name-link:hover {
  text-decoration: underline;
  color: #2563eb;
}

.campaign-name-link:focus {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  border-radius: 2px;
}

.campaign-name-link:active {
  color: #1d4ed8;
}
```

**Design:**
- Matches existing keyword link styling (blue color)
- Underlines on hover
- Visible focus state for keyboard accessibility
- Button element (not anchor) for semantic correctness (no page reload)

---

## User Flow

### Scenario: User Clicks Campaign Name

1. **User on Campaigns page**
   - Sees campaign "Delm8_route_planner_Discovery" for app "Delm8 Pro"
   - Clicks the campaign name

2. **Navigation occurs**
   - Browser navigates to: `/keywords?app=Delm8+Pro&campaign=Delm8_route_planner_Discovery`
   - React Router updates the route

3. **Keywords page loads**
   - `useSearchParams` reads URL: `app=Delm8 Pro`, `campaign=Delm8_route_planner_Discovery`
   - Keywords page waits for `sourceRows` to load
   - Sets filters: `{ app: 'Delm8 Pro', campaign: 'Delm8_route_planner_Discovery' }`

4. **FilterBar initializes**
   - Receives `initialFilters` prop with app and campaign
   - Sets dropdown values to match
   - Emits filters to parent (triggers filtering)

5. **Keywords table displays**
   - Only keywords from "Delm8 Pro" app and "Delm8_route_planner_Discovery" campaign shown
   - User can see filtered results immediately

6. **User can interact**
   - Change campaign dropdown → shows different campaign
   - Change app dropdown → campaign resets if invalid
   - Use browser Back → returns to Campaigns page
   - Use browser Forward → restores filtered Keywords view

---

## Campaign Identity

Uses the existing identity system:
- **App identification**: `app_name` (e.g., "Delm8 Pro")
- **Campaign identification**: `campaign_name` (e.g., "Delm8_route_planner_Discovery")

**Why `app_name` instead of `app_id`?**
- FilterBar dropdown uses app names for display and filtering
- Avoids ID → name lookup complexity
- Consistent with existing filter implementation

**Campaign isolation:**
- Campaign names are only unique within an app
- URL includes both app and campaign to ensure correct filtering
- Prevents cross-app campaign name collisions

---

## Edge Cases Handled

### 1. Invalid URL Parameters

**Scenario:** User manually edits URL to invalid values

**Behavior:**
- FilterBar accepts the values
- If campaign not found in app's campaigns → dropdown shows value but no results
- User can reset by selecting "All Campaigns"

### 2. Empty Source Data

**Scenario:** Keywords page loads before period comparison data available

**Behavior:**
- URL params read but not applied until `sourceRows.length > 0`
- Once data loads, filters applied correctly
- Avoids "flash" of unfiltered data

### 3. Normal Navigation

**Scenario:** User navigates to Keywords from top menu (not from Campaigns)

**Behavior:**
- No URL params present
- Filters default to "All Apps" and "All Campaigns"
- Normal behavior preserved

### 4. Campaign Dependency on App

**Scenario:** App changes while campaign is selected

**Behavior:**
- FilterBar's existing `handleAppChange` validates campaign
- If campaign invalid for new app → resets to "All Campaigns"
- Same logic applies whether filters set via UI or URL

---

## Browser Back/Forward

**Back Button:**
- From Keywords with filters → Returns to Campaigns
- URL changes from `/keywords?app=...&campaign=...` to `/campaigns`
- React Router handles cleanup

**Forward Button:**
- From Campaigns → Returns to Keywords with filters
- URL params preserved
- Filters re-applied correctly

**URL State:**
- Filters stored in URL (not hidden component state)
- Shareable links work correctly
- Bookmarking preserves filter context

---

## Preservation of Existing Behavior

### ✅ Unchanged Features

- **Keyword analytics calculations**: No changes to metrics
- **Period comparison**: Works normally with filtered results
- **Bid history**: Opens keyword detail drawer as before
- **Keyword Overview**: Functions normally
- **Segment filtering**: Still available and functional
- **Search**: Filters keywords within selected campaign
- **Min spend/install filters**: Apply to filtered results
- **Notes**: Work on filtered keywords
- **Export**: Exports filtered results
- **Bid Experiments**: Detection unchanged

### ✅ Filter Behavior

- **App → Campaign dependency**: Preserved
  - Changing app validates/resets campaign
  - Campaign dropdown only shows campaigns for selected app
- **Filter combinations**: All existing combinations still work
- **Clear filters**: User can select "All" to reset

---

## Accessibility

### Keyboard Navigation

✅ Campaign name link is fully keyboard accessible:
- Tab to focus the link
- Enter or Space to activate
- Visible focus outline (2px blue outline)

### Screen Readers

✅ Semantic HTML:
- Uses `<button>` element (correct for in-app navigation)
- Has descriptive `title` attribute: "View keywords for {campaign_name}"
- Button text is the campaign name (clear label)

### Focus Management

✅ Focus states:
- `:focus` - visible outline
- `:hover` - underline
- `:active` - darker color

---

## Testing Checklist

### Manual Testing Performed

- [x] Clicking campaign name navigates to Keywords
- [x] Correct source app is selected
- [x] Correct campaign is selected
- [x] Only that campaign's keywords displayed
- [x] Campaign filter dropdown reflects selected campaign
- [x] Switching campaign afterwards works normally
- [x] Switching app resets/updates Campaign dropdown
- [x] Browser Back returns to Campaigns
- [x] Browser Forward restores filtered Keywords
- [x] Normal Keywords navigation (from menu) still works
- [x] Frontend builds without errors
- [x] No console errors in browser
- [x] Keyboard navigation works (Tab, Enter)
- [x] Focus states visible

### Edge Cases Tested

- [x] Clicking campaign with long name
- [x] Campaign with special characters in name
- [x] Multiple campaigns with similar names
- [x] Same campaign name in different apps (isolated correctly)
- [x] URL params with spaces (encoded correctly)

---

## Files Changed

### Frontend

1. **`frontend/src/components/CampaignPerformanceTable.jsx`**
   - Added `useNavigate` hook
   - Added `navigateToKeywords` function
   - Changed campaign name from plain text to clickable button

2. **`frontend/src/pages/Keywords.jsx`**
   - Added `useSearchParams` hook
   - Added `useEffect` to read and apply URL parameters
   - Pass `initialFilters` to FilterBar

3. **`frontend/src/components/FilterBar.jsx`**
   - Added `initialFilters` prop
   - Initialize state from `initialFilters`
   - Added `useEffect` to sync with `initialFilters` changes
   - Added `useEffect` to emit initial filters on mount

4. **`frontend/src/styles/app.css`**
   - Added `.campaign-name-link` styles (base, hover, focus, active)

---

## What Was NOT Changed

✅ **Backend**: No backend changes required  
✅ **Database**: No schema changes  
✅ **Analytics calculations**: No formula changes  
✅ **API endpoints**: No new endpoints  
✅ **Campaign identity system**: Uses existing `app_name` + `campaign_name`  
✅ **Filter logic**: Reuses existing FilterBar filtering  
✅ **Routing setup**: Uses existing React Router configuration

---

## Performance Impact

**Minimal:**
- URL param reading: O(1) operation
- Filter application: Same as manual filter selection
- No additional API calls
- No new data fetching

---

## Future Enhancements (Not Implemented)

These were intentionally deferred to keep the implementation minimal:

1. **URL param validation**
   - Could validate app/campaign exist before applying
   - Current behavior: accepts invalid values (user can reset)

2. **Preserve other filters in URL**
   - Could include segment, search, minSpend, etc. in URL
   - Current behavior: only app + campaign in URL

3. **Deep linking with period selection**
   - Could encode filter preset (7D/14D/30D) in URL
   - Current behavior: uses current preset

4. **Campaign ID usage**
   - Could use campaign_id instead of name
   - Current behavior: uses name (simpler, consistent with filters)

---

## Acceptance Criteria ✅

| Criterion | Status |
|-----------|--------|
| Clicking campaign name opens Keywords | ✅ |
| Correct source app selected | ✅ |
| Correct campaign selected | ✅ |
| Only that campaign's keywords displayed | ✅ |
| Campaign filter dropdown reflects selection | ✅ |
| Switching campaign works normally | ✅ |
| Switching app resets/updates Campaign dropdown | ✅ |
| Browser Back returns to Campaigns | ✅ |
| Normal Keywords navigation still works | ✅ |
| No analytics changes | ✅ |
| No database schema changes | ✅ |
| No console errors | ✅ |

---

## Conclusion

Clickable campaign names successfully implemented with:

1. ✅ Minimal code changes (4 files)
2. ✅ Clean URL-based navigation
3. ✅ Proper filter dependency handling
4. ✅ Full keyboard accessibility
5. ✅ Browser back/forward support
6. ✅ No breaking changes to existing functionality
7. ✅ Production-ready (frontend builds successfully)

The implementation provides intuitive contextual navigation from Campaigns to Keywords while preserving all existing behavior.
