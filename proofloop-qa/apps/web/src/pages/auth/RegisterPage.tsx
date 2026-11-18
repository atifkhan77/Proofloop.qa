import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { getApiErrorMessage, getApiStatus } from '@/lib/api-error';
import { useAuth, type User } from '@/contexts/auth-context';

// Mirrors apps/api/src/validations/auth.validation.ts → registerSchema.
const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  organizationName: z.string().trim().min(1, 'Organization name is required'),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
});

type RegisterForm = z.infer<typeof registerSchema>;

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function RegisterPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterForm) => {
    try {
      setServerError(null);
      const response = await api.post<{ token: string; user: User }>('/auth/register', data);
      login(response.data.token, response.data.user);
      navigate('/', { replace: true });
    } catch (error) {
      const status = getApiStatus(error);
      if (status === 409 || status === 400) {
        setServerError(getApiErrorMessage(error, 'Registration failed'));
      } else {
        setServerError('An unexpected error occurred. Please try again.');
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-sidebar p-8 shadow-sm">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Create your workspace</h2>
          <p className="mt-2 text-sm text-sidebar-foreground">Set up PROOFLOOP QA for your organization</p>
        </div>

        {serverError && (
          <div role="alert" className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="reg-first-name" className="block text-sm font-medium text-foreground">First Name</label>
              <input id="reg-first-name" {...register('firstName')} autoComplete="given-name" aria-invalid={!!errors.firstName} className={inputClass} />
              {errors.firstName && <p className="mt-1 text-xs text-red-500">{errors.firstName.message}</p>}
            </div>
            <div>
              <label htmlFor="reg-last-name" className="block text-sm font-medium text-foreground">Last Name</label>
              <input id="reg-last-name" {...register('lastName')} autoComplete="family-name" aria-invalid={!!errors.lastName} className={inputClass} />
              {errors.lastName && <p className="mt-1 text-xs text-red-500">{errors.lastName.message}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="reg-org" className="block text-sm font-medium text-foreground">Organization Name</label>
            <input id="reg-org" {...register('organizationName')} autoComplete="organization" aria-invalid={!!errors.organizationName} className={inputClass} />
            {errors.organizationName && <p className="mt-1 text-xs text-red-500">{errors.organizationName.message}</p>}
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium text-foreground">Work Email</label>
            <input id="reg-email" {...register('email')} type="email" autoComplete="email" aria-invalid={!!errors.email} className={inputClass} />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-foreground">Password</label>
            <input id="reg-password" {...register('password')} type="password" autoComplete="new-password" aria-invalid={!!errors.password} className={inputClass} />
            {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Creating account" /> : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-sidebar-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary hover:text-primary/80">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
