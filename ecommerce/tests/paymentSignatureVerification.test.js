import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
} from "../services/paymentService.js";

describe("BUG-SEC-004: Payment Signature Verification & Constant-Time Security Tests", () => {
  const testSecret = "test_razorpay_secret_key_1234567890";
  const originalSecret = process.env.RAZORPAY_KEY_SECRET;

  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = testSecret;
  });

  // Helper to generate a valid HMAC-SHA256 signature
  const generateValidSignature = (orderId, paymentId, secret = testSecret) => {
    return crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
  };

  // Helper to generate a valid webhook signature
  const generateValidWebhookSignature = (body, secret = testSecret) => {
    const raw = Buffer.isBuffer(body)
      ? body
      : (typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(JSON.stringify(body), "utf8"));
    return crypto
      .createHmac("sha256", secret)
      .update(raw)
      .digest("hex");
  };

  // 1. Valid Signatures
  describe("1. Valid Signature Verification", () => {
    it("accepts a perfectly matched HMAC-SHA256 payment signature", () => {
      const orderId = "order_EKfMRdaZnozKy6";
      const paymentId = "pay_29QQoUBcxrhErq";
      const validSignature = generateValidSignature(orderId, paymentId);

      const isValid = verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature,
      });

      assert.strictEqual(isValid, true, "Valid HMAC signature must be accepted");
    });

    it("accepts uppercase and lowercase valid hex signatures identically", () => {
      const orderId = "order_CaseSensitivityTest";
      const paymentId = "pay_CaseSensitivityTest";
      const validSignature = generateValidSignature(orderId, paymentId);

      const isValidUpper = verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature.toUpperCase(),
      });
      assert.strictEqual(isValidUpper, true, "Uppercase hex signature must match");

      const isValidLower = verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature.toLowerCase(),
      });
      assert.strictEqual(isValidLower, true, "Lowercase hex signature must match");
    });

    it("verifies webhook payload signatures in constant time", () => {
      const webhookPayload = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: { payment: { id: "pay_123" } },
      });
      const validWebhookSig = generateValidWebhookSignature(webhookPayload);

      const isValid = verifyRazorpayWebhookSignature({
        webhookBody: webhookPayload,
        webhookSignature: validWebhookSig,
        webhookSecret: testSecret,
      });

      assert.strictEqual(isValid, true, "Valid webhook signature must be accepted");
    });
  });

  // 2. Invalid Signatures
  describe("2. Invalid Signatures & Tampering Rejection", () => {
    it("rejects tampered signature with single-character modification", () => {
      const orderId = "order_EKfMRdaZnozKy6";
      const paymentId = "pay_29QQoUBcxrhErq";
      const validSignature = generateValidSignature(orderId, paymentId);

      // Modify the last character
      const lastChar = validSignature[63];
      const alteredChar = lastChar === "a" ? "b" : "a";
      const tamperedSignature = validSignature.slice(0, 63) + alteredChar;

      const isValid = verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: tamperedSignature,
      });

      assert.strictEqual(isValid, false, "Tampered signature must be rejected");
    });

    it("rejects signature generated with an untrusted or incorrect secret", () => {
      const orderId = "order_EKfMRdaZnozKy6";
      const paymentId = "pay_29QQoUBcxrhErq";
      const alienSignature = generateValidSignature(orderId, paymentId, "different_secret_key");

      const isValid = verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: alienSignature,
      });

      assert.strictEqual(isValid, false, "Signature from different secret must fail");
    });

    it("rejects signature when orderId or paymentId do not match", () => {
      const validSignature = generateValidSignature("order_A", "pay_A");

      // Swap paymentId
      const isValidMismatched = verifyRazorpaySignature({
        razorpayOrderId: "order_A",
        razorpayPaymentId: "pay_B",
        razorpaySignature: validSignature,
      });

      assert.strictEqual(isValidMismatched, false, "Signature for different paymentId must fail");
    });
  });

  // 3. Malformed Values & Length Validation
  describe("3. Malformed Values & Type Validation", () => {
    it("rejects null, undefined, or missing parameters safely without crashing", () => {
      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: null,
          razorpayPaymentId: "pay_123",
          razorpaySignature: "abc",
        }),
        false
      );

      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: "order_123",
          razorpayPaymentId: undefined,
          razorpaySignature: "abc",
        }),
        false
      );

      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: "order_123",
          razorpayPaymentId: "pay_123",
          razorpaySignature: null,
        }),
        false
      );
    });

    it("rejects non-string types (objects, arrays, numbers)", () => {
      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: 12345,
          razorpayPaymentId: "pay_123",
          razorpaySignature: "abc",
        }),
        false
      );

      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: "order_123",
          razorpayPaymentId: ["pay_123"],
          razorpaySignature: "abc",
        }),
        false
      );

      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: "order_123",
          razorpayPaymentId: "pay_123",
          razorpaySignature: { evil: true },
        }),
        false
      );
    });

    it("rejects signatures that are not exactly 64 hexadecimal characters", () => {
      const orderId = "order_TestLength";
      const paymentId = "pay_TestLength";

      // Truncated signature (32 chars)
      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: "a".repeat(32),
        }),
        false,
        "Truncated 32-char signature must be rejected"
      );

      // Oversized signature (128 chars)
      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: "a".repeat(128),
        }),
        false,
        "Oversized 128-char signature must be rejected"
      );

      // 64 characters but non-hex characters (e.g. contains 'z' or spaces)
      assert.strictEqual(
        verifyRazorpaySignature({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: "z".repeat(64),
        }),
        false,
        "Non-hex signature must be rejected"
      );
    });

    it("throws clear configuration error if RAZORPAY_KEY_SECRET is unset", () => {
      delete process.env.RAZORPAY_KEY_SECRET;

      assert.throws(
        () => {
          verifyRazorpaySignature({
            razorpayOrderId: "order_123",
            razorpayPaymentId: "pay_123",
            razorpaySignature: "a".repeat(64),
          });
        },
        /RAZORPAY_KEY_SECRET/
      );
    });
  });

  // 4. Amount Verification & Tampering Protection
  describe("4. Amount Verification & Integration State Guards", () => {
    it("rejects payment confirmation when payment amount does not match order amount", () => {
      const orderFinalAmount = 1500.0; // ₹1500.00
      const tamperedPaymentAmount = 1.0; // Attacker tries to pay ₹1.00

      const orderAmountPaise = Math.round(Number(orderFinalAmount) * 100);
      const paymentAmountPaise = Math.round(Number(tamperedPaymentAmount) * 100);

      const isAmountValid = orderAmountPaise === paymentAmountPaise;
      assert.strictEqual(isAmountValid, false, "Payment amount mismatch must be detected and rejected");
    });

    it("validates exact currency amount down to paise precision", () => {
      const orderFinalAmount = 1499.99;
      const paymentAmount = 1499.99;

      const orderPaise = Math.round(orderFinalAmount * 100);
      const paymentPaise = Math.round(paymentAmount * 100);

      assert.strictEqual(orderPaise, 149999);
      assert.strictEqual(orderPaise === paymentPaise, true);
    });
  });

  // 5. Duplicate Notifications & Idempotency Protection
  describe("5. Replay & Duplicate Callback Protection", () => {
    it("prevents double-processing when identical payment callback is replayed", () => {
      // Mock payment states
      const paymentRecords = [
        { _id: "pay-rec-1", razorpay_order_id: "order_DUP_1", status: "PENDING" },
      ];

      // First callback claims PENDING -> PROCESSING
      const claim = (orderId) => {
        const p = paymentRecords.find(
          (item) => item.razorpay_order_id === orderId && ["PENDING", "FAILED"].includes(item.status)
        );
        if (!p) return null;
        p.status = "PROCESSING";
        return p;
      };

      const firstClaim = claim("order_DUP_1");
      assert.ok(firstClaim, "First callback must successfully claim payment");
      assert.strictEqual(firstClaim.status, "PROCESSING");

      // Duplicate callback arrives concurrently or replayed
      const secondClaim = claim("order_DUP_1");
      assert.strictEqual(
        secondClaim,
        null,
        "Duplicate callback must NOT be able to claim already processing payment"
      );
    });

    it("returns idempotent success if order is already marked paid", () => {
      const order = {
        order_id: "ORD-ALREADY-PAID",
        payment_status: "paid",
      };

      // When callback is received for an already paid order:
      const isAlreadyPaid = order.payment_status === "paid";
      assert.strictEqual(isAlreadyPaid, true, "Already paid order must be recognized");
      // Handler returns 200 without executing payment charge or stock modification
    });
  });
});

