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
router.get("/logout", adminController.logout);



export default router;
