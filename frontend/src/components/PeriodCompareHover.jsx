import { usePeriodCompareTooltip } from '../context/PeriodCompareTooltip'

export default function PeriodCompareHover({
  enabled = false,
  hint = null,
  children,
  className = '',
}) {
  const tooltip = usePeriodCompareTooltip()

  if (!enabled || !hint || !tooltip) {
    return children
  }

  return (
    <span
      className={`period-compare-hover${className ? ` ${className}` : ''}`}
      onMouseEnter={() => tooltip.show(hint)}
      onMouseLeave={() => tooltip.hide()}
    >
      {children}
    </span>
  )
}
