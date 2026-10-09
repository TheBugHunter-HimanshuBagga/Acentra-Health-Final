import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/Shell'
import { AgentPage } from '@/pages/Messages'
import { AuditPage } from '@/pages/Audit'
import { CasePage } from '@/pages/Case'
import { DashboardPage } from '@/pages/Dashboard'
import { GovernancePage } from '@/pages/Governance'
import { InvestigatePage, InvestigateRedirect } from '@/features/investigate/InvestigatePage'
import { LabPage } from '@/pages/Lab'
import { LandingPage } from '@/pages/Landing'
import { LibraryPage } from '@/pages/Library'
import { LoginPage } from '@/pages/Login'
import { OnboardingPage } from '@/pages/Onboarding'
import { PrecedentsPage } from '@/pages/Precedents'
import { QueuePage } from '@/pages/Queue'

export default function App() {
  return (
    <Routes>
      <Route path="/home" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<OnboardingPage />} />
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="investigate" element={<InvestigateRedirect />} />
        <Route path="investigate/:caseId" element={<InvestigatePage />} />
        <Route path="lab" element={<LabPage />} />
        <Route path="cases/:caseId" element={<CasePage />} />
        <Route path="precedents" element={<PrecedentsPage />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="agent" element={<AgentPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
