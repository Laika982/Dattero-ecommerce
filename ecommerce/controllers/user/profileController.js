import User from "../../models/userSchema.js";
import logger from "../../utils/logger.js";
import jwt from "jsonwebtoken";
import { sendVerificationEmail } from "../../services/emailService.js";
import { generateOtp } from "../../utils/otp.js";
import { generateToken } from "../../utils/token.js";

const getProfile = async (req, res) => {
  try {
    const token = req.cookies.token;

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    const defaultAddress = userData.addresses?.find(addr => addr.isDefault) || userData.addresses?.[0] || null;

    return res.render("user/profile", {
      userData,
      defaultAddress
    });

  } catch (error) {
    logger.error("Profile error:", error);

    res.clearCookie("token");

    return res.redirect("/login");
  }
};

const getEditProfile = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    return res.render("user/edit-profile", {
      userData
    });
  } catch (error) {
    logger.error("Get edit profile page error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const updateProfile = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    let { name, email, phone, removeProfileImage } = req.body;
    name = name?.trim();
    email = email?.toLowerCase().trim();
    phone = phone?.trim();
    const shouldRemovePhoto = removeProfileImage === "true";

    if (!name || !email) {
      const userData = await User.findById(userId).lean();
      return res.status(400).render("user/edit-profile", {
        userData,
        error: "Name and Email are required"
      });
    }

    const currentUser = await User.findById(userId).lean();
    if (!currentUser) {
      return res.redirect("/login");
    }

    // Check if email has changed
    if (email !== currentUser.email) {
      const existingUser = await User.findOne({ email }).lean();
      if (existingUser) {
        const userData = await User.findById(userId).lean();
        return res.status(400).render("user/edit-profile", {
          userData,
          error: "Email is already in use by another account"
        });
      }

      // Generate OTP and send email
      const otp = generateOtp();
      const emailSent = await sendVerificationEmail(email, otp);
      if (!emailSent) {
        const userData = await User.findById(userId).lean();
        return res.status(500).render("user/edit-profile", {
          userData,
          error: "Failed to send verification email. Please try again."
        });
      }

      logger.info(`Email update OTP sent to ${email}: ${otp}`);

      // Create a pending token cookie
      const pendingEmailToken = generateToken(
        {
          userId,
          newEmail: email,
          name,
          phone,
          profileImage: shouldRemovePhoto ? null : (req.file ? req.file.path : currentUser.profileImage),
          otp
        },
        "10m"
      );

      res.cookie("pendingEmailToken", pendingEmailToken, {
        httpOnly: true,
        secure: false,
        maxAge: 10 * 60 * 1000
      });

      return res.redirect("/profile/verify-email-otp");
    }

    // Email is the same, just update name, phone, and profileImage directly
    const updateData = {
      name,
      phone: phone || null
    };
    if (shouldRemovePhoto) {
      updateData.profileImage = null;
    } else if (req.file) {
      updateData.profileImage = req.file.path;
    }

    await User.findByIdAndUpdate(userId, updateData);

    return res.redirect("/profile");
  } catch (error) {
    logger.error("Profile update error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const loadVerifyEmailOtp = async (req, res) => {
  try {
    const token = req.cookies.pendingEmailToken;
    if (!token) {
      return res.redirect("/profile/edit");
    }

    // Verify token structure
    jwt.verify(token, process.env.JWT_SECRET);

    return res.render("user/verify-profile-email-otp");
  } catch (error) {
    logger.error("Load verify email OTP page error:", error);
    res.clearCookie("pendingEmailToken");
    return res.redirect("/profile/edit");
  }
};

const verifyEmailOtp = async (req, res) => {
  try {
    const otpValue = req.body.otp || "";
    const otp = otpValue.toString().trim();

    const token = req.cookies.pendingEmailToken;
    if (!token) {
      return res.status(400).render("user/verify-profile-email-otp", {
        error: "OTP session expired. Please update profile again."
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (String(otp) !== String(decoded.otp)) {
      return res.status(400).render("user/verify-profile-email-otp", {
        error: "Invalid OTP code"
      });
    }

    // Update details in the database
    await User.findByIdAndUpdate(decoded.userId, {
      email: decoded.newEmail,
      name: decoded.name,
      phone: decoded.phone || null,
      profileImage: decoded.profileImage || null
    });

    // Clear session cookies
    res.clearCookie("pendingEmailToken");

    return res.redirect("/profile");
  } catch (error) {
    logger.error("Verify email OTP error:", error);
    if (error.name === "TokenExpiredError") {
      return res.status(400).render("user/verify-profile-email-otp", {
        error: "OTP expired. Please try again."
      });
    }
    return res.status(500).render("user/verify-profile-email-otp", {
      error: "Internal Server Error"
    });
  }
};

const resendEmailOtp = async (req, res) => {
  try {
    const token = req.cookies.pendingEmailToken;
    if (!token) {
      return res.status(400).json({ error: "Session expired" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const otp = generateOtp();

    const emailSent = await sendVerificationEmail(decoded.newEmail, otp);
    if (!emailSent) {
      return res.status(500).json({ error: "Failed to send email" });
    }

    logger.info(`Resent email update OTP to ${decoded.newEmail}: ${otp}`);

    const newPendingToken = generateToken(
      {
        userId: decoded.userId,
        newEmail: decoded.newEmail,
        name: decoded.name,
        phone: decoded.phone,
        profileImage: decoded.profileImage || null,
        otp
      },
      "10m"
    );

    res.cookie("pendingEmailToken", newPendingToken, {
      httpOnly: true,
      secure: false,
      maxAge: 10 * 60 * 1000
    });

    return res.status(200).json({ message: "OTP resent successfully" });
  } catch (error) {
    logger.error("Resend email OTP error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const getAllAddresses = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    return res.render("user/all-address", {
      userData
    });
  } catch (error) {
    logger.error("Get all addresses error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const getAddAddress = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    return res.render("user/add-address", {
      userData
    });
  } catch (error) {
    logger.error("Get add address page error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const deleteAccount = async (req, res) => {
  try {
    let userId = req.user ? req.user._id : null;
    if (!userId) {
      const token = req.cookies.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
      }
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await User.findByIdAndDelete(userId);
    res.clearCookie("token");

    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    logger.error("Delete account error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export {
  getProfile,
  getEditProfile,
  updateProfile,
  loadVerifyEmailOtp,
  verifyEmailOtp,
  resendEmailOtp,
  getAllAddresses,
  getAddAddress,
  deleteAccount
};

export default {
  getProfile,
  getEditProfile,
  updateProfile,
  loadVerifyEmailOtp,
  verifyEmailOtp,
  resendEmailOtp,
  getAllAddresses,
  getAddAddress,
  deleteAccount
};