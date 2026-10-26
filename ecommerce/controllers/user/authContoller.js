import User from "../../models/userSchema.js";
import logger from "../../utils/logger.js";
import dotenv from "dotenv";
dotenv.config();
import jwt from "jsonwebtoken";
import { sendVerificationEmail } from "../../services/emailService.js";
import { generateOtp } from "../../utils/otp.js";
import { generateToken } from "../../utils/token.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import {
  REFERRAL_COOKIE,
  buildReferralAttribution,
  findReferrerByInvite,
  followReferralInvite,
  setReferralCookie,
  clearReferralCookie,
} from "../../services/referralService.js";

const loadHomepage = async (req, res) => {
  try {
    res.render("user/home", {
      currentNav: "home",
    });
  } catch (error) {
    logger.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const loadSignUp = async (req, res) => {
  try {
    const inviteCode = String(req.query.code || req.query.ref || "").trim();
    if (inviteCode) {
      const referrer = await findReferrerByInvite(inviteCode);
      if (referrer?.referralToken) {
        setReferralCookie(res, referrer.referralToken);
      }
    }
    return res.render("user/signup");
  } catch (error) {
    logger.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const registerUser = async (req, res) => {
  try {
    let { name, email, password, confirmpassword, referralCode } = req.body;

    name = name?.trim();
    email = email?.trim().toLowerCase();
    referralCode = referralCode?.trim();

    if (!name || !email || !password || !confirmpassword) {
      req.session.error = "All fields are required.";

      return res.redirect("/signup");
    }

    const nameRegex = /^[A-Za-z\s]+$/;

    if (!nameRegex.test(name)) {
      req.session.error = "Name must contain only letters and spaces.";

      return res.redirect("/signup");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      req.session.error = "Please enter a valid email address.";

      return res.redirect("/signup");
    }

    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(password)) {
      req.session.error =
        "Password must be at least 8 characters and contain a letter, number, and special character.";

      return res.redirect("/signup");
    }

    if (password !== confirmpassword) {
      req.session.error = "Passwords do not match.";

      return res.redirect("/signup");
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      req.session.error = "User already exists.";

      return res.redirect("/signup");
    }

    const invite = referralCode || req.cookies[REFERRAL_COOKIE];
    if (invite) {
      const referrer = await findReferrerByInvite(invite);
      if (!referrer) {
        req.session.error = "Invalid referral code or invite link.";
        return res.redirect("/signup");
      }
      if (
        referrer.email &&
        referrer.email.toLowerCase() === email.toLowerCase()
      ) {
        req.session.error = "You cannot use your own referral code.";
        return res.redirect("/signup");
      }
    }

    const hashedPassword = await hashPassword(password);

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      req.session.error =
        "Unable to send verification email. Please try again.";

      return res.redirect("/signup");
    }

    console.log(`Sign up OTP is ${otp}`);

    const signupToken = generateToken(
      {
        purpose: "signup",
        name,
        email,
        password: hashedPassword,
        referralCode: referralCode || req.cookies[REFERRAL_COOKIE] || "",
      },
      "10m",
    );

    res.cookie("signupToken", signupToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    const otpToken = generateToken(
      {
        purpose: "signup",
        otp,
        email,
        // OTP valid for 60 seconds
        otpExpiresAt: Date.now() + 60 * 1000,
      },
      "10m",
    );

    res.cookie("otpToken", otpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // OTP session valid for 10 minutes
      maxAge: 10 * 60 * 1000,
    });

    req.session.success = `OTP sended on ${email} successfully `;

    return res.redirect("/verify-otp");
  } catch (error) {
    logger.error(error);

    req.session.signupError = "Internal Server Error";

    return res.redirect("/signup");
  }
};

const loadVerifyOtp = async (req, res) => {
  try {
    return res.render("user/verify-otp", {
      purpose: req.otpSession.purpose,
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/server-error");
  }
};

const verifyOtp = async (req, res) => {
  try {
    const otp = String(req.body.otp || "").trim();

    if (!otp) {
      req.session.error = "Please enter OTP.";

      return res.redirect("/verify-otp");
    }

    const otpToken = req.cookies.otpToken;

    if (!otpToken) {
      req.session.error = "OTP session expired. Please request a new OTP.";

      return res.redirect("/verify-otp");
    }

    const otpData = jwt.verify(otpToken, process.env.JWT_SECRET);

    if (Date.now() > otpData.otpExpiresAt) {
      req.session.error = "OTP expired. Please click Resend OTP.";

      return res.redirect("/verify-otp");
    }

    if (otp !== String(otpData.otp)) {
      req.session.error = "Enter a valid OTP.";

      return res.redirect("/verify-otp");
    }

    // SIGNUP

    if (otpData.purpose === "signup") {
      const signupToken = req.cookies.signupToken;

      if (!signupToken) {
        req.session.error = "Signup session expired. Please signup again.";

        return res.redirect("/verify-otp");
      }

      const signupData = jwt.verify(signupToken, process.env.JWT_SECRET);

      const existingUser = await User.findOne({
        email: signupData.email,
      });

      if (existingUser) {
        res.clearCookie("otpToken");
        res.clearCookie("signupToken");

        req.session.error = "Email is already registered. Please login.";

        return res.redirect("/signup");
      }

      const attribution = await buildReferralAttribution({
        referralCode: signupData.referralCode,
        referralToken: req.cookies[REFERRAL_COOKIE],
        excludeEmail: signupData.email,
      });

      const saveUser = new User({
        name: signupData.name,
        email: signupData.email,
        password: signupData.password,
        referredBy: attribution.referredBy,
        referralOfferId: attribution.referralOfferId,
      });

      await saveUser.save();

      res.clearCookie("otpToken");
      res.clearCookie("signupToken");
      clearReferralCookie(res);

      // LOGIN USER

      const token = generateToken({
        userId: saveUser._id,
      });

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      });

      req.session.success = "Sign Up successfull";

      return res.redirect("/");
    }

    // FORGOT PASSWORD

    if (otpData.purpose === "forgot-password") {
      const resetToken = generateToken(
        {
          purpose: "reset-password",
          email: otpData.email,
        },
        "10m",
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

    // CHANGE EMAIL

    if (otpData.purpose === "change-email") {
      const userId = otpData.userId;
      const newEmail = otpData.newEmail;

      const existingUser = await User.findOne({
        email: newEmail,
        _id: { $ne: userId },
      });

      if (existingUser) {
        res.clearCookie("otpToken");

        req.session.error = "This email is already registered.";

        return res.redirect("/verify-otp");
      }

      await User.findByIdAndUpdate(userId, {
        email: newEmail,
        name: otpData.name,
        phone: otpData.phone || null,
        profileImage: otpData.profileImage || null,
      });

      res.clearCookie("otpToken");

      return res.redirect("/profile");
    }

    res.clearCookie("otpToken");

    req.session.error = "Invalid OTP session.";

    return res.redirect("/verify-otp");
  } catch (error) {
    logger.error(error);

    if (error.name === "TokenExpiredError") {
      req.session.error = "OTP session expired. Please request a new OTP.";

      return res.redirect("/verify-otp");
    }

    req.session.error = "Internal Server Error.";

    return res.redirect("/verify-otp");
  }
};

const loadLogin = async (req, res) => {
  try {
    const { blocked } = req.query;

    const error =
      blocked === "true" ? "Your account has been blocked." : res.locals.error;

    return res.render("user/login", {
      error,
    });
  } catch (err) {
    console.error("Load login error:", err);

    return res.redirect("/");
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      req.session.error = "All fields are required";
      return res.redirect("/login");
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      req.session.error = "User does not exist";
      return res.redirect("/login");
    }

    // Check blocked user
    if (user.isBlocked) {
      req.session.error = "Your account has been blocked.";
      return res.redirect("/login?blocked=true");
    }

    // Compare password
    const matchPassword = await verifyPassword(password, user.password);

    if (!matchPassword) {
      req.session.error = "Incorrect password";
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
    req.session.success = "login successfull";
    return res.redirect("/");
  } catch (error) {
    logger.error(error);

    req.session.error = "Internal Server Error";

    return res.redirect("/login");
  }
};

const loadForgotPassword = async (req, res) => {
  try {
    return res.render("user/forgotPassword");
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

    if (!email) {
      req.session.error = "Enter email.";

      return res.redirect("/forgotPassword");
    }

    const user = await User.findOne({ email });

    if (!user) {
      req.session.error = "Enter a valid email.";

      return res.redirect("/forgotPassword");
    }

    if (user.isBlocked) {
      req.session.error = "Your account has been blocked.";

      return res.redirect("/forgotPassword");
    }

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      req.session.error = "Unable to send OTP. Please try again.";

      return res.redirect("/forgotPassword");
    }

    logger.info(`Forgot password OTP: ${otp}`);

    const otpToken = generateToken(
      {
        purpose: "forgot-password",
        otp,
        email,

        // OTP valid for 60 seconds
        otpExpiresAt: Date.now() + 60 * 1000,
      },
      "10m",
    );

    res.cookie("otpToken", otpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",

      // OTP session valid for 10 minutes
      maxAge: 10 * 60 * 1000,
    });

    req.session.success = `OTP sended on ${email} successfully`;

    return res.redirect("/verify-otp");
  } catch (error) {
    logger.error(error);

    req.session.forgotPasswordError = "Internal Server Error.";

    return res.redirect("/forgotPassword");
  }
};

const loadResetPassword = async (req, res) => {
  try {
    return res.render("user/reset-password");
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/server-error");
  }
};

const resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword) {
      req.session.error = "Fill both fields.";

      return res.redirect("/resetPassword");
    }

    if (newPassword !== confirmPassword) {
      req.session.error = "Passwords don't match.";

      return res.redirect("/resetPassword");
    }

    const token = req.cookies.resetEmail;

    if (!token) {
      req.session.error = "Reset session expired. Please try again.";

      return res.redirect("/resetPassword");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const hashedPassword = await hashPassword(newPassword);

    const user = await User.findOneAndUpdate(
      { email: decoded.email },
      { password: hashedPassword },
    );

    if (!user) {
      req.session.error = "User not found.";

      return res.redirect("/resetPassword");
    }

    res.clearCookie("resetEmail");

    req.session.success = "Password Change Successfully";

    return res.redirect("/login");
  } catch (error) {
    logger.error(error);



    if (error.name === "TokenExpiredError") {
      res.clearCookie("resetEmail");

      req.session.error = "Reset session expired. Please request a new OTP.";

      return res.redirect("/resetPassword");
    }



    if (error.name === "JsonWebTokenError") {
      res.clearCookie("resetEmail");

      req.session.error = "Invalid reset session. Please try again.";

      return res.redirect("/resetPassword");
    }



    req.session.error = "Internal Server Error.";

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



    const decoded = jwt.verify(otpToken, process.env.JWT_SECRET);



    const otp = generateOtp();

    let email;



    if (decoded.purpose === "signup") {
      email = decoded.email;
    } else if (decoded.purpose === "forgot-password") {
      email = decoded.email;
      const user = await User.findOne({ email });
      if (user && user.isBlocked) {
        return res.status(403).json({
          success: false,
          message: "Your account has been blocked.",
        });
      }
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



    console.log(`Resend OTP: ${otp}`);

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to send OTP. Please try again.",
      });
    }



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



    const newOtpToken = generateToken(newTokenData, "10m");

    res.cookie("otpToken", newOtpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    logger.info(`OTP resent for ${decoded.purpose}`);

    req.session.success = "Resend OTP successfully";
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
    req.session.success = "Logout success";
    return res.redirect("/");
  } catch (error) {
    logger.error("Logout error:", error);
    return res.redirect("/");
  }
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
