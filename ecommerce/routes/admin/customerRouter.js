import express from "express";
const router = express.Router();

import { isAdminAuthenticated,
  isAdminLoggedIn, } from "../../middleware/authMidilware.js";

import customerController from "../../controllers/admin/customerController.js";



// //customers
router.get("/customers", customerController.customerInfo);
router.post("/blockCustomer", customerController.customerBlocked);
router.post("/unblockCustomer", customerController.customerUnBlocked);


export default router;