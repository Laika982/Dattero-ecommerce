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
    res.set("Cache-Control", "no-store");
    res.render("user/signup");
  } catch (error) {
    logger.info(error);

    res.status(500).json({
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
      referralCode
    } = req.body;

    name = name?.trim();
    email = email?.trim().toLowerCase();
    referralCode = referralCode?.trim();

    if (!name || !email || !password || !confirmpassword) {
      return res.status(400).render("user/signup", {
        error: "All fields are required."
      });
    }

    const nameRegex = /^[A-Za-z\s]+$/;

    if (!nameRegex.test(name)) {
      return res.status(400).render("user/signup", {
        error: "Name must contain only letters and spaces."
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).render("user/signup", {
        error: "Please enter a valid email address."
      });
    }

    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(password)) {
      return res.status(400).render("user/signup", {
        error:
          "Password must be at least 8 characters and contain a letter, number, and special character."
      });
    }

    if (password !== confirmpassword) {
      return res.status(400).render("user/signup", {
        error: "Passwords do not match."
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).render("user/signup", {
        error: "User already exists"
      });
    }

    const hashedPassword = await hashPassword(password);

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.status(500).render("user/signup", {
        error: "Unable to send verification email. Please try again."
      });
    }

    console.log(`sign up otp is ${otp}`)

    // Store signup information
    const signupToken = generateToken(
      {
        purpose: "signup",
        name,
        email,
        password: hashedPassword,
        referralCode
      },
      "10m"
    );

    res.cookie("signupToken", signupToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000
    });


const otpToken = generateToken(
    {
        purpose: "signup",
        otp,
        email,

        // OTP is valid for 60 seconds
        otpExpiresAt: Date.now() + 60 * 1000
    },
    "10m"
);

res.cookie("otpToken", otpToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",

    // OTP session is valid for 10 minutes
    maxAge: 10 * 60 * 1000
});
    return res.redirect("/verify-otp");

  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/signup", {
      error: "Internal Server Error"
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const otp = String(req.body.otp || "").trim();

    if (!otp) {
      return res.status(400).render("user/verify-otp", {
        error: "Please enter OTP."
      });
    }

    const otpToken = req.cookies.otpToken;

    if (!otpToken) {
      return res.status(400).render("user/verify-otp", {
        error: "OTP session expired. Please request a new OTP."
      });
    }
const otpData = jwt.verify(
    otpToken,
    process.env.JWT_SECRET
);


// =================================
// CHECK OTP EXPIRY
// =================================

if (Date.now() > otpData.otpExpiresAt) {
    return res.status(400).render("user/verify-otp", {
        error: "OTP expired. Please click Resend OTP."
    });
}


// =================================
// CHECK OTP VALUE
// =================================

if (otp !== String(otpData.otp)) {
    return res.status(400).render("user/verify-otp", {
        error: "Enter a valid OTP."
    });
}
    // =========================
    // SIGNUP
    // =========================

    if (otpData.purpose === "signup") {

      const signupToken = req.cookies.signupToken;

      if (!signupToken) {
        return res.status(400).render("user/verify-otp", {
          error: "Signup session expired. Please signup again."
        });
      }

      const signupData = jwt.verify(
        signupToken,
        process.env.JWT_SECRET
      );

      // Check duplicate email again
      const existingUser = await User.findOne({
        email: signupData.email
      });

      if (existingUser) {
        res.clearCookie("otpToken");
        res.clearCookie("signupToken");

        return res.status(409).render("user/signup", {
          error: "Email is already registered. Please login."
        });
      }

      // Create user
      const saveUser = new User({
        name: signupData.name,
        email: signupData.email,
        password: signupData.password,
        referralCode: signupData.referralCode
      });

      await saveUser.save();

      // Clear temporary cookies
      res.clearCookie("otpToken");
      res.clearCookie("signupToken");

      // Login user
      const token = generateToken({
        userId: saveUser._id
      });

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000
      });

      return res.redirect("/");
    }

    // =========================
    // FORGOT PASSWORD
    // =========================

    if (otpData.purpose === "forgot-password") {

      const resetToken = generateToken(
        {
          purpose: "reset-password",
          email: otpData.email
        },
        "10m"
      );

      res.clearCookie("otpToken");

      res.cookie("resetEmail", resetToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000
      });

      return res.redirect("/resetPassword");
    }

    // =========================
    // CHANGE EMAIL
    // =========================

    if (otpData.purpose === "change-email") {

      const userId = otpData.userId;
      const newEmail = otpData.newEmail;

      // Check whether new email is already used
      const existingUser = await User.findOne({
        email: newEmail,
        _id: { $ne: userId }
      });

      if (existingUser) {
        res.clearCookie("otpToken");

        return res.status(409).render("user/verify-otp", {
          error: "This email is already registered."
        });
      }

      await User.findByIdAndUpdate(
        userId,
        {
          email: newEmail
        }
      );

      res.clearCookie("otpToken");

      return res.redirect("/profile");
    }

    // Unknown purpose
    res.clearCookie("otpToken");

    return res.status(400).render("user/verify-otp", {
      error: "Invalid OTP session."
    });

  } catch (error) {

    logger.error(error);

    if (error.name === "TokenExpiredError") {
      return res.status(400).render("user/verify-otp", {
        error: "OTP expired. Please click Resend OTP."
      });
    }

    return res.status(500).render("user/verify-otp", {
      error: "Internal Server Error"
    });
  }
};

const loadLogin = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");

    let error = null;

    // Check if user was redirected because account is blocked
    if (req.query.blocked === "true") {
      error = "Your account has been blocked by the administrator.";
    }

    res.render("user/login", {
      error
    });

  } catch (error) {
    logger.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).render("user/login", {
        error: "All fields are required",
      });
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).render("user/login", {
        error: "User does not exist",
      });
    }

    // Check blocked user
    if (user.isBlocked) {
      return res.status(403).render("user/login", {
        error: "User is blocked",
      });
    }

    // Compare password
    const matchPassword = await verifyPassword(password, user.password);

    if (!matchPassword) {
      return res.status(401).render("user/login", {
        error: "Incorrect password",
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

    // Go to home
    return res.redirect("/");
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/login", {
      error: "Internal Server Error",
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
      return res.status(400).render("user/forgotPassword", {
        error: "Enter email"
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).render("user/forgotPassword", {
        error: "Enter a valid email"
      });
    }

    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(
      email,
      otp
    );

    if (!emailSent) {
      return res.status(500).render("user/forgotPassword", {
        error: "Unable to send OTP. Please try again."
      });
    }

    logger.info(`Forgot password OTP: ${otp}`);

    const otpToken = generateToken(
    {
        purpose: "forgot-password",
        otp,
        email,

        // OTP valid for 60 seconds
        otpExpiresAt: Date.now() + 60 * 1000
    },
    "10m"
);

res.cookie("otpToken", otpToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",

    // OTP session valid for 10 minutes
    maxAge: 10 * 60 * 1000
});

    return res.redirect("/verify-otp");

  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/forgotPassword", {
      error: "Internal Server Error"
    });
  }
};

const loadResetPassword = async (req, res) => {
  try {
    return res.render("user/reset-password");
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/verify-otp", {
      error: "Internal Server Error",
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    // Check fields
    if (!newPassword || !confirmPassword) {
      return res.status(400).render("user/reset-password", {
        error: "Fill both fields",
      });
    }

    // Check passwords
    if (newPassword !== confirmPassword) {
      return res.status(400).render("user/reset-password", {
        error: "Passwords don't match",
      });
    }

    // Get reset email token from cookie
    const token = req.cookies.resetEmail;

    if (!token) {
      return res.status(400).render("user/reset-password", {
        error: "Reset session expired. Please try again",
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Hash password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    const user = await User.findOneAndUpdate(
      { email: decoded.email },
      { password: hashedPassword },
    );

    if (!user) {
      return res.status(404).render("user/reset-password", {
        error: "User not found",
      });
    }

    // Remove reset cookie
    res.clearCookie("resetEmail");
    return res.redirect("/login");
  } catch (error) {
    logger.error(error);

    if (error.name === "TokenExpiredError") {
      return res.status(400).render("user/reset-password", {
        error: "Reset session expired. Please request a new OTP",
      });
    }

    return res.status(500).render("user/reset-password", {
      error: "Internal Server Error",
    });
  }
};


const loadVerifyOtp = async (req, res) => {
  try {
    return res.render("user/verify-otp");
  } catch (error) {
    logger.error(error);

    return res.status(500).render("user/server-error");
  }
};

const resendOtp = async (req, res) => {
    try {

        // =================================
        // GET OTP SESSION
        // =================================

        const otpToken = req.cookies.otpToken;

        if (!otpToken) {
            return res.status(400).json({
                success: false,
                message: "OTP session expired. Please start again."
            });
        }


        // =================================
        // VERIFY JWT
        // =================================

        const decoded = jwt.verify(
            otpToken,
            process.env.JWT_SECRET
        );


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
                message: "Invalid OTP session."
            });
        }


        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email not found."
            });
        }


        // =================================
        // SEND NEW OTP
        // =================================

        console.log(`Resend OTP: ${otp}`);

        const emailSent = await sendVerificationEmail(
            email,
            otp
        );


        if (!emailSent) {
            return res.status(500).json({
                success: false,
                message: "Unable to send OTP. Please try again."
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
            otpExpiresAt: Date.now() + 60 * 1000
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

        const newOtpToken = generateToken(
            newTokenData,
            "10m"
        );


        res.cookie("otpToken", newOtpToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 10 * 60 * 1000
        });


        logger.info(
            `OTP resent for ${decoded.purpose}`
        );


        return res.status(200).json({
            success: true,
            message: "OTP resent successfully"
        });


    } catch (error) {

        logger.error(error);


        if (error.name === "TokenExpiredError") {

            return res.status(400).json({
                success: false,
                message: "OTP session expired. Please start again."
            });
        }


        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
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


const loadProducts = async (req, res) => {
  try {
    return res.render("user/products");
  } catch (error) {
    logger.error("Load products page error:", error);
    return res.status(500).render("user/server-error");
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
  loadProducts,
  resendOtp
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
  loadProducts,
  resendOtp
};