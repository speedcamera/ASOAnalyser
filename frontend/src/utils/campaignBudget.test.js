import { describe, expect, it } from 'vitest'
import { campaignBudgetPresentation } from './campaignBudget'

describe('campaign daily budget wording', () => {
  it('labels a first recorded budget without inventing a previous value', () => {
    expect(
      campaignBudgetPresentation({
        current_daily_budget: 25,
        previous_daily_budget: null,
        budget_comparison_status: 'new',
        budget_change: null,
      }),
    ).toEqual({
      kind: 'first',
      current: 25,
      detail: 'Previous budget not recorded',
    })
  })

  it('shows a change that falls inside the selected period', () => {
    const view = campaignBudgetPresentation({
      current_daily_budget: 30,
      previous_daily_budget: 20,
      budget_change: 10,
      budget_change_percent: 50,
      budget_comparison_status: 'comparable',
      budget_changed_in_selected_period: true,
    })
    expect(view.kind).toBe('changed')
    expect(view.current).toBe(30)
    expect(view.previous).toBe(20)
    expect(view.percent).toBe(50)
  })

  it('keeps the current budget when the change is outside the selected period', () => {
    const view = campaignBudgetPresentation({
      current_daily_budget: 30,
      previous_daily_budget: 20,
      budget_comparison_status: 'comparable',
      budget_changed_in_selected_period: false,
      last_budget_change_at: '2026-08-20',
    })
    expect(view.kind).toBe('outside')
    expect(view.current).toBe(30)
    expect(view.detail).toBe('No budget change detected in selected period')
    expect(view.lastChange).toBe('2026-08-20')
  })

  it('shows the current budget when the same amount was recorded on several days', () => {
    const view = campaignBudgetPresentation({
      current_daily_budget: 30,
      previous_daily_budget: null,
      budget_observation_count: 4,
      budget_comparison_status: 'unchanged',
    })
    expect(view.kind).toBe('unchanged')
    expect(view.current).toBe(30)
    expect(view.detail).toBe('No budget change detected')
  })

  it('keeps a current budget visible when no previous budget exists', () => {
    const view = campaignBudgetPresentation({
      current_daily_budget: 30,
      previous_daily_budget: null,
      budget_comparison_status: 'unavailable',
      budget_observation_count: 1,
    })
    expect(view.kind).toBe('first')
    expect(view.current).toBe(30)
    expect(view.detail).toBe('Previous budget not recorded')
  })

  it('uses Not recorded when no daily budget exists, including a stored zero as a value', () => {
    expect(campaignBudgetPresentation({
      current_daily_budget: null,
      budget_comparison_status: 'unavailable',
    }).kind).toBe('missing')

    expect(campaignBudgetPresentation({
      current_daily_budget: 0,
      previous_daily_budget: null,
      budget_comparison_status: 'new',
    }).kind).toBe('first')
  })
})
