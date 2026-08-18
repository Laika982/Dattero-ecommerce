const User = require("../../models/userSchema");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

function generateOtp() {
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
      subject: "Verify your email update",
      text: `Your OTP to update your email is: ${otp}`,
      html: `<b>Your OTP to update your email is: ${otp}</b>`,
    });

    return info.accepted.length > 0;
  } catch (error) {
    console.error("Error sending profile email update OTP:", error);
    return false;
  }
}

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
    console.error("Profile error:", error);

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
    console.error("Get edit profile page error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const updateProfile = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    let { name, email, phone } = req.body;
    name = name?.trim();
    email = email?.toLowerCase().trim();
    phone = phone?.trim();

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

      console.log(`Email update OTP sent to ${email}: ${otp}`);

      // Create a pending token cookie
      const pendingEmailToken = jwt.sign(
        {
          userId,
          newEmail: email,
          name,
          phone,
          otp
        },
        process.env.JWT_SECRET,
        { expiresIn: "10m" }
      );

      res.cookie("pendingEmailToken", pendingEmailToken, {
        httpOnly: true,
        secure: false,
        maxAge: 10 * 60 * 1000
      });

      return res.redirect("/profile/verify-email-otp");
    }

    // Email is the same, just update name and phone directly
    await User.findByIdAndUpdate(userId, {
      name,
      phone: phone || null
    });

    return res.redirect("/profile");
  } catch (error) {
    console.error("Profile update error:", error);
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
    console.error("Load verify email OTP page error:", error);
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
      phone: decoded.phone || null
    });

    // Clear session cookies
    res.clearCookie("pendingEmailToken");

    return res.redirect("/profile");
  } catch (error) {
    console.error("Verify email OTP error:", error);
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

    console.log(`Resent email update OTP to ${decoded.newEmail}: ${otp}`);

    const newPendingToken = jwt.sign(
      {
        userId: decoded.userId,
        newEmail: decoded.newEmail,
        name: decoded.name,
        phone: decoded.phone,
        otp
      },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    res.cookie("pendingEmailToken", newPendingToken, {
      httpOnly: true,
      secure: false,
      maxAge: 10 * 60 * 1000
    });

    return res.status(200).json({ message: "OTP resent successfully" });
  } catch (error) {
    console.error("Resend email OTP error:", error);
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
    console.error("Get all addresses error:", error);
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
    console.error("Get add address page error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

module.exports = {
  getProfile,
  getEditProfile,
  updateProfile,
  loadVerifyEmailOtp,
  verifyEmailOtp,
  resendEmailOtp,
  getAllAddresses,
  getAddAddress
};