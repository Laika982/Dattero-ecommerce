import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";

import { isAuthenticated, isGuest, isOtpSession } 
  from "../../middleware/authMidilware.js";

import userController from "../../controllers/user/authContoller.js";

const router = express.Router();

// ==================== PUBLIC ====================

// Home
router.get("/", userController.loadHomepage);


// ==================== GUEST ROUTES ====================

// Login page
router.get("/login", isGuest, userController.loadLogin);

// Signup page
router.get("/signup", isGuest, userController.loadSignUp);

// Forgot password
router.get(
  "/forgotPassword",
  userController.loadForgotPassword
);

// Forgot password OTP page
router.get(
  "/forgotPassword/verifyOtp",
  isGuest,
  userController.loadForgotPasswordVarifyOtp
);

// Reset password page
router.get(
  "/resetPassword",
  isGuest,
  userController.loadResetPassword
);


// ==================== SIGNUP + OTP ====================

// Register user
router.post(
  "/signup",
  isGuest,
  userController.registerUser
);

// Show signup OTP page
router.get(
  "/verify-otp",
  isOtpSession,
  userController.loadVerifyOtp
);

// Verify signup OTP
router.post(
  "/verify-otp",
  isOtpSession,
  userController.verifyOtp
);

// Resend signup OTP
router.post(
  "/resend-signup-otp",
  isOtpSession,
  userController.resendSignupOtp
);


// ==================== LOGIN ====================

// Login
router.post(
  "/login",
  isGuest,
  userController.loginUser
);


// ==================== FORGOT PASSWORD ====================

// Send forgot-password OTP
router.post(
  "/forgotPassword",
  isGuest,
  userController.forgotPassword
);

// Verify forgot-password OTP
router.post(
  "/forgotPassword/verifyOtp",
  isGuest,
  userController.forgotPasswordVerifyOtp
);

// Resend forgot-password OTP
router.post(
  "/resend-forgot-password-otp",
  isGuest,
  userController.resendForgotPasswordOtp
);

// Reset password
router.post(
  "/resetPassword",
  isGuest,
  userController.resetPassword
);


// ==================== GOOGLE AUTH ====================

// Start Google login
router.get(
  "/auth/google",
  isGuest,
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })
);

// Google callback
router.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
  }),
  (req, res) => {

    const token = jwt.sign(
      {
        userId: req.user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.redirect("/");
  }
);


// ==================== AUTHENTICATED ====================

// Logout
router.get(
  "/logout",
  isAuthenticated,
  userController.logoutUser
);


export default router;