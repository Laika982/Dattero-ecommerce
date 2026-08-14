const User = require("../../models/userSchema");
const bcrypt = require("bcrypt");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const loadHomepage = async (req, res) => {
  try {
    res.render("user/home");
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const loadLogin = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.render("user/login");
  } catch (error) {
    console.error(error);

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
    console.log(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

const loadForgotPassword = async (req, res) => {
  try {
    return res.render("user/forgotPassword");
  } catch (error) {
    console.error(error);

    return res.status(500).render("user/forgotPassword", {
      error: "Internal Server Error",
    });
  }
};

const loadForgotPasswordVarifyOtp = async (req, res) => {
  try {
    return res.render("user/verify-reset-otp");
  } catch (error) {
    console.error(error);

    return res.status(500).render("user/forgotPassword", {
      error: "Internal Server Error",
    });
  }
};

const loadResetPassword = async (req, res) => {
  try {
    return res.render("user/reset-password");
  } catch (error) {
    console.error(error);

    return res.status(500).render("user/verify-otp", {
      error: "Internal Server Error",
    });
  }
};

const registerUser = async (req, res) => {
  try {
    let { name, email, password, confirmpassword, referralCode } = req.body;

    name = name?.trim();
    email = email?.trim().toLowerCase();
    referralCode = referralCode?.trim();

    // Validate required fields
    if (!name || !email || !password || !confirmpassword) {
      return res.status(400).render("user/signup", {
        error: "All required fields must be provided",
      });
    }

    // Password length
    if (password.length < 8) {
      return res.status(400).render("user/signup", {
        error: "Password must be at least 8 characters long",
      });
    }

    // Password confirmation
    if (password !== confirmpassword) {
      return res.status(400).render("user/signup", {
        error: "Passwords do not match",
      });
    }

    // Check existing user
    const user = await User.findOne({ email });

    if (user) {
      return res.status(409).render("user/signup", {
        error: "User already exists",
      });
    }

    // Generate OTP
    const otp = genarateOtp();
    console.log(otp);

    // Send OTP email
    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.status(500).render("user/signup", {
        error: "Unable to send verification email. Please try again.",
      });
    }

    // Create OTP JWT
    const hashedPassword = await passwordHash(password);

    const otpToken = jwt.sign(
      {
        otp,
        name,
        email,
        password: hashedPassword,
        referralCode,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "5m",
      },
    );

    // Store OTP token in cookie
    res.cookie("otpToken", otpToken, {
      httpOnly: true,
      secure: false, // true in production with HTTPS
      maxAge: 5 * 60 * 1000,
    });

    // Show OTP page
    return res.render("user/verify-otp");
  } catch (error) {
    console.error(error);

    return res.status(500).render("user/signup", {
      error: "Internal Server Error",
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const otpValue = req.body.otp || "";
    const otp = otpValue.toString().trim();

    const otpToken = req.cookies.otpToken;

    if (!otpToken) {
      return res.status(400).render("user/verify-otp", {
        error: "OTP expired. Please request a new OTP.",
      });
    }

    const user = jwt.verify(otpToken, process.env.JWT_SECRET);

    if (String(otp) !== String(user.otp)) {
      return res.status(400).render("user/verify-otp", {
        error: "Enter a valid OTP",
      });
    }

    // Create user
    const saveUser = new User({
      name: user.name,
      email: user.email,
      password: user.password,
      referralCode: user.referralCode,
    });

    await saveUser.save();

    // Remove OTP cookie
    res.clearCookie("otpToken");

    // Generate login JWT
    const token = jwt.sign(
      {
        userId: saveUser._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    // Store authentication JWT
    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.redirect("/");
  } catch (error) {
    console.error(error);

    if (error.name === "TokenExpiredError") {
      return res.status(400).render("user/verify-otp", {
        error: "OTP expired. Please request a new OTP",
      });
    }

    return res.status(500).render("user/verify-otp", {
      error: "Internal Server Error",
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
    const matchPassword = await bcrypt.compare(password, user.password);

    if (!matchPassword) {
      return res.status(401).render("user/login", {
        error: "Incorrect password",
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    // Store JWT in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Go to home
    return res.redirect("/");
  } catch (error) {
    console.error(error);

    return res.status(500).render("user/login", {
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
        error: "Enter email",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).render("user/forgotPassword", {
        error: "Enter a valid email",
      });
    }

    const otp = genarateOtp();

    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.status(500).render("user/forgotPassword", {
        error: "Unable to send OTP. Please try again.",
      });
    }

    console.log(`resent otp ${otp}`);

    const otpToken = jwt.sign(
      {
        otp,
        email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "5m",
      },
    );

    res.cookie("forgotOtpToken", otpToken, {
      httpOnly: true,
      secure: false,
      maxAge: 5 * 60 * 1000,
    });

    return res.redirect("/forgotPassword/verifyOtp");
  } catch (error) {
    console.error(error);

    return res.status(500).render("user/forgotPassword", {
      error: "Internal Server Error",
    });
  }
};

const forgotPasswordVerifyOtp = async (req, res) => {
  try {
    const otpValue = req.body.otp || "";
    const otp = otpValue.toString().trim();

    // Get OTP token from cookie
    const otpToken = req.cookies.forgotOtpToken;

    if (!otpToken) {
      return res.status(400).render("user/verify-reset-otp", {
        error: "OTP expired. Please request a new OTP",
      });
    }

    // Verify OTP JWT
    const decoded = jwt.verify(otpToken, process.env.JWT_SECRET);

    // Compare OTP
    if (String(otp) !== String(decoded.otp)) {
      return res.status(400).render("user/verify-reset-otp", {
        error: "Invalid OTP",
      });
    }

    // OTP verified
    console.log("Forgot password OTP verified");
    const resetToken = jwt.sign(
      {
        email: decoded.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "10m",
      },
    );
    // Remove OTP cookie
    res.clearCookie("forgotOtpToken");

    // Store email temporarily for reset password
    res.cookie("resetEmail", resetToken, {
      httpOnly: true,
      secure: false,
      maxAge: 10 * 60 * 1000,
    });

    // Go to reset password page
    return res.redirect("/reset-password");
  } catch (error) {
    console.error(error);

    if (error.name === "TokenExpiredError") {
      return res.status(400).render("user/verify-otp", {
        error: "OTP expired. Please request a new OTP",
      });
    }

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
    const hashedPassword = await passwordHash(newPassword);

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
    console.error(error);

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

//AI
const resendSignupOtp = async (req, res) => {
    try {
        const otpToken = req.cookies.otpToken;

        if (!otpToken) {
            return res.status(400).render("user/signup", {
                error: "Signup session expired. Please signup again."
            });
        }

        // Read signup details from existing token
        const decoded = jwt.decode(otpToken);

        if (!decoded || !decoded.email) {
            return res.status(400).render("user/signup", {
                error: "Invalid signup session. Please signup again."
            });
        }

        const otp = genarateOtp();

        console.log("resend otp"+otp)

        const emailSent = await sendVerificationEmail(
            decoded.email,
            otp
        );

        if (!emailSent) {
            return res.status(500).render("user/verify-otp", {
                error: "Unable to send OTP. Please try again."
            });
        }

        console.log(`Resent signup OTP: ${otp}`);

        // Create new OTP token
        const newOtpToken = jwt.sign(
            {
                otp,
                name: decoded.name,
                email: decoded.email,
                password: decoded.password,
                referralCode: decoded.referralCode
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "5m"
            }
        );

        // Replace old OTP token
        res.cookie("otpToken", newOtpToken, {
            httpOnly: true,
            secure: false,
            maxAge: 5 * 60 * 1000
        });

        return res.redirect("/verify-otp");

    } catch (error) {
        console.error(error);

        return res.status(500).render("user/verify-otp", {
            error: "Internal Server Error"
        });
    }
};
//functions

async function passwordHash(password) {
  try {
    const hashedPassword = await bcrypt.hash(
      password,
      Number(process.env.SALT_ROUNDS),
    );

    return hashedPassword;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

function genarateOtp() {
  const otp = Math.floor(100000 + Math.random() * 900000);
  return otp;
}

async function sendVerificationEmail(email, otp) {
  try {

    const transporter = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Verify your email account",
      text: `your OTP:${otp}`,
      html: `<b>your OTP:${otp}<b>`,
    });

    return info.accepted.length > 0;
  } catch (error) {
    console.error("error sending email", error);
    return false;
  }
}

console.log(genarateOtp());
module.exports = {
  loadHomepage,
  loadLogin,
  loadSignUp,
  loadForgotPassword,
  loadForgotPasswordVarifyOtp,
  loadResetPassword,
  registerUser,
  verifyOtp,
  loginUser,
  forgotPassword,
  forgotPasswordVerifyOtp,
  resetPassword,
  resendSignupOtp
};
