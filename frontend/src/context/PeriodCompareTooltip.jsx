import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const PeriodCompareTooltipContext = createContext(null)

export function PeriodCompareTooltipProvider({ children }) {
  const [message, setMessage] = useState(null)

  const show = useCallback((text) => {
    if (text) setMessage(text)
  }, [])

  const hide = useCallback(() => {
    setMessage(null)
  }, [])

  const value = useMemo(() => ({ show, hide }), [show, hide])

  return (
    <PeriodCompareTooltipContext.Provider value={value}>
      {children}
      {message ? (
        <div className="toast toast--info period-compare-toast" role="status">
          {message}
        </div>
      ) : null}
    </PeriodCompareTooltipContext.Provider>
  )
}

export function usePeriodCompareTooltip() {
  return useContext(PeriodCompareTooltipContext)
}
