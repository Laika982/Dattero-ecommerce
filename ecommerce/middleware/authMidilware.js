const jwt = require("jsonwebtoken");

const isAuthenticated = (req, res, next) => {
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

         // Check blocked status
        if (user.isBlocked) {
            res.clearCookie("token");

            return res.redirect("/login?blocked=true");
        }

        req.user = decoded;

        next();

    } catch (error) {
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
        return res.redirect("/home");

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




module.exports = {
isAuthenticated,
isGuest,
isAdminAuthenticated,
isAdminLoggedIn
}