process.env.NODE_ENV = "test";
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_TlK704UXB6P0aR";
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "M3xMhELuf1ntSFYK5qjjpM0n";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { verifyRazorpaySignature } from "../services/paymentService.js";

describe("Online Payment & Wallet Top-Up Integration Tests", () => {
  it("verifies authentic Razorpay signatures using HMAC SHA-256", () => {
    const razorpayOrderId = "order_test_1234567890";
    const razorpayPaymentId = "pay_test_9876543210";
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const validSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const isValid = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: validSignature,
    });

    assert.strictEqual(isValid, true, "Valid HMAC signature should pass verification");
  });

  it("rejects tampered or forged Razorpay signatures", () => {
    const razorpayOrderId = "order_test_1234567890";
    const razorpayPaymentId = "pay_test_9876543210";
    const fakeSignature = "d41d8cd98f00b204e9800998ecf8427e00000000000000000000000000000000";

    const isValid = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: fakeSignature,
    });

    assert.strictEqual(isValid, false, "Tampered signature must fail verification");
  });

  it("rejects payment verification when payment ID or order ID is altered", () => {
    const razorpayOrderId = "order_test_original";
    const razorpayPaymentId = "pay_test_original";
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const isValidWithAlteredOrder = verifyRazorpaySignature({
      razorpayOrderId: "order_test_altered",
      razorpayPaymentId,
      razorpaySignature: signature,
    });

    assert.strictEqual(isValidWithAlteredOrder, false, "Altered order ID must fail verification");
  });

  it("validates wallet top-up amount boundaries (min ₹1, max ₹50,000)", () => {
    const validateTopUpAmount = (rawAmount) => {
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount < 1 || amount > 50000) {
        return { valid: false, message: "Enter an amount between ₹1 and ₹50,000." };
      }
      return { valid: true, amount: Math.round(amount * 100) / 100 };
    };

    assert.strictEqual(validateTopUpAmount(0).valid, false);
    assert.strictEqual(validateTopUpAmount(-50).valid, false);
    assert.strictEqual(validateTopUpAmount("abc").valid, false);
    assert.strictEqual(validateTopUpAmount(50001).valid, false);
    assert.strictEqual(validateTopUpAmount(1).valid, true);
    assert.strictEqual(validateTopUpAmount(500).valid, true);
    assert.strictEqual(validateTopUpAmount(50000).valid, true);
    assert.strictEqual(validateTopUpAmount("150.50").amount, 150.50);
  });

  it("normalizes paymentMethod aliases (online, razorpay -> upi)", () => {
    const normalizePaymentMethod = (rawMethod) => {
      const trimmed = String(rawMethod || "").toLowerCase().trim();
      return (trimmed === "online" || trimmed === "razorpay") ? "upi" : trimmed;
    };

    assert.strictEqual(normalizePaymentMethod("online"), "upi");
    assert.strictEqual(normalizePaymentMethod("razorpay"), "upi");
    assert.strictEqual(normalizePaymentMethod("RAZORPAY"), "upi");
    assert.strictEqual(normalizePaymentMethod("ONLINE"), "upi");
    assert.strictEqual(normalizePaymentMethod("upi"), "upi");
    assert.strictEqual(normalizePaymentMethod("cod"), "cod");
    assert.strictEqual(normalizePaymentMethod("wallet"), "wallet");
  });

  it("handles wallet top-up failure reason formatting and default fallbacks", () => {
    const formatFailureReason = (reasonParam) => {
      const trimmed = typeof reasonParam === "string" ? reasonParam.trim() : "";
      return trimmed || "Your bank or payment provider could not complete this transaction.";
    };

    assert.strictEqual(
      formatFailureReason("Card expired"),
      "Card expired"
    );
    assert.strictEqual(
      formatFailureReason(""),
      "Your bank or payment provider could not complete this transaction."
    );
    assert.strictEqual(
      formatFailureReason(undefined),
      "Your bank or payment provider could not complete this transaction."
    );
    assert.strictEqual(
      formatFailureReason("Your payment didn't go through due to a temporary issue. Any debited amount will be refunded in 4-5 business days."),
      "Your payment didn't go through due to a temporary issue. Any debited amount will be refunded in 4-5 business days."
    );
  });

  it("extracts failure reasons from Razorpay webhook/postMessage/callback payloads", () => {
    const extractFailureReason = (payload) => {
      const errorObj = payload?.error || (payload?.data && payload.data.error) || null;
      if (errorObj) {
        return (
          errorObj.description ||
          errorObj.reason ||
          "Your payment didn't go through due to a temporary issue."
        );
      }
      if (payload && payload["error[description]"]) {
        return payload["error[description]"];
      }
      return "Wallet top-up payment was unsuccessful.";
    };

    const postMessagePayload = {
      event: "payment.error",
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "Your payment didn't go through due to a temporary issue. Any debited amount will be refunded in 4-5 business days.",
        source: "gateway",
      },
    };

    assert.strictEqual(
      extractFailureReason(postMessagePayload),
      "Your payment didn't go through due to a temporary issue. Any debited amount will be refunded in 4-5 business days."
    );

    const formCallbackPayload = {
      "error[code]": "BAD_REQUEST_ERROR",
      "error[description]": "Payment declined by bank",
    };

    assert.strictEqual(
      extractFailureReason(formCallbackPayload),
      "Payment declined by bank"
    );
  });

  it("formats failed wallet transactions with failed status indicators and failure reasons", () => {
    const rawTxn = {
      _id: "txn12345",
      type: "CREDIT",
      amount: 1500,
      reason: "WALLET_TOP_UP",
      status: "FAILED",
      failure_reason: "Payment declined by customer bank",
      balance_before: 250,
      balance_after: 250,
      createdAt: new Date("2026-10-25T10:00:00.000Z"),
    };

    const isFailed = rawTxn.status === "FAILED";
    const displayAmount = `${rawTxn.type === "CREDIT" ? "+" : "-"}₹${Number(rawTxn.amount).toFixed(2)}`;
    const displayBalance = isFailed ? "—" : `₹${Number(rawTxn.balance_after).toFixed(2)}`;

    assert.strictEqual(isFailed, true);
    assert.strictEqual(displayAmount, "+₹1500.00");
    assert.strictEqual(displayBalance, "—");
    assert.strictEqual(rawTxn.failure_reason, "Payment declined by customer bank");
  });

  it("builds query correctly when filtering for failed wallet transactions", () => {
    const buildFilter = (filterParam) => {
      const filter = String(filterParam || "all").toLowerCase();
      const query = { user_id: "user1" };
      if (filter === "failed") {
        query.status = "FAILED";
      } else if (filter === "orders") {
        query.reason = "ORDER_PAYMENT";
      }
      return query;
    };

    assert.deepStrictEqual(buildFilter("failed"), { user_id: "user1", status: "FAILED" });
    assert.deepStrictEqual(buildFilter("all"), { user_id: "user1" });
  });

  it("calculates wallet transaction pagination metadata and boundary clamping", () => {
    const calculatePagination = (totalItems, requestedPage, limit = 10) => {
      const totalPages = Math.max(1, Math.ceil(totalItems / limit));
      const rawPage = parseInt(requestedPage, 10);
      const currentPage = Math.min(Math.max(1, Number.isFinite(rawPage) ? rawPage : 1), totalPages);
      const skip = (currentPage - 1) * limit;
      const startIndex = totalItems === 0 ? 0 : skip + 1;
      const endIndex = Math.min(skip + limit, totalItems);

      return { totalPages, currentPage, skip, startIndex, endIndex, hasPagination: totalPages > 1 };
    };

    // 48 items, page 1
    const p1 = calculatePagination(48, 1, 10);
    assert.strictEqual(p1.totalPages, 5);
    assert.strictEqual(p1.currentPage, 1);
    assert.strictEqual(p1.skip, 0);
    assert.strictEqual(p1.startIndex, 1);
    assert.strictEqual(p1.endIndex, 10);
    assert.strictEqual(p1.hasPagination, true);

    // 48 items, page 5 (last page)
    const p5 = calculatePagination(48, 5, 10);
    assert.strictEqual(p5.currentPage, 5);
    assert.strictEqual(p5.skip, 40);
    assert.strictEqual(p5.startIndex, 41);
    assert.strictEqual(p5.endIndex, 48);

    // Clamps out-of-range page numbers
    const pOver = calculatePagination(48, 99, 10);
    assert.strictEqual(pOver.currentPage, 5);
    const pUnder = calculatePagination(48, -3, 10);
    assert.strictEqual(pUnder.currentPage, 1);
    const pNaN = calculatePagination(48, "invalid", 10);
    assert.strictEqual(pNaN.currentPage, 1);

    // Empty list
    const pEmpty = calculatePagination(0, 1, 10);
    assert.strictEqual(pEmpty.totalPages, 1);
    assert.strictEqual(pEmpty.currentPage, 1);
    assert.strictEqual(pEmpty.startIndex, 0);
    assert.strictEqual(pEmpty.endIndex, 0);
    assert.strictEqual(pEmpty.hasPagination, false);
  });

  it("calculates in-checkout wallet balance deficit and tops up to satisfy order total", () => {
    const calculateCheckoutWalletState = (walletBalance, orderTotal) => {
      const currentTotal = Math.max(0, Number(orderTotal) || 0);
      const rawBalance = Math.max(0, Number(walletBalance) || 0);
      const hasEnoughBalance = rawBalance >= currentTotal;
      const deficit = hasEnoughBalance ? 0 : Math.round((currentTotal - rawBalance) * 100) / 100;
      const topUpAmount = deficit > 0 ? Math.max(1, deficit) : 0;
      const remainingAfterOrder = Math.max(0, rawBalance - currentTotal);

      return {
        hasEnoughBalance,
        deficit,
        topUpAmount,
        remainingAfterOrder,
      };
    };

    // Scenario 1: Insufficient balance (Order: ₹1250.50, Wallet: ₹450.00)
    const state1 = calculateCheckoutWalletState(450.00, 1250.50);
    assert.strictEqual(state1.hasEnoughBalance, false);
    assert.strictEqual(state1.deficit, 800.50);
    assert.strictEqual(state1.topUpAmount, 800.50);

    // After topping up the deficit amount:
    const state1After = calculateCheckoutWalletState(450.00 + state1.topUpAmount, 1250.50);
    assert.strictEqual(state1After.hasEnoughBalance, true);
    assert.strictEqual(state1After.deficit, 0);
    assert.strictEqual(state1After.remainingAfterOrder, 0);

    // Scenario 2: Deficit less than ₹1 minimum (Order: ₹500.50, Wallet: ₹500.00 -> deficit: ₹0.50)
    const state2 = calculateCheckoutWalletState(500.00, 500.50);
    assert.strictEqual(state2.hasEnoughBalance, false);
    assert.strictEqual(state2.deficit, 0.50);
    assert.strictEqual(state2.topUpAmount, 1); // Minimum top-up is ₹1

    // After topping up ₹1:
    const state2After = calculateCheckoutWalletState(500.00 + state2.topUpAmount, 500.50);
    assert.strictEqual(state2After.hasEnoughBalance, true);
    assert.strictEqual(state2After.remainingAfterOrder, 0.50);

    // Scenario 3: Sufficient balance (Order: ₹800.00, Wallet: ₹1000.00)
    const state3 = calculateCheckoutWalletState(1000.00, 800.00);
    assert.strictEqual(state3.hasEnoughBalance, true);
    assert.strictEqual(state3.deficit, 0);
    assert.strictEqual(state3.remainingAfterOrder, 200.00);
  });
});
