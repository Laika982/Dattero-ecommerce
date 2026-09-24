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

// ==================== GUEST ROUTES ====================

// Login page
router.get("/login", isGuest,  noCache, userController.loadLogin);

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
router.post("/signup", isGuest, userController.registerUser);

// Show signup OTP page
router.get("/verify-otp", isOtpSession, userController.loadVerifyOtp);

// Verify signup OTP
router.post("/verify-otp", isOtpSession, userController.verifyOtp);

// ==================== LOGIN ====================

// Login
router.post("/login", isGuest, userController.loginUser);

// ==================== FORGOT PASSWORD ====================

// Send forgot-password OTP
router.post("/forgotPassword", isGuest, userController.forgotPassword);

// Reset password
router.post("/resetPassword", isGuest, userController.resetPassword);

router.post("/resend-otp", isOtpSession, userController.resendOtp);

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
      },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.redirect("/");
  },
);


// ==================== AUTHENTICATED ====================

// Logout
router.post("/logout", isAuthenticated, userController.logoutUser);
router.get("/logout", (req, res) => res.redirect("/"));

export default router;
