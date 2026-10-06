import express from "express";

import { isAdminAuthenticated } from "../../middleware/authMidilware.js";

import orderController from "../../controllers/admin/orderController.js";

const router = express.Router()


router.get(
  "/orders",
  isAdminAuthenticated,
  orderController.adminListOrders
);


router.get(
  "/orders/:orderId",
  isAdminAuthenticated,
  orderController.adminOrderDetails
);

router.get(
  "/orders/:orderId/edit",
  isAdminAuthenticated,
  orderController.adminEditOrder
);

router.get(
  "/orders/:orderId/return",
  isAdminAuthenticated,
  orderController.adminOrderReturn
);

router.patch(
  "/orders/:orderId/return",
  isAdminAuthenticated,
  orderController.processOrderReturn
);


router.patch(
  "/orders/:orderId/status",
  isAdminAuthenticated,
  orderController.updateOrderStatus
);


export default router