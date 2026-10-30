import jwt from "jsonwebtoken";
import User from "../models/userSchema.js";
import { getClearCookieOptions } from "../config/cookie.js";

const isAjaxOrJson = (req) =>
    Boolean(
        req.xhr ||
        req.headers["x-requested-with"] === "XMLHttpRequest" ||
        req.headers["accept"]?.includes("application/json") ||
        req.headers["content-type"]?.includes("application/json") ||
        req.headers["sec-fetch-dest"] === "empty"
    );

const isAuthenticated = async (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store");

        const token = req.cookies.token;
        if (!token) {
            if (isAjaxOrJson(req)) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required. Please log in.",
                    redirectTo: "/login",
                });
            }
            return res.redirect("/login");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId);

        if (!user) {
            res.clearCookie("token", getClearCookieOptions());
            delete req.cookies.token;

            if (isAjaxOrJson(req)) {
                return res.status(401).json({
                    success: false,
                    message: "User not found. Please log in again.",
                    redirectTo: "/login",
                });
            }
            return res.redirect("/login");
        }

        if (user.isBlocked === true) {
            res.clearCookie("token", getClearCookieOptions());
            delete req.cookies.token;
            req.session.error = "Your account has been blocked.";

            if (isAjaxOrJson(req)) {
                return res.status(403).json({
                    success: false,
                    message: "Your account has been blocked.",
                    isBlocked: true,
                    redirectTo: "/login?blocked=true",
                });
            }

            return res.redirect("/login?blocked=true");
        }

        req.user = user;

        next();
    } catch (error) {
        console.error("Authentication error:", error);

        res.clearCookie("token", getClearCookieOptions());
        delete req.cookies.token;

        if (isAjaxOrJson(req)) {
            return res.status(401).json({
                success: false,
                message: "Session expired or invalid. Please log in again.",
                redirectTo: "/login",
            });
        }

        return res.redirect("/login");
    }
};

const isGuest = async (req, res, next) => {
    try {
        const token = req.cookies.token;

        // User is not logged in
        if (!token) {
            return next();
        }

        // Check whether token is valid
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId);

        if (!user || user.isBlocked) {
            res.clearCookie("token", getClearCookieOptions());
            delete req.cookies.token;
            return next();
        }

        // User is already logged in
        return res.redirect("/");
    } catch (error) {
        // Token is invalid or expired
        res.clearCookie("token", getClearCookieOptions());
        delete req.cookies.token;

        return next();
    }
};

// Protect admin pages
const isAdminAuthenticated = (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store");

        const token = req.cookies.adminToken;

        if (!token) {
            if (isAjaxOrJson(req)) {
                return res.status(401).json({
                    success: false,
                    message: "Admin authentication required. Please log in.",
                    redirectTo: "/admin/login",
                });
            }
            return res.redirect("/admin/login");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded || !decoded.isAdmin) {
            res.clearCookie("adminToken", getClearCookieOptions());
            if (isAjaxOrJson(req)) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Admin privileges required.",
                    redirectTo: "/admin/login",
                });
            }
            return res.redirect("/admin/login");
        }

        req.admin = decoded;

        return next();
    } catch (error) {
        res.clearCookie("adminToken", getClearCookieOptions());

        if (isAjaxOrJson(req)) {
            return res.status(401).json({
                success: false,
                message: "Session expired or invalid. Please log in again.",
                redirectTo: "/admin/login",
            });
        }

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

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded.isAdmin) {
            res.clearCookie("adminToken", getClearCookieOptions());
            return next();
        }

        return res.redirect("/admin");
    } catch (error) {
        res.clearCookie("adminToken", getClearCookieOptions());
        return next();
    }
};

export const isOtpSession = (req, res, next) => {
    try {
        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        );

        res.set("Pragma", "no-cache");
        res.set("Expires", "0");

        const otpToken = req.cookies.otpToken;

        if (!otpToken) {
            return res.redirect("/login");
        }

        const decoded = jwt.verify(otpToken, process.env.JWT_SECRET);

        const validPurposes = ["signup", "forgot-password", "change-email"];

        if (!validPurposes.includes(decoded.purpose)) {
            res.clearCookie("otpToken", getClearCookieOptions());

            return res.redirect("/login");
        }

        req.otpSession = decoded;

        next();
    } catch (error) {
        console.error("OTP session error:", error);

        res.clearCookie("otpToken", getClearCookieOptions());

        return res.redirect("/login");
    }
};

export const noCache = (req, res, next) => {
    res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
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

        const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);

        if (decoded.purpose !== "reset-password") {
            res.clearCookie("resetEmail", getClearCookieOptions());

            return res.redirect("/forgotPassword");
        }

        req.resetSession = decoded;

        next();
    } catch (error) {
        res.clearCookie("resetEmail", getClearCookieOptions());

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

export { isAuthenticated, isGuest, isAdminAuthenticated, isAdminLoggedIn };

export default {
    isAuthenticated,
    isGuest,
    isAdminAuthenticated,
    isAdminLoggedIn,
    isOtpSession,
};
