import User from "../../models/userSchema.js";
import logger from "../../utils/logger.js";
import dotenv from "dotenv";
dotenv.config();
import jwt from "jsonwebtoken";
import { sendVerificationEmail } from "../../services/emailService.js";
import { generateOtp } from "../../utils/otp.js";
import { generateToken } from "../../utils/token.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";

const loadHomepage = async (req, res) => {
  try {
    res.render("user/home");
  } catch (error) {
    logger.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const loadSignUp = async (req, res) => {
  try {
    const error = req.session.signupError || null;

    // Flash message: show once, then remove
    delete req.session.signupError;

    return res.render("user/signup", {
      error,
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const registerUser = async (req, res) => {
  try {
    let {
      name,
      email,
      password,
      confirmpassword,
      referralCode,
    } = req.body;

    name = name?.trim();
    email = email?.trim().toLowerCase();
    referralCode = referralCode?.trim();

    // =========================
    // REQUIRED FIELDS
    // =========================

    if (!name || !email || !password || !confirmpassword) {
      req.session.signupError = "All fields are required.";

      return res.redirect("/signup");
    }

    // =========================
    // NAME VALIDATION
    // =========================

    const nameRegex = /^[A-Za-z\s]+$/;

    if (!nameRegex.test(name)) {
      req.session.signupError =
        "Name must contain only letters and spaces.";

      return res.redirect("/signup");
    }

    // =========================
    // EMAIL VALIDATION
    // =========================

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      req.session.signupError =
        "Please enter a valid email address.";

      return res.redirect("/signup");
    }

    // =========================
    // PASSWORD VALIDATION
    // =========================

    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(password)) {
      req.session.signupError =
        "Password must be at least 8 characters and contain a letter, number, and special character.";

      return res.redirect("/signup");
    }

    // =========================
    // CONFIRM PASSWORD
    // =========================

    if (password !== confirmpassword) {
      req.session.signupError = "Passwords do not match.";

      return res.redirect("/signup");
    }

    // =========================
    // CHECK EXISTING USER
    // =========================

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      req.session.signupError = "User already exists.";

      return res.redirect("/signup");
    }

    // =========================
    // HASH PASSWORD
    // =========================

    const hashedPassword = await hashPassword(password);

    // =========================
    // GENERATE OTP
    // =========================

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      req.session.signupError =
        "Unable to send verification email. Please try again.";

      return res.redirect("/signup");
    }

    console.log(`Sign up OTP is ${otp}`);

    // =========================
    // STORE SIGNUP INFORMATION
    // =========================

    const signupToken = generateToken(
      {
        purpose: "signup",
        name,
        email,
        password: hashedPassword,
        referralCode,
      },
      "10m"
    );

    res.cookie("signupToken", signupToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    // =========================
    // STORE OTP INFORMATION
    // =========================

    const otpToken = generateToken(
      {
        purpose: "signup",
        otp,
        email,
        // OTP valid for 60 seconds
        otpExpiresAt: Date.now() + 60 * 1000,
      },
      "10m"
    );

    res.cookie("otpToken", otpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // OTP session valid for 10 minutes
      maxAge: 10 * 60 * 1000,
    });

    // =========================
    // SUCCESS
    // =========================

    return res.redirect("/verify-otp");

  } catch (error) {
    logger.error(error);

    req.session.signupError = "Internal Server Error";

    return res.redirect("/signup");
  }
};

const loadVerifyOtp = async (req, res) => {
  try {
    const error = req.session.otpError || null;

    // Show OTP error only once
    delete req.session.otpError;

    return res.render("user/verify-otp", {
      purpose: req.otpSession.purpose,
      error,
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/server-error");
  }
};

const verifyOtp = async (req, res) => {
  try {
    const otp = String(req.body.otp || "").trim();

    // =========================
    // EMPTY OTP
    // =========================

    if (!otp) {
      req.session.otpError = "Please enter OTP.";

      return res.redirect("/verify-otp");
    }

    // =========================
    // GET OTP TOKEN
    // =========================

    const otpToken = req.cookies.otpToken;

    if (!otpToken) {
      req.session.otpError =
        "OTP session expired. Please request a new OTP.";

      return res.redirect("/verify-otp");
    }

    const otpData = jwt.verify(
      otpToken,
      process.env.JWT_SECRET
    );

    // =========================
    // CHECK OTP EXPIRY
    // =========================

    if (Date.now() > otpData.otpExpiresAt) {
      req.session.otpError =
        "OTP expired. Please click Resend OTP.";

      return res.redirect("/verify-otp");
    }

    // =========================
    // CHECK OTP VALUE
    // =========================

    if (otp !== String(otpData.otp)) {
      req.session.otpError = "Enter a valid OTP.";

      return res.redirect("/verify-otp");
    }


    // ==================================================
    // SIGNUP
    // ==================================================

    if (otpData.purpose === "signup") {
      const signupToken = req.cookies.signupToken;

      if (!signupToken) {
        req.session.otpError =
          "Signup session expired. Please signup again.";

        return res.redirect("/verify-otp");
      }

      const signupData = jwt.verify(
        signupToken,
        process.env.JWT_SECRET
      );

      // =========================
      // CHECK DUPLICATE EMAIL
      // =========================

      const existingUser = await User.findOne({
        email: signupData.email,
      });

      if (existingUser) {
        res.clearCookie("otpToken");
        res.clearCookie("signupToken");

        req.session.signupError =
          "Email is already registered. Please login.";

        return res.redirect("/signup");
      }

      // =========================
      // CREATE USER
      // =========================

      const saveUser = new User({
        name: signupData.name,
        email: signupData.email,
        password: signupData.password,
        referralCode: signupData.referralCode,
      });

      await saveUser.save();

      // =========================
      // CLEAR TEMPORARY COOKIES
      // =========================

      res.clearCookie("otpToken");
      res.clearCookie("signupToken");

      // =========================
      // LOGIN USER
      // =========================

      const token = generateToken({
        userId: saveUser._id,
      });

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.redirect("/");
    }


    // ==================================================
    // FORGOT PASSWORD
    // ==================================================

    if (otpData.purpose === "forgot-password") {

      const resetToken = generateToken(
        {
          purpose: "reset-password",
          email: otpData.email,
        },
        "10m"
      );

      // Clear OTP token
      res.clearCookie("otpToken");

      // Store reset session
      res.cookie("resetEmail", resetToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
      });

      return res.redirect("/resetPassword");
    }


    // ==================================================
    // CHANGE EMAIL
    // ==================================================

    if (otpData.purpose === "change-email") {

      const userId = otpData.userId;
      const newEmail = otpData.newEmail;

      // =========================
      // CHECK EMAIL ALREADY EXISTS
      // =========================

      const existingUser = await User.findOne({
        email: newEmail,
        _id: { $ne: userId },
      });

      if (existingUser) {
        res.clearCookie("otpToken");

        req.session.otpError =
          "This email is already registered.";

        return res.redirect("/verify-otp");
      }

      // =========================
      // UPDATE EMAIL
      // =========================

      await User.findByIdAndUpdate(
        userId,
        {
          email: newEmail,
          name: otpData.name,
          phone: otpData.phone || null,
          profileImage: otpData.profileImage || null,
        }
      );

      // =========================
      // CLEAR OTP TOKEN
      // =========================

      res.clearCookie("otpToken");

      return res.redirect("/profile");
    }


    // ==================================================
    // UNKNOWN PURPOSE
    // ==================================================

    res.clearCookie("otpToken");

    req.session.otpError = "Invalid OTP session.";

    return res.redirect("/verify-otp");


  } catch (error) {

    logger.error(error);

    // =========================
    // JWT EXPIRED
    // =========================

    if (error.name === "TokenExpiredError") {

      req.session.otpError =
        "OTP session expired. Please request a new OTP.";

      return res.redirect("/verify-otp");
    }

    // =========================
    // OTHER ERRORS
    // =========================

    req.session.otpError =
      "Internal Server Error.";

    return res.redirect("/verify-otp");
  }
};

const loadLogin = async (req, res) => {
  try {

   let error = req.session.loginError || null;

    // Remove error after reading it
    delete req.session.loginError;

    // Check if user was redirected because account is blocked
    if (req.query.blocked === "true") {
      error = "Your account has been blocked by the administrator.";
    }

    return res.render("user/login", {
      error,
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    

    // Validate input
    if (!email || !password) {
      req.session.loginError = "All fields are required";
      return res.redirect("/login");
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      req.session.loginError = "User does not exist";
      return res.redirect("/login");
    }

    // Check blocked user
    if (user.isBlocked) {
      req.session.loginError = "User is blocked";
      return res.redirect("/login");
    }

    // Compare password
    const matchPassword = await verifyPassword(
      password,
      user.password
    );

    if (!matchPassword) {
      req.session.loginError = "Incorrect password";
      return res.redirect("/login");
    }

    // Generate JWT
    const token = generateToken({
      userId: user._id,
    });

    // Store JWT in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Successful login
    return res.redirect("/");
  } catch (error) {
    logger.error(error);

    req.session.loginError = "Internal Server Error";

    return res.redirect("/login");
  }
};

const loadForgotPassword = async (req, res) => {
  try {
    const error = req.session.forgotPasswordError || null;

    // Show error only once
    delete req.session.forgotPasswordError;

    return res.render("user/forgotPassword", {
      error,
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/forgotPassword", {
      error: "Internal Server Error",
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;

    email = email?.trim().toLowerCase();

    // =========================
    // CHECK EMAIL
    // =========================

    if (!email) {
      req.session.forgotPasswordError = "Enter email.";

      return res.redirect("/forgotPassword");
    }

    // =========================
    // FIND USER
    // =========================

    const user = await User.findOne({ email });

    if (!user) {
      req.session.forgotPasswordError = "Enter a valid email.";

      return res.redirect("/forgotPassword");
    }

    // =========================
    // GENERATE OTP
    // =========================

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(
      email,
      otp
    );

    if (!emailSent) {
      req.session.forgotPasswordError =
        "Unable to send OTP. Please try again.";

      return res.redirect("/forgotPassword");
    }

    logger.info(`Forgot password OTP: ${otp}`);

    // =========================
    // CREATE OTP TOKEN
    // =========================

    const otpToken = generateToken(
      {
        purpose: "forgot-password",
        otp,
        email,

        // OTP valid for 60 seconds
        otpExpiresAt: Date.now() + 60 * 1000,
      },
      "10m"
    );

    // =========================
    // STORE OTP TOKEN
    // =========================

    res.cookie("otpToken", otpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",

      // OTP session valid for 10 minutes
      maxAge: 10 * 60 * 1000,
    });

    // =========================
    // SUCCESS
    // =========================

    return res.redirect("/verify-otp");

  } catch (error) {
    logger.error(error);

    req.session.forgotPasswordError =
      "Internal Server Error.";

    return res.redirect("/forgotPassword");
  }
};

const loadResetPassword = async (req, res) => {
  try {
    const error = req.session.resetPasswordError || null;

    // Show error only once
    delete req.session.resetPasswordError;

    return res.render("user/reset-password", {
      error,
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/server-error");
  }
};

const resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    // =========================
    // CHECK FIELDS
    // =========================

    if (!newPassword || !confirmPassword) {
      req.session.resetPasswordError =
        "Fill both fields.";

      return res.redirect("/resetPassword");
    }

    // =========================
    // CHECK PASSWORD MATCH
    // =========================

    if (newPassword !== confirmPassword) {
      req.session.resetPasswordError =
        "Passwords don't match.";

      return res.redirect("/resetPassword");
    }

    // =========================
    // GET RESET TOKEN
    // =========================

    const token = req.cookies.resetEmail;

    if (!token) {
      req.session.resetPasswordError =
        "Reset session expired. Please try again.";

      return res.redirect("/resetPassword");
    }

    // =========================
    // VERIFY JWT
    // =========================

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // =========================
    // HASH PASSWORD
    // =========================

    const hashedPassword = await hashPassword(newPassword);

    // =========================
    // UPDATE PASSWORD
    // =========================

    const user = await User.findOneAndUpdate(
      { email: decoded.email },
      { password: hashedPassword }
    );

    if (!user) {
      req.session.resetPasswordError =
        "User not found.";

      return res.redirect("/resetPassword");
    }

    // =========================
    // CLEAR RESET COOKIE
    // =========================

    res.clearCookie("resetEmail");

    // =========================
    // SUCCESS
    // =========================

    return res.redirect("/login");

  } catch (error) {
    logger.error(error);

    // =========================
    // RESET TOKEN EXPIRED
    // =========================

    if (error.name === "TokenExpiredError") {
      res.clearCookie("resetEmail");

      req.session.resetPasswordError =
        "Reset session expired. Please request a new OTP.";

      return res.redirect("/resetPassword");
    }

    // =========================
    // INVALID TOKEN
    // =========================

    if (error.name === "JsonWebTokenError") {
      res.clearCookie("resetEmail");

      req.session.resetPasswordError =
        "Invalid reset session. Please try again.";

      return res.redirect("/resetPassword");
    }

    // =========================
    // SERVER ERROR
    // =========================

    req.session.resetPasswordError =
      "Internal Server Error.";

    return res.redirect("/resetPassword");
  }
};

const resendOtp = async (req, res) => {
  try {
    const otpToken = req.cookies.otpToken;

    if (!otpToken) {
      return res.status(400).json({
        success: false,
        message: "OTP session expired. Please start again.",
      });
    }

    // =================================
    // VERIFY JWT
    // =================================

    const decoded = jwt.verify(otpToken, process.env.JWT_SECRET);

    // =================================
    // GENERATE NEW OTP
    // =================================

    const otp = generateOtp();

    let email;

    // =================================
    // DETERMINE EMAIL
    // =================================

    if (decoded.purpose === "signup") {
      email = decoded.email;
    } else if (decoded.purpose === "forgot-password") {
      email = decoded.email;
    } else if (decoded.purpose === "change-email") {
      email = decoded.newEmail;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP session.",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not found.",
      });
    }

    // =================================
    // SEND NEW OTP
    // =================================

    console.log(`Resend OTP: ${otp}`);

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to send OTP. Please try again.",
      });
    }

    // =================================
    // CREATE NEW OTP TOKEN
    // =================================

    const newTokenData = {
      purpose: decoded.purpose,
      otp,
      email,

      // New OTP gets a fresh 60 seconds
      otpExpiresAt: Date.now() + 60 * 1000,
    };

    // Change-email specific data
    if (decoded.purpose === "change-email") {
      newTokenData.userId = decoded.userId;
      newTokenData.newEmail = decoded.newEmail;
    }

    // =================================
    // JWT SESSION = 10 MINUTES
    // OTP = 60 SECONDS
    // =================================

    const newOtpToken = generateToken(newTokenData, "10m");

    res.cookie("otpToken", newOtpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    logger.info(`OTP resent for ${decoded.purpose}`);

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
    });
  } catch (error) {
    logger.error(error);

    if (error.name === "TokenExpiredError") {
      return res.status(400).json({
        success: false,
        message: "OTP session expired. Please start again.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const logoutUser = async (req, res) => {
  try {
    res.clearCookie("token");
    return res.redirect("/");
  } catch (error) {
    logger.error("Logout error:", error);
    return res.redirect("/");
  }
};

export {
  loadHomepage,
  loadLogin,
  loadSignUp,
  loadForgotPassword,
  loadResetPassword,
  registerUser,
  verifyOtp,
  loginUser,
  forgotPassword,
  resetPassword,
  logoutUser,
  loadVerifyOtp,
  resendOtp,
};

export default {
  loadHomepage,
  loadLogin,
  loadSignUp,
  loadForgotPassword,
  loadResetPassword,
  registerUser,
  verifyOtp,
  loginUser,
  forgotPassword,
  resetPassword,
  logoutUser,
  loadVerifyOtp,
  resendOtp,
};
