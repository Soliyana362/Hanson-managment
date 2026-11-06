import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';

const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MyStatus = lazy(() => import('./pages/MyStatus'));
const LeaveRequests = lazy(() => import('./pages/LeaveRequests'));
const LeaveReview = lazy(() => import('./pages/LeaveReview'));
const KpiList = lazy(() => import('./pages/KpiList'));
const KpiForm = lazy(() => import('./pages/KpiForm'));
const KpiTemplateEdit = lazy(() => import('./pages/KpiTemplateEdit'));
const KpiTemplates = lazy(() => import('./pages/KpiTemplates'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const CooDashboard = lazy(() => import('./pages/CooDashboard'));
const Vacancies = lazy(() => import('./pages/Vacancies'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Reports = lazy(() => import('./pages/Reports'));
const Plans = lazy(() => import('./pages/Plans'));

export default function App() {
  const { user } = useAuth();

  return (
    <Suspense fallback={(
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading...
      </div>
    )}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/dashboard" /> : <ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/reports" element={
        <ProtectedRoute roles={['employee', 'manager', 'hr', 'coo']}>
          <Layout><Reports /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/plans" element={
        <ProtectedRoute roles={['coo']}>
          <Layout><Plans /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route path="/dashboard" element={
        <ProtectedRoute exclude={['coo']}><Layout><Dashboard /></Layout></ProtectedRoute>
      } />
      <Route path="/my-status" element={
        <ProtectedRoute exclude={['coo']}><Layout><MyStatus /></Layout></ProtectedRoute>
      } />
      <Route path="/leave" element={
        <ProtectedRoute exclude={['coo']}><Layout><LeaveRequests /></Layout></ProtectedRoute>
      } />
      <Route path="/leave/review" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager']}>
          <Layout><LeaveReview /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/kpi" element={
        <ProtectedRoute><Layout><KpiList /></Layout></ProtectedRoute>
      } />
      <Route path="/kpi/new" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager']}>
          <Layout><KpiForm /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/kpi/templates" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager']}>
          <Layout><KpiTemplates /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/kpi/templates/new" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager']}>
          <Layout><KpiTemplateEdit /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/kpi/templates/:id/edit" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager']}>
          <Layout><KpiTemplateEdit /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/kpi/:id" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager', 'employee', 'coo']}>
          <Layout><KpiForm /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/coo" element={
        <ProtectedRoute roles={['coo']}>
          <Layout><CooDashboard /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/employees" element={
        <ProtectedRoute roles={['hr', 'admin', 'manager']}>
          <Layout><Employees /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/employees/:id" element={
        <ProtectedRoute roles={['hr', 'admin', 'coo', 'manager']}>
          <Layout><EmployeeDetail /></Layout>
        </ProtectedRoute>
      } />
      <Route path="/vacancies" element={
        <ProtectedRoute roles={['hr', 'admin']}>
          <Layout><Vacancies /></Layout>
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
}
