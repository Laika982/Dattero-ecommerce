const express = require("express");
const router = express.Router();

const adminController = require("../controllers/admin/adminController");
const {
isAdminAuthenticated,
isAdminLoggedIn
} = require("../middleware/authMidilware")


//adminLogin
router.get("/login",isAdminLoggedIn,adminController.loadLogin);
//loadAdminDashboard
router.post("/login",adminController.adminLogin);
router.get("/", isAdminAuthenticated, adminController.loadAdminDashboard);

//logout
router.get("/logout", adminController.logout);


module.exports = router;
