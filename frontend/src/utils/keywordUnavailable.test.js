import { describe, expect, it } from 'vitest'
import {
  NO_INSTALLS,
  NO_PRIOR_DATA,
  NOT_RECORDED,
  bidChangeUnavailableLabel,
  currentMetricLabel,
  missingBidLabel,
  previousMetricLabel,
} from './keywordUnavailable'

describe('keyword comparison unavailable wording', () => {
  it('A. keeps a normal bid change when both bids are recorded', () => {
    expect(missingBidLabel(30)).toBeNull()
    expect(missingBidLabel(10)).toBeNull()
    expect(bidChangeUnavailableLabel(10, 20)).toBeNull()
    expect(bidChangeUnavailableLabel(10, 200)).toBeNull()
  })

  it('B. labels a missing previous bid as not recorded, including a first bid', () => {
    expect(missingBidLabel(5.73)).toBeNull()
    expect(missingBidLabel(null)).toBe(NOT_RECORDED)
    expect(bidChangeUnavailableLabel(null, null)).toBe(NOT_RECORDED)
    expect(bidChangeUnavailableLabel(null, 5.73)).toBe(NOT_RECORDED)
    expect(bidChangeUnavailableLabel(undefined, undefined)).toBe(NOT_RECORDED)
  })

  it('C. labels a previous CPA as no installs when the previous period has zero installs', () => {
    expect(
      previousMetricLabel('cpa', { previous: null, previousInstalls: 0 }),
    ).toBe(NO_INSTALLS)
    expect(currentMetricLabel('cpa', { current: 1.59, installs: 4 })).toBeNull()
  })

  it('D. leaves a valid previous CPA as a number', () => {
    expect(
      previousMetricLabel('cpa', { previous: 1.3, previousInstalls: 12 }),
    ).toBeNull()
  })

  it('E. keeps a genuine zero as a number', () => {
    expect(previousMetricLabel('installs', { previous: 0, previousInstalls: 0 })).toBeNull()
    expect(currentMetricLabel('installs', { current: 0, installs: 0 })).toBeNull()
    expect(previousMetricLabel('spend', { previous: 0, previousInstalls: 0 })).toBeNull()
    expect(missingBidLabel(0)).toBeNull()
    expect(bidChangeUnavailableLabel(10, 0)).toBeNull()
  })

  it('uses no prior data when the previous period itself is missing', () => {
    expect(
      previousMetricLabel('cpa', { previous: null, previousInstalls: null }),
    ).toBe(NO_PRIOR_DATA)
    expect(
      previousMetricLabel('spend', { previous: null, previousInstalls: null }),
    ).toBe(NO_PRIOR_DATA)
    expect(
      previousMetricLabel('installs', { previous: null, previousInstalls: null }),
    ).toBe(NO_PRIOR_DATA)
  })

  it('labels a current CPA with zero installs as no installs', () => {
    expect(currentMetricLabel('cpa', { current: null, installs: 0 })).toBe(NO_INSTALLS)
  })
})
