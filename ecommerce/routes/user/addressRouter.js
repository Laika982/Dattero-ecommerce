import express from "express";
const router = express.Router();

import { isAuthenticated } from "../../middleware/authMidilware.js";

import addressController from "../../controllers/user/addressController.js";

router.get("/", isAuthenticated, addressController.loadAddress);
router.get("/add", isAuthenticated, addressController.addAddress);
router.post("/add", isAuthenticated, addressController.addAddressPost);
router.post("/make-primary/:addressId", isAuthenticated, addressController.makePrimary);
router.post("/delete/:addressId", isAuthenticated, addressController.deleteAddress);
router.get("/edit/:addressId", isAuthenticated, addressController.editAddress);
router.post("/edit/:addressId", isAuthenticated, addressController.editAddressPost);

export default router;
