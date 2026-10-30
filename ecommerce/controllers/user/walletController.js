import mongoose from "mongoose";
import Wallet from "../../models/walletSchema.js";
import Payment from "../../models/paymentSchema.js";
import Order from "../../models/orderSchema.js";
import Address from "../../models/addressSchema.js";
import WalletTransaction from "../../models/walletTransactionSchema.js";
import { getOrCreateWallet, creditWallet } from "../../services/walletService.js";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  fetchRazorpayOrderPayments,
} from "../../services/paymentService.js";

export const recordFailedWalletTransaction = async ({
  userId,
  amount,
  reason = "WALLET_TOP_UP",
  description = "Wallet top-up failed",
  failureReason = "Transaction failed",
  razorpayOrderId = null,
  paymentId = null,
  orderId = null,
  type = "CREDIT",
}) => {
  try {
    const wallet = await getOrCreateWallet(userId);
    const currentBalance = Number((wallet?.balance || 0).toFixed(2));
    const failedTransactionKey = paymentId
      ? `WALLET_TOP_UP_FAILED_PAYMENT:${paymentId.toString()}`
      : razorpayOrderId
        ? `WALLET_TOP_UP_FAILED_ORDER:${razorpayOrderId}`
        : null;

    if (failedTransactionKey || razorpayOrderId || paymentId) {
      const duplicateConditions = [];
      if (failedTransactionKey) duplicateConditions.push({ idempotency_key: failedTransactionKey });
      if (razorpayOrderId) duplicateConditions.push({ razorpay_order_id: razorpayOrderId });
      if (paymentId) duplicateConditions.push({ payment_id: paymentId });

      const existingTxn = await WalletTransaction.findOne({
        user_id: userId,
        status: "FAILED",
        $or: duplicateConditions,
      });
      if (existingTxn) return existingTxn;
    }

    try {
      return await WalletTransaction.create({
      user_id: userId,
      type,
      amount: Math.max(0, Number(Number(amount || 0).toFixed(2))),
      reason,
      description,
      status: "FAILED",
      failure_reason: String(failureReason || "Transaction failed").slice(0, 500),
      razorpay_order_id: razorpayOrderId,
      payment_id: paymentId,
      order_id: orderId,
      idempotency_key: failedTransactionKey,
      balance_before: currentBalance,
      balance_after: currentBalance,
      });
    } catch (err) {
      // A concurrent failure callback may win the unique idempotency insert.
      if (err?.code === 11000 && failedTransactionKey) {
        return await WalletTransaction.findOne({
          user_id: userId,
          status: "FAILED",
          idempotency_key: failedTransactionKey,
        });
      }
      throw err;
    }
  } catch (err) {
    console.error("Failed to record failed wallet transaction:", err);
    return null;
  }
};

export const ensureFailedTopUpTransactions = async (userId) => {
  try {
    const failedPayments = await Payment.find({
      user_id: userId,
      purpose: "WALLET_TOP_UP",
      status: "FAILED",
    }).lean();

    for (const p of failedPayments || []) {
      await recordFailedWalletTransaction({
        userId,
        amount: p.amount,
        reason: "WALLET_TOP_UP",
        description: "Wallet top-up failed",
        failureReason: p.failure_reason || "Wallet top-up payment was unsuccessful.",
        razorpayOrderId: p.razorpay_order_id,
        paymentId: p._id,
        type: "CREDIT",
      });
    }

    // Clean up duplicate rows created by older non-atomic failure callbacks.
    const failedTransactions = await WalletTransaction.find({
      user_id: userId,
      reason: "WALLET_TOP_UP",
      status: "FAILED",
      $or: [
        { payment_id: { $exists: true, $ne: null } },
        { razorpay_order_id: { $exists: true, $ne: null } },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    const seenPaymentIds = new Set();
    const seenOrderIds = new Set();
    const duplicateIds = [];
    for (const transaction of failedTransactions) {
      const paymentId = transaction.payment_id?.toString();
      const orderId = transaction.razorpay_order_id;
      const isDuplicate =
        (paymentId && seenPaymentIds.has(paymentId)) ||
        (orderId && seenOrderIds.has(orderId));

      if (isDuplicate) {
        duplicateIds.push(transaction._id);
      } else {
        if (paymentId) seenPaymentIds.add(paymentId);
        if (orderId) seenOrderIds.add(orderId);
      }
    }

    if (duplicateIds.length) {
      await WalletTransaction.deleteMany({ _id: { $in: duplicateIds }, user_id: userId });
    }
  } catch (err) {
    console.error("Error ensuring failed top-up transactions:", err);
  }
};

const formatTransactions = (transactions) => transactions.map((transaction) => {
  const descriptions = {
    WALLET_TOP_UP: "Wallet top-up",
    ORDER_CANCELLATION: "Order cancellation refund",
    ORDER_RETURN: "Order return refund",
    ORDER_PAYMENT: "Order payment",
    REFERRAL_REWARD: "Referral reward",
    OTHER: "Wallet adjustment",
  };

  const isFailed = transaction.status === "FAILED";
  const isPending = transaction.status === "PENDING";
  const isCompleted = !isFailed && !isPending;

  let baseDesc = transaction.description || descriptions[transaction.reason] || "Wallet transaction";

  return {
    ...transaction,
    status: transaction.status || "COMPLETED",
    isFailed,
    isPending,
    isCompleted,
    failureReason: transaction.failure_reason || null,
    description: baseDesc,
    displayAmount: `${transaction.type === "CREDIT" ? "+" : "-"}₹${Number(transaction.amount || 0).toFixed(2)}`,
    displayDate: new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(transaction.createdAt ? new Date(transaction.createdAt) : new Date()),
    displayBalance: isFailed ? "—" : `₹${Number(transaction.balance_after || 0).toFixed(2)}`,
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
      status: { $ne: "FAILED" },
      createdAt: { $gte: startOfCurrentMonth, $lt: startOfNextMonth },
    }).lean(),
    WalletTransaction.find({
      user_id: userId,
      type: "DEBIT",
      status: { $ne: "FAILED" },
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

  // Also include any orders explicitly paid using wallet (payment_method: "wallet" and payment_status: "paid")
  // that were not already recorded as a WalletTransaction DEBIT (preventing double counting)
  const currentRecordedOrderIds = new Set(
    currentMonthDebits
      .filter((t) => t.order_id)
      .map((t) => t.order_id.toString())
  );
  const lastRecordedOrderIds = new Set(
    lastMonthDebits
      .filter((t) => t.order_id)
      .map((t) => t.order_id.toString())
  );

  const [currentWalletOrders, lastWalletOrders] = await Promise.all([
    Order.find({
      user_id: userId,
      payment_method: "wallet",
      payment_status: "paid",
      createdAt: { $gte: startOfCurrentMonth, $lt: startOfNextMonth },
    }).lean(),
    Order.find({
      user_id: userId,
      payment_method: "wallet",
      payment_status: "paid",
      createdAt: { $gte: startOfLastMonth, $lt: startOfCurrentMonth },
    }).lean(),
  ]);

  const unrecordedCurrentOrders = currentWalletOrders.filter(
    (o) => !currentRecordedOrderIds.has(o._id.toString())
  );
  const unrecordedLastOrders = lastWalletOrders.filter(
    (o) => !lastRecordedOrderIds.has(o._id.toString())
  );

  if (unrecordedCurrentOrders.length > 0) {
    currentMonthTotal += unrecordedCurrentOrders.reduce(
      (acc, o) => acc + Number(o.final_amount || 0),
      0
    );
    unrecordedCurrentOrders.forEach((o) => {
      const day = new Date(o.createdAt).getDate();
      const amount = Number(o.final_amount || 0);
      if (day <= 7) weeklySpending[0] += amount;
      else if (day <= 14) weeklySpending[1] += amount;
      else if (day <= 21) weeklySpending[2] += amount;
      else weeklySpending[3] += amount;
    });
  }

  if (unrecordedLastOrders.length > 0) {
    lastMonthTotal += unrecordedLastOrders.reduce(
      (acc, o) => acc + Number(o.final_amount || 0),
      0
    );
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
  } else if (filter === "failed") {
    query.status = "FAILED";
  }

  if (search) {
    const cleanSearch = search.replace(/^#/, "").trim();
    const orConditions = [
      { description: { $regex: cleanSearch, $options: "i" } },
      { reason: { $regex: cleanSearch, $options: "i" } },
      { failure_reason: { $regex: cleanSearch, $options: "i" } },
      { status: { $regex: cleanSearch, $options: "i" } },
    ];
    if (mongoose.Types.ObjectId.isValid(cleanSearch)) {
      orConditions.push({ _id: new mongoose.Types.ObjectId(cleanSearch) });
    }
    query.$or = orConditions;
  }

  const validFilters = ["all", "orders", "wallet", "refunds", "referrals", "failed"];
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
    isFailed: currentFilter === "failed",
  };
};

export const getWallet = async (req, res) => {
  try {
    const userId = req.user._id;
    await ensureFailedTopUpTransactions(userId);
    const filterData = buildTransactionFilter(userId, req.query.filter);

    const wallet = await getOrCreateWallet(userId);

    const limit = 10;
    const [totalFilteredTransactions, totalAllTransactions, monthlySpending] = await Promise.all([
      WalletTransaction.countDocuments(filterData.query),
      WalletTransaction.countDocuments({ user_id: userId }),
      calculateMonthlySpending(userId),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalFilteredTransactions / limit));
    const rawPage = parseInt(req.query.page, 10);
    const currentPage = Math.min(Math.max(1, Number.isFinite(rawPage) ? rawPage : 1), totalPages);
    const skip = (currentPage - 1) * limit;

    const transactions = await WalletTransaction.find(filterData.query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const startIndex = totalFilteredTransactions === 0 ? 0 : skip + 1;
    const endIndex = Math.min(skip + limit, totalFilteredTransactions);

    return res.status(200).render("user/wallet", {
      user: req.user,
      wallet: {
        balance: Number(wallet.balance).toFixed(2),
      },
      monthlySpending,
      ...filterData,
      transactions: formatTransactions(transactions),
      currentPage,
      totalPages,
      totalTransactions: totalFilteredTransactions,
      totalTransactionsCount: totalAllTransactions,
      startIndex,
      endIndex,
      hasPagination: totalPages > 1,
    });
  } catch (error) {
    console.error("Get wallet error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load wallet",
    });
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

    const defaultAddress = await Address.findOne({ user_id: req.user._id, isDefault: true }).lean()
      || await Address.findOne({ user_id: req.user._id }).lean();

    return res.status(200).json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      key: process.env.RAZORPAY_KEY_ID,
      prefill: {
        name: req.user.name || "",
        email: req.user.email || "",
        contact: req.user.phone || defaultAddress?.phone || "",
      },
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

    if (!payment || !razorpayPaymentId || !razorpaySignature || Number(payment.amount) <= 0) {
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
      const userWallet = await getOrCreateWallet(req.user._id);
      return res.status(200).json({
        success: true,
        message: "Wallet already credited.",
        balance: Number(userWallet?.balance || 0),
        amountCredited: payment.amount,
      });
    }

    const claimedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $in: ["PENDING", "FAILED"] } },
      {
        $set: {
          status: "PROCESSING",
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
          failure_reason: null,
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

    let creditedWallet = null;
    try {
      const creditResult = await creditWallet({
        userId: req.user._id,
        amount: payment.amount,
        reason: "WALLET_TOP_UP",
        paymentId: payment._id,
        razorpayOrderId,
        idempotencyKey: `WALLET_TOP_UP:${payment._id}`,
      });
      creditedWallet = creditResult?.wallet;

      if (razorpayOrderId) {
        await WalletTransaction.deleteMany({
          user_id: req.user._id,
          razorpay_order_id: razorpayOrderId,
          status: "FAILED",
        });
      }

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
      balance: Number(creditedWallet?.balance != null ? creditedWallet.balance : 0),
      amountCredited: payment.amount,
    });
  } catch (error) {
    console.error("Verify wallet top-up error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify wallet payment.",
    });
  }
};

export const walletFailed = async (req, res) => {
  try {
    const { razorpay_order_id, reason } = req.body;

    if (typeof razorpay_order_id === "string" && razorpay_order_id) {
      const payment = await Payment.findOneAndUpdate(
        {
          user_id: req.user._id,
          razorpay_order_id,
          purpose: "WALLET_TOP_UP",
        },
        {
          status: "FAILED",
          failure_reason: String(reason || "Wallet top-up failed").slice(0, 500),
        },
        { new: true }
      );

      await recordFailedWalletTransaction({
        userId: req.user._id,
        amount: payment?.amount || 0,
        reason: "WALLET_TOP_UP",
        description: "Wallet top-up failed",
        failureReason: payment?.failure_reason || reason || "Wallet top-up failed",
        razorpayOrderId: razorpay_order_id,
        paymentId: payment?._id || null,
        type: "CREDIT",
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Wallet failure record error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to record wallet failure",
    });
  }
};

export const walletFailedPage = async (req, res) => {
  try {
    const reason = typeof req.query.reason === "string" ? req.query.reason.trim() : "";

    if (reason && req.user?._id) {
      const requestedOrderId = typeof req.query.orderId === "string"
        ? req.query.orderId.trim()
        : "";
      const pendingPayment = requestedOrderId
        ? await Payment.findOne({
          user_id: req.user._id,
          razorpay_order_id: requestedOrderId,
          purpose: "WALLET_TOP_UP",
          status: "PENDING",
        })
        : null;

      if (pendingPayment) {
        pendingPayment.status = "FAILED";
        pendingPayment.failure_reason = reason;
        await pendingPayment.save();

        await recordFailedWalletTransaction({
          userId: req.user._id,
          amount: pendingPayment.amount,
          reason: "WALLET_TOP_UP",
          description: "Wallet top-up failed",
          failureReason: reason,
          razorpayOrderId: pendingPayment.razorpay_order_id,
          paymentId: pendingPayment._id,
          type: "CREDIT",
        });
      }
    }

    return res.status(200).render("user/walletFailed", {
      user: req.user,
      reason: reason || "Your bank or payment provider could not complete this transaction.",
    });
  } catch (error) {
    console.error("Load wallet failed page error:", error);
    return res.status(500).redirect("/wallet");
  }
};

export const checkWalletTopUpStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Order ID is required." });
    }

    const payment = await Payment.findOne({
      user_id: req.user._id,
      razorpay_order_id: orderId,
      purpose: "WALLET_TOP_UP",
    }).lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment record not found." });
    }

    if (payment.status === "FAILED") {
      await recordFailedWalletTransaction({
        userId: req.user._id,
        amount: payment.amount,
        reason: "WALLET_TOP_UP",
        description: "Wallet top-up failed",
        failureReason: payment.failure_reason || "Wallet top-up payment was unsuccessful.",
        razorpayOrderId: orderId,
        paymentId: payment._id,
        type: "CREDIT",
      });

      return res.status(200).json({
        success: true,
        status: "FAILED",
        reason: payment.failure_reason || "Wallet top-up payment was unsuccessful.",
      });
    }

    if (payment.status === "SUCCESS") {
      return res.status(200).json({
        success: true,
        status: "SUCCESS",
      });
    }

    // Inspect Razorpay order payments directly for fast failure detection
    const items = await fetchRazorpayOrderPayments(orderId);
    const capturedPayment = items.find((item) => item.status === "captured");
    if (capturedPayment) {
      return res.status(200).json({
        success: true,
        status: "SUCCESS",
      });
    }

    return res.status(200).json({
      success: true,
      status: payment.status || "PENDING",
    });
  } catch (error) {
    console.error("Check wallet top-up status error:", error);
    return res.status(500).json({ success: false, message: "Error checking status." });
  }
};

export const handleWalletTopUpCallback = async (req, res) => {
  try {
    const errorData =
      req.body.error ||
      (req.body["error[code]"]
        ? {
          code: req.body["error[code]"],
          description: req.body["error[description]"],
          source: req.body["error[source]"],
          step: req.body["error[step]"],
          reason: req.body["error[reason]"],
        }
        : null);

    if (errorData) {
      const reason =
        errorData.description ||
        errorData.reason ||
        "Wallet top-up payment was unsuccessful.";
      const razorpayOrderId =
        req.body.razorpay_order_id ||
        (typeof errorData.metadata === "object" ? errorData.metadata.order_id : null);

      if (razorpayOrderId && req.user?._id) {
        const failedPay = await Payment.findOneAndUpdate(
          {
            user_id: req.user._id,
            razorpay_order_id: razorpayOrderId,
            purpose: "WALLET_TOP_UP",
            status: "PENDING",
          },
          {
            status: "FAILED",
            failure_reason: String(reason).slice(0, 500),
          },
          { new: true }
        );

        await recordFailedWalletTransaction({
          userId: req.user._id,
          amount: failedPay?.amount || 0,
          reason: "WALLET_TOP_UP",
          description: "Wallet top-up failed",
          failureReason: String(reason).slice(0, 500),
          razorpayOrderId,
          paymentId: failedPay?._id || null,
          type: "CREDIT",
        });
      }
      return res.redirect(`/wallet/failed?reason=${encodeURIComponent(reason)}`);
    }

    const {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.redirect(
        `/wallet/failed?reason=${encodeURIComponent("Payment details missing or transaction incomplete.")}`
      );
    }

    const payment = await Payment.findOne({
      user_id: req.user._id,
      razorpay_order_id: razorpayOrderId,
      purpose: "WALLET_TOP_UP",
      method: "RAZORPAY",
    });

    if (!payment || Number(payment.amount) <= 0) {
      return res.redirect(`/wallet/failed?reason=${encodeURIComponent("Payment record not found.")}`);
    }

    const isValid = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!isValid) {
      await Payment.updateOne(
        { _id: payment._id, status: "PENDING" },
        { status: "FAILED", failure_reason: "Signature verification failed" }
      );

      await recordFailedWalletTransaction({
        userId: req.user._id,
        amount: payment.amount,
        reason: "WALLET_TOP_UP",
        description: "Wallet top-up failed",
        failureReason: "Signature verification failed",
        razorpayOrderId,
        paymentId: payment._id,
        type: "CREDIT",
      });

      return res.redirect(`/wallet/failed?reason=${encodeURIComponent("Security signature check failed.")}`);
    }

    if (payment.status === "SUCCESS") {
      return res.redirect("/wallet");
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
      { new: true }
    );

    if (claimedPayment) {
      try {
        await creditWallet({
          userId: req.user._id,
          amount: payment.amount,
          reason: "WALLET_TOP_UP",
          paymentId: payment._id,
          razorpayOrderId,
          idempotencyKey: `WALLET_TOP_UP:${payment._id}`,
        });

        await Payment.updateOne(
          { _id: payment._id, status: "PROCESSING" },
          { $set: { status: "SUCCESS" } }
        );
      } catch (err) {
        await Payment.updateOne(
          { _id: payment._id, status: "PROCESSING" },
          { $set: { status: "PENDING" } }
        );
        throw err;
      }
    }

    return res.redirect("/wallet");
  } catch (error) {
    console.error("Wallet top-up callback error:", error);
    return res.redirect(
      `/wallet/failed?reason=${encodeURIComponent("An unexpected error occurred while processing wallet top-up.")}`
    );
  }
};
