import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useLocation } from 'react-router';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { getApiErrorMessage, getApiStatus } from '@/lib/api-error';
import { useAuth, type User } from '@/contexts/auth-context';

// Mirrors apps/api/src/validations/auth.validation.ts → loginSchema.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function LoginPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from: string = location.state?.from?.pathname || '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    try {
      setServerError(null);
      const response = await api.post<{ token: string; user: User }>('/auth/login', data);
      login(response.data.token, response.data.user);
      navigate(from, { replace: true });
    } catch (error) {
      if (getApiStatus(error) === 401) {
        setServerError('Invalid email or password');
      } else {
        setServerError(getApiErrorMessage(error, 'An unexpected error occurred'));
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-sidebar p-8 shadow-sm">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h2>
          <p className="mt-2 text-sm text-sidebar-foreground">Sign in to PROOFLOOP QA</p>
        </div>

        {serverError && (
          <div role="alert" className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <div className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-foreground">Email address</label>
              <input
                id="login-email"
                {...register('email')}
                type="email"
                autoComplete="email"
                aria-invalid={!!errors.email}
                className={inputClass}
              />
              {errors.email && <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-foreground">Password</label>
              <input
                id="login-password"
                {...register('password')}
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                className={inputClass}
              />
              <div className="mt-2 flex justify-end">
                <Link to="/forgot-password" className="text-sm font-medium text-primary hover:text-primary/80">
                  Forgot password?
                </Link>
              </div>
              {errors.password && <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Signing in" /> : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-sidebar-foreground">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-semibold text-primary hover:text-primary/80">
            Register your organization
          </Link>
        </p>
      </div>
    </div>
  );
}
