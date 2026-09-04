import express from "express";
const router = express.Router();

import { isAdminAuthenticated,
  isAdminLoggedIn, } from "../../middleware/authMidilware.js";

  import upload from "../../middleware/upload.js"

import customerController from "../../controllers/admin/customerController.js";



// //customers
router.get("/customers", isAdminAuthenticated, customerController.customerInfo);
router.post("/blockCustomer", isAdminAuthenticated, customerController.customerBlocked);
router.post("/unblockCustomer", isAdminAuthenticated, customerController.customerUnBlocked);
router.get("/editCustomer/:id",isAdminAuthenticated,customerController.loadEditCustomer)
router.post(
  "/editCustomer/:id",
  upload.single("profileImage"),
  customerController.editCustomer
);


export default router;