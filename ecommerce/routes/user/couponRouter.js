import express from "express";
import { applyCoupon, removeCoupon } from "../../controllers/user/couponController.js";
import { isAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.post(
  "/apply",
  isAuthenticated,
  applyCoupon
);

router.post(
  "/remove",
  isAuthenticated,
  removeCoupon
);

export default router;