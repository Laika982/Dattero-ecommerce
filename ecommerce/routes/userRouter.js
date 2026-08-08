const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();

const isAuthenticated = require("../middleware/auth");
const userContoller = require("../controllers/user/userContoller");
const passport = require("passport");

// Home
router.get("/", userContoller.loadHomepage);

//load Login
router.get("/login", isAuthenticated,userContoller.loadLogin);

//load Signup
router.get("/signup", isAuthenticated, userContoller.loadSignUp);

//load forgotPassword
router.get("/forgotPassword", isAuthenticated, userContoller.loadForgotPassword);

//load forgotPassword verify otp
router.get("/forgotPassword/verifyOtp", isAuthenticated, userContoller.loadForgotPasswordVarifyOtp);

//load reset password
router.get("/resetPassword",userContoller.loadResetPassword);

// Register
router.post("/signup", userContoller.registerUser);

//verify otp
router.post("/verify-otp", userContoller.verifyOtp);

//resend otp
router.post("/resend-signup-otp", userContoller.resendSignupOtp);

//login
router.post("/login",userContoller.loginUser);

//forgot password 
router.post("/forgotPassword",userContoller.forgotPassword)

//forgot password verify
router.post("/forgotPassword/verifyOtp",userContoller.forgotPasswordVerifyOtp)

//reset password
router.post("/resetPassword",userContoller.resetPassword);
// Google authentication
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
            secure: false,
            maxAge: 24 * 60 * 60 * 1000
        });

        return res.redirect("/");
    }
);

module.exports = router;