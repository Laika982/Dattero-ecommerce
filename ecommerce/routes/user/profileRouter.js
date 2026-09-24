import express from "express";
const router = express.Router();

import { isAuthenticated, isGuest } from "../../middleware/authMidilware.js";

import profileController from "../../controllers/user/profileController.js";
import upload from "../../middleware/upload.js";

router.get("/", isAuthenticated, profileController.getProfile);
router.get("/edit", isAuthenticated, profileController.getEditProfile);
router.put(
  "/edit",
  isAuthenticated,
  upload.single("profileImage"),
  profileController.updateProfile,
);

router.patch(
  "/change-password",
  isAuthenticated,
  profileController.changePassword,
);

// DELETE ACCOUNT
router.delete(
  "/delete-account",
  isAuthenticated,
  profileController.deleteAccount,
);

export default router;
