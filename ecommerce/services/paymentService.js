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

export const verifyRazorpaySignature = ({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const body =
    razorpayOrderId + "|" + razorpayPaymentId;

  const expectedSignature = crypto
    .createHmac(
      "sha256",
      process.env.RAZORPAY_KEY_SECRET
    )
    .update(body)
    .digest("hex");

  return expectedSignature === razorpaySignature;
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