import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthProvider';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import GuestRoute from '@/components/layout/GuestRoute';
import PageLoader from '@/components/layout/PageLoader';
import { navigation } from '@/config/navigation';

// Route-level code splitting: each page becomes its own chunk.
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const ProjectDetailPage = lazy(() => import('@/pages/projects/ProjectDetailPage'));
const TraceabilityMatrixPage = lazy(() => import('@/pages/requirements/TraceabilityMatrixPage'));
const RequirementsPage = lazy(() => import('@/pages/requirements/RequirementsPage'));
const ProjectRisksPage = lazy(() => import('@/pages/risks/ProjectRisksPage'));
const GlobalRisksPage = lazy(() => import('@/pages/risks/GlobalRisksPage'));
const ProjectTestCasesPage = lazy(() => import('@/pages/test-cases/ProjectTestCasesPage'));
const GlobalTestCasesPage = lazy(() => import('@/pages/test-cases/GlobalTestCasesPage'));
const TestCaseDetailPage = lazy(() => import('@/pages/test-cases/TestCaseDetailPage'));
const ProjectAutomationPage = lazy(() => import('@/pages/automation/ProjectAutomationPage'));
const GlobalAutomationPage = lazy(() => import('@/pages/automation/GlobalAutomationPage'));
const ProjectApiCollectionsPage = lazy(() => import('@/pages/api-intelligence/ProjectApiCollectionsPage'));
const ApiCollectionDetailPage = lazy(() => import('@/pages/api-intelligence/ApiCollectionDetailPage'));
const GlobalApiCollectionsPage = lazy(() => import('@/pages/api-intelligence/GlobalApiCollectionsPage'));
const ProjectDefectsPage = lazy(() => import('@/pages/defects/ProjectDefectsPage'));
const GlobalDefectsPage = lazy(() => import('@/pages/defects/GlobalDefectsPage'));
const OrganizationSettingsPage = lazy(() => import('@/pages/settings/OrganizationSettingsPage'));
const ProjectReportsPage = lazy(() => import('@/pages/reports/ProjectReportsPage'));
const GlobalReportsPage = lazy(() => import('@/pages/reports/GlobalReportsPage'));
const ProjectIntegrationsPage = lazy(() => import('@/pages/integrations/ProjectIntegrationsPage'));
const GlobalIntegrationsPage = lazy(() => import('@/pages/integrations/GlobalIntegrationsPage'));
const ProjectTestCyclesPage = lazy(() => import('@/pages/test-cycles/ProjectTestCyclesPage'));
const GlobalTestCyclesPage = lazy(() => import('@/pages/test-cycles/GlobalTestCyclesPage'));
const TestCycleDetailPage = lazy(() => import('@/pages/test-cycles/TestCycleDetailPage'));
const ProjectQualityGatePage = lazy(() => import('@/pages/quality-gate/ProjectQualityGatePage'));
const GlobalQualityGatePage = lazy(() => import('@/pages/quality-gate/GlobalQualityGatePage'));
const RequirementIntelligencePage = lazy(() => import('@/pages/requirements/RequirementIntelligencePage'));
const AiQaBrainPage = lazy(() => import('@/pages/ai-brain/AiQaBrainPage'));
const RootCauseAnalyzerPage = lazy(() => import('@/pages/root-cause/RootCauseAnalyzerPage'));
const EvidenceExplorerPage = lazy(() => import('@/pages/evidence/EvidenceExplorerPage'));
const DatabaseSentinelPage = lazy(() => import('@/pages/database/DatabaseSentinelPage'));

// Sidebar entries with a real page; all other nav items render the ModulePage placeholder.
const IMPLEMENTED_NAV_PATHS = new Set([
  '/',
  '/ai-brain',
  '/requirements',
  '/risks',
  '/test-cases',
  '/automation',
  '/api-collections',
  '/database',
  '/evidence',
  '/root-cause',
  '/defects',
  '/regression',
  '/releases',
  '/reports',
  '/integrations',
  '/settings',
]);
const ModulePage = lazy(() => import('@/pages/ModulePage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <AuthProvider>
        <BrowserRouter>
          {/* Covers guest pages; AppLayout has its own Suspense so the shell stays visible. */}
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Guest-only routes */}
              <Route element={<GuestRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
              </Route>

              {/* Protected routes inside the AppLayout shell */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="projects/:projectId" element={<ProjectDetailPage />} />
                  <Route path="projects/:projectId/traceability" element={<TraceabilityMatrixPage />} />
                  <Route path="projects/:projectId/risks" element={<ProjectRisksPage />} />
                  <Route path="modules/:moduleId/requirements" element={<RequirementsPage />} />
                  <Route path="risks" element={<GlobalRisksPage />} />
                  <Route path="projects/:projectId/test-cases" element={<ProjectTestCasesPage />} />
                  <Route path="test-cases" element={<GlobalTestCasesPage />} />
                  <Route path="test-cases/:testCaseId" element={<TestCaseDetailPage />} />
                  <Route path="projects/:projectId/automation" element={<ProjectAutomationPage />} />
                  <Route path="automation" element={<GlobalAutomationPage />} />
                  <Route path="projects/:projectId/api-collections" element={<ProjectApiCollectionsPage />} />
                  <Route path="api-collections" element={<GlobalApiCollectionsPage />} />
                  <Route path="api-collections/:collectionId" element={<ApiCollectionDetailPage />} />
                  <Route path="projects/:projectId/defects" element={<ProjectDefectsPage />} />
                  <Route path="defects" element={<GlobalDefectsPage />} />
                  <Route path="settings" element={<OrganizationSettingsPage />} />
                  <Route path="projects/:projectId/reports" element={<ProjectReportsPage />} />
                  <Route path="reports" element={<GlobalReportsPage />} />
                  <Route path="projects/:projectId/integrations" element={<ProjectIntegrationsPage />} />
                  <Route path="integrations" element={<GlobalIntegrationsPage />} />
                  <Route path="projects/:projectId/test-cycles" element={<ProjectTestCyclesPage />} />
                  <Route path="test-cycles" element={<GlobalTestCyclesPage />} />
                  <Route path="regression" element={<GlobalTestCyclesPage />} />
                  <Route path="test-cycles/:cycleId" element={<TestCycleDetailPage />} />
                  <Route path="requirements" element={<RequirementIntelligencePage />} />
                  <Route path="ai-brain" element={<AiQaBrainPage />} />
                  <Route path="projects/:projectId/ai-brain" element={<AiQaBrainPage />} />
                  <Route path="releases" element={<GlobalQualityGatePage />} />
                  <Route path="projects/:projectId/releases" element={<ProjectQualityGatePage />} />
                  <Route path="projects/:projectId/quality-gate" element={<ProjectQualityGatePage />} />
                  <Route path="root-cause" element={<RootCauseAnalyzerPage />} />
                  <Route path="projects/:projectId/root-cause" element={<RootCauseAnalyzerPage />} />
                  <Route path="evidence" element={<EvidenceExplorerPage />} />
                  <Route path="projects/:projectId/evidence" element={<EvidenceExplorerPage />} />
                  <Route path="database" element={<DatabaseSentinelPage />} />
                  <Route path="projects/:projectId/database" element={<DatabaseSentinelPage />} />
                  {navigation
                    .filter((item) => !IMPLEMENTED_NAV_PATHS.has(item.path))
                    .map((item) => (
                      <Route key={item.path} path={item.path.slice(1)} element={<ModulePage item={item} />} />
                    ))}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
