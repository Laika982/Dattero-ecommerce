import express from "express";

import { isAuthenticated } from "../../middleware/authMidilware.js";

import orderController from "../../controllers/user/orderController.js";

const router = express.Router();

router.post("/place", isAuthenticated, orderController.placeOrder);

router.get(
  "/order-success/:orderId",
  isAuthenticated,
  orderController.loadOrderSuccess,
);

router.get("/orders", isAuthenticated, orderController.loadOrders);
router.get(
  "/orders/:orderId",
  isAuthenticated,
  orderController.loadOrderDetails,
);
router.post(
  "/orders/:orderId/return-request",
  isAuthenticated,
  orderController.requestOrderReturn,
);
router.get(
  "/orders/:orderId/track",
  isAuthenticated,
  orderController.loadOrderTracking,
);
router.post(
  "/orders/:orderId/buy-again",
  isAuthenticated,
  orderController.buyAgain,
);

router.patch(
  "/orders/:orderId/items/:itemId/cancel",
  isAuthenticated,
  orderController.cancelOrderItem,
);

router.patch(
  "/orders/:orderId/cancel",
  isAuthenticated,
  orderController.cancelEntireOrder
);

router.get(
  "/orders/:orderId/invoice",
  isAuthenticated,
  orderController.downloadInvoice
);

export default router;
