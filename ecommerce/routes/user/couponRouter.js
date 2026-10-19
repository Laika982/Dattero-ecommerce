import express from "express";
import { applyCoupon } from "../../controllers/user/couponController.js";
import { isAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.post(
  "/apply",
  isAuthenticated,
  applyCoupon
);

export default router;