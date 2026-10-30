import User from "../../models/userSchema.js";
import Order from "../../models/orderSchema.js";
import Product from "../../models/productSchema.js";
import Category from "../../models/categorySchema.js";
import { verifyPassword } from "../../utils/password.js";
import { generateToken } from "../../utils/token.js";
import { getChartDataHelper } from "../../utils/chartHelper.js";
import { getCookieOptions, getClearCookieOptions } from "../../config/cookie.js";

const loadLogin = async (req, res) => {
  try {
    return res.render("admin/login");
  } catch (error) {
    console.error("Error loading admin login:", error);

    return res.status(500).send("Internal Server Error");
  }
};

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate fields
    if (!email || !password) {
      req.session.error = "Both fields are required"
      return res.status(400).render("admin/login");
    }

    // Find admin
    const admin = await User.findOne({ email, isAdmin: true });

    if (!admin) {
      req.session.error = "Invalid admin credentials";
      return res.status(401).render("admin/login");
    }

    // Check password
    const matchPassword = await verifyPassword(password, admin.password);

    if (!matchPassword) {
      req.session.error = "Invalid admin credentials";
      return res.status(401).render("admin/login");
    }

    // Create JWT
    const token = generateToken({
      adminId: admin._id,
      isAdmin: true,
    });

    // Store JWT in cookie
    res.cookie("adminToken", token, getCookieOptions({
      maxAge: 24 * 60 * 60 * 1000,
    }));

    // Redirect to dashboard
    req.session.success = "Login Successfull"
    return res.redirect("/admin");
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).render("admin/login", {
      error: "Something went wrong. Please try again.",
    });
  }
};

const getChartData = async (req, res) => {
  try {
    const filter = ["yearly", "monthly", "weekly"].includes(req.query.filter)
      ? req.query.filter
      : "monthly";
    const data = await getChartDataHelper(filter);
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("Get chart data error:", error);
    return res.status(500).json({ success: false, message: "Unable to load chart data" });
  }
};

const loadAdminDashboard = async (req, res) => {
  try {
    const validOrderMatch = {
      order_status: { $nin: ["cancelled"] },
    };

    const [
      revenueAgg,
      totalOrders,
      totalUsers,
      totalProducts,
      topProductsAgg,
      topCategoriesAgg,
      chartData,
      recentOrdersRaw,
    ] = await Promise.all([
      Order.aggregate([
        { $match: validOrderMatch },
        { $group: { _id: null, total: { $sum: "$final_amount" } } },
      ]),
      Order.countDocuments(validOrderMatch),
      User.countDocuments({ isAdmin: false }),
      Product.countDocuments({ is_listed: true }),
      Order.aggregate([
        { $match: validOrderMatch },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product_id",
            product_name: { $first: "$items.product_name" },
            product_image: { $first: "$items.product_image" },
            totalSold: { $sum: "$items.quantity" },
            totalRevenue: { $sum: "$items.item_total" },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "categories",
            localField: "productDoc.category_id",
            foreignField: "_id",
            as: "categoryDoc",
          },
        },
        { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            name: { $ifNull: ["$productDoc.productName", "$product_name"] },
            image: {
              $ifNull: [
                { $arrayElemAt: ["$productDoc.images.url", 0] },
                "$product_image",
              ],
            },
            category: { $ifNull: ["$categoryDoc.category_name", "General"] },
            totalSold: 1,
            totalRevenue: 1,
          },
        },
      ]),
      Order.aggregate([
        { $match: validOrderMatch },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "products",
            localField: "items.product_id",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "categories",
            localField: "productDoc.category_id",
            foreignField: "_id",
            as: "categoryDoc",
          },
        },
        { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$productDoc.category_id",
            category_name: { $first: "$categoryDoc.category_name" },
            totalSold: { $sum: "$items.quantity" },
            totalRevenue: { $sum: "$items.item_total" },
          },
        },
        {
          $project: {
            _id: 1,
            category_name: { $ifNull: ["$category_name", "General"] },
            totalSold: 1,
            totalRevenue: 1,
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: 10 },
      ]),
      getChartDataHelper("monthly"),
      Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("user_id", "name email")
        .lean(),
    ]);

    const totalRevenue = Math.round(revenueAgg[0]?.total || 0);

    const topProducts = topProductsAgg.map((p, idx) => ({
      ...p,
      rank: idx + 1,
      totalRevenueFormatted: `₹${Math.round(p.totalRevenue).toLocaleString("en-IN")}`,
    }));

    const categoryTotalSales = topCategoriesAgg.reduce((acc, c) => acc + c.totalSold, 0) || 1;
    const topCategories = topCategoriesAgg.map((c, idx) => ({
      ...c,
      rank: idx + 1,
      percentage: Math.min(100, Math.round((c.totalSold / categoryTotalSales) * 100)),
      totalRevenueFormatted: `₹${Math.round(c.totalRevenue).toLocaleString("en-IN")}`,
    }));

    const recentOrders = recentOrdersRaw.map((o) => ({
      ...o,
      customerName: o.user_id?.name || o.shipping_address?.full_name || "Customer",
      dateFormatted: new Date(o.createdAt).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      amountFormatted: `₹${Math.round(o.final_amount).toLocaleString("en-IN")}`,
      statusBadgeClass:
        o.order_status === "delivered"
          ? "bg-green-100 text-green-700"
          : o.order_status === "cancelled"
            ? "bg-red-100 text-red-700"
            : o.order_status === "shipped" || o.order_status === "out_for_delivery"
              ? "bg-blue-100 text-blue-700"
              : "bg-yellow-100 text-yellow-800",
    }));

    return res.render("admin/dashboard", {
      kpis: {
        totalRevenue: `₹${totalRevenue.toLocaleString("en-IN")}`,
        totalOrders: totalOrders.toLocaleString("en-IN"),
        totalUsers: totalUsers.toLocaleString("en-IN"),
        totalProducts: totalProducts.toLocaleString("en-IN"),
      },
      chartData,
      chartDataJson: JSON.stringify(chartData),
      topProducts,
      topCategories,
      recentOrders,
    });
  } catch (error) {
    console.error("Error loading admin dashboard:", error);
    return res.status(500).send("Internal Server Error");
  }
};

const logout = async (req, res) => {
  try {
    res.clearCookie("adminToken", getClearCookieOptions());

    req.session.success = "Logout success";

    return res.redirect("/admin/login");
  } catch (error) {
    console.error("Admin logout error:", error);

    return res.status(500).send("Internal Server Error");
  }
};

export default {
  loadLogin,
  adminLogin,
  loadAdminDashboard,
  getChartData,
  logout,
};
