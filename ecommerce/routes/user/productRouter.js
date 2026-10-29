import express from "express";
const router = express.Router();

import productContoller from "../../controllers/user/productController.js";
import { isAuthenticated } from "../../middleware/authMidilware.js";

router.get("/", productContoller.loadProducts);
router.get("/:id", productContoller.loadProduct);
router.post("/:id/review", isAuthenticated, productContoller.submitReview);
router.post("/review", isAuthenticated, productContoller.submitReview);

export default router;
