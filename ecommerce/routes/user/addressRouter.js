const express = require("express");
const router = express.Router();

const {
    isAuthenticated
} = require("../../middleware/authMidilware");

const addressController = require("../../controllers/user/addressController");

router.get("/", isAuthenticated, addressController.loadAddress);
router.get("/add", isAuthenticated, addressController.addAddress);
router.post("/add", isAuthenticated, addressController.addAddressPost);
router.post("/make-primary/:addressId", isAuthenticated, addressController.makePrimary);
router.post("/delete/:addressId", isAuthenticated, addressController.deleteAddress);
router.get("/edit/:addressId", isAuthenticated, addressController.editAddress);
router.post("/edit/:addressId", isAuthenticated, addressController.editAddressPost);

module.exports = router;
