import express from "express";
import couponController from "../../controllers/admin/couponController.js";
import { isAdminAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.get("/", isAdminAuthenticated, couponController.listCoupons);
router.get("/add", isAdminAuthenticated, couponController.showCreateCoupon);
router.post("/add", isAdminAuthenticated, couponController.createCoupon);
router.get("/edit/:couponId", isAdminAuthenticated, couponController.showEditCoupon);
router.patch("/edit/:couponId", isAdminAuthenticated, couponController.editCoupon);
router.post("/edit/:couponId", isAdminAuthenticated, couponController.editCoupon);
router.delete("/:couponId", isAdminAuthenticated, couponController.deleteCoupon);

export default router;
