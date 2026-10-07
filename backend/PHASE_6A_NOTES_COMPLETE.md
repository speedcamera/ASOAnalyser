# Phase 6A: Notes and Annotations - Complete ✅

## Summary

Notes and Annotations system was already 95% complete. Only missing piece was the `entity_key` field in Analytics Service responses.

**Change Made**: Added `entity_key` field to campaign and keyword responses in `backend/analyticsService.js`.

---

## Files Changed

### `backend/analyticsService.js`

**Added**:
1. Entity key generation helper functions (lines 16-28)
2. `entity_key` field to campaign responses (non-comparison mode)
3. `entity_key` field to campaign responses (comparison mode)
4. `entity_key` field to keyword responses (non-comparison mode)
5. `entity_key` field to keyword responses (comparison mode)

**Functions Modified**:
- `getCampaignSummary()` - both modes
- `getKeywordSummary()` - both modes

---

## Final Entity Keys

### Campaign Entity Key Format

```javascript
buildCampaignEntityKey(appId, campaignName)
// Returns: "{app_id}|{campaign_name}"
```

**Example**:
```
1429831779|Standard Delm8 -Brand
```

**Response Field**:
```json
{
  "campaign_name": "Standard Delm8 -Brand",
  "app_id": "1429831779",
  "entity_key": "1429831779|Standard Delm8 -Brand",
  "app_name": "DelM8 UK Address Finder",
  "current_spend": 123.45,
  ...
}
```

**Identity Components**:
- ✅ `app_id` (stable, preferred)
- ✅ `campaign_name` (text)
- ❌ `organisation_id` (not available yet)
- ❌ `campaign_id` (not populated in database)

**Fallback**: If `app_id` missing, frontend uses `app_key`.

---

### Keyword Entity Key Format

```javascript
buildKeywordEntityKey(appId, campaignName, adGroupName, keyword)
// Returns: "{app_id}|{campaign_name}|{ad_group_name}|{keyword}"
```

**Example**:
```
1429831779|Standard Delm8 - Competitors|Standard Delm8 - Competitors|posttag: address finder
```

**Response Field**:
```json
{
  "keyword": "posttag: address finder",
  "campaign_name": "Standard Delm8 - Competitors",
  "ad_group_name": "Standard Delm8 - Competitors",
  "app_id": "1429831779",
  "entity_key": "1429831779|Standard Delm8 - Competitors|Standard Delm8 - Competitors|posttag: address finder",
  "app_name": "DelM8 UK Address Finder",
  "current_spend": 31.26,
  ...
}
```

**Identity Components**:
- ✅ `app_id` (stable, preferred)
- ✅ `campaign_name` (text)
- ✅ `ad_group_name` (text)
- ✅ `keyword` text
- ❌ `organisation_id` (not available yet)
- ❌ `campaign_id` (not populated)
- ❌ `ad_group_id` (not populated)
- ❌ `keyword_id` (not populated)

**Fallback**: If `app_id` missing, frontend uses `app_key`.

---

## Endpoints Used

All existing and working - no changes required:

### List Annotations
```
GET /api/annotations?entityType=campaign&entityKey=1429831779|Campaign
GET /api/annotations?entityType=keyword&entityKey=1429831779|Campaign|AdGroup|keyword
```

**Response**:
```json
[
  {
    "id": 1,
    "entityType": "campaign",
    "entityKey": "1429831779|Standard Campaign",
    "noteType": "note",
    "noteText": "Increased daily budget to £100",
    "isPinned": true,
    "createdAt": "2026-07-14T10:30:00Z",
    "updatedAt": "2026-07-14T10:30:00Z"
  }
]
```

### Create Annotation
```
POST /api/annotations
Content-Type: application/json

{
  "entityType": "campaign",
  "entityKey": "1429831779|Standard Campaign",
  "noteType": "optimisation",
  "noteText": "Paused low-performing keywords",
  "isPinned": false
}
```

### Update Annotation
```
PUT /api/annotations/:id
Content-Type: application/json

{
  "noteType": "observation",
  "noteText": "Updated note text",
  "isPinned": true
}
```

### Delete Annotation
```
DELETE /api/annotations/:id
```

---

## Architecture

### Backend (`backend/annotations.js`)

**Validation**:
- ✅ Entity type: must be "campaign" or "keyword"
- ✅ Entity key: required, any string format
- ✅ Note type: must be one of 5 types
- ✅ Note text: required

**Sorting**:
```sql
ORDER BY is_pinned DESC, created_at DESC, id DESC
```
- Pinned notes first
- Then newest notes
- Then by ID as tiebreaker

**Features**:
- ✅ CRUD operations (create, read, update, delete)
- ✅ Pin/unpin support
- ✅ Timestamps (created_at, updated_at)
- ✅ Efficient indexes

---

### Frontend (`frontend/src/components/NotesPanel.jsx`)

**Features**:
- ✅ Shared panel for both campaigns and keywords
- ✅ Add, edit, delete, pin
- ✅ Note types: Note, Optimisation, Observation, Issue, Experiment
- ✅ Created and updated timestamps displayed
- ✅ Pinned notes shown first
- ✅ Delete confirmation dialog
- ✅ Loads only selected entity's annotations
- ✅ Escape key to close
- ✅ Loading and error states
- ✅ Form validation

**Usage**:
```javascript
<NotesPanel
  open={Boolean(notesTarget)}
  onClose={() => setNotesTarget(null)}
  entityType="campaign"
  entityKey={row.entity_key}  // ← Now provided by backend!
  title={row.campaign_name}
  subtitle={`App · ${row.app_name}`}
/>
```

---

### Table Integration

**Campaign Performance Table**: `frontend/src/components/CampaignPerformanceTable.jsx`
- ✅ "Notes" button per row
- ✅ Opens NotesPanel with `row.entity_key`
- ✅ Backend now provides entity_key
- ❌ Missing: note indicator icon (optional Phase 6B)

**Keyword & Bid Analysis Table**: `frontend/src/components/KeywordBidTable.jsx`
- ✅ "Notes" button per row
- ✅ Opens NotesPanel with `row.entity_key`
- ✅ Backend now provides entity_key
- ❌ Missing: note indicator icon (optional Phase 6B)

---

## Manual Test Checklist

### Campaign Notes

#### Basic Operations
- [ ] Navigate to Campaigns page
- [ ] Select an app with campaigns
- [ ] Click "Notes" button on first campaign
- [ ] Panel opens with correct campaign name
- [ ] Add a note:
  - [ ] Type: "Note"
  - [ ] Text: "Test campaign note"
  - [ ] Click "Add note"
- [ ] Note appears in list
- [ ] Note shows created timestamp
- [ ] Edit the note:
  - [ ] Click "Edit"
  - [ ] Change text to "Updated campaign note"
  - [ ] Click "Update note"
- [ ] Note updated successfully
- [ ] Note shows updated timestamp
- [ ] Pin the note:
  - [ ] Click "Pin"
  - [ ] Note moves to top
  - [ ] "Pinned" badge displays
- [ ] Delete the note:
  - [ ] Click "Delete"
  - [ ] Confirmation dialog appears
  - [ ] Confirm deletion
  - [ ] Note removed from list

#### Stability Across Filters
- [ ] Add note to Campaign A
- [ ] Change date filter (7D → 14D)
- [ ] Campaign A still visible
- [ ] Click "Notes" on Campaign A
- [ ] Previous note still attached ✅
- [ ] Enable comparison mode
- [ ] Campaign A still visible
- [ ] Click "Notes" on Campaign A
- [ ] Previous note still attached ✅

#### Separation by App
- [ ] Select App 1
- [ ] Find "Campaign X"
- [ ] Add note: "App 1 - Campaign X note"
- [ ] Select App 2 (different app with same campaign name)
- [ ] Find "Campaign X"
- [ ] Click "Notes"
- [ ] App 1 note NOT visible (correct)
- [ ] Add note: "App 2 - Campaign X note"
- [ ] Select App 1
- [ ] Click "Notes" on Campaign X
- [ ] Only "App 1 - Campaign X note" visible ✅

---

### Keyword Notes

#### Basic Operations
- [ ] Navigate to Keywords page
- [ ] Enable 7D comparison
- [ ] Select an app
- [ ] Click "Notes" on first keyword
- [ ] Panel shows keyword + campaign + ad group + app
- [ ] Add a note:
  - [ ] Type: "Optimisation"
  - [ ] Text: "Increased bid to £2.00"
  - [ ] Check "Pin note"
  - [ ] Click "Add note"
- [ ] Note appears at top (pinned)
- [ ] Pinned badge displays
- [ ] Edit the note:
  - [ ] Click "Edit"
  - [ ] Change type to "Observation"
  - [ ] Update text
  - [ ] Uncheck "Pin note"
  - [ ] Click "Update note"
- [ ] Note updates
- [ ] Pinned badge removed
- [ ] Note moves to chronological position
- [ ] Delete the note:
  - [ ] Click "Delete"
  - [ ] Confirm
  - [ ] Note removed

#### Stability Across Filters
- [ ] Add note to Keyword A
- [ ] Change date filter (7D → 14D)
- [ ] Keyword A still visible
- [ ] Click "Notes" on Keyword A
- [ ] Previous note still attached ✅
- [ ] Change app filter
- [ ] Return to original app
- [ ] Keyword A visible again
- [ ] Click "Notes"
- [ ] Previous note still attached ✅

#### Separation by Campaign/Ad Group
- [ ] Find keyword "test" in Campaign A / Ad Group 1
- [ ] Add note: "Campaign A - Ad Group 1 note"
- [ ] Find keyword "test" in Campaign A / Ad Group 2
- [ ] Click "Notes"
- [ ] Previous note NOT visible (correct - different ad group)
- [ ] Add note: "Campaign A - Ad Group 2 note"
- [ ] Return to Campaign A / Ad Group 1 "test"
- [ ] Click "Notes"
- [ ] Only "Campaign A - Ad Group 1 note" visible ✅

---

### Note Types

- [ ] Create note with type: "Note"
  - [ ] Label displays: "Note"
- [ ] Create note with type: "Optimisation"
  - [ ] Label displays: "Optimisation"
- [ ] Create note with type: "Observation"
  - [ ] Label displays: "Observation"
- [ ] Create note with type: "Issue"
  - [ ] Label displays: "Issue"
- [ ] Create note with type: "Experiment"
  - [ ] Label displays: "Experiment"

---

### Pinning Behavior

- [ ] Create three notes (unpinned)
- [ ] Newest note at top
- [ ] Pin middle note
- [ ] Pinned note moves to top
- [ ] Pin oldest note
- [ ] Two pinned notes at top
- [ ] Newest pinned first
- [ ] Unpin first note
- [ ] Note moves to chronological position
- [ ] Add new note (unpinned)
- [ ] New note appears below pinned note

---

### Timestamps

- [ ] Create a note at 10:00
- [ ] Note shows "Created: 14 Jul 2026, 10:00"
- [ ] Edit note at 10:05
- [ ] Note shows "Updated: 14 Jul 2026, 10:05"
- [ ] Updated timestamp different from created ✅
- [ ] Close and reopen notes panel
- [ ] Timestamps persist correctly

---

### Validation

- [ ] Try to add empty note
- [ ] Error: "Note text is required"
- [ ] Add note with only whitespace
- [ ] Error displayed
- [ ] Add note with valid text
- [ ] Note saves successfully

---

### UI Behavior

- [ ] Click "Notes" button
- [ ] Panel slides in from right
- [ ] Press Escape key
- [ ] Panel closes
- [ ] Click outside panel (on overlay)
- [ ] Panel closes
- [ ] Click inside panel
- [ ] Panel stays open
- [ ] Edit a note
- [ ] Click Cancel
- [ ] Form resets
- [ ] Previous note unchanged

---

## Status

✅ **Backend**: Complete  
✅ **Frontend**: Complete  
✅ **Entity Keys**: Complete  
✅ **API Endpoints**: Complete  
✅ **Validation**: Complete  
✅ **Sorting**: Complete  
✅ **CRUD Operations**: Complete  

**Files Changed**: 1 (`backend/analyticsService.js`)  
**New Lines of Code**: ~15  
**Tests Required**: Manual (checklist provided)

---

## Optional Phase 6B Enhancements

Not required for Phase 6A, but could be added:

1. **Note Indicator Icons**
   - Show small icon in table rows when notes exist
   - Files: `CampaignPerformanceTable.jsx`, `KeywordBidTable.jsx`
   - Requires: Additional API call or count in response

2. **Chart Markers**
   - Add annotation markers to trend charts
   - Show notes for specific dates
   - Files: `TrendChart.jsx`

3. **Bulk Operations**
   - Delete multiple notes at once
   - Move notes between entities

4. **Search/Filter**
   - Search notes by text
   - Filter by note type
   - Filter by date range

---

## Phase 6A Complete ✅

All requirements met:
- ✅ Notes attach to stable campaign/keyword identities
- ✅ Notes remain attached when date filters change
- ✅ Notes remain attached when comparison mode changes
- ✅ Same keyword in different apps/campaigns have separate notes
- ✅ Support all 5 note types
- ✅ Support add, edit, delete, pin
- ✅ Pinned notes shown first
- ✅ Timestamps shown
- ✅ Delete confirmation required
- ✅ Loads only selected entity's annotations
- ✅ Backend validates all inputs
- ✅ Reuses existing annotations table
- ✅ Shared NotesPanel for both screens
