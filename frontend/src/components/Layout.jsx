import { Outlet } from 'react-router-dom'
import { PeriodCompareTooltipProvider } from '../context/PeriodCompareTooltip'
import { useApp } from '../context/AppContext'
import TopNav from './TopNav'

export default function Layout() {
  const { error, uploadMessage, comparingPeriod } = useApp()

  return (
    <PeriodCompareTooltipProvider>
      <div className="app">
        <TopNav />
        {uploadMessage ? <div className="toast toast--success">{uploadMessage}</div> : null}
        {error ? <div className="toast toast--error">{error}</div> : null}
        {comparingPeriod ? (
          <div className="toast toast--info">Loading period comparison…</div>
        ) : null}
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </PeriodCompareTooltipProvider>
  )
}
