/**
 * Historical baseline statistics for keyword metrics.
 *
 * Primary presentation uses Typical Range (Q1–Q3).
 * Median, quartiles and IQR remain available for advanced/API consumers.
 */

const CONFIDENCE = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INSUFFICIENT: 'Insufficient',
}

const RANGE_STATUS = {
  ABOVE: 'Above historical range',
  WITHIN: 'Within historical range',
  BELOW: 'Below historical range',
  INSUFFICIENT: 'Insufficient historical data',
  UNAVAILABLE: 'Current value unavailable',
}

/** Default lookback calendar days before change_date for historical samples. */
const DEFAULT_BASELINE_LOOKBACK_DAYS = 90

/**
 * Linear-interpolation percentile (0–100) on a sorted numeric array.
 */
function percentile(sorted, p) {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  const weight = rank - low
  return sorted[low] * (1 - weight) + sorted[high] * weight
}

function summariseDistribution(values) {
  const cleaned = (values || [])
    .map((v) => (typeof v === 'number' ? v : Number.parseFloat(v)))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)

  const sampleSize = cleaned.length
  if (sampleSize === 0) {
    return {
      sample_size: 0,
      median: null,
      q1: null,
      q3: null,
      iqr: null,
      min: null,
      max: null,
      typical_low: null,
      typical_high: null,
    }
  }

  const q1 = percentile(cleaned, 25)
  const median = percentile(cleaned, 50)
  const q3 = percentile(cleaned, 75)
  const iqr = q1 != null && q3 != null ? q3 - q1 : null

  return {
    sample_size: sampleSize,
    median,
    q1,
    q3,
    iqr,
    min: cleaned[0],
    max: cleaned[cleaned.length - 1],
    // Typical Range = interquartile range bounds
    typical_low: q1,
    typical_high: q3,
  }
}

/**
 * Confidence from count of valid historical data points.
 * High ≥ 30, Medium ≥ 14, Low ≥ 5, else Insufficient.
 */
function confidenceFromSampleSize(sampleSize) {
  const n = Number(sampleSize) || 0
  if (n >= 30) return CONFIDENCE.HIGH
  if (n >= 14) return CONFIDENCE.MEDIUM
  if (n >= 5) return CONFIDENCE.LOW
  return CONFIDENCE.INSUFFICIENT
}

function classifyAgainstTypicalRange(current, typicalLow, typicalHigh, confidence) {
  if (confidence === CONFIDENCE.INSUFFICIENT || typicalLow == null || typicalHigh == null) {
    return RANGE_STATUS.INSUFFICIENT
  }
  if (current == null || !Number.isFinite(current)) {
    return RANGE_STATUS.UNAVAILABLE
  }
  if (current > typicalHigh) return RANGE_STATUS.ABOVE
  if (current < typicalLow) return RANGE_STATUS.BELOW
  return RANGE_STATUS.WITHIN
}

/**
 * Build a metric baseline payload from daily sample values + current value.
 */
function buildMetricBaseline(sampleValues, currentValue) {
  const stats = summariseDistribution(sampleValues)
  const confidence = confidenceFromSampleSize(stats.sample_size)
  const status = classifyAgainstTypicalRange(
    currentValue,
    stats.typical_low,
    stats.typical_high,
    confidence,
  )

  return {
    // Presentation-oriented fields
    typical_low: stats.typical_low,
    typical_high: stats.typical_high,
    current: currentValue ?? null,
    status,
    confidence,
    // Full statistical summary (secondary / future advanced UI)
    statistics: {
      sample_size: stats.sample_size,
      median: stats.median,
      q1: stats.q1,
      q3: stats.q3,
      iqr: stats.iqr,
      min: stats.min,
      max: stats.max,
    },
  }
}

module.exports = {
  CONFIDENCE,
  RANGE_STATUS,
  DEFAULT_BASELINE_LOOKBACK_DAYS,
  percentile,
  summariseDistribution,
  confidenceFromSampleSize,
  classifyAgainstTypicalRange,
  buildMetricBaseline,
}
