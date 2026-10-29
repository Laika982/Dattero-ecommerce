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
import { isAjaxRequest } from "../../utils/isAjax.js";

const sendAuthResponse = (req, res, { isSuccess, message, redirectUrl, statusCode = 200, extra = {} }) => {
  if (isSuccess) {
    req.session.success = message;
  } else {
    req.session.error = message;
  }

  if (isAjaxRequest(req)) {
    return res.status(statusCode).json({
      success: isSuccess,
      message,
      redirectTo: redirectUrl,
      ...extra,
    });
  }

  return res.redirect(redirectUrl);
};

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
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "All fields are required.",
        redirectUrl: "/signup",
        statusCode: 400,
      });
    }

    const nameRegex = /^[A-Za-z\s]+$/;

    if (!nameRegex.test(name)) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Name must contain only letters and spaces.",
        redirectUrl: "/signup",
        statusCode: 400,
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Please enter a valid email address.",
        redirectUrl: "/signup",
        statusCode: 400,
      });
    }

    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(password)) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Password must be at least 8 characters and contain a letter, number, and special character.",
        redirectUrl: "/signup",
        statusCode: 400,
      });
    }

    if (password !== confirmpassword) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Passwords do not match.",
        redirectUrl: "/signup",
        statusCode: 400,
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "User already exists.",
        redirectUrl: "/signup",
        statusCode: 400,
      });
    }

    const invite = referralCode || req.cookies[REFERRAL_COOKIE];
    if (invite) {
      const referrer = await findReferrerByInvite(invite);
      if (!referrer) {
        return sendAuthResponse(req, res, {
          isSuccess: false,
          message: "Invalid referral code or invite link.",
          redirectUrl: "/signup",
          statusCode: 400,
        });
      }
      if (
        referrer.email &&
        referrer.email.toLowerCase() === email.toLowerCase()
      ) {
        return sendAuthResponse(req, res, {
          isSuccess: false,
          message: "You cannot use your own referral code.",
          redirectUrl: "/signup",
          statusCode: 400,
        });
      }
    }

    const hashedPassword = await hashPassword(password);

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Unable to send verification email. Please try again.",
        redirectUrl: "/signup",
        statusCode: 500,
      });
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

    return sendAuthResponse(req, res, {
      isSuccess: true,
      message: `OTP sent to ${email} successfully`,
      redirectUrl: "/verify-otp",
      statusCode: 200,
    });
  } catch (error) {
    logger.error(error);

    req.session.signupError = "Internal Server Error";

    return sendAuthResponse(req, res, {
      isSuccess: false,
      message: "Internal Server Error",
      redirectUrl: "/signup",
      statusCode: 500,
    });
  }
};

const loadVerifyOtp = async (req, res) => {
  try {
    return res.render("user/verify-otp", {
      purpose: req.otpSession.purpose,
      // Pass the exact expiry from the token so the client timer is always
      // anchored to this OTP's true deadline, even after email changes.
      otpExpiresAt: req.otpSession.otpExpiresAt || null,
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
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Please enter OTP.",
        redirectUrl: "/verify-otp",
        statusCode: 400,
      });
    }

    const otpToken = req.cookies.otpToken;

    if (!otpToken) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "OTP session expired. Please request a new OTP.",
        redirectUrl: "/verify-otp",
        statusCode: 400,
      });
    }

    const otpData = jwt.verify(otpToken, process.env.JWT_SECRET);

    if (Date.now() > otpData.otpExpiresAt) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "OTP expired. Please click Resend OTP.",
        redirectUrl: "/verify-otp",
        statusCode: 400,
      });
    }

    if (otp !== String(otpData.otp)) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Enter a valid OTP.",
        redirectUrl: "/verify-otp",
        statusCode: 400,
      });
    }

    // SIGNUP

    if (otpData.purpose === "signup") {
      const signupToken = req.cookies.signupToken;

      if (!signupToken) {
        return sendAuthResponse(req, res, {
          isSuccess: false,
          message: "Signup session expired. Please signup again.",
          redirectUrl: "/verify-otp",
          statusCode: 400,
        });
      }

      const signupData = jwt.verify(signupToken, process.env.JWT_SECRET);

      const existingUser = await User.findOne({
        email: signupData.email,
      });

      if (existingUser) {
        res.clearCookie("otpToken");
        res.clearCookie("signupToken");

        return sendAuthResponse(req, res, {
          isSuccess: false,
          message: "Email is already registered. Please login.",
          redirectUrl: "/signup",
          statusCode: 400,
        });
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

      return sendAuthResponse(req, res, {
        isSuccess: true,
        message: "Sign Up successful",
        redirectUrl: "/",
        statusCode: 200,
      });
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

      return sendAuthResponse(req, res, {
        isSuccess: true,
        message: "OTP verified successfully",
        redirectUrl: "/resetPassword",
        statusCode: 200,
      });
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

        return sendAuthResponse(req, res, {
          isSuccess: false,
          message: "This email is already registered.",
          redirectUrl: "/verify-otp",
          statusCode: 400,
        });
      }

      await User.findByIdAndUpdate(userId, {
        email: newEmail,
        name: otpData.name,
        phone: otpData.phone || null,
        profileImage: otpData.profileImage || null,
      });

      res.clearCookie("otpToken");

      return sendAuthResponse(req, res, {
        isSuccess: true,
        message: "Email updated successfully",
        redirectUrl: "/profile",
        statusCode: 200,
      });
    }

    res.clearCookie("otpToken");

    return sendAuthResponse(req, res, {
      isSuccess: false,
      message: "Invalid OTP session.",
      redirectUrl: "/verify-otp",
      statusCode: 400,
    });
  } catch (error) {
    logger.error(error);

    if (error.name === "TokenExpiredError") {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "OTP session expired. Please request a new OTP.",
        redirectUrl: "/verify-otp",
        statusCode: 400,
      });
    }

    return sendAuthResponse(req, res, {
      isSuccess: false,
      message: "Internal Server Error.",
      redirectUrl: "/verify-otp",
      statusCode: 500,
    });
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
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "All fields are required",
        redirectUrl: "/login",
        statusCode: 400,
      });
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "User does not exist",
        redirectUrl: "/login",
        statusCode: 400,
      });
    }

    // Check blocked user
    if (user.isBlocked) {
      req.session.error = "Your account has been blocked.";
      if (isAjaxRequest(req)) {
        return res.status(403).json({
          success: false,
          message: "Your account has been blocked.",
          blocked: true,
          redirectTo: "/login?blocked=true",
        });
      }
      return res.redirect("/login?blocked=true");
    }

    // Compare password
    const matchPassword = await verifyPassword(password, user.password);

    if (!matchPassword) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Incorrect password",
        redirectUrl: "/login",
        statusCode: 400,
      });
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
    return sendAuthResponse(req, res, {
      isSuccess: true,
      message: "Login successful",
      redirectUrl: "/",
      statusCode: 200,
    });
  } catch (error) {
    logger.error(error);

    return sendAuthResponse(req, res, {
      isSuccess: false,
      message: "Internal Server Error",
      redirectUrl: "/login",
      statusCode: 500,
    });
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
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Enter email.",
        redirectUrl: "/forgotPassword",
        statusCode: 400,
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Enter a valid email.",
        redirectUrl: "/forgotPassword",
        statusCode: 400,
      });
    }

    if (user.isBlocked) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Your account has been blocked.",
        redirectUrl: "/forgotPassword",
        statusCode: 403,
      });
    }

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Unable to send OTP. Please try again.",
        redirectUrl: "/forgotPassword",
        statusCode: 500,
      });
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

    return sendAuthResponse(req, res, {
      isSuccess: true,
      message: `OTP sent to ${email} successfully`,
      redirectUrl: "/verify-otp",
      statusCode: 200,
    });
  } catch (error) {
    logger.error(error);

    req.session.forgotPasswordError = "Internal Server Error.";

    return sendAuthResponse(req, res, {
      isSuccess: false,
      message: "Internal Server Error.",
      redirectUrl: "/forgotPassword",
      statusCode: 500,
    });
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
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Fill both fields.",
        redirectUrl: "/resetPassword",
        statusCode: 400,
      });
    }

    if (newPassword !== confirmPassword) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Passwords don't match.",
        redirectUrl: "/resetPassword",
        statusCode: 400,
      });
    }

    const token = req.cookies.resetEmail;

    if (!token) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Reset session expired. Please try again.",
        redirectUrl: "/resetPassword",
        statusCode: 400,
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const hashedPassword = await hashPassword(newPassword);

    const user = await User.findOneAndUpdate(
      { email: decoded.email },
      { password: hashedPassword },
    );

    if (!user) {
      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "User not found.",
        redirectUrl: "/resetPassword",
        statusCode: 400,
      });
    }

    res.clearCookie("resetEmail");

    return sendAuthResponse(req, res, {
      isSuccess: true,
      message: "Password Changed Successfully",
      redirectUrl: "/login",
      statusCode: 200,
    });
  } catch (error) {
    logger.error(error);

    if (error.name === "TokenExpiredError") {
      res.clearCookie("resetEmail");

      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Reset session expired. Please request a new OTP.",
        redirectUrl: "/resetPassword",
        statusCode: 400,
      });
    }

    if (error.name === "JsonWebTokenError") {
      res.clearCookie("resetEmail");

      return sendAuthResponse(req, res, {
        isSuccess: false,
        message: "Invalid reset session. Please try again.",
        redirectUrl: "/resetPassword",
        statusCode: 400,
      });
    }

    return sendAuthResponse(req, res, {
      isSuccess: false,
      message: "Internal Server Error.",
      redirectUrl: "/resetPassword",
      statusCode: 500,
    });
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
    if (isAjaxRequest(req)) {
      return res.status(200).json({
        success: true,
        message: "Logout success",
        redirectTo: "/",
      });
    }
    return res.redirect("/");
  } catch (error) {
    logger.error("Logout error:", error);
    if (isAjaxRequest(req)) {
      return res.status(500).json({
        success: false,
        message: "Logout error",
        redirectTo: "/",
      });
    }
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
