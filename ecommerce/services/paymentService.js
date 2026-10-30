import Razorpay from "razorpay";
import crypto from "crypto";

const getRazorpayClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

export const createRazorpayOrder = async ({
  amount,
  receipt,
}) => {
  const order = await getRazorpayClient().orders.create({
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt,
  });

  return order;
};

/**
 * Verifies Razorpay payment signature using HMAC-SHA256 with constant-time comparison
 * to eliminate timing side-channel attacks.
 *
 * @param {Object} params
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * @returns {boolean}
 */
export const verifyRazorpaySignature = ({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error("RAZORPAY_KEY_SECRET environment variable is missing.");
  }

  // 1. Strict input validation: must be non-empty strings
  if (
    typeof razorpayOrderId !== "string" ||
    typeof razorpayPaymentId !== "string" ||
    typeof razorpaySignature !== "string"
  ) {
    return false;
  }

  const orderId = razorpayOrderId.trim();
  const paymentId = razorpayPaymentId.trim();
  const signature = razorpaySignature.trim().toLowerCase();

  // 2. Validate lengths and formats
  // SHA-256 hex digest is strictly 64 hex characters (32 bytes)
  if (
    orderId.length === 0 ||
    paymentId.length === 0 ||
    signature.length !== 64 ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) {
    return false;
  }

  // 3. Compute expected HMAC-SHA256 signature
  const payload = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(payload)
    .digest("hex");

  // 4. Constant-time comparison
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

/**
 * Verifies Razorpay webhook payload signature using HMAC-SHA256 with constant-time comparison.
 *
 * @param {Object} params
 * @param {string|Buffer} params.webhookBody - Raw request body
 * @param {string} params.webhookSignature - X-Razorpay-Signature header
 * @param {string} [params.webhookSecret] - Webhook secret (defaults to env)
 * @returns {boolean}
 */
export const verifyRazorpayWebhookSignature = ({
  webhookBody,
  webhookSignature,
  webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET,
}) => {
  if (!webhookSecret) {
    throw new Error("Webhook secret is missing from environment configuration.");
  }

  if (
    (!webhookBody && webhookBody !== "") ||
    typeof webhookSignature !== "string"
  ) {
    return false;
  }

  const signature = webhookSignature.trim().toLowerCase();
  if (signature.length !== 64 || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }

  const rawBody = Buffer.isBuffer(webhookBody)
    ? webhookBody
    : (typeof webhookBody === "string" ? Buffer.from(webhookBody, "utf8") : Buffer.from(JSON.stringify(webhookBody), "utf8"));

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

export const fetchRazorpayOrderPayments = async (orderId) => {
  try {
    const client = getRazorpayClient();
    const payments = await client.orders.fetchPayments(orderId);
    return payments?.items || [];
  } catch (error) {
    console.error("fetchRazorpayOrderPayments error:", error);
    return [];
  }
};
