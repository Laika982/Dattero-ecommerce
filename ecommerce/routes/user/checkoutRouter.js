import express from "express"
const router = express.Router()

import checkoutController from "../../controllers/user/checkoutController.js"

import{ isAuthenticated }from "../../middleware/authMidilware.js"


router.get("/", isAuthenticated, checkoutController.loadCheckout);
router.get("/addresses", isAuthenticated, checkoutController.getUserAddresses);

export default router;