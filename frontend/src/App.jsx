import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Dashboard from './pages/Dashboard';
import MyStatus from './pages/MyStatus';
import LeaveRequests from './pages/LeaveRequests';
import LeaveReview from './pages/LeaveReview';
import KpiList from './pages/KpiList';
import KpiForm from './pages/KpiForm';
import KpiTemplateEdit from './pages/KpiTemplateEdit';
import KpiTemplates from './pages/KpiTemplates';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import CooDashboard from './pages/CooDashboard';
import Vacancies from './pages/Vacancies';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/dashboard" /> : <ForgotPassword />} />
      <Route path="/reset-password" element={user ? <Navigate to="/dashboard" /> : <ResetPassword />} />
      <Route path="/verify-email" element={user ? <Navigate to="/dashboard" /> : <VerifyEmail />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
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
  );
}
