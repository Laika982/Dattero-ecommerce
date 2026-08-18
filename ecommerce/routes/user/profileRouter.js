const express = require("express");
const router = express.Router()

const {
    isAuthenticated,
    isGuest
} = require("../../middleware/authMidilware");

const profileController = require("../../controllers/user/profileController");

router.get("/", isAuthenticated, profileController.getProfile);
router.get("/edit", isAuthenticated, profileController.getEditProfile);
router.post("/edit", isAuthenticated, profileController.updateProfile);

router.get("/verify-email-otp", isAuthenticated, profileController.loadVerifyEmailOtp);
router.post("/verify-email-otp", isAuthenticated, profileController.verifyEmailOtp);
router.post("/resend-email-otp", isAuthenticated, profileController.resendEmailOtp);
router.get("/address", isAuthenticated, profileController.getAllAddresses);
router.get("/address/add", isAuthenticated, profileController.getAddAddress);

module.exports = router;