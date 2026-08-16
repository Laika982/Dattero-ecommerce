const express = require("express");
const path = require("path");
require("dotenv").config();

const connectDB = require("./config/db");
const passport = require("./config/passport");
const userRouter = require("./routes/userRouter");
const adminRouter = require("./routes/adminRouter");

const session = require("express-session");
const cookieParser = require("cookie-parser");
const hbs = require("hbs");

const app = express();
const PORT = process.env.PORT || 3000;

// Database
connectDB();

app.use(cookieParser());
// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// View engine
hbs.registerPartials(path.join(__dirname, "views", "partials"));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "hbs");

hbs.registerHelper("gt", function (a, b) {
    return a > b;
});

hbs.registerHelper("lt", function (a, b) {
    return a < b;
});

hbs.registerHelper("add", function (a, b) {
    return a + b;
});

hbs.registerHelper("subtract", function (a, b) {
    return a - b;
});
hbs.registerHelper("eq", function (a, b) {
    return String(a) === String(b);
});

hbs.registerHelper("multiply", function (a, b) {
    return Number(a) * Number(b);
});

hbs.registerHelper("range", function (start, end) {
    const result = [];

    for (let i = start; i <= end; i++) {
        result.push(i);
    }

    return result;
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/", userRouter);
app.use("/admin", adminRouter);

// Start server
app.listen(PORT, () => {
  console.log(
    `Server is running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
  );
});