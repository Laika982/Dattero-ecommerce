import express from "express";
const router = express.Router()

import { isAuthenticated,
    isGuest } from "../../middleware/authMidilware.js";

import profileController from "../../controllers/user/profileController.js";
import upload from "../../middleware/upload.js";

router.get("/", isAuthenticated, profileController.getProfile);
router.get("/edit", isAuthenticated, profileController.getEditProfile);
router.post("/edit", isAuthenticated, upload.single("profileImage"), profileController.updateProfile);

router.get("/verify-email-otp", isAuthenticated, profileController.loadVerifyEmailOtp);
router.post("/verify-email-otp", isAuthenticated, profileController.verifyEmailOtp);
router.post("/resend-email-otp", isAuthenticated, profileController.resendEmailOtp);
router.get("/address", isAuthenticated, profileController.getAllAddresses);
router.get("/address/add", isAuthenticated, profileController.getAddAddress);
router.post("/delete-account", isAuthenticated, profileController.deleteAccount);

export default router;