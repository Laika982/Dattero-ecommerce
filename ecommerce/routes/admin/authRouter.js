import express from "express";
const router = express.Router();

import adminController from "../../controllers/admin/adminController.js";

import {
  isAdminAuthenticated,
  isAdminLoggedIn,
  noCache,
} from "../../middleware/authMidilware.js";

//adminLogin
router.get("/login", noCache, isAdminLoggedIn, adminController.loadLogin);
//loadAdminDashboard
router.get("/", isAdminAuthenticated, adminController.loadAdminDashboard);
router.get("/dashboard/chart-data", isAdminAuthenticated, adminController.getChartData);
router.post("/login", adminController.adminLogin);

//logout
router.post("/logout", adminController.logout);

router.get("/logout", (req, res) => res.redirect("/admin/login"));

// Orders alias redirect
router.get("/orders", (req, res) => {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(`/admin/order/orders${query}`);
});

export default router;

