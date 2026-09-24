import express from "express";
const router = express.Router();

import adminController from "../../controllers/admin/adminController.js";


import { isAdminAuthenticated,
  isAdminLoggedIn,noCache } from "../../middleware/authMidilware.js";

//adminLogin
router.get("/login", noCache,isAdminLoggedIn, adminController.loadLogin);
//loadAdminDashboard
router.get("/", isAdminAuthenticated, adminController.loadAdminDashboard);
router.post("/login", adminController.adminLogin);


//logout
router.post("/logout", adminController.logout);
router.get("/logout", (req, res) => res.redirect("/admin/login"));



export default router;
