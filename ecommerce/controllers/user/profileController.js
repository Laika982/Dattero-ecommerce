import User from "../../models/userSchema.js";
import logger from "../../utils/logger.js";
import jwt from "jsonwebtoken";
import { sendVerificationEmail } from "../../services/emailService.js";
import { generateOtp } from "../../utils/otp.js";
import { generateToken } from "../../utils/token.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";

const getProfile = async (req, res) => {
  try {
    const token = req.cookies.token;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    const defaultAddress =
      userData.addresses?.find((addr) => addr.isDefault) ||
      userData.addresses?.[0] ||
      null;

    return res.render("user/profile", {
      userData,
      defaultAddress,
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

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const userId = decoded.userId;

        // Get current user BEFORE validation
        const currentUser = await User.findById(userId).lean();

        if (!currentUser) {
            res.clearCookie("token");
            return res.redirect("/login");
        }

        let {
            name,
            email,
            phone,
            removeProfileImage
        } = req.body;

        name = name?.trim();
        email = email?.toLowerCase().trim();
        phone = phone?.trim();

        const shouldRemovePhoto =
            removeProfileImage === "true";


        // =========================
        // NAME + EMAIL REQUIRED
        // =========================

        if (!name || !email) {
            return res.status(400).render(
                "user/edit-profile",
                {
                    userData: currentUser,
                    error: "Name and Email are required"
                }
            );
        }


        // =========================
        // NAME VALIDATION
        // =========================

        const nameRegex = /^[A-Za-z\s]+$/;

        if (!nameRegex.test(name)) {
            return res.status(400).render(
                "user/edit-profile",
                {
                    userData: currentUser,
                    error: "Name must contain only letters and spaces."
                }
            );
        }


        // =========================
        // EMAIL VALIDATION
        // =========================

        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(400).render(
                "user/edit-profile",
                {
                    userData: currentUser,
                    error: "Please enter a valid email address."
                }
            );
        }


        // =========================
        // PHONE VALIDATION
        // =========================
        if(phone){
        const phoneRegex = /^[6-9]\d{9}$/;

        if (!phoneRegex.test(phone)) {
            return res.status(400).render(
                "user/edit-profile",
                {
                    userData: currentUser,
                    error: "Phone number must be a valid 10-digit number."
                }
            );
        }
      }


        // =========================
        // EMAIL CHANGED?
        // =========================

        if (email !== currentUser.email) {

            const existingUser =
                await User.findOne({ email }).lean();

            if (existingUser) {
                return res.status(400).render(
                    "user/edit-profile",
                    {
                        userData: currentUser,
                        error: "Email is already in use by another account"
                    }
                );
            }


            // =========================
            // GENERATE OTP
            // =========================

            const otp = generateOtp();

            const emailSent =
                await sendVerificationEmail(email, otp);

            if (!emailSent) {
                return res.status(500).render(
                    "user/edit-profile",
                    {
                        userData: currentUser,
                        error: "Failed to send verification email. Please try again."
                    }
                );
            }


            logger.info(
                `Email update OTP sent to ${email}: ${otp}`
            );


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
                    otpExpiresAt: Date.now() + 60 * 1000
                },
                "10m"
            );


            res.cookie("otpToken", otpToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 10 * 60 * 1000
            });

            return res.redirect("/verify-otp");
        }


        // =========================
        // SAME EMAIL
        // =========================

        const updateData = {
            name,
            phone: phone || null
        };

        if (shouldRemovePhoto) {
            updateData.profileImage = null;
        } else if (req.file) {
            updateData.profileImage = req.file.path;
        }

        await User.findByIdAndUpdate(
            userId,
            updateData
        );

        return res.redirect("/profile");

    } catch (error) {

        logger.error("Profile update error:", error);

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

const changePassword = async (req,res) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.redirect("/user/login");
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const user = await User.findById(userId);

    if (!user) {
      return res.redirect("/user/login");
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    const isPasswordCorrect = await verifyPassword(
      currentPassword,
      user.password,
    );

    if (!isPasswordCorrect) {
      return res
        .status(400)
        .render("user/profile", { error: "Incorrect current password" });
    }

      const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(newPassword)) {
      return res.status(400).render("user/profile", {
        error:
          "Password must be at least 8 characters and contain a letter, number, and special character.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .render("user/profile", { error: "both password should be same" });
    }

    const hashedPassword = await hashPassword(newPassword);

    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    return res.redirect("/profile");
  } catch (error) {
    logger.error("change password error:", error);

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
