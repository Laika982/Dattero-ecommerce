import express from "express";
const router = express.Router();

import { isAdminAuthenticated,
  isAdminLoggedIn, } from "../../middleware/authMidilware.js";

  import upload from "../../middleware/upload.js"

import customerController from "../../controllers/admin/customerController.js";



// //customers
router.get("/customers", isAdminAuthenticated, customerController.customerInfo);
router.patch("/blockCustomer", isAdminAuthenticated, customerController.customerBlocked);
router.patch("/unblockCustomer", isAdminAuthenticated, customerController.customerUnBlocked);
router.get("/editCustomer/:id",isAdminAuthenticated,customerController.loadEditCustomer);
router.put(
  "/editCustomer/:id",
  isAdminAuthenticated,
  upload.single("profileImage"),
  customerController.editCustomer
);


export default router;