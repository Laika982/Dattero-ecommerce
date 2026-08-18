const express = require("express");
const router = express.Router();

const {
  isAdminAuthenticated,
  isAdminLoggedIn,
} = require("../../middleware/authMidilware");

const customerController = require("../../controllers/admin/customerController");



// //customers
router.get("/customers", customerController.customerInfo);
router.post("/blockCustomer", customerController.customerBlocked);
router.post("/unblockCustomer", customerController.customerUnBlocked);


module.exports = router;