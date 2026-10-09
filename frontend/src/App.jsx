import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Campaigns from './pages/Campaigns'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Keywords from './pages/Keywords'
import Profile from './pages/Profile'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="keywords" element={<Keywords />} />
        <Route path="history" element={<History />} />
        <Route path="imports" element={<Navigate to="/history" replace />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
