import express from "express";
const router = express.Router();

import { isAdminAuthenticated,
  isAdminLoggedIn, } from "../../middleware/authMidilware.js";

import customerController from "../../controllers/admin/customerController.js";



// //customers
router.get("/customers", isAdminAuthenticated, customerController.customerInfo);
router.post("/blockCustomer", isAdminAuthenticated, customerController.customerBlocked);
router.post("/unblockCustomer", isAdminAuthenticated, customerController.customerUnBlocked);


export default router;