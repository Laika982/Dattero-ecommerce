import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";
import morgan from "morgan";
import logger from "./utils/logger.js";
// Reload templates for user orderList footer full-width update
import connectDB from "./config/db.js";
import passport from "./config/passport.js";
import userRouter from "./routes/user/authRouter.js";
import userProductRouter from "./routes/user/productRouter.js"
import userProfileRouter from "./routes/user/profileRouter.js";
import addressRouter from "./routes/user/addressRouter.js";
import cartRouter from "./routes/user/cartRouter.js"
import checkoutRouter from "./routes/user/checkoutRouter.js"
import orderRouter from "./routes/user/orderRouter.js"
import paymentRoutes from "./routes/user/paymentRoutes.js"
import couponRouter from "./routes/user/couponRouter.js"
import walletRoutes from "./routes/user/walletRoutes.js"
import wishlistRoutes from "./routes/user/wishlistRoutes.js"
import adminRouter from "./routes/admin/authRouter.js";
import categoryRouter from "./routes/admin/categoryRouter.js";
import productRouter from "./routes/admin/productRouter.js";
import customerRouter from "./routes/admin/customerRouter.js";
import adminOrderRouter from "./routes/admin/orderRouter.js";
import couponRoutes from "./routes/admin/couponRoutes.js";
import offerRoutes from "./routes/admin/offerRouter.js";
import salesReportRouter from "./routes/admin/salesReportRouter.js";


import session from "express-session";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import hbs from "hbs";
import User from "./models/userSchema.js";
import Cart from "./models/cartSchema.js";
import methodOverride from "method-override";

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

app.use(async (req, res, next) => {
  res.locals.cartCount = 0;
  try {
    const token = req.cookies.token;

    if (token) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );

      const user = await User.findById(decoded.userId);

      if (!user) {
        res.clearCookie("token");
        delete req.cookies.token;
        req.user = null;
        res.locals.user = null;
        res.locals.cartCount = 0;
      } else if (user.isBlocked) {
        res.clearCookie("token");
        delete req.cookies.token;
        req.user = null;
        res.locals.user = null;
        res.locals.cartCount = 0;

        const reqPath = (req.path || "").toLowerCase();
        const isAuthRoute =
          reqPath === "/login" ||
          reqPath === "/signup" ||
          reqPath === "/verify-otp" ||
          reqPath === "/logout" ||
          reqPath.startsWith("/auth/google");
        const isAdminRoute = reqPath.startsWith("/admin");
        const isStaticAsset =
          reqPath.startsWith("/uploads") ||
          /\.(css|js|jpg|jpeg|png|gif|svg|ico|webp|woff|woff2|ttf|map)$/i.test(reqPath);

        if (!isAuthRoute && !isAdminRoute && !isStaticAsset) {
          const isAjax = Boolean(
            req.xhr ||
            req.headers["x-requested-with"] === "XMLHttpRequest" ||
            req.headers["accept"]?.includes("application/json") ||
            req.headers["content-type"]?.includes("application/json") ||
            req.headers["sec-fetch-dest"] === "empty"
          );

          if (isAjax) {
            return res.status(403).json({
              success: false,
              message: "Your account has been blocked.",
              isBlocked: true,
              redirectTo: "/login?blocked=true",
            });
          }

          req.session.error = "Your account has been blocked.";
          return res.redirect("/login?blocked=true");
        }
      } else {
        req.user = user;
        res.locals.user = user;
        try {
          const userCart = await Cart.findOne({ user_id: user._id }).lean();
          res.locals.cartCount = (userCart?.items || []).reduce(
            (sum, item) => sum + (Number(item.quantity) || 0),
            0
          );
        } catch (cartErr) {
          res.locals.cartCount = 0;
        }
      }
    }

  } catch (error) {
    res.clearCookie("token");
    delete req.cookies.token;
    req.user = null;
    res.locals.user = null;
    res.locals.cartCount = 0;
  }

  next();
});

// View engine
hbs.registerPartials(path.join(__dirname, "views", "partials"));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "hbs");


// hbsHelper
import registerHbsHelpers from "./utils/hbsHelper.js";
registerHbsHelpers();


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  methodOverride(function (req, res) {
    if (req.body && typeof req.body === "object" && "_method" in req.body) {
      const method = req.body._method;
      delete req.body._method;
      return method;
    }
    if (req.query && "_method" in req.query) {
      const method = req.query._method;
      delete req.query._method;
      return method;
    }
    return req.headers["x-http-method-override"];
  })
);
app.use(express.static(path.join(__dirname, "public")));

// Success / Error message & navigation middleware
app.use((req, res, next) => {

  res.locals.success = req.session.success;
  res.locals.error = req.session.error;

  delete req.session.success;
  delete req.session.error;

  const urlPath = (req.originalUrl || req.url || req.path || "").split("?")[0].toLowerCase();
  let currentNav = "";
  if (urlPath === "/" || urlPath === "") {
    currentNav = "home";
  } else if (urlPath.includes("/product")) {
    currentNav = "products";
  } else if (urlPath.includes("/about")) {
    currentNav = "about";
  } else if (urlPath.includes("/contact")) {
    currentNav = "contact";
  }
  res.locals.currentNav = currentNav;
  res.locals.currentPath = urlPath;

  next();
});

// Uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));


// Routes
app.use("/", userRouter);
app.use("/products", userProductRouter);
app.use("/profile", userProfileRouter);
app.use("/profile/address", addressRouter);
app.use("/cart", cartRouter)
app.use("/checkout", checkoutRouter)
app.use("/order", orderRouter)
app.use("/payment", paymentRoutes)
app.use("/coupon", couponRouter)
app.use("/wallet", walletRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/admin", adminRouter);
app.use("/admin/category", categoryRouter);
app.use("/admin/customer", customerRouter);
app.use("/admin/product", productRouter);
app.use("/admin/order", adminOrderRouter);
app.use("/admin/coupons", couponRoutes);
app.use("/admin/offers", offerRoutes);
app.use("/admin/sales-report", salesReportRouter);

// Start server
app.listen(PORT, () => {
  logger.info(
    `Server is running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
  );
});
