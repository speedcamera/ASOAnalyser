const { getDashboardSummary } = require('./analyticsService')

/**
 * AI Insights Engine
 * 
 * Generates deterministic insights from analytics data.
 * No LLM integration - uses rule-based analysis.
 */

const INSIGHT_TYPES = {
  CPA_INCREASE: 'cpa_increase',
  CPA_DECREASE: 'cpa_decrease',
  SPEND_INCREASE: 'spend_increase',
  SPEND_DECREASE: 'spend_decrease',
  INSTALL_GROWTH: 'install_growth',
  INSTALL_DECLINE: 'install_decline',
  TTR_IMPROVEMENT: 'ttr_improvement',
  TTR_DECLINE: 'ttr_decline',
  CR_IMPROVEMENT: 'cr_improvement',
  CR_DECLINE: 'cr_decline',
}

const METRIC_WEIGHTS = {
  cpa: 10,
  installs: 9,
  spend: 8,
  cr: 7,
  ttr: 6,
}

const MIN_CHANGE_THRESHOLD = 5 // Minimum 5% change

/**
 * Calculate percentage change
 */
function calculatePercentChange(current, previous) {
  if (!previous || previous === 0) return null
  return ((current - previous) / previous) * 100
}

/**
 * Format percentage for display
 */
function formatPercent(value) {
  if (value === null || value === undefined) return 'N/A'
  return Math.abs(value).toFixed(1)
}

/**
 * Determine severity based on insight type and magnitude
 */
function determineSeverity(type, percentageChange, context = {}) {
  const magnitude = Math.abs(percentageChange)
  
  // Positive insights
  if ([INSIGHT_TYPES.CPA_DECREASE, INSIGHT_TYPES.INSTALL_GROWTH, 
       INSIGHT_TYPES.TTR_IMPROVEMENT, INSIGHT_TYPES.CR_IMPROVEMENT].includes(type)) {
    return 'positive'
  }
  
  // Negative insights with magnitude thresholds
  if ([INSIGHT_TYPES.CPA_INCREASE, INSIGHT_TYPES.INSTALL_DECLINE, 
       INSIGHT_TYPES.TTR_DECLINE, INSIGHT_TYPES.CR_DECLINE].includes(type)) {
    if (magnitude > 20) return 'critical'
    if (magnitude > 10) return 'warning'
    return 'info'
  }
  
  // Spend increase - depends on CPA
  if (type === INSIGHT_TYPES.SPEND_INCREASE) {
    return context.cpaIncreased ? 'warning' : 'info'
  }
  
  // Spend decrease - depends on installs
  if (type === INSIGHT_TYPES.SPEND_DECREASE) {
    return context.installsDeclined ? 'warning' : 'info'
  }
  
  return 'info'
}

/**
 * Generate explanation for CPA increase
 */
function explainCpaIncrease(data) {
  const spendChange = data.changes?.spend_change || 0
  const installsChange = data.changes?.installs_change || 0
  
  let spendPart = ''
  let installsPart = ''
  
  if (spendChange > 5) {
    spendPart = `Spend increased ${formatPercent(spendChange)}%`
  } else if (spendChange < -5) {
    spendPart = `Spend decreased ${formatPercent(spendChange)}%`
  } else {
    spendPart = 'Spend remained stable'
  }
  
  if (installsChange > 5) {
    installsPart = `tap-through installs grew ${formatPercent(installsChange)}%`
  } else if (installsChange < -5) {
    installsPart = `tap-through installs fell ${formatPercent(installsChange)}%`
  } else {
    installsPart = 'tap-through installs remained flat'
  }
  
  return `${spendPart} while ${installsPart}, resulting in a higher acquisition cost.`
}

/**
 * Generate explanation for CPA decrease
 */
function explainCpaDecrease(data) {
  const spendChange = data.changes?.spend_change || 0
  const installsChange = data.changes?.installs_change || 0
  
  if (installsChange > 5 && Math.abs(spendChange) < 5) {
    return `Installs increased ${formatPercent(installsChange)}% while spend remained stable. This improvement suggests better campaign efficiency.`
  }
  
  if (installsChange > spendChange && installsChange > 5) {
    return `Installs increased ${formatPercent(installsChange)}% faster than spend (${formatPercent(spendChange)}%). This improvement suggests better campaign efficiency.`
  }
  
  if (spendChange < -5 && Math.abs(installsChange) < 5) {
    return `Spend decreased ${formatPercent(spendChange)}% while maintaining install volume. This improvement suggests better campaign efficiency.`
  }
  
  return 'Cost per acquisition improved, indicating more efficient user acquisition.'
}

/**
 * Generate explanation for spend change
 */
function explainSpendChange(data, isIncrease) {
  const cpaChange = data.changes?.cpa_change || 0
  
  if (isIncrease) {
    if (Math.abs(cpaChange) < 5) {
      return 'Daily budget utilization increased. CPA remained stable, indicating healthy scaling.'
    }
    if (cpaChange > 5) {
      return `Daily budget utilization increased. CPA increased ${formatPercent(cpaChange)}%, monitor acquisition efficiency.`
    }
    return `Daily budget utilization increased. CPA improved ${formatPercent(cpaChange)}%, indicating effective budget allocation.`
  } else {
    const installsChange = data.changes?.installs_change || 0
    if (installsChange < -10) {
      return 'Budget allocation reduced. Installs also declined significantly, review campaign performance.'
    }
    if (Math.abs(installsChange) < 5) {
      return 'Budget allocation reduced. Install volume maintained, indicating effective cost optimization.'
    }
    return 'Budget allocation reduced.'
  }
}

/**
 * Generate explanation for install change
 */
function explainInstallChange(data, isGrowth) {
  const crChange = data.changes?.cr_change || 0
  const ttrChange = data.changes?.ttr_change || 0
  const tapsChange = ((data.current?.taps || 0) - (data.previous?.taps || 0)) / (data.previous?.taps || 1) * 100
  
  if (isGrowth) {
    if (crChange > 5) {
      return `Tap-through installs grew ${formatPercent(data.changes?.installs_change || 0)}%. Conversion rate improved ${formatPercent(crChange)}%, indicating better targeting.`
    }
    if (tapsChange > 5) {
      return `Tap-through installs grew ${formatPercent(data.changes?.installs_change || 0)}%. Taps increased ${formatPercent(tapsChange)}%, expanding campaign reach.`
    }
    return `Tap-through installs grew ${formatPercent(data.changes?.installs_change || 0)}%. Strong performance across campaigns.`
  } else {
    if (crChange < -5) {
      return `Tap-through installs fell ${formatPercent(data.changes?.installs_change || 0)}%. Conversion rate dropped ${formatPercent(crChange)}%, review creative and targeting.`
    }
    if (tapsChange < -5) {
      return `Tap-through installs fell ${formatPercent(data.changes?.installs_change || 0)}%. Taps declined ${formatPercent(tapsChange)}%, indicating lower ad visibility.`
    }
    return `Tap-through installs fell ${formatPercent(data.changes?.installs_change || 0)}%. Budget constraints may be limiting reach.`
  }
}

/**
 * Classify overall performance based on key metrics
 */
function classifyOverallPerformance(data) {
  const installsChange = calculatePercentChange(data.current?.installs, data.previous?.installs) || 0
  const cpaChange = calculatePercentChange(data.current?.cpa, data.previous?.cpa) || 0
  const crChange = calculatePercentChange(data.current?.cr, data.previous?.cr) || 0
  const spendChange = calculatePercentChange(data.current?.spend, data.previous?.spend) || 0
  const ttrChange = calculatePercentChange(data.current?.ttr, data.previous?.ttr) || 0
  
  // Check if any metric exceeds threshold
  const hasSignificantChange = [installsChange, cpaChange, crChange, spendChange, ttrChange]
    .some(change => Math.abs(change) > MIN_CHANGE_THRESHOLD)
  
  if (!hasSignificantChange) {
    return 'stable'
  }
  
  // Priority 1: Strong improvement - installs up AND CPA down
  if (installsChange > 10 && cpaChange < -5) {
    return 'strong_improvement'
  }
  if (installsChange > 20 && Math.abs(cpaChange) < 5) {
    return 'strong_improvement'
  }
  
  // Priority 2: Strong decline - installs down AND CPA up
  if (installsChange < -20 && cpaChange > 5) {
    return 'strong_decline'
  }
  if (installsChange < -10 && cpaChange > 15) {
    return 'strong_decline'
  }
  
  // Priority 3: Moderate improvement
  if (installsChange > 10 && cpaChange < 10 && cpaChange >= -5) {
    return 'moderate_improvement'
  }
  if (Math.abs(installsChange) < 5 && cpaChange < -10) {
    return 'moderate_improvement'
  }
  if (crChange > 10 && Math.abs(cpaChange) < 5) {
    return 'moderate_improvement'
  }
  
  // Priority 4: Moderate decline
  if (installsChange < -10 && installsChange >= -20 && Math.abs(cpaChange) < 15) {
    return 'moderate_decline'
  }
  if (Math.abs(installsChange) < 5 && cpaChange > 10) {
    return 'moderate_decline'
  }
  if (crChange < -10) {
    return 'moderate_decline'
  }
  
  // Priority 5: Mixed scenarios
  // Installs up but CPA up proportionally (scaling inefficiently)
  if (installsChange > 10 && cpaChange > 10) {
    return 'mixed'
  }
  // Installs down but CPA down (more efficient but less volume)
  if (installsChange < -10 && cpaChange < -10) {
    return 'mixed'
  }
  // Significant opposing movements
  if (Math.abs(installsChange) > 10 && Math.abs(cpaChange) > 10 && 
      (installsChange * cpaChange < 0)) { // Opposite signs
    return 'mixed'
  }
  
  // Default to mixed if we have significant changes but no clear pattern
  return 'mixed'
}

/**
 * Select key drivers for overall summary
 */
function selectKeyDrivers(data) {
  const metrics = [
    {
      metric: 'installs',
      current: data.current?.installs,
      previous: data.previous?.installs,
      priority: 1,
    },
    {
      metric: 'cpa',
      current: data.current?.cpa,
      previous: data.previous?.cpa,
      priority: 2,
    },
    {
      metric: 'cr',
      current: data.current?.cr,
      previous: data.previous?.cr,
      priority: 3,
    },
    {
      metric: 'spend',
      current: data.current?.spend,
      previous: data.previous?.spend,
      priority: 4,
    },
    {
      metric: 'ttr',
      current: data.current?.ttr,
      previous: data.previous?.ttr,
      priority: 5,
    },
    {
      metric: 'taps',
      current: data.current?.taps,
      previous: data.previous?.taps,
      priority: 6,
    },
  ]
  
  const drivers = []
  
  for (const m of metrics) {
    const percentageChange = calculatePercentChange(m.current, m.previous)
    
    if (percentageChange === null || Math.abs(percentageChange) < 10) {
      continue // Skip insignificant movements
    }
    
    const direction = percentageChange > 0 ? 'up' : 'down'
    const significance = Math.abs(percentageChange) >= 20 ? 'high' : 'medium'
    
    let label = ''
    switch (m.metric) {
      case 'installs':
        label = percentageChange > 0 ? 'Installs grew' : 'Installs declined'
        break
      case 'cpa':
        label = percentageChange > 0 ? 'CPA increased' : 'CPA decreased'
        break
      case 'cr':
        label = percentageChange > 0 ? 'CR improved' : 'CR declined'
        break
      case 'spend':
        label = percentageChange > 0 ? 'Spend increased' : 'Spend decreased'
        break
      case 'ttr':
        label = percentageChange > 0 ? 'TTR improved' : 'TTR declined'
        break
      case 'taps':
        label = percentageChange > 0 ? 'Taps increased' : 'Taps decreased'
        break
    }
    
    drivers.push({
      metric: m.metric,
      direction,
      percentageChange: parseFloat(percentageChange.toFixed(1)),
      label,
      significance,
      priority: m.priority,
    })
  }
  
  // Sort by priority, then by magnitude
  drivers.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return Math.abs(b.percentageChange) - Math.abs(a.percentageChange)
  })
  
  // Return top 3
  return drivers.slice(0, 3).map(({ priority, ...rest }) => rest)
}

/**
 * Generate explanation for overall performance
 */
function generateOverallExplanation(classification, data, keyDrivers) {
  const installsChange = calculatePercentChange(data.current?.installs, data.previous?.installs) || 0
  const cpaChange = calculatePercentChange(data.current?.cpa, data.previous?.cpa) || 0
  const crChange = calculatePercentChange(data.current?.cr, data.previous?.cr) || 0
  const spendChange = calculatePercentChange(data.current?.spend, data.previous?.spend) || 0
  const ttrChange = calculatePercentChange(data.current?.ttr, data.previous?.ttr) || 0
  
  if (classification === 'stable') {
    return 'All key metrics remained within normal variance. No material changes exceeded the significance threshold.'
  }
  
  // Helper for describing movements
  const describe = (change, metric) => {
    const absChange = Math.abs(change)
    const verb = change > 0 ? 
      (metric === 'cpa' ? 'increased' : metric === 'cr' || metric === 'ttr' ? 'improved' : 'increased') :
      (metric === 'cpa' ? 'decreased' : metric === 'cr' || metric === 'ttr' ? 'declined' : 'decreased')
    return `${verb} ${formatPercent(absChange)}%`
  }
  
  if (classification === 'strong_improvement') {
    const parts = []
    
    if (installsChange > 10) {
      parts.push(`Tap-through installs grew ${formatPercent(installsChange)}%`)
    }
    
    if (cpaChange < -5) {
      parts.push(`CPA ${describe(cpaChange, 'cpa')}`)
    } else if (Math.abs(cpaChange) < 5) {
      parts.push('CPA remained stable')
    }
    
    let result = parts.join(' while ') + ', indicating highly effective campaign optimization.'
    
    if (crChange > 10) {
      result += ` Conversion rate improved ${formatPercent(crChange)}%, suggesting better targeting and creative alignment.`
    }
    
    return result
  }
  
  if (classification === 'moderate_improvement') {
    if (installsChange > 10) {
      return `Tap-through installs increased ${formatPercent(installsChange)}% during the period. ${cpaChange > 5 ? `CPA increased ${formatPercent(cpaChange)}%, monitor acquisition efficiency.` : 'This growth suggests effective campaign management.'}`
    }
    
    if (cpaChange < -10) {
      return `CPA improved ${formatPercent(Math.abs(cpaChange))}%, indicating more efficient user acquisition. ${Math.abs(installsChange) < 5 ? 'Install volume remained stable.' : ''}`
    }
    
    if (crChange > 10) {
      return `Conversion rate improved ${formatPercent(crChange)}%, indicating better targeting and user intent alignment. This improvement suggests optimized campaign-to-app store alignment.`
    }
    
    return 'Overall performance improved during the period with favorable movements across key efficiency metrics.'
  }
  
  if (classification === 'strong_decline') {
    const parts = []
    
    if (installsChange < -10) {
      parts.push(`Tap-through installs fell ${formatPercent(Math.abs(installsChange))}%`)
    }
    
    if (spendChange > 5) {
      parts.push(`spend increased ${formatPercent(spendChange)}%`)
    } else if (Math.abs(spendChange) < 5) {
      parts.push('spend remained broadly stable')
    } else {
      parts.push(`spend decreased ${formatPercent(Math.abs(spendChange))}%`)
    }
    
    let result = parts.join(' while ') + ', resulting in a significantly higher CPA.'
    
    if (ttrChange > 5 && crChange < 0) {
      result += ` TTR improved, but the additional engagement did not translate into stronger conversion performance.`
    } else if (crChange < -10) {
      result += ` Conversion rate declined ${formatPercent(Math.abs(crChange))}%, compounding the acquisition challenge.`
    }
    
    return result
  }
  
  if (classification === 'moderate_decline') {
    if (installsChange < -10) {
      return `Tap-through installs declined ${formatPercent(Math.abs(installsChange))}% during the period. ${cpaChange > 5 ? `CPA increased ${formatPercent(cpaChange)}%, indicating weakening acquisition efficiency.` : 'Review campaign performance and keyword targeting.'}`
    }
    
    if (cpaChange > 10) {
      return `CPA increased ${formatPercent(cpaChange)}%, indicating declining acquisition efficiency. ${Math.abs(installsChange) < 5 ? 'Install volume remained stable.' : ''} Review bid strategies and creative performance.`
    }
    
    if (crChange < -10) {
      return `Conversion rate declined ${formatPercent(Math.abs(crChange))}%, suggesting weaker alignment between ad engagement and install intent. Review app store page and keyword relevance.`
    }
    
    return 'Overall performance weakened during the period with unfavorable movements in key efficiency metrics.'
  }
  
  if (classification === 'mixed') {
    const parts = []
    
    // Identify the most significant positive and negative movements
    const movements = [
      { metric: 'installs', change: installsChange, label: 'tap-through installs' },
      { metric: 'cpa', change: cpaChange, label: 'CPA' },
      { metric: 'spend', change: spendChange, label: 'spend' },
    ]
    
    const positive = movements.filter(m => m.change > 10).sort((a, b) => b.change - a.change)[0]
    const negative = movements.filter(m => m.change < -10).sort((a, b) => a.change - b.change)[0]
    
    if (positive && negative) {
      const posDesc = positive.metric === 'cpa' ? 
        `CPA decreased ${formatPercent(Math.abs(positive.change))}%` :
        `${positive.label} ${positive.metric === 'spend' ? 'increased' : 'grew'} ${formatPercent(positive.change)}%`
      
      const negDesc = negative.metric === 'cpa' ? 
        `CPA increased ${formatPercent(Math.abs(negative.change))}%` :
        `${negative.label} ${negative.metric === 'spend' ? 'decreased' : 'declined'} ${formatPercent(Math.abs(negative.change))}%`
      
      let result = `${posDesc} but ${negDesc}, resulting in mixed performance outcomes.`
      
      if (negative.metric === 'spend' && installsChange < -10) {
        result += ' Budget constraints may be limiting reach.'
      } else if (positive.metric === 'installs' && cpaChange > 10) {
        result += ' Monitor acquisition efficiency during scaling.'
      }
      
      return result
    }
    
    return 'Performance showed mixed results with significant movements in opposing directions across key metrics.'
  }
  
  return 'Performance movements varied across key metrics during the period.'
}

/**
 * Generate overall performance insight
 */
function generateOverallInsight(data, timestamp) {
  const classification = classifyOverallPerformance(data)
  const keyDrivers = classification === 'stable' ? [] : selectKeyDrivers(data)
  
  const titles = {
    strong_improvement: 'Overall performance strengthened',
    moderate_improvement: 'Overall performance improved',
    mixed: 'Overall performance was mixed',
    moderate_decline: 'Overall performance weakened',
    strong_decline: 'Overall performance declined significantly',
    stable: 'Performance remained broadly stable',
  }
  
  const summaries = {
    strong_improvement: 'Acquisition efficiency improved significantly during the period.',
    moderate_improvement: 'Acquisition efficiency improved during the period.',
    mixed: 'Efficiency and volume showed opposing trends during the period.',
    moderate_decline: 'Acquisition efficiency weakened during the period.',
    strong_decline: 'Acquisition efficiency declined during the period.',
    stable: 'No significant movements during the period.',
  }
  
  const severities = {
    strong_improvement: 'positive',
    moderate_improvement: 'positive',
    mixed: 'neutral',
    moderate_decline: 'warning',
    strong_decline: 'critical',
    stable: 'neutral',
  }
  
  return {
    id: `overall_${timestamp}`,
    type: 'overall_summary',
    severity: severities[classification],
    title: titles[classification],
    summary: summaries[classification],
    explanation: generateOverallExplanation(classification, data, keyDrivers),
    keyDrivers,
    currentPeriod: data.current,
    previousPeriod: data.previous,
    appId: null,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Generate insights from analytics data
 */
/**
 * Generate insights from analytics data
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function generateInsights({ organisationId, startDate, endDate, days, appId = null }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  // Fetch analytics data with comparison
  const data = await getDashboardSummary({
    organisationId,
    startDate,
    endDate,
    days,
    appId,
    compare: true,
  })
  
  if (!data.current || !data.previous) {
    return {
      overallInsight: null,
      insights: [],
    }
  }
  
  const timestamp = Date.now()
  
  // Generate overall insight first
  const overallInsight = generateOverallInsight(data, timestamp)
  overallInsight.appId = appId || null
  
  const insights = []
  let insightCounter = 0
  
  // Helper to create insight
  function createInsight(type, metric, currentValue, previousValue, percentageChange) {
    insightCounter++
    return {
      id: `insight_${timestamp}_${insightCounter}`,
      type,
      metric,
      currentValue,
      previousValue,
      percentageChange,
      appId: appId || null,
      campaignId: null,
      keywordId: null,
      generatedAt: new Date().toISOString(),
    }
  }
  
  // 1. CPA Insights
  const cpaChange = calculatePercentChange(data.current?.cpa, data.previous?.cpa)
  if (cpaChange !== null && Math.abs(cpaChange) > MIN_CHANGE_THRESHOLD) {
    const type = cpaChange > 0 ? INSIGHT_TYPES.CPA_INCREASE : INSIGHT_TYPES.CPA_DECREASE
    const insight = createInsight(type, 'cpa', data.current.cpa, data.previous.cpa, cpaChange)
    insight.severity = determineSeverity(type, cpaChange)
    insight.title = cpaChange > 0 ? 'CPA increased' : 'CPA improved'
    insight.summary = `CPA ${cpaChange > 0 ? 'increased' : 'decreased'} ${formatPercent(cpaChange)}%`
    insight.explanation = cpaChange > 0 ? explainCpaIncrease(data) : explainCpaDecrease(data)
    insights.push(insight)
  }
  
  // 2. Spend Insights
  const spendChange = calculatePercentChange(data.current?.spend, data.previous?.spend)
  if (spendChange !== null && Math.abs(spendChange) > MIN_CHANGE_THRESHOLD) {
    const type = spendChange > 0 ? INSIGHT_TYPES.SPEND_INCREASE : INSIGHT_TYPES.SPEND_DECREASE
    const insight = createInsight(type, 'spend', data.current.spend, data.previous.spend, spendChange)
    const installsChange = calculatePercentChange(data.current?.installs, data.previous?.installs)
    insight.severity = determineSeverity(type, spendChange, {
      cpaIncreased: cpaChange > 5,
      installsDeclined: installsChange < -10,
    })
    insight.title = spendChange > 0 ? 'Spend increased' : 'Spend decreased'
    insight.summary = `Spend ${spendChange > 0 ? 'increased' : 'decreased'} ${formatPercent(spendChange)}%`
    insight.explanation = explainSpendChange(data, spendChange > 0)
    insights.push(insight)
  }
  
  // 3. Install Insights
  const installsChange = calculatePercentChange(data.current?.installs, data.previous?.installs)
  if (installsChange !== null && Math.abs(installsChange) > MIN_CHANGE_THRESHOLD) {
    const type = installsChange > 0 ? INSIGHT_TYPES.INSTALL_GROWTH : INSIGHT_TYPES.INSTALL_DECLINE
    const insight = createInsight(type, 'installs', data.current.installs, data.previous.installs, installsChange)
    insight.severity = determineSeverity(type, installsChange)
    insight.title = installsChange > 0 ? 'Installs grew significantly' : 'Installs declined'
    insight.summary = `Installs ${installsChange > 0 ? 'increased' : 'decreased'} ${formatPercent(installsChange)}%`
    insight.explanation = explainInstallChange(data, installsChange > 0)
    insights.push(insight)
  }
  
  // 4. TTR Insights
  const ttrChange = calculatePercentChange(data.current?.ttr, data.previous?.ttr)
  if (ttrChange !== null && Math.abs(ttrChange) > MIN_CHANGE_THRESHOLD) {
    const type = ttrChange > 0 ? INSIGHT_TYPES.TTR_IMPROVEMENT : INSIGHT_TYPES.TTR_DECLINE
    const insight = createInsight(type, 'ttr', data.current.ttr, data.previous.ttr, ttrChange)
    insight.severity = determineSeverity(type, ttrChange)
    insight.title = ttrChange > 0 ? 'TTR improved' : 'TTR declined'
    insight.summary = `TTR ${ttrChange > 0 ? 'improved' : 'declined'} ${formatPercent(ttrChange)}%`
    if (ttrChange > 0) {
      insight.explanation = `Tap-through rate improved from ${data.previous.ttr?.toFixed(1)}% to ${data.current.ttr?.toFixed(1)}%, indicating more engaging ad creative.`
    } else {
      insight.explanation = `Tap-through rate declined from ${data.previous.ttr?.toFixed(1)}% to ${data.current.ttr?.toFixed(1)}%. Consider refreshing ad creative or refining keyword targeting.`
    }
    insights.push(insight)
  }
  
  // 5. CR Insights
  const crChange = calculatePercentChange(data.current?.cr, data.previous?.cr)
  if (crChange !== null && Math.abs(crChange) > MIN_CHANGE_THRESHOLD) {
    const type = crChange > 0 ? INSIGHT_TYPES.CR_IMPROVEMENT : INSIGHT_TYPES.CR_DECLINE
    const insight = createInsight(type, 'cr', data.current.cr, data.previous.cr, crChange)
    insight.severity = determineSeverity(type, crChange)
    insight.title = crChange > 0 ? 'Conversion rate improved' : 'Conversion rate declined'
    insight.summary = `CR ${crChange > 0 ? 'improved' : 'declined'} ${formatPercent(crChange)}%`
    if (crChange > 0) {
      insight.explanation = `Conversion rate improved from ${data.previous.cr?.toFixed(1)}% to ${data.current.cr?.toFixed(1)}%, indicating better user intent and app relevance.`
    } else {
      insight.explanation = `Conversion rate declined from ${data.previous.cr?.toFixed(1)}% to ${data.current.cr?.toFixed(1)}%. Review app store page, pricing, and keyword relevance.`
    }
    insights.push(insight)
  }
  
  // Score and rank insights
  insights.forEach(insight => {
    const weight = METRIC_WEIGHTS[insight.metric] || 5
    const magnitude = Math.abs(insight.percentageChange)
    insight.impactScore = weight * magnitude
  })
  
  // Sort by impact score descending
  insights.sort((a, b) => b.impactScore - a.impactScore)
  
  // Return overall insight + top 5 detailed insights
  return {
    overallInsight,
    insights: insights.slice(0, 5).map(insight => {
      // Remove impactScore from final output
      const { impactScore, ...rest } = insight
      return rest
    }),
  }
}

module.exports = {
  generateInsights,
  INSIGHT_TYPES,
}
