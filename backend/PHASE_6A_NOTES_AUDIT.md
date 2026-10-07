# Phase 6A: Notes and Annotations Audit

## Current State Analysis

### ✅ Backend Annotations System - COMPLETE

**File**: `backend/annotations.js`

**Database Schema**: `annotations` table
- ✅ `id` (SERIAL PRIMARY KEY)
- ✅ `entity_type` (TEXT NOT NULL) - "campaign" or "keyword"
- ✅ `entity_key` (TEXT NOT NULL) - stable identifier
- ✅ `note_type` (TEXT NOT NULL) - note, optimisation, observation, issue, experiment
- ✅ `note_text` (TEXT NOT NULL)
- ✅ `is_pinned` (BOOLEAN NOT NULL DEFAULT FALSE)
- ✅ `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- ✅ `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())

**Indexes**:
- ✅ `idx_annotations_entity` ON (entity_type, entity_key)
- ✅ `idx_annotations_entity_pinned_created` ON (entity_type, entity_key, is_pinned DESC, created_at DESC)

**Endpoints**: All implemented in `backend/index.js`
- ✅ `GET /api/annotations?entityType=...&entityKey=...` - List annotations
- ✅ `POST /api/annotations` - Create annotation
- ✅ `PUT /api/annotations/:id` - Update annotation
- ✅ `DELETE /api/annotations/:id` - Delete annotation

**Validation**:
- ✅ Entity type: must be "campaign" or "keyword"
- ✅ Note type: must be one of 5 types
- ✅ Note text: required
- ✅ Entity key: required

**Sorting**:
- ✅ Pinned notes first (is_pinned DESC)
- ✅ Then newest notes (created_at DESC)

---

### ✅ Frontend Notes UI - COMPLETE

**File**: `frontend/src/components/NotesPanel.jsx`

**Features**:
- ✅ Shared panel for both campaigns and keywords
- ✅ Add, edit, delete, pin
- ✅ Note types: Note, Optimisation, Observation, Issue, Experiment
- ✅ Created and updated timestamps
- ✅ Pinned notes shown first
- ✅ Delete confirmation dialog
- ✅ Loads only selected entity's annotations
- ✅ Escape key to close
- ✅ Loading and error states

**Usage**:
```javascript
<NotesPanel
  open={Boolean(notesTarget)}
  onClose={() => setNotesTarget(null)}
  entityType="campaign"
  entityKey="1429831779|Standard Campaign"
  title="Campaign Name"
  subtitle="App · App Name"
/>
```

---

### ✅ Entity Key Generation - COMPLETE

**File**: `frontend/src/utils/entityKeys.js`

**Campaign Entity Key**:
```javascript
buildCampaignEntityKey({ appId, campaignName })
// Returns: "1429831779|Standard Campaign"
```

**Keyword Entity Key**:
```javascript
buildKeywordEntityKey({ appId, campaignName, adGroupName, keyword })
// Returns: "1429831779|Standard Campaign|Ad Group|keyword text"
```

**Identity Parts**:
- Uses `|` as separator
- Missing values become `-`
- Stable across date filters and comparison modes

---

### ✅ Table Integration - PARTIAL

**Campaign Performance Table**: `frontend/src/components/CampaignPerformanceTable.jsx`
- ✅ "Notes" button per row
- ✅ Opens NotesPanel with entityKey
- ❌ Missing: note indicator icon
- ❌ Backend doesn't return entity_key field

**Keyword & Bid Analysis Table**: `frontend/src/components/KeywordBidTable.jsx`
- ✅ "Notes" button per row
- ✅ Opens NotesPanel with entityKey
- ❌ Missing: note indicator icon
- ❌ Backend doesn't return entity_key field

---

## Issues Found

### ❌ Issue 1: Backend Missing entity_key Field

**Problem**: Analytics Service doesn't return `entity_key` in campaign or keyword responses.

**Impact**: Frontend must manually build entity keys from separate fields.

**Current**:
```javascript
// Campaign response (missing entity_key)
{
  campaign_name: "Standard Delm8 -Brand",
  app_id: "1429831779",
  // ❌ NO entity_key field
}
```

**Required**:
```javascript
// Campaign response (with entity_key)
{
  campaign_name: "Standard Delm8 -Brand",
  app_id: "1429831779",
  entity_key: "1429831779|Standard Delm8 -Brand",  // ✅ ADD THIS
}
```

**Location**: `backend/analyticsService.js`
- `getCampaignSummary()` - both comparison and non-comparison modes
- `getKeywordSummary()` - both comparison and non-comparison modes

---

### ❌ Issue 2: Missing Note Indicator Icons

**Problem**: Tables don't show indicator when notes exist for a row.

**Impact**: Users can't see which campaigns/keywords have notes without clicking.

**Required**: Small icon/badge in table row when annotations exist.

**Location**: 
- `frontend/src/components/CampaignPerformanceTable.jsx`
- `frontend/src/components/KeywordBidTable.jsx`

---

## Entity Identity Requirements

### Campaign Identity

**Preferred** (stable):
```javascript
{
  organisation_id: null,  // Not available yet
  app_id: "1429831779",
  campaign_id: null,      // Not populated in database
  campaign_name: "Standard Campaign"
}
```

**Entity Key Format**:
```
{app_id}|{campaign_name}
```

**Example**:
```
1429831779|Standard Delm8 -Brand
```

**Fallback**: If app_id missing, use app_key.

---

### Keyword Identity

**Preferred** (stable):
```javascript
{
  organisation_id: null,  // Not available yet
  app_id: "1429831779",
  campaign_id: null,      // Not populated
  ad_group_id: null,      // Not populated
  keyword_id: null,       // Not populated
  campaign_name: "Standard Campaign",
  ad_group_name: "Ad Group",
  keyword: "keyword text"
}
```

**Entity Key Format**:
```
{app_id}|{campaign_name}|{ad_group_name}|{keyword}
```

**Example**:
```
1429831779|Standard Delm8 - Competitors|Standard Delm8 - Competitors|posttag: address finder
```

**Fallback**: If app_id missing, use app_key.

---

## Files Requiring Changes

### Backend

1. **`backend/analyticsService.js`**
   - Add `entity_key` field to `getCampaignSummary()` responses
   - Add `entity_key` field to `getKeywordSummary()` responses
   - Both comparison and non-comparison modes

### Frontend

2. **`frontend/src/components/CampaignPerformanceTable.jsx`**
   - Use `row.entity_key` directly (once backend provides it)
   - Add note indicator icon (optional for Phase 6A)

3. **`frontend/src/components/KeywordBidTable.jsx`**
   - Use `row.entity_key` directly (once backend provides it)
   - Add note indicator icon (optional for Phase 6A)

---

## Testing Checklist

### Backend Entity Key Generation
- [ ] Campaign API returns entity_key field
- [ ] Keyword API returns entity_key field
- [ ] Entity key format matches frontend expectations
- [ ] Entity key stable across date filters
- [ ] Entity key stable across comparison mode changes

### Campaign Notes
- [ ] Click "Notes" button on campaign row
- [ ] Panel opens with correct campaign name
- [ ] Add a note (type: Note)
- [ ] Note saves and appears in list
- [ ] Edit the note
- [ ] Pin the note
- [ ] Pinned note moves to top
- [ ] Delete the note
- [ ] Confirmation dialog appears
- [ ] Note deleted successfully

### Keyword Notes
- [ ] Click "Notes" button on keyword row
- [ ] Panel opens with correct keyword + campaign + ad group
- [ ] Add note (type: Optimisation)
- [ ] Note saves
- [ ] Change app filter
- [ ] Click same keyword "Notes" button
- [ ] Previous note still attached
- [ ] Add second keyword note
- [ ] Both notes display

### Note Types
- [ ] Create note with type: Note
- [ ] Create note with type: Optimisation
- [ ] Create note with type: Observation
- [ ] Create note with type: Issue
- [ ] Create note with type: Experiment
- [ ] Each type displays correct label

### Timestamps
- [ ] New note shows created timestamp
- [ ] Edit note
- [ ] Note shows updated timestamp
- [ ] Updated timestamp different from created

### Pinning
- [ ] Pin a note
- [ ] Note moves to top of list
- [ ] Add second unpinned note
- [ ] Pinned note stays at top
- [ ] Unpin the note
- [ ] Note moves to chronological position

### Stability
- [ ] Add note to Campaign A
- [ ] Change date filter (7D → 14D)
- [ ] Campaign A still has note
- [ ] Enable comparison mode
- [ ] Campaign A still has note
- [ ] Select different app
- [ ] Campaign A not visible (correct)
- [ ] Select original app
- [ ] Campaign A visible with note

### Separation
- [ ] Add note to "Campaign A" in App 1
- [ ] Add note to "Campaign A" in App 2
- [ ] Select App 1 → Campaign A has first note only
- [ ] Select App 2 → Campaign A has second note only
- [ ] Notes correctly separated by app_id

---

## Endpoints Used

All existing and working:

- **GET** `/api/annotations?entityType=campaign&entityKey=1429831779|Campaign`
- **POST** `/api/annotations` - Body: `{ entityType, entityKey, noteType, noteText, isPinned }`
- **PUT** `/api/annotations/:id` - Body: `{ noteType, noteText, isPinned }`
- **DELETE** `/api/annotations/:id`

---

## Status

✅ **Backend annotations system**: Complete  
✅ **Frontend NotesPanel**: Complete  
✅ **Entity key generation**: Complete  
✅ **API endpoints**: Complete  
✅ **Validation**: Complete  
✅ **Sorting**: Complete  

❌ **Backend entity_key field**: Missing in analytics responses  
❌ **Note indicator icons**: Missing in tables (optional)

**Required Changes**: 1 file (`backend/analyticsService.js`)  
**Optional Changes**: 2 files (table components for indicators)
