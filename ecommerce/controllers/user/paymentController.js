import mongoose from "mongoose";
import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";
import Payment from "../../models/paymentSchema.js";
import {
  calculateItemPrice,
  calculateCartTotals,
  getOfferedUnitPrice,
  loadOfferPricingMap,
  applyCheckoutDiscounts,
} from "../../services/pricingService.js";
import { validateCoupon } from "../../services/couponService.js";

import {
  createRazorpayOrder,
} from "../../services/paymentService.js";

export const createCheckoutPaymentOrder = async (req, res) => {
  try {
    const { addressId } = req.body;
    const hasExplicitCouponInBody = typeof req.body.couponCode === "string";
    const couponCode = hasExplicitCouponInBody
      ? req.body.couponCode.trim()
      : (typeof req.session?.appliedCouponCode === "string" ? req.session.appliedCouponCode.trim() : "");
    if (!couponCode && req.session) {
      req.session.appliedCouponCode = null;
    }
    const userId = req.user._id;

    if (!mongoose.isValidObjectId(addressId)) {
      return res.status(400).json({ success: false, message: "Please select a delivery address." });
    }

    const [address, cart] = await Promise.all([
      Address.findOne({ _id: addressId, user_id: userId }).lean(),
      Cart.findOne({ user_id: userId }).lean(),
    ]);

    if (!address) {
      return res.status(400).json({ success: false, message: "Invalid delivery address." });
    }
    if (!cart?.items?.length) {
      return res.status(400).json({ success: false, message: "Your cart is empty." });
    }

    const [products, variants] = await Promise.all([
      Product.find({ _id: { $in: cart.items.map((item) => item.product_id) } }).lean(),
      Variant.find({ _id: { $in: cart.items.map((item) => item.variant_id) } }).lean(),
    ]);
    const productMap = new Map(products.map((product) => [product._id.toString(), product]));
    const variantMap = new Map(variants.map((variant) => [variant._id.toString(), variant]));
    const offerPricing = await loadOfferPricingMap(products, variants);
    const items = [];

    for (const cartItem of cart.items) {
      const product = productMap.get(cartItem.product_id.toString());
      const variant = variantMap.get(cartItem.variant_id.toString());
      const price = variant && getOfferedUnitPrice(variant, offerPricing.get(variant._id.toString()));

      if (!product || !variant || product.is_blocked || !product.is_listed ||
        variant.product_id.toString() !== product._id.toString() ||
        !Number.isInteger(cartItem.quantity) || cartItem.quantity < 1 ||
        variant.stock_quantity < cartItem.quantity || !Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          success: false,
          message: "Your cart changed or contains an unavailable item. Refresh checkout and try again.",
        });
      }

      items.push({ item_total: price * cartItem.quantity });
    }

    const totals = calculateCartTotals(items);
    const cartItems = cart.items.map((cartItem) => {
      const prod = productMap.get(cartItem.product_id.toString());
      const itemVariant = variantMap.get(cartItem.variant_id.toString());
      const itemOffer = offerPricing.get(cartItem.variant_id.toString());
      const itemPrice = getOfferedUnitPrice(itemVariant, itemOffer);
      return {
        productId: cartItem.product_id.toString(),
        categoryId: prod?.category_id ? prod.category_id.toString() : null,
        quantity: cartItem.quantity,
        itemTotal: itemPrice * cartItem.quantity,
        hasOffer: Boolean(itemOffer?.offer),
      };
    });

    const checkoutDiscounts = await applyCheckoutDiscounts({
      user: req.user,
      subtotal: totals.subtotal,
      couponCode,
      cartItems,
      validateCoupon,
    });
    const amount = Math.max(
      0,
      totals.finalAmount - checkoutDiscounts.couponDiscount - checkoutDiscounts.referralDiscount,
    );
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid order total." });
    }

    const razorpayOrder = await createRazorpayOrder({
      amount,
      receipt: `checkout_${userId.toString().slice(-8)}_${Date.now()}`,
    });

    await Payment.create({
      user_id: userId,
      razorpay_order_id: razorpayOrder.id,
      amount,
      method: "RAZORPAY",
      purpose: "ORDER_CHECKOUT",
      status: "PENDING",
    });

    return res.status(200).json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      },
      prefill: {
        name: address.fullName || req.user.name,
        email: req.user.email,
        contact: address.phone || req.user.phone || "",
      },
    });
  } catch (error) {
    console.error("Create checkout payment order error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Unable to start payment.",
    });
  }
};

export const paymentFailed = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      reason,
    } = req.body;

    if (typeof razorpay_order_id === "string" && razorpay_order_id) {
      await Payment.findOneAndUpdate(
        {
          user_id: req.user._id,
          razorpay_order_id,
          purpose: "ORDER_CHECKOUT",
          status: "PENDING",
        },
        {
          status: "FAILED",
          failure_reason: String(reason || "Payment failed").slice(0, 500),
        },
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Payment failure error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to record payment failure",
    });
  }
};
export const paymentFailedPage = (req, res) =>
  res.status(200).render("user/paymentFailed", {
    orderId: req.query.orderId || "",
  });
