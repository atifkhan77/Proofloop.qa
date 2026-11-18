import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/contexts/auth-context';

export default function ProtectedRoute() {
  const { token, user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // No token, OR the profile could not be fetched (e.g. API down / network error).
  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
