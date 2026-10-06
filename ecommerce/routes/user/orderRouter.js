import express from "express";

import { isAuthenticated } from "../../middleware/authMidilware.js";

import orderController from "../../controllers/user/orderController.js";

const router = express.Router();

router.post("/place", isAuthenticated, orderController.placeOrder);

router.get("/order-success/:orderId",isAuthenticated,orderController.loadOrderSuccess,);

export default router;
