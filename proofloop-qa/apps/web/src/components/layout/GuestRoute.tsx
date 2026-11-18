import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/contexts/auth-context';

export default function GuestRoute() {
  const { token, user, isLoading } = useAuth();
  const location = useLocation();
  // Same target LoginPage navigates to after sign-in. React Router v7 applies
  // navigate() in a transition, so this guard can render first while the URL is
  // still /login; redirecting to "/" here would override the intended page.
  const from: string = location.state?.from?.pathname || '/';

  // While the session is being checked, avoid flashing the form.
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Must match ProtectedRoute's condition (token AND user). Checking only `token`
  // loops when the API is down: ProtectedRoute → /login → GuestRoute → / → ...
  if (token && user) {
    return <Navigate to={from} replace />;
  }

  return <Outlet />;
}
