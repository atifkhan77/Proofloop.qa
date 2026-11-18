import { Router } from 'express';
import { register, login, me, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import {
  forgotPasswordRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
  resetPasswordRateLimiter,
} from '../middlewares/rate-limiter';

const router = Router();

router.post('/register', registerRateLimiter, register);
router.post('/login', loginRateLimiter, login);
router.get('/me', authenticate, me);

// Password Reset Flow (unauthenticated)
router.post('/forgot-password', forgotPasswordRateLimiter, forgotPassword);
router.post('/reset-password', resetPasswordRateLimiter, resetPassword);
// Alias in case invoked with /auth prefix
router.post('/auth/forgot-password', forgotPasswordRateLimiter, forgotPassword);
router.post('/auth/reset-password', resetPasswordRateLimiter, resetPassword);

export default router;
