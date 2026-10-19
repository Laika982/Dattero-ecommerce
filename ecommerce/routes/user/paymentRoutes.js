import express from "express";

import {
  createCheckoutPaymentOrder,
  paymentFailed,
  paymentFailedPage,
} from "../../controllers/user/paymentController.js";

import { isAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.post("/checkout/create-order", isAuthenticated, createCheckoutPaymentOrder);

router.post("/failed", isAuthenticated, paymentFailed);
router.get("/failed", isAuthenticated, paymentFailedPage);

export default router;