import express from "express";
import {
  createWalletTopUpOrder,
  getWallet,
  verifyWalletTopUp,
  walletFailed,
  walletFailedPage,
  checkWalletTopUpStatus,
  handleWalletTopUpCallback,
} from "../../controllers/user/walletController.js";
import { isAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.get("/", isAuthenticated, getWallet);
router.get("/transactions", isAuthenticated, (req, res) => res.redirect("/wallet"));
router.get("/failed", isAuthenticated, walletFailedPage);
router.post("/failed", isAuthenticated, walletFailed);
router.post("/top-up/create-order", isAuthenticated, createWalletTopUpOrder);
router.post("/top-up/verify", isAuthenticated, verifyWalletTopUp);
router.get("/top-up/check-status/:orderId", isAuthenticated, checkWalletTopUpStatus);
router.post("/top-up/callback", isAuthenticated, handleWalletTopUpCallback);

export default router;
