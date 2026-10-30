import { rateLimit } from "express-rate-limit";
import MongoRateLimitStore from "./mongoRateLimitStore.js";
import { isAjaxRequest } from "../utils/isAjax.js";

/**
 * Creates an Express rate limiter instance configured with a shared MongoDB store,
 * standard headers, and consistent JSON/HTML responses.
 */
export function createRateLimiter({
  windowMs,
  max,
  prefix,
  message = "Too many requests. Please try again later.",
  keyGenerator,
  skipSuccessfulRequests = false,
}) {
  const store = new MongoRateLimitStore({ prefix, windowMs });

  const limiterOptions = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    store,
    message: {
      success: false,
      message,
    },
    handler: (req, res, next, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      const msg = options.message?.message || message;

      const isAjax = Boolean(
        isAjaxRequest(req) ||
        req.headers["accept"]?.includes("application/json") ||
        req.headers["content-type"]?.includes("application/json")
      );

      if (isAjax) {
        return res.status(429).json({
          success: false,
          message: msg,
          retryAfter,
        });
      }

      req.session.error = msg;
      // If a referrer is present, redirect back so notification displays in UI, else render error
      const backUrl = req.header("Referer") || req.originalUrl || "/";
      if (req.method === "POST" && req.header("Referer")) {
        return res.status(429).redirect(backUrl);
      }

      return res.status(429).render("user/server-error", {
        title: "Too Many Requests",
        message: msg,
        statusCode: 429,
      });
    },
  };

  if (typeof keyGenerator === "function") {
    limiterOptions.keyGenerator = keyGenerator;
  }

  return rateLimit(limiterOptions);
}

// 1. Customer & Admin Login Limiter (Max 10 attempts per 15 min by default)
export const loginLimiter = createRateLimiter({
  windowMs:
    Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  prefix: "rl:login:",
  message:
    "Too many login attempts from this IP. Please try again after 15 minutes.",
});

// 2. OTP Generation Limiter for Signup & Forgot Password (Max 5 attempts per 15 min)
export const otpGenLimiter = createRateLimiter({
  windowMs:
    Number(process.env.OTP_GEN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.OTP_GEN_RATE_LIMIT_MAX) || 5,
  prefix: "rl:otp-gen:",
  message:
    "Too many verification requests. Please wait 15 minutes before requesting again.",
});

// 3. OTP Resend Limiter (Max 3 attempts per 15 min)
export const otpResendLimiter = createRateLimiter({
  windowMs:
    Number(process.env.OTP_RESEND_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.OTP_RESEND_RATE_LIMIT_MAX) || 3,
  prefix: "rl:otp-resend:",
  message:
    "Too many OTP resend attempts. Please wait 15 minutes before requesting again.",
});

// 4. OTP Verification Limiter (Max 10 attempts per 15 min)
export const otpVerifyLimiter = createRateLimiter({
  windowMs:
    Number(process.env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.OTP_VERIFY_RATE_LIMIT_MAX) || 10,
  prefix: "rl:otp-verify:",
  message:
    "Too many OTP verification attempts. Please wait 15 minutes before trying again.",
});

// 5. Contact Form Submission Limiter (Max 5 submissions per 15 min)
export const contactLimiter = createRateLimiter({
  windowMs:
    Number(process.env.CONTACT_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.CONTACT_RATE_LIMIT_MAX) || 5,
  prefix: "rl:contact:",
  message:
    "Too many contact submissions from your IP. Please try again after 15 minutes.",
});

export default {
  createRateLimiter,
  loginLimiter,
  otpGenLimiter,
  otpResendLimiter,
  otpVerifyLimiter,
  contactLimiter,
};

