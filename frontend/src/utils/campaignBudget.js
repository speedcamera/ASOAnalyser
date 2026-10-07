/**
 * Presentation for the Campaigns Daily Budget column.
 * Numbers come from the API. This only chooses the wording.
 */

function missingNumber(value) {
  return value === null || value === undefined
}

export function campaignBudgetPresentation(row) {
  const current = !missingNumber(row?.current_daily_budget)
    ? row.current_daily_budget
    : row?.daily_budget
  if (missingNumber(current)) {
    return { kind: 'missing' }
  }

  const previousMissing = missingNumber(row?.previous_daily_budget)
  const observations = Number(row?.budget_observation_count)
  const repeated =
    row?.budget_comparison_status === 'unchanged' ||
    (Number.isFinite(observations) && observations > 1)

  if (previousMissing && repeated) {
    return {
      kind: 'unchanged',
      current,
      detail: 'No budget change detected',
    }
  }

  if (previousMissing || row?.budget_comparison_status === 'new') {
    return {
      kind: 'first',
      current,
      detail: 'Previous budget not recorded',
    }
  }

  if (row.budget_changed_in_selected_period) {
    return {
      kind: 'changed',
      current,
      previous: row.previous_daily_budget,
      change: row.budget_change,
      percent: row.budget_change_percent,
    }
  }

  return {
    kind: 'outside',
    current,
    detail: 'No budget change detected in selected period',
    lastChange: row.last_budget_change_at || null,
  }
}
