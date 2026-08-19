import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";
import morgan from "morgan";
import logger from "./utils/logger.js";

import connectDB from "./config/db.js";
import passport from "./config/passport.js";
import userRouter from "./routes/user/authRouter.js";
import userProfileRouter from "./routes/user/profileRouter.js";
import addressRouter from "./routes/user/addressRouter.js";
import adminRouter from "./routes/admin/authRouter.js";
import categoryRouter from "./routes/admin/categoryRouter.js";
import productRouter from "./routes/admin/productRouter.js";
import customerRouter from "./routes/admin/customerRouter.js";

import session from "express-session";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import hbs from "hbs";
import User from "./models/userSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database
connectDB();

app.use(cookieParser());
app.use(
  morgan(":method :url :status :res[content-length] - :response-time ms", {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);
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

// Global User Locals Middleware
app.use(async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      if (user && !user.isBlocked) {
        res.locals.user = user;
      } else {
        res.clearCookie("token");
      }
    }
  } catch (error) {
    res.clearCookie("token");
  }
  next();
});

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
app.use("/profile",userProfileRouter);
app.use("/profile/address", addressRouter);
app.use("/admin", adminRouter);
app.use("/admin/category", categoryRouter);
app.use("/admin/customer", customerRouter);
app.use("/admin/product", productRouter);

// Start server
app.listen(PORT, () => {
  logger.info(
    `Server is running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
  );
});