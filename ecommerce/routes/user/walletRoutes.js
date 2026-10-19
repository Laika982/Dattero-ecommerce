import express from "express";
import {
	createWalletTopUpOrder,
	getWallet,
	getWalletTransactions,
	verifyWalletTopUp,
} from "../../controllers/user/walletController.js";
import { isAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.get("/", isAuthenticated, getWallet);
router.get("/transactions", isAuthenticated, getWalletTransactions);
router.post("/top-up/create-order", isAuthenticated, createWalletTopUpOrder);
router.post("/top-up/verify", isAuthenticated, verifyWalletTopUp);

export default router;