# Phase 8A: AI Insights Engine - Design

## Proposed Insight Interface

```typescript
interface Insight {
  id: string;                    // Unique identifier (timestamp-based)
  type: InsightType;             // Type of insight
  severity: 'critical' | 'warning' | 'info' | 'positive';
  title: string;                 // Short title (e.g., "CPA increased")
  summary: string;               // One-line summary (e.g., "CPA increased 18%")
  explanation: string;           // Detailed explanation with context
  currentValue: number | null;   // Current period metric value
  previousValue: number | null;  // Previous period metric value
  percentageChange: number | null; // % change (positive or negative)
  metric: string;                // Primary metric ('cpa', 'spend', 'installs', etc.)
  appId: string | null;          // App ID if specific to an app
  campaignId: string | null;     // Campaign ID if specific (future)
  keywordId: string | null;      // Keyword ID if specific (future)
  generatedAt: string;           // ISO timestamp
}

type InsightType =
  | 'cpa_increase'
  | 'cpa_decrease'
  | 'spend_increase'
  | 'spend_decrease'
  | 'install_growth'
  | 'install_decline'
  | 'ttr_improvement'
  | 'ttr_decline'
  | 'cr_improvement'
  | 'cr_decline';
```

---

## Generation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Input: Analytics Summary                                 │
│    - startDate, endDate, appId (optional)                   │
│    - days parameter for period comparison                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Fetch Data from Analytics Service                        │
│    - getDashboardSummary({ compare: true })                 │
│    - Returns: current, previous, changes                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Extract Metrics & Calculate Changes                      │
│    - current_cpa vs previous_cpa                            │
│    - current_spend vs previous_spend                        │
│    - current_installs vs previous_installs                  │
│    - current_ttr vs previous_ttr                            │
│    - current_cr vs previous_cr                              │
│    - Calculate % change for each                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Apply Rules & Generate Insights                          │
│    For each metric:                                         │
│      - Check if |%change| > 5%                              │
│      - Determine insight type                               │
│      - Assign severity                                      │
│      - Generate title, summary, explanation                 │
│      - Create Insight object                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Score & Rank Insights                                    │
│    Impact Score = |%change| × metric_weight                 │
│                                                              │
│    Metric Weights:                                          │
│    - CPA: 10 (highest priority)                             │
│    - Installs: 9                                            │
│    - Spend: 8                                               │
│    - CR: 7                                                  │
│    - TTR: 6                                                 │
│                                                              │
│    Sort by score descending                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Return Top 5 Insights                                    │
│    - Limit to 5 most impactful                              │
│    - Include all insight fields                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Insight Generation Rules

### 1. CPA Increase (type: `cpa_increase`)
**Trigger**: CPA increased by > 5%

**Severity**:
- `critical` if increase > 20%
- `warning` if increase 10-20%
- `info` if increase 5-10%

**Explanation Template**:
```
Spend {spend_change_direction} {spend_change_pct}% while tap-through installs {installs_change_direction} {installs_change_pct}%, resulting in a higher acquisition cost.
```

**Example**:
```javascript
{
  id: "insight_1689456789000_1",
  type: "cpa_increase",
  severity: "warning",
  title: "CPA increased",
  summary: "CPA increased 18%",
  explanation: "Spend increased 14% while tap-through installs fell 9%, resulting in a higher acquisition cost.",
  currentValue: 5.90,
  previousValue: 5.00,
  percentageChange: 18.0,
  metric: "cpa",
  appId: null,
  campaignId: null,
  keywordId: null,
  generatedAt: "2026-07-18T00:13:00.000Z"
}
```

---

### 2. CPA Decrease (type: `cpa_decrease`)
**Trigger**: CPA decreased by > 5%

**Severity**:
- `positive` (all decreases are good)

**Explanation Template**:
```
{reason}. This improvement suggests better campaign efficiency.
```

**Reasons**:
- "Installs increased X% while spend remained stable"
- "Installs increased X% faster than spend (Y%)"
- "Spend decreased X% while maintaining install volume"

---

### 3. Spend Increase (type: `spend_increase`)
**Trigger**: Spend increased by > 5%

**Severity**:
- `warning` if CPA also increased
- `info` if CPA stable or decreased (good ROI)

**Explanation Template**:
```
Daily budget utilization increased. {cpa_context}
```

**CPA Context**:
- "CPA remained stable, indicating healthy scaling."
- "CPA increased X%, monitor acquisition efficiency."
- "CPA improved X%, indicating effective budget allocation."

---

### 4. Spend Decrease (type: `spend_decrease`)
**Trigger**: Spend decreased by > 5%

**Severity**:
- `warning` if installs also decreased significantly
- `info` if installs stable (cost optimization)

**Explanation Template**:
```
Budget allocation reduced. {installs_context}
```

---

### 5. Install Growth (type: `install_growth`)
**Trigger**: Installs increased by > 5%

**Severity**:
- `positive` (all growth is good)

**Explanation Template**:
```
Tap-through installs grew {pct}%. {context}
```

**Context**:
- "Conversion rate improved X%, indicating better targeting."
- "Taps increased X%, expanding campaign reach."
- "Strong performance across campaigns."

---

### 6. Install Decline (type: `install_decline`)
**Trigger**: Installs decreased by > 5%

**Severity**:
- `critical` if decline > 20%
- `warning` if decline 10-20%
- `info` if decline 5-10%

**Explanation Template**:
```
Tap-through installs fell {pct}%. {reason}
```

**Reasons**:
- "Conversion rate dropped X%, review creative and targeting."
- "Taps declined X%, indicating lower ad visibility."
- "Budget constraints may be limiting reach."

---

### 7. TTR Improvement (type: `ttr_improvement`)
**Trigger**: TTR increased by > 5%

**Severity**:
- `positive`

**Explanation Template**:
```
Tap-through rate improved from {prev}% to {curr}%, indicating more engaging ad creative.
```

---

### 8. TTR Decline (type: `ttr_decline`)
**Trigger**: TTR decreased by > 5%

**Severity**:
- `warning`

**Explanation Template**:
```
Tap-through rate declined from {prev}% to {curr}%. Consider refreshing ad creative or refining keyword targeting.
```

---

### 9. CR Improvement (type: `cr_improvement`)
**Trigger**: CR increased by > 5%

**Severity**:
- `positive`

**Explanation Template**:
```
Conversion rate improved from {prev}% to {curr}%, indicating better user intent and app relevance.
```

---

### 10. CR Decline (type: `cr_decline`)
**Trigger**: CR decreased by > 5%

**Severity**:
- `warning` if decline > 10%
- `info` if decline 5-10%

**Explanation Template**:
```
Conversion rate declined from {prev}% to {curr}%. Review app store page, pricing, and keyword relevance.
```

---

## Impact Scoring

```javascript
function calculateImpactScore(insight) {
  const metricWeights = {
    cpa: 10,      // Highest priority (cost efficiency)
    installs: 9,  // Volume metric
    spend: 8,     // Budget utilization
    cr: 7,        // Conversion quality
    ttr: 6,       // Engagement
  };
  
  const weight = metricWeights[insight.metric] || 5;
  const changeMagnitude = Math.abs(insight.percentageChange || 0);
  
  return weight * changeMagnitude;
}
```

**Example Scores**:
- CPA +18% → 10 × 18 = 180
- Installs +25% → 9 × 25 = 225 (higher priority)
- TTR +8% → 6 × 8 = 48

---

## Severity Assignment

```javascript
function determineSeverity(type, percentageChange) {
  const changeMagnitude = Math.abs(percentageChange);
  
  // Positive insights (improvements)
  if (['cpa_decrease', 'install_growth', 'ttr_improvement', 'cr_improvement'].includes(type)) {
    return 'positive';
  }
  
  // Negative insights (degradations)
  if (['cpa_increase', 'install_decline', 'ttr_decline', 'cr_decline'].includes(type)) {
    if (changeMagnitude > 20) return 'critical';
    if (changeMagnitude > 10) return 'warning';
    return 'info';
  }
  
  // Spend changes (context-dependent)
  if (type === 'spend_increase') {
    // Check if CPA also increased
    return cpaIncrease ? 'warning' : 'info';
  }
  
  if (type === 'spend_decrease') {
    // Check if installs maintained
    return installsDeclined ? 'warning' : 'info';
  }
  
  return 'info';
}
```

---

## API Endpoints

### GET /api/insights

**Query Parameters**:
- `days` (optional): 7, 14, 30 (default: 7)
- `startDate` (optional): YYYY-MM-DD
- `endDate` (optional): YYYY-MM-DD
- `appId` (optional): Filter by app

**Response**:
```json
{
  "insights": [
    {
      "id": "insight_1689456789000_1",
      "type": "install_growth",
      "severity": "positive",
      "title": "Installs grew significantly",
      "summary": "Installs increased 25%",
      "explanation": "Tap-through installs grew 25%. Conversion rate improved 12%, indicating better targeting.",
      "currentValue": 1250,
      "previousValue": 1000,
      "percentageChange": 25.0,
      "metric": "installs",
      "appId": null,
      "campaignId": null,
      "keywordId": null,
      "generatedAt": "2026-07-18T00:13:00.000Z"
    },
    // ... up to 5 insights
  ],
  "generatedAt": "2026-07-18T00:13:00.000Z"
}
```

---

## Files to Create/Modify

### Backend (2 files)
1. **`backend/insightsEngine.js`** (NEW)
   - Core insights generation logic
   - Insight type generators
   - Scoring and ranking
   - Explanation builders

2. **`backend/index.js`** (MODIFIED)
   - Add `GET /api/insights` endpoint

### Frontend (3 files)
3. **`frontend/src/api.js`** (MODIFIED)
   - Add `fetchInsights()` function

4. **`frontend/src/utils/dashboardHelpers.js`** (MODIFIED)
   - Remove static `generateInsights()` function
   - Keep other helpers

5. **`frontend/src/pages/Dashboard.jsx`** (MODIFIED)
   - Fetch insights from API instead of generating locally
   - Map API insights to InsightsBar format

---

## Testing Strategy

### Unit Tests (Manual)
1. Test each insight type generator
2. Test threshold logic (5% minimum)
3. Test severity assignment
4. Test scoring algorithm
5. Test explanation generation

### Integration Tests
1. Fetch dashboard summary with comparison
2. Generate insights
3. Verify top 5 returned
4. Verify explanations make sense
5. Verify frontend displays correctly

### Edge Cases
1. No previous period data → No insights
2. All changes < 5% → No insights
3. Mixed positive/negative → Correct severities
4. Missing metrics (nulls) → Skip gracefully

---

## Example Scenarios

### Scenario 1: Budget Increase with Good Results
**Data**:
- Spend: +30%
- Installs: +40%
- CPA: -7%

**Generated Insights**:
1. Install Growth (positive, score: 360)
2. CPA Decrease (positive, score: 70)
3. Spend Increase (info, score: 240)

### Scenario 2: Performance Degradation
**Data**:
- CPA: +22%
- Installs: -15%
- TTR: -8%

**Generated Insights**:
1. CPA Increase (critical, score: 220)
2. Install Decline (warning, score: 135)
3. TTR Decline (warning, score: 48)

---

## Success Criteria

✅ Generate insights from Analytics Service only  
✅ All 10 insight types implemented  
✅ Explanations include supporting data  
✅ 5% minimum threshold enforced  
✅ Top 5 insights ranked by impact  
✅ No AI APIs used  
✅ Frontend displays live insights  
✅ Plain English explanations  
✅ No unsupported recommendations  

---

Ready to implement?
