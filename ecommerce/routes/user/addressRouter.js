import express from "express";
const router = express.Router();

import { isAuthenticated } from "../../middleware/authMidilware.js";

import addressController from "../../controllers/user/addressController.js";

router.get("/", isAuthenticated, addressController.loadAddress);
router.get("/add", isAuthenticated, addressController.addAddress);
router.post("/add", isAuthenticated, addressController.addAddressPost);
router.patch("/make-primary/:addressId", isAuthenticated, addressController.makePrimary);
router.delete("/delete/:addressId", isAuthenticated, addressController.deleteAddress);
router.get("/edit/:addressId", isAuthenticated, addressController.editAddress);
router.put("/edit/:addressId", isAuthenticated, addressController.editAddressPost);

export default router;


