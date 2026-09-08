import jwt from "jsonwebtoken";
import User from "../models/userSchema.js";

const isAuthenticated = async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");

    const token = req.cookies.token;
    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.userId);

    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    if (user.isBlocked === true) {

      res.clearCookie("token");

      return res.redirect("/login?blocked=true");
    }

    req.user = user;

    next();

  } catch (error) {
    console.error("Authentication error:", error);

    res.clearCookie("token");

    return res.redirect("/login");
  }
};

const isGuest = (req, res, next) => {
    try {
        const token = req.cookies.token;

        // User is not logged in
        if (!token) {
            return next();
        }

        // Check whether token is valid
        jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // User is already logged in
        return res.redirect("/");

    } catch (error) {
        // Token is invalid or expired
        res.clearCookie("token");

        return next();
    }
};

// Protect admin pages
const isAdminAuthenticated = (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store");

        const token = req.cookies.adminToken;

        if (!token) {
            return res.redirect("/admin/login");
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.admin = decoded;

        return next();

    } catch (error) {
        res.clearCookie("adminToken");

        return res.redirect("/admin/login");
    }
};

// Prevent logged-in admin from accessing login page
const isAdminLoggedIn = (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store");

        const token = req.cookies.adminToken;

        if (!token) {
            return next();
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        if (!decoded.isAdmin) {
            res.clearCookie("adminToken");
            return next();
        }

        return res.redirect("/admin");

    } catch (error) {
        res.clearCookie("adminToken");
        return next();
    }
};


export const isOtpSession = (req, res, next) => {
    try {

        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate"
        );

        res.set("Pragma", "no-cache");
        res.set("Expires", "0");


        const otpToken = req.cookies.otpToken;

        if (!otpToken) {
            return res.redirect("/login");
        }


        const decoded = jwt.verify(
            otpToken,
            process.env.JWT_SECRET
        );


        const validPurposes = [
            "signup",
            "forgot-password",
            "change-email"
        ];


        if (!validPurposes.includes(decoded.purpose)) {

            res.clearCookie("otpToken");

            return res.redirect("/login");
        }


        req.otpSession = decoded;

        next();

    } catch (error) {

        console.error("OTP session error:", error);

        res.clearCookie("otpToken");

        return res.redirect("/login");
    }
};


export const noCache = (req, res, next) => {
    res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
    );

    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    next();
};


export const isResetSession = (req, res, next) => {
    try {

        const resetToken = req.cookies.resetEmail;

        if (!resetToken) {
            return res.redirect("/forgotPassword");
        }

        const decoded = jwt.verify(
            resetToken,
            process.env.JWT_SECRET
        );

        if (decoded.purpose !== "reset-password") {
            res.clearCookie("resetEmail");

            return res.redirect("/forgotPassword");
        }

        req.resetSession = decoded;

        next();

    } catch (error) {

        res.clearCookie("resetEmail");

        return res.redirect("/forgotPassword");
    }
};


export const preventForgotPasswordBack = (req, res, next) => {
    try {

        const resetToken = req.cookies.resetEmail;

        if (resetToken) {
            return res.redirect("/resetPassword");
        }

        next();

    } catch (error) {
        next();
    }
};

export {
isAuthenticated,
isGuest,
isAdminAuthenticated,
isAdminLoggedIn,
};

export default {
isAuthenticated,
isGuest,
isAdminAuthenticated,
isAdminLoggedIn,
isOtpSession
};