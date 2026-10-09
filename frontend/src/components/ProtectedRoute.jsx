import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, roles, exclude }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const home = user.role === 'coo' ? '/coo' : '/dashboard';

  if (exclude && exclude.includes(user.role)) {
    return <Navigate to={home} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={home} replace />;
  }

  return children;
}
