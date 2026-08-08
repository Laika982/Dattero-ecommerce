const jwt = require("jsonwebtoken");

const requireAuth = (req, res, next) => {
    try {
        const token = req.cookies.token;

        // No token → user is not logged in
        if (!token) {
            return res.redirect("/login");
        }

        // Verify token
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // Store decoded user information
        req.user = decoded;

        return next();

    } catch (error) {
        console.error(error);

        // Token expired or invalid
        res.clearCookie("token");

        return res.redirect("/login");
    }
};

module.exports = requireAuth;