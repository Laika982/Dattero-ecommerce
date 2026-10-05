import express from "express";

import cartController from "../../controllers/user/cartController.js";

import {isAuthenticated} from "../../middleware/authMidilware.js";


const router = express.Router();


router.get(
  "/",
  isAuthenticated,
  cartController.loadCart
);


router.post(
  "/add",
  isAuthenticated,
  cartController.addToCart
);


router.patch(
  "/:variantId/increase",
  isAuthenticated,
  cartController.increaseQuantity
);


router.patch(
  "/:variantId/decrease",
  isAuthenticated,
  cartController.decreaseQuantity
);


router.delete(
  "/:variantId",
  isAuthenticated,
  cartController.removeFromCart
);


export default router;