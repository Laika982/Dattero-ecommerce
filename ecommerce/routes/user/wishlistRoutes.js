import express from "express";

import {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
} from "../../controllers/user/wishlistController.js";

import { isAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.get("/", isAuthenticated, getWishlist);

router.post("/add/:productId", isAuthenticated, addToWishlist);

router.delete("/remove/:productId", isAuthenticated, removeFromWishlist);

export default router;
