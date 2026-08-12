const express = require("express");
const router = express.Router();

const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/coustomerController")
const categoryController = require("../controllers/admin/categoryController")

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

// //customers
router.get("/customers", customerController.customerInfo);
// router.get("/user", customerController.customerInfo);
router.get("/blockCustomer", customerController.customerBlocked);
router.get("/unblockCustomer", customerController.customerUnBlocked);



module.exports = router;
