const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();

const {
    isAuthenticated,
    isGuest
} = require("../../middleware/authMidilware");

const userController = require("../../controllers/user/authContoller");
const passport = require("passport");


// ==================== PUBLIC ====================

// Home
router.get(
    "/",
    userController.loadHomepage
);


// ==================== GUEST ROUTES ====================

// Login page
router.get(
    "/login",
    isGuest,
    userController.loadLogin
);

// Signup page
router.get(
    "/signup",
    isGuest,
    userController.loadSignUp
);

// Forgot password
router.get(
    "/forgotPassword",
    isGuest,
    userController.loadForgotPassword
);

// Forgot password OTP
router.get(
    "/forgotPassword/verifyOtp",
    isGuest,
    userController.loadForgotPasswordVarifyOtp
);

// Reset password
router.get(
    "/resetPassword",
    isGuest,
    userController.loadResetPassword
);


// ==================== AUTH ACTIONS ====================

// Register
router.post(
    "/signup",
    userController.registerUser
);

// Verify signup OTP
router.post(
    "/verify-otp",
    userController.verifyOtp
);

// Resend signup OTP
router.post(
    "/resend-signup-otp",
    userController.resendSignupOtp
);

// Login
router.post(
    "/login",
    userController.loginUser
);

// Forgot password
router.post(
    "/forgotPassword",
    userController.forgotPassword
);

// Verify forgot password OTP
router.post(
    "/forgotPassword/verifyOtp",
    userController.forgotPasswordVerifyOtp
);

// Reset password
router.post(
    "/resetPassword",
    userController.resetPassword
);


// ==================== GOOGLE AUTH ====================

// Google login
router.get(
    "/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "select_account"
    })
);


// Google callback
router.get(
    "/auth/google/callback",
    passport.authenticate("google", {
        session: false,
        failureRedirect: "/signup"
    }),
    (req, res) => {

        const token = jwt.sign(
            {
                userId: req.user._id
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000
        });

        return res.redirect("/");
    }
);


// Logout
router.get(
    "/logout",
    userController.logoutUser
);


//products

router.get("/products",)


module.exports = router;