import mongoose from "mongoose";
import Wallet from "../../models/walletSchema.js";
import Payment from "../../models/paymentSchema.js";
import Order from "../../models/orderSchema.js";
import WalletTransaction from "../../models/walletTransactionSchema.js";
import { getOrCreateWallet, creditWallet } from "../../services/walletService.js";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
} from "../../services/paymentService.js";

const formatTransactions = (transactions) => transactions.map((transaction) => {
  const descriptions = {
    WALLET_TOP_UP: "Wallet top-up",
    ORDER_CANCELLATION: "Order cancellation refund",
    ORDER_RETURN: "Order return refund",
    ORDER_PAYMENT: "Order payment",
    REFERRAL_REWARD: "Referral reward",
    OTHER: "Wallet adjustment",
  };

  return {
    ...transaction,
    description: transaction.description || descriptions[transaction.reason] || "Wallet transaction",
    displayAmount: `${transaction.type === "CREDIT" ? "+" : "-"}₹${Number(transaction.amount).toFixed(2)}`,
    displayDate: new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(transaction.createdAt),
    displayBalance: `₹${Number(transaction.balance_after).toFixed(2)}`,
  };
});

const calculateMonthlySpending = async (userId) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
  const startOfNextMonth = new Date(currentYear, currentMonth + 1, 1);
  const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1);

  const [currentMonthDebits, lastMonthDebits] = await Promise.all([
    WalletTransaction.find({
      user_id: userId,
      type: "DEBIT",
      createdAt: { $gte: startOfCurrentMonth, $lt: startOfNextMonth },
    }).lean(),
    WalletTransaction.find({
      user_id: userId,
      type: "DEBIT",
      createdAt: { $gte: startOfLastMonth, $lt: startOfCurrentMonth },
    }).lean(),
  ]);

  let currentMonthTotal = currentMonthDebits.reduce(
    (acc, t) => acc + Number(t.amount || 0),
    0
  );
  let lastMonthTotal = lastMonthDebits.reduce(
    (acc, t) => acc + Number(t.amount || 0),
    0
  );
  const weeklySpending = [0, 0, 0, 0];

  currentMonthDebits.forEach((t) => {
    const day = new Date(t.createdAt).getDate();
    const amount = Number(t.amount || 0);
    if (day <= 7) weeklySpending[0] += amount;
    else if (day <= 14) weeklySpending[1] += amount;
    else if (day <= 21) weeklySpending[2] += amount;
    else weeklySpending[3] += amount;
  });

  // If no wallet debits, check if the user has store orders in current/last month
  if (currentMonthTotal === 0 && lastMonthTotal === 0) {
    const [currentOrders, lastOrders] = await Promise.all([
      Order.find({
        user_id: userId,
        order_status: { $ne: "cancelled" },
        createdAt: { $gte: startOfCurrentMonth, $lt: startOfNextMonth },
      }).lean(),
      Order.find({
        user_id: userId,
        order_status: { $ne: "cancelled" },
        createdAt: { $gte: startOfLastMonth, $lt: startOfCurrentMonth },
      }).lean(),
    ]);

    if (currentOrders.length > 0 || lastOrders.length > 0) {
      currentMonthTotal = currentOrders.reduce(
        (acc, o) => acc + Number(o.final_amount || 0),
        0
      );
      lastMonthTotal = lastOrders.reduce(
        (acc, o) => acc + Number(o.final_amount || 0),
        0
      );
      currentOrders.forEach((o) => {
        const day = new Date(o.createdAt).getDate();
        const amount = Number(o.final_amount || 0);
        if (day <= 7) weeklySpending[0] += amount;
        else if (day <= 14) weeklySpending[1] += amount;
        else if (day <= 21) weeklySpending[2] += amount;
        else weeklySpending[3] += amount;
      });
    }
  }

  let percentageChange = "0%";
  let trendIcon = "trending_flat";
  let trendColor = "text-on-surface-variant";

  if (lastMonthTotal > 0) {
    const diff = currentMonthTotal - lastMonthTotal;
    const pct = Math.round((Math.abs(diff) / lastMonthTotal) * 100);
    if (diff > 0) {
      percentageChange = `+${pct}%`;
      trendIcon = "trending_up";
      trendColor = "text-green-700";
    } else if (diff < 0) {
      percentageChange = `-${pct}%`;
      trendIcon = "trending_down";
      trendColor = "text-amber-700";
    }
  } else if (currentMonthTotal > 0) {
    percentageChange = "+100%";
    trendIcon = "trending_up";
    trendColor = "text-green-700";
  }

  const currentWeekIdx = Math.min(3, Math.floor((now.getDate() - 1) / 7));
  const maxWeekly = Math.max(...weeklySpending, 1);
  const bars = [];
  const subRatios = [0.65, 0.85, 1.0];

  for (let w = 0; w < 4; w++) {
    const spend = weeklySpending[w];
    const ratio = currentMonthTotal > 0 ? spend / maxWeekly : 0;
    for (let s = 0; s < 3; s++) {
      let heightPercent = 12;
      if (spend > 0) {
        heightPercent = Math.min(
          100,
          Math.max(18, Math.round(ratio * subRatios[s] * 88))
        );
      }
      const isCurrent = w === currentWeekIdx && s === 2;
      bars.push({
        height: `${heightPercent}%`,
        title: `Week ${w + 1}: ₹${spend.toFixed(2)}`,
        isCurrent,
      });
    }
  }

  return {
    total: Number(currentMonthTotal).toFixed(2),
    percentageChange,
    trendIcon,
    trendColor,
    bars,
  };
};

const buildTransactionFilter = (userId, filterParam, searchParam) => {
  const filter = String(filterParam || "all").toLowerCase();
  const search = String(searchParam || "").trim();

  const query = { user_id: userId };

  if (filter === "orders") {
    query.reason = "ORDER_PAYMENT";
  } else if (filter === "wallet") {
    query.reason = { $in: ["WALLET_TOP_UP", "OTHER"] };
  } else if (filter === "refunds") {
    query.reason = { $in: ["ORDER_CANCELLATION", "ORDER_RETURN"] };
  } else if (filter === "referrals") {
    query.reason = "REFERRAL_REWARD";
  }

  if (search) {
    const cleanSearch = search.replace(/^#/, "").trim();
    const orConditions = [
      { description: { $regex: cleanSearch, $options: "i" } },
      { reason: { $regex: cleanSearch, $options: "i" } },
    ];
    if (mongoose.Types.ObjectId.isValid(cleanSearch)) {
      orConditions.push({ _id: new mongoose.Types.ObjectId(cleanSearch) });
    }
    query.$or = orConditions;
  }

  const validFilters = ["all", "orders", "wallet", "refunds", "referrals"];
  const currentFilter = validFilters.includes(filter) ? filter : "all";

  return {
    query,
    currentFilter,
    search,
    isAll: currentFilter === "all",
    isOrders: currentFilter === "orders",
    isWallet: currentFilter === "wallet",
    isRefunds: currentFilter === "refunds",
    isReferrals: currentFilter === "referrals",
  };
};

export const getWallet = async (req, res) => {
  try {
    const userId = req.user._id;
    const filterData = buildTransactionFilter(userId, req.query.filter);

    const wallet = await getOrCreateWallet(userId);

    const [transactions, totalCount, monthlySpending] = await Promise.all([
      WalletTransaction.find(filterData.query)
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      WalletTransaction.countDocuments({ user_id: userId }),
      calculateMonthlySpending(userId),
    ]);

    return res.status(200).render("user/wallet", {
      user: req.user,
      wallet: {
        balance: Number(wallet.balance).toFixed(2),
      },
      monthlySpending,
      ...filterData,
      transactions: formatTransactions(transactions),
      totalTransactionsCount: totalCount,
    });
  } catch (error) {
    console.error("Get wallet error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load wallet",
    });
  }
};

export const getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user._id;
    const filterData = buildTransactionFilter(
      userId,
      req.query.filter,
      req.query.search
    );

    const wallet = await getOrCreateWallet(userId);

    const transactions = await WalletTransaction.find(filterData.query)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).render("user/walletTransactions", {
      user: req.user,
      wallet: {
        balance: Number(wallet.balance).toFixed(2),
      },
      ...filterData,
      transactions: formatTransactions(transactions),
    });
  } catch (error) {
    console.error("Get wallet transactions error:", error);

    return res.status(500).send("Unable to load wallet transactions");
  }
};

export const createWalletTopUpOrder = async (req, res) => {
  try {
    const requestedAmount = Number(req.body.amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount < 1 || requestedAmount > 50000) {
      return res.status(400).json({
        success: false,
        message: "Enter an amount between ₹1 and ₹50,000.",
      });
    }
    const amount = Math.round(requestedAmount * 100) / 100;

    const order = await createRazorpayOrder({
      amount,
      receipt: `wallet_${req.user._id.toString().slice(-8)}_${Date.now()}`,
    });

    await Payment.create({
      user_id: req.user._id,
      razorpay_order_id: order.id,
      amount,
      method: "RAZORPAY",
      status: "PENDING",
      purpose: "WALLET_TOP_UP",
    });

    return res.status(200).json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Create wallet top-up order error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to start wallet top-up. Please try again.",
    });
  }
};

export const verifyWalletTopUp = async (req, res) => {
  try {
    const {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = req.body;

    const payment = await Payment.findOne({
      user_id: req.user._id,
      razorpay_order_id: razorpayOrderId,
      purpose: "WALLET_TOP_UP",
      method: "RAZORPAY",
    });

    if (!payment || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: "Wallet payment could not be verified.",
      });
    }

    const isValid = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Wallet payment signature is invalid.",
      });
    }

    if (payment.status === "SUCCESS") {
      return res.status(200).json({ success: true, message: "Wallet already credited." });
    }

    const claimedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "PENDING" },
      {
        $set: {
          status: "PROCESSING",
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
        },
      },
      { new: true },
    );

    if (!claimedPayment) {
      return res.status(409).json({
        success: false,
        message: "This wallet payment is already being processed.",
      });
    }

    try {
      await creditWallet({
        userId: req.user._id,
        amount: payment.amount,
        reason: "WALLET_TOP_UP",
      });

      await Payment.updateOne(
        { _id: payment._id, status: "PROCESSING" },
        { $set: { status: "SUCCESS" } },
      );
    } catch (error) {
      await Payment.updateOne(
        { _id: payment._id, status: "PROCESSING" },
        { $set: { status: "PENDING" } },
      );
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "Wallet credited successfully.",
    });
  } catch (error) {
    console.error("Verify wallet top-up error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify wallet payment.",
    });
  }
};