import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, CheckCircle2, Loader2, ArrowLeft, KeyRound } from 'lucide-react';
import { submitPasswordReset } from '@/lib/api/auth';
import { getApiErrorMessage } from '@/lib/api-error';

const resetPasswordFormSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordForm = z.infer<typeof resetPasswordFormSchema>;

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordFormSchema),
  });

  const onSubmit = async (data: ResetPasswordForm) => {
    if (!token) {
      setServerError('Reset token is missing or invalid.');
      return;
    }

    try {
      setServerError(null);
      await submitPasswordReset({
        token,
        newPassword: data.newPassword,
      });
      setIsSuccess(true);
      // Auto-redirect to login after short delay
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 2500);
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Failed to reset password. The link may have expired.'));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-sidebar p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Set new password</h2>
          <p className="mt-2 text-sm text-sidebar-foreground">
            Please choose a strong password with at least 8 characters.
          </p>
        </div>

        {!token && (
          <div className="space-y-4">
            <div role="alert" className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">
                Invalid or missing reset token. Please request a new password reset link.
              </span>
            </div>
            <div className="text-center">
              <Link
                to="/forgot-password"
                className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80"
              >
                Request a new link
              </Link>
            </div>
          </div>
        )}

        {token && serverError && (
          <div role="alert" className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        {token && isSuccess ? (
          <div className="space-y-6">
            <div role="status" className="flex items-start space-x-3 rounded-md border border-green-500/20 bg-green-500/10 p-4 text-green-500">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-green-400">Password has been successfully reset.</p>
                <p className="mt-1 text-sidebar-foreground">
                  You can now sign in with your new password. Redirecting to login...
                </p>
              </div>
            </div>

            <div className="text-center">
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                Go to Sign in
              </Link>
            </div>
          </div>
        ) : (
          token && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-foreground">
                  New Password
                </label>
                <input
                  id="new-password"
                  {...register('newPassword')}
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  aria-invalid={!!errors.newPassword}
                  className={inputClass}
                />
                {errors.newPassword && <p className="mt-1 text-xs text-red-500">{errors.newPassword.message}</p>}
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  {...register('confirmPassword')}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                  aria-invalid={!!errors.confirmPassword}
                  className={inputClass}
                />
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-red-500">{errors.confirmPassword.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 flex w-full justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting password...
                  </>
                ) : (
                  'Reset password'
                )}
              </button>

              <div className="text-center pt-2">
                <Link
                  to="/login"
                  className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Sign in
                </Link>
              </div>
            </form>
          )
        )}
      </div>
    </div>
  );
}
