const jwt = require("jsonwebtoken");

const isAuthenticated = (req, res, next) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return next();
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = decoded;

        return res.redirect("/");

    } catch (error) {

        // Token is invalid or expired
        res.clearCookie("token");

        return next();
    }
};

module.exports = isAuthenticated;