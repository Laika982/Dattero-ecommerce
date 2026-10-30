import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";

import {
  isAuthenticated,
  isGuest,
  isOtpSession,
  noCache,
  isResetSession,
  preventForgotPasswordBack,
} from "../../middleware/authMidilware.js";

import userController from "../../controllers/user/authContoller.js";
import { followReferralInvite, REFERRAL_COOKIE } from "../../services/referralService.js";
import { getCookieOptions, getClearCookieOptions } from "../../config/cookie.js";
import { isAjaxRequest } from "../../utils/isAjax.js";
import {
  loginLimiter,
  otpGenLimiter,
  otpResendLimiter,
  otpVerifyLimiter,
  contactLimiter,
} from "../../middleware/rateLimiter.js";

const router = express.Router();

// ==================== PUBLIC ====================

// Home
router.get("/", userController.loadHomepage);

// About Us
router.get("/about", (req, res) => {
  res.render("user/aboutUs");
});

// Contact
router.get("/contact", (req, res) => {
  res.render("user/contact");
});

router.post("/contact", contactLimiter, (req, res) => {
  const { firstName, lastName, email, inquiryType, message } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email.trim()) || !message || !message.trim()) {
    if (isAjaxRequest(req)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address and message." });
    }
    req.session.error = "Please provide a valid email address and message.";
    return res.redirect("/contact");
  }

  req.session.success = "Thank you for reaching out! We've received your message and will get back to you shortly.";
  if (isAjaxRequest(req)) {
    return res.status(200).json({
      success: true,
      message: "Thank you for reaching out! We've received your message and will get back to you shortly."
    });
  }
  return res.redirect("/contact");
});

// ingredients
router.get("/ingredients", (req, res) => {
  res.render("user/ingredients");
});

// Referral invite link
router.get("/invite/:token", followReferralInvite);

// ==================== GUEST ROUTES ====================

// Login page
router.get("/login", isGuest, noCache, userController.loadLogin);

// Signup page
router.get("/signup", isGuest, noCache, userController.loadSignUp);

// Forgot password
router.get(
  "/forgotPassword",
  noCache,
  isGuest,
  preventForgotPasswordBack,
  userController.loadForgotPassword,
);

// Reset password page
router.get(
  "/resetPassword",
  noCache,
  isGuest,
  isResetSession,
  userController.loadResetPassword,
);

// ==================== SIGNUP + OTP ====================

// Register user
router.post("/signup", otpGenLimiter, isGuest, userController.registerUser);

// Show signup OTP page
router.get("/verify-otp", isOtpSession, userController.loadVerifyOtp);

// Verify signup OTP
router.post("/verify-otp", otpVerifyLimiter, isOtpSession, userController.verifyOtp);

// ==================== LOGIN ====================

// Login
router.post("/login", loginLimiter, isGuest, userController.loginUser);

// ==================== FORGOT PASSWORD ====================

// Send forgot-password OTP
router.post("/forgotPassword", otpGenLimiter, isGuest, userController.forgotPassword);

// Reset password
router.post("/resetPassword", otpGenLimiter, isGuest, userController.resetPassword);

router.post("/resend-otp", otpResendLimiter, isOtpSession, userController.resendOtp);

// ==================== GOOGLE AUTH ====================

// Start Google login
router.get(
  "/auth/google",
  isGuest,
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  }),
);

// Google callback
router.get("/auth/google/callback", (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user, info) => {
    if (err) {
      console.error("Google authentication error:", err);
      req.session.error = "Google authentication failed. Please try again.";
      return res.redirect("/login");
    }

    if (!user) {
      res.clearCookie("token", getClearCookieOptions());
      const message =
        (info && info.message) || "Authentication failed. Please try again.";
      req.session.error = message;
      if (message.toLowerCase().includes("blocked")) {
        return res.redirect("/login?blocked=true");
      }
      return res.redirect("/login");
    }

    if (user.isBlocked) {
      res.clearCookie("token", getClearCookieOptions());
      req.session.error = "Your account has been blocked.";
      return res.redirect("/login?blocked=true");
    }

    const token = jwt.sign(
      {
        userId: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    res.cookie("token", token, getCookieOptions({
      maxAge: 24 * 60 * 60 * 1000,
    }));

    res.clearCookie(REFERRAL_COOKIE, getClearCookieOptions());

    return res.redirect("/");
  })(req, res, next);
});

// ==================== AUTHENTICATED ====================

// Logout
router.post("/logout", userController.logoutUser);
router.get("/logout", userController.logoutUser);

// Orders route alias
router.get("/orders", (req, res) => res.redirect("/order/orders"));

export default router;
