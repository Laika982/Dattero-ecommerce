import User from "../../models/userSchema.js";
import Address from "../../models/addressSchema.js";
import logger from "../../utils/logger.js";
import jwt from "jsonwebtoken";
import { sendVerificationEmail } from "../../services/emailService.js";
import { generateOtp } from "../../utils/otp.js";
import { generateToken } from "../../utils/token.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import ReferralReward from "../../models/referralRewardSchema.js";
import {
  ensureUserReferralFields,
  buildReferralShareUrl,
} from "../../services/referralService.js";
import { isAjaxRequest } from "../../utils/isAjax.js";

const getProfile = async (req, res) => {
  try {
    const token = req.cookies.token;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      req.session.error = "User Not Found Please Login";
      return res.redirect("/login");
    }

    let isGoogleUser = false;

    if (userData.googleId) {
      isGoogleUser = true;
    }

    await ensureUserReferralFields(userData);

    const defaultAddress = await Address.findOne({
      user_id: userData._id,
      isDefault: true,
    });

    const referralShareUrl = buildReferralShareUrl(
      req,
      userData.referralToken || userData.referalCode
    );

    const rewards = await ReferralReward.find({ referrer_id: userData._id })
      .populate("referred_user_id", "name email createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const totalEarnings = rewards.reduce((sum, r) => sum + (r.reward_amount || 0), 0);
    const successfulReferrals = rewards.length;
    const totalInvited = await User.countDocuments({ referredBy: userData._id });

    const formatMaskedName = (referredUser) => {
      if (!referredUser) return "Referred Friend";
      if (referredUser.name) {
        const parts = referredUser.name.trim().split(" ");
        if (parts.length > 1) {
          return `${parts[0]} ${parts[1][0]}.`;
        }
        return `${parts[0].slice(0, 3)}***`;
      }
      if (referredUser.email) {
        const [local, domain] = referredUser.email.split("@");
        return `${local.slice(0, 2)}***@${domain}`;
      }
      return "Referred Friend";
    };

    const referralHistory = rewards.map((r) => ({
      _id: r._id,
      maskedName: formatMaskedName(r.referred_user_id),
      amount: Number(r.reward_amount).toFixed(2),
      date: new Date(r.createdAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      status: r.status === "CREDITED" ? "Credited to Wallet" : r.status,
    }));

    return res.render("user/profile", {
      userData,
      defaultAddress,
      isGoogleUser,
      referralStats: {
        totalEarnings: totalEarnings.toFixed(2),
        successfulReferrals,
        totalInvited,
      },
      referralShareUrl,
      referralHistory,
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
      req.session.error = "User Not Found Please Login";
      return res.redirect("/login");
    }

    return res.render("user/edit-profile", {
      userData,
      error: req.query.error,
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

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.userId;

    // Get current user BEFORE validation
    const currentUser = await User.findById(userId).lean();

    if (!currentUser) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    let { name, email, phone, removeProfileImage } = req.body;

    name = name?.trim();
    email = email?.toLowerCase().trim();
    phone = phone?.trim();

    const shouldRemovePhoto = removeProfileImage === "true";

    // =========================
    // NAME + EMAIL REQUIRED
    // =========================

    if (!name || !email) {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Name and Email are required" });
      }
      return res.status(400).render("user/edit-profile", {
        userData: currentUser,
        error: "Name and Email are required",
      });
    }

    // =========================
    // NAME VALIDATION
    // =========================

    const nameRegex = /^[A-Za-z\s]+$/;

    if (!nameRegex.test(name)) {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Name must contain only letters and spaces." });
      }
      return res.status(400).render("user/edit-profile", {
        userData: currentUser,
        error: "Name must contain only letters and spaces.",
      });
    }

    // =========================
    // EMAIL VALIDATION
    // =========================

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Please enter a valid email address." });
      }
      return res.status(400).render("user/edit-profile", {
        userData: currentUser,
        error: "Please enter a valid email address.",
      });
    }

    // =========================
    // PHONE VALIDATION
    // =========================
    if (phone) {
      const phoneRegex = /^[6-9]\d{9}$/;

      if (!phoneRegex.test(phone)) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: "Phone number must be a valid 10-digit number." });
        }
        return res.status(400).render("user/edit-profile", {
          userData: currentUser,
          error: "Phone number must be a valid 10-digit number.",
        });
      }
    }

    // =========================
    // EMAIL CHANGED?
    // =========================

    if (email !== currentUser.email) {
      const existingUser = await User.findOne({ email }).lean();

      if (existingUser) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: "Email is already in use by another account" });
        }
        return res.status(400).render("user/edit-profile", {
          userData: currentUser,
          error: "Email is already in use by another account",
        });
      }

      // =========================
      // GENERATE OTP
      // =========================

      const otp = generateOtp();

      const emailSent = await sendVerificationEmail(email, otp);

      if (!emailSent) {
        if (isAjaxRequest(req)) {
          return res.status(500).json({ success: false, message: "Failed to send verification email. Please try again." });
        }
        return res.status(500).render("user/edit-profile", {
          userData: currentUser,
          error: "Failed to send verification email. Please try again.",
        });
      }

      logger.info(`Email update OTP sent to ${email}: ${otp}`);

      // =========================
      // OTP TOKEN
      // =========================

      const otpToken = generateToken(
        {
          purpose: "change-email",
          userId,
          newEmail: email,
          name,
          phone,

          profileImage: shouldRemovePhoto
            ? null
            : req.file
              ? req.file.path
              : currentUser.profileImage,

          otp,
          otpExpiresAt: Date.now() + 60 * 1000,
        },
        "10m"
      );

      res.cookie("otpToken", otpToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
      });

      req.session.success = `Verification code sent to ${email}`;
      if (isAjaxRequest(req)) {
        return res.status(200).json({
          success: true,
          message: `Verification code sent to ${email}`,
          redirectTo: "/verify-otp",
        });
      }

      return res.redirect("/verify-otp");
    }

    // =========================
    // SAME EMAIL
    // =========================

    const updateData = {
      name,
      phone: phone || null,
    };

    if (shouldRemovePhoto) {
      updateData.profileImage = null;
    } else if (req.file) {
      updateData.profileImage = req.file.path;
    }

    await User.findByIdAndUpdate(userId, updateData);

    req.session.success = "Profile edited successfully";

    if (isAjaxRequest(req)) {
      return res.status(200).json({
        success: true,
        message: "Profile edited successfully",
        redirectTo: "/profile",
      });
    }

    return res.redirect("/profile");
  } catch (error) {
    logger.error("Profile update error:", error);

    if (isAjaxRequest(req)) {
      return res.status(500).json({
        success: false,
        message: "Failed to update profile. Please try again.",
      });
    }

    res.clearCookie("token");

    return res.redirect("/login");
  }
};

const deleteAccount = async (req, res) => {
  try {
    const token = req.cookies.token;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.userId;

    await User.findByIdAndDelete(userId);

    res.clearCookie("token");

    req.session.success = "Account Deleted Successfull";

    return res.status(200).json({
      message: "Account deleted successfully",
    });
  } catch (error) {
    logger.error("Delete account error:", error);

    return res.status(500).json({
      error: "Internal Server Error",
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      if (isAjaxRequest(req)) {
        return res.status(401).json({ success: false, message: "Unauthorized", redirectTo: "/login" });
      }
      return res.redirect("/user/login");
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const user = await User.findById(userId);

    if (!user) {
      if (isAjaxRequest(req)) {
        return res.status(401).json({ success: false, message: "User not found", redirectTo: "/login" });
      }
      return res.redirect("/user/login");
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    const isPasswordCorrect = await verifyPassword(currentPassword, user.password);

    if (!isPasswordCorrect) {
      req.session.error = "Incorrect current password";
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Incorrect current password" });
      }
      return res.status(400).render("user/profile");
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(newPassword)) {
      req.session.error =
        "Password must be at least 8 characters and contain a letter, number, and special character.";
      if (isAjaxRequest(req)) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters and contain a letter, number, and special character.",
        });
      }
      return res.status(400).render("user/profile");
    }

    if (newPassword !== confirmPassword) {
      req.session.error = "both password should be same";
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Passwords do not match" });
      }
      return res.status(400).render("user/profile");
    }

    const hashedPassword = await hashPassword(newPassword);

    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    req.session.success = "Password changed successfully";

    if (isAjaxRequest(req)) {
      return res.status(200).json({
        success: true,
        message: "Password changed successfully",
        redirectTo: "/profile",
      });
    }

    return res.redirect("/profile");
  } catch (error) {
    logger.error("change password error:", error);

    if (isAjaxRequest(req)) {
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }

    return res.status(500).json({
      error: "Internal Server Error",
    });
  }
};

export default {
  getProfile,
  getEditProfile,
  updateProfile,
  deleteAccount,
  changePassword,
};
