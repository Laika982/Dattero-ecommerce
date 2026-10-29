import mongoose from "mongoose";

import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";
import Order from "../../models/orderSchema.js";
import Payment from "../../models/paymentSchema.js";
import Coupon from "../../models/couponSchema.js";
import WalletTransaction from "../../models/walletTransactionSchema.js";
import Review from "../../models/reviewSchema.js";

import { generateInvoicePDF } from "../../services/invoiceService.js";

import User from "../../models/userSchema.js";
import {
  calculateItemPrice,
  calculateCartTotals,
  getOfferedUnitPrice,
  loadOfferPricingMap,
  applyCheckoutDiscounts,
  calculateOrderShipping,
} from "../../services/pricingService.js";

import {
  decreaseStock,
  increaseStock,
} from "../../services/inventoryService.js";

import { generateOrderId } from "../../utils/generateOrderId.js";
import { validateCoupon, evaluateOrderCouponEligibility } from "../../services/couponService.js";
import { verifyRazorpaySignature, createRazorpayOrder } from "../../services/paymentService.js";
import {
  getOrCreateWallet,
  debitWallet,
  creditWallet,
} from "../../services/walletService.js";
import { processReferralReward } from "../../services/referralService.js";
import { isAjaxRequest } from "../../utils/isAjax.js";

const getActiveOrderItems = (order) =>
  (order.items || []).filter(
    (item) => !["cancelled", "returned"].includes(item.status),
  );

const getInvoiceItems = (order) =>
  (order.items || []).filter((item) => item.status === "delivered");

const calculateOrderAdjustedTotals = async (order) => {
  if (!order) return order;

  const nonCancelledItems = (order.items || []).filter(
    (item) => item.status !== "cancelled",
  );

  const cancelledItems = (order.items || []).filter(
    (item) => item.status === "cancelled",
  );

  const cancelledAmount = cancelledItems.reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0,
  );

  const activeSubtotal = nonCancelledItems.reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0,
  );

  const isEntireOrderCancelled =
    order.order_status === "cancelled" || nonCancelledItems.length === 0;

  const hasCancelledItems = cancelledItems.length > 0;

  let activeDiscount = isEntireOrderCancelled ? 0 : Number(order.discount || 0);

  if (!isEntireOrderCancelled && hasCancelledItems && order.coupon_code && activeDiscount > 0) {
    try {
      const couponCheck = await evaluateOrderCouponEligibility(order, nonCancelledItems);
      if (!couponCheck.isEligible) {
        activeDiscount = 0;
      } else {
        activeDiscount = couponCheck.discount;
      }
    } catch (err) {
      console.error("Coupon eligibility error in calculateOrderAdjustedTotals:", err);
    }
  }

  const activeShipping = isEntireOrderCancelled
    ? 0
    : (hasCancelledItems
      ? calculateOrderShipping(activeSubtotal)
      : Number(order.shipping_charge || 0));

  const activeTax = isEntireOrderCancelled
    ? 0
    : Number(order.tax || 0);

  const activeFinalAmount = isEntireOrderCancelled
    ? 0
    : (hasCancelledItems
      ? Number(Math.max(0, activeSubtotal - activeDiscount + activeTax + activeShipping).toFixed(2))
      : Number(order.final_amount || 0));

  const formattedItems = (order.items || []).map((item) => ({
    ...item,
    is_cancelled: item.status === "cancelled",
  }));

  const fullSubtotal = (order.items || []).reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0,
  );

  return {
    ...order,
    items: formattedItems,
    is_payment_failed: order.payment_status === "failed",
    original_subtotal: order.subtotal,
    original_final_amount: order.final_amount,
    active_subtotal: Number(activeSubtotal.toFixed(2)),
    subtotal: Number((order.subtotal != null ? order.subtotal : fullSubtotal).toFixed(2)),
    discount: Number(activeDiscount.toFixed(2)),
    final_amount: Number(activeFinalAmount.toFixed(2)),
    shipping_charge: Number(activeShipping.toFixed(2)),
    tax: Number(activeTax.toFixed(2)),
    cancelled_amount: Number(cancelledAmount.toFixed(2)),
    has_cancelled_items: hasCancelledItems,
  };
};

const MAX_CART_QUANTITY = 5;

const standardTrackingMilestones = [
  {
    status: "pending",
    title: "Order confirmed",
    description: "Your order has been received and is being prepared.",
  },
  {
    status: "shipped",
    title: "Shipped",
    description: "Your order has left our fulfillment center.",
  },
  {
    status: "out_for_delivery",
    title: "Out for delivery",
    description: "Your order is with the delivery partner.",
  },
  {
    status: "delivered",
    title: "Delivered",
    description: "Your order has been delivered.",
  },
];

const returnRequestedMilestone = {
  status: "return_requested",
  title: "Return requested",
  description: "Your return request has been sent for review.",
};

const placeOrder = async (req, res) => {
  let couponReservationId = null;
  let processingPaymentId = null;
  let orderCreated = false;
  let createdOrder = null;
  let walletDebited = false;
  let finalAmount = 0;
  let orderItems = [];

  try {
    const userId = req.user._id;

    const { addressId } = req.body;
    const rawPaymentMethod = String(req.body.paymentMethod || "").toLowerCase().trim();
    const paymentMethod = (rawPaymentMethod === "online" || rawPaymentMethod === "razorpay") ? "upi" : rawPaymentMethod;
    const hasExplicitCouponInBody = typeof req.body.couponCode === "string";
    const couponCode = hasExplicitCouponInBody
      ? req.body.couponCode.trim()
      : (typeof req.session?.appliedCouponCode === "string" ? req.session.appliedCouponCode.trim() : "");

    if (!couponCode && req.session) {
      req.session.appliedCouponCode = null;
    }


    if (!mongoose.isValidObjectId(addressId)) {
      return res.status(400).json({
        success: false,
        message: "Please select an address",
      });
    }

    if (!['cod', 'upi', 'wallet'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    const address = await Address.findOne({
      _id: addressId,
      user_id: userId,
    });

    if (!address) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery address",
      });
    }

    const cart = await Cart.findOne({
      user_id: userId,
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty",
      });
    }

    const productIds = cart.items.map((item) => item.product_id);

    const variantIds = cart.items.map((item) => item.variant_id);

    const [products, variants] = await Promise.all([
      Product.find({
        _id: {
          $in: productIds,
        },
      }).lean(),

      Variant.find({
        _id: {
          $in: variantIds,
        },
      }).lean(),
    ]);

    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    const variantMap = new Map(
      variants.map((variant) => [variant._id.toString(), variant]),
    );

    const offerPricing = await loadOfferPricingMap(products, variants);
    orderItems = [];
    let offerDiscount = 0;

    for (const cartItem of cart.items) {
      const product = productMap.get(cartItem.product_id.toString());

      const variant = variantMap.get(cartItem.variant_id.toString());

      // Product exists
      if (!product) {
        return res.status(400).json({
          success: false,
          message: "Product no longer exists",
        });
      }

      // Variant exists
      if (!variant) {
        return res.status(400).json({
          success: false,
          message: "Product variant no longer exists",
        });
      }

      if (product.is_blocked) {
        return res.status(400).json({
          success: false,
          message: `${product.productName} is unavailable`,
        });
      }

      if (!product.is_listed) {
        return res.status(400).json({
          success: false,
          message: `${product.productName} is no longer available`,
        });
      }

      if (!Number.isInteger(cartItem.quantity) || cartItem.quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Cart contains an invalid quantity",
        });
      }

      if (variant.product_id.toString() !== product._id.toString()) {
        return res.status(400).json({
          success: false,
          message: "Invalid product variant in cart",
        });
      }

      if (variant.stock_quantity < cartItem.quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${variant.stock_quantity} ${product.productName} available`,
        });
      }

      const offer = offerPricing.get(variant._id.toString());
      const price = getOfferedUnitPrice(variant, offer);

      if (
        price === null ||
        price === undefined ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: `${product.productName} has an invalid price`,
        });
      }

      const itemTotal = price * cartItem.quantity;
      offerDiscount += Number(offer?.discount || 0) * cartItem.quantity;

      orderItems.push({
        product_id: product._id,

        variant_id: variant._id,

        product_name: product.productName,

        product_image: product.images?.[0]?.url || "",

        sku: variant.sku,

        weight: variant.weight,

        quantity: cartItem.quantity,

        price,

        discount: 0,

        item_total: itemTotal,

        status: "pending",
      });
    }

    const totals = calculateCartTotals(orderItems);
    let coupon = null;
    let discount = 0;
    let referralDiscount = 0;
    let referralOffer = null;

    const cartItems = cart.items.map((cartItem) => {
      const prod = productMap.get(cartItem.product_id.toString());
      return {
        productId: cartItem.product_id.toString(),
        categoryId: prod?.category_id ? prod.category_id.toString() : null,
        quantity: cartItem.quantity,
      };
    });

    try {
      const checkoutDiscounts = await applyCheckoutDiscounts({
        user: req.user,
        subtotal: totals.subtotal,
        couponCode,
        cartItems,
        validateCoupon,
        excludeOrderId: req.body.retryOrderId,
      });
      coupon = checkoutDiscounts.coupon;
      discount = checkoutDiscounts.couponDiscount;
      referralDiscount = checkoutDiscounts.referralDiscount;
      referralOffer = checkoutDiscounts.referralOffer;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    finalAmount = Math.max(0, totals.finalAmount - discount - referralDiscount);

    if (paymentMethod === "wallet") {
      const userWallet = await getOrCreateWallet(userId);
      if (finalAmount > 0 && userWallet.balance < finalAmount) {
        try {
          await WalletTransaction.create({
            user_id: userId,
            type: "DEBIT",
            amount: finalAmount,
            reason: "ORDER_PAYMENT",
            description: "Order payment failed",
            status: "FAILED",
            failure_reason: `Insufficient wallet balance (Available: ₹${userWallet.balance.toFixed(2)}, Required: ₹${finalAmount.toFixed(2)})`,
            balance_before: Number((userWallet.balance || 0).toFixed(2)),
            balance_after: Number((userWallet.balance || 0).toFixed(2)),
          });
        } catch (txnErr) {
          console.error("Failed to record failed wallet order payment:", txnErr);
        }

        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Available: ₹${userWallet.balance.toFixed(2)}, Order total: ₹${finalAmount.toFixed(2)}.`,
        });
      }
    }

    let checkoutPayment = null;
    let paymentDetails = null;
    const isExplicitlyFailed = req.body.paymentStatus === "failed";

    if (paymentMethod === "upi") {
      const {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      } = req.body;

      if (razorpayOrderId) {
        checkoutPayment = await Payment.findOne({
          user_id: userId,
          razorpay_order_id: razorpayOrderId,
          purpose: "ORDER_CHECKOUT",
          method: "RAZORPAY",
        });
      }

      if (isExplicitlyFailed) {
        if (checkoutPayment) {
          checkoutPayment.status = "FAILED";
          checkoutPayment.failure_reason = req.body.failureReason || "Payment failed";
          await checkoutPayment.save();
        }
      } else {
        if (!checkoutPayment || !razorpayPaymentId || !razorpaySignature) {
          return res.status(400).json({
            success: false,
            message: "Complete UPI payment before placing the order.",
          });
        }

        if (Math.round(Number(checkoutPayment.amount) * 100) !== Math.round(finalAmount * 100)) {
          return res.status(400).json({
            success: false,
            message: "Cart total changed. Reopen checkout and retry payment.",
          });
        }

        const isValidPayment = verifyRazorpaySignature({
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
        });

        if (!isValidPayment) {
          return res.status(400).json({
            success: false,
            message: "UPI payment verification failed.",
          });
        }

        paymentDetails = { razorpayPaymentId, razorpaySignature };
      }
    }

    if (coupon) {
      if (
        coupon.usage_limit !== null &&
        coupon.usage_limit !== undefined &&
        coupon.usage_limit > 0
      ) {
        const orderQuery = {
          user_id: userId,
          coupon_code: coupon.code,
          order_status: { $nin: ["cancelled"] },
          payment_status: { $nin: ["failed"] },
        };
        if (req.body.retryOrderId) {
          orderQuery.order_id = { $ne: req.body.retryOrderId };
        }
        const currentUsage = await Order.countDocuments(orderQuery).catch(() => 0);
        if (currentUsage >= coupon.usage_limit) {
          return res.status(400).json({
            success: false,
            message: `You have reached the usage limit (${coupon.usage_limit} ${coupon.usage_limit === 1 ? "time" : "times"}) for this coupon`,
          });
        }
      }

      if (!isExplicitlyFailed) {
        const reservation = await Coupon.updateOne(
          {
            _id: coupon._id,
            is_active: true,
            expiry_date: { $gt: new Date() },
          },
          {
            $inc: { used_count: 1 },
            $push: { used_by: userId },
          },
        );

        if (reservation.modifiedCount !== 1) {
          return res.status(409).json({
            success: false,
            message: "This coupon is no longer available",
          });
        }

        couponReservationId = coupon._id;
      }
    }

    if (!isExplicitlyFailed && checkoutPayment) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: checkoutPayment._id, status: "PENDING" },
        {
          $set: {
            status: "PROCESSING",
            razorpay_payment_id: paymentDetails?.razorpayPaymentId,
            razorpay_signature: paymentDetails?.razorpaySignature,
          },
        },
        { new: true },
      );

      if (!claimedPayment) {
        if (couponReservationId) {
          try {
            const cDoc = await Coupon.findById(couponReservationId);
            if (cDoc) {
              cDoc.used_count = Math.max(0, (cDoc.used_count || 1) - 1);
              const idx = (cDoc.used_by || []).findIndex(
                (id) => (id?._id || id).toString() === userId.toString(),
              );
              if (idx !== -1) {
                cDoc.used_by.splice(idx, 1);
              }
              await cDoc.save();
            }
          } catch (rErr) {
            console.error("Coupon rollback error:", rErr);
          }
          couponReservationId = null;
        }
        return res.status(409).json({
          success: false,
          message: "This payment is already being processed.",
        });
      }

      processingPaymentId = claimedPayment._id;
    }

    if (!isExplicitlyFailed) {
      for (const item of orderItems) {
        await decreaseStock(item.variant_id, item.quantity);
      }
    }

    const retryOrderId = req.body.retryOrderId;
    let existingFailedOrder = null;
    if (retryOrderId) {
      existingFailedOrder = await Order.findOne({
        order_id: retryOrderId,
        user_id: userId,
        payment_status: "failed",
      });
    }

    const orderId = existingFailedOrder ? existingFailedOrder.order_id : generateOrderId();

    const orderData = {
      order_id: orderId,

      user_id: userId,

      items: orderItems,

      shipping_address: {
        full_name: address.fullName,

        phone_number: address.phone,

        address: [address.street, address.suite].filter(Boolean).join(", "),

        company_name: "",

        city: address.city,

        state: address.state,

        zip_code: address.zip,

        country: address.country,
      },

      subtotal: totals.subtotal,

      discount,
      offer_discount: Number(offerDiscount.toFixed(2)),
      referral_discount: referralDiscount,
      referral_offer_id: referralOffer?._id || null,
      coupon_code: coupon?.code || null,

      tax: totals.tax,

      shipping_charge: totals.shipping,

      final_amount: finalAmount,

      payment_method: paymentMethod,

      payment_status: isExplicitlyFailed
        ? "failed"
        : (["upi", "wallet"].includes(paymentMethod) ? "paid" : "pending"),

      order_status: "pending",
    };

    let order;
    if (existingFailedOrder) {
      Object.assign(existingFailedOrder, orderData);
      existingFailedOrder.order_id = orderId;
      order = await existingFailedOrder.save();
    } else {
      order = await Order.create(orderData);
    }
    createdOrder = order;

    if (paymentMethod === "wallet" && finalAmount > 0) {
      await debitWallet({
        userId,
        amount: finalAmount,
        reason: "ORDER_PAYMENT",
        orderId: order._id,
      });
      walletDebited = true;

      await Payment.create({
        user_id: userId,
        order_id: order._id,
        amount: finalAmount,
        method: "WALLET",
        purpose: "ORDER_CHECKOUT",
        status: "SUCCESS",
      });
    }

    orderCreated = true;

    if (referralDiscount > 0) {
      await User.updateOne(
        { _id: userId, referralOfferUsed: false },
        { $set: { referralOfferUsed: true } },
      );
    }

    if (order.payment_status === "paid" && req.user?.referredBy) {
      try {
        await processReferralReward({ order, user: req.user });
      } catch (rewardErr) {
        console.error("Referral reward error on placeOrder:", rewardErr);
      }
    }

    if (isExplicitlyFailed) {
      if (checkoutPayment) {
        checkoutPayment.order_id = order._id;
        checkoutPayment.status = "FAILED";
        checkoutPayment.failure_reason = req.body.failureReason || "Payment failed";
        await checkoutPayment.save();
      }
    } else {
      if (processingPaymentId) {
        await Payment.findByIdAndUpdate(processingPaymentId, {
          status: "SUCCESS",
          order_id: order._id,
        });
      }
    }

    couponReservationId = null;
    if (req.session) {
      req.session.appliedCouponCode = null;
      req.session.loadedRetryOrderId = null;
    }

    if (!isExplicitlyFailed) {
      cart.items = [];
      await cart.save();
    }

    return res.status(201).json({
      success: true,

      message: "Order placed successfully",

      orderId: order.order_id,
    });
  } catch (error) {
    if (walletDebited) {
      try {
        await creditWallet({
          userId: req.user._id,
          amount: finalAmount,
          reason: "ORDER_CANCELLATION",
          orderId: createdOrder?._id || null,
        });
      } catch (rollbackError) {
        console.error("Wallet debit rollback error:", rollbackError);
      }
    }

    if (createdOrder && !orderCreated) {
      try {
        await Order.findByIdAndDelete(createdOrder._id);
        for (const item of orderItems) {
          await increaseStock(item.variant_id, item.quantity);
        }
      } catch (orderRollbackError) {
        console.error("Order creation rollback error:", orderRollbackError);
      }
    }

    if (couponReservationId) {
      try {
        const cDoc = await Coupon.findById(couponReservationId);
        if (cDoc) {
          cDoc.used_count = Math.max(0, (cDoc.used_count || 1) - 1);
          const idx = (cDoc.used_by || []).findIndex(
            (id) => (id?._id || id).toString() === req.user._id.toString(),
          );
          if (idx !== -1) {
            cDoc.used_by.splice(idx, 1);
          }
          await cDoc.save();
        }
      } catch (rollbackError) {
        console.error("Coupon reservation rollback error:", rollbackError);
      }
    }

    if (processingPaymentId && !orderCreated) {
      await Payment.findByIdAndUpdate(processingPaymentId, {
        status: "PENDING",
      }).catch((paymentError) => {
        console.error("Payment processing rollback error:", paymentError);
      });
    }

    console.error("Place order error:", error);

    return res.status(500).json({
      success: false,

      message: error.message || "Unable to place order",
    });
  }
};

const loadOrderSuccess = async (req, res) => {
  try {
    const userId = req.user._id;

    const { orderId } = req.params;

    const order = await Order.findOne({
      order_id: orderId,
      user_id: userId,
    }).lean();

    if (!order) {
      return res.redirect("/order/orders");
    }

    return res.render("user/orderSuccess", {
      order,
      orderDate: order.createdAt
        ? new Date(order.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "",
      paymentMethodLabel: order.payment_method ? order.payment_method.toUpperCase() : "COD",
    });
  } catch (error) {
    console.error("Order success error:", error);

    return res.redirect("/order/orders");
  }
};

export const ensureFailedCheckoutOrders = async (userId) => {
  try {
    const failedPayments = await Payment.find({
      user_id: userId,
      purpose: "ORDER_CHECKOUT",
      status: "FAILED",
      order_id: null,
    }).sort({ createdAt: 1 });

    if (!failedPayments || failedPayments.length === 0) return;

    let address = await Address.findOne({ user_id: userId, is_default: true }).lean();
    if (!address) {
      address = await Address.findOne({ user_id: userId }).lean();
    }
    const userDoc = await User.findById(userId).lean();

    const shippingAddress = {
      full_name: address?.fullName || userDoc?.name || "Customer",
      phone_number: address?.phone || userDoc?.phone || "0000000000",
      address: [address?.street, address?.suite].filter(Boolean).join(", ") || "Delivery Address",
      company_name: "",
      city: address?.city || "City",
      state: address?.state || "State",
      zip_code: address?.zip || "000000",
      country: address?.country || "India",
    };

    const sampleProduct = await Product.findOne({ is_listed: true }).lean();
    if (!sampleProduct) return;
    const sampleVariant = await Variant.findOne({ product_id: sampleProduct._id, stock_quantity: { $gt: 0 } }).lean()
      || await Variant.findOne({ product_id: sampleProduct._id }).lean();
    if (!sampleVariant) return;

    for (const payment of failedPayments) {
      const existingOrder = await Order.findOne({
        user_id: userId,
        final_amount: payment.amount,
        createdAt: {
          $gte: new Date(payment.createdAt.getTime() - 60000),
          $lte: new Date(payment.createdAt.getTime() + 60000),
        },
      });

      if (existingOrder) {
        payment.order_id = existingOrder._id;
        await payment.save();
        continue;
      }

      const orderId = generateOrderId();
      const sampleItem = {
        product_id: sampleProduct._id,
        variant_id: sampleVariant._id,
        product_name: sampleProduct.productName || "Artisanal Burfi Box",
        product_image: sampleProduct.images?.[0]?.url || "/images/peanut-burfi.png",
        sku: sampleVariant.sku || "NB-BOX-01",
        weight: sampleVariant.weight || "500g",
        quantity: 1,
        price: payment.amount,
        item_total: payment.amount,
        status: "pending",
      };

      const newOrder = await Order.create({
        order_id: orderId,
        user_id: userId,
        items: [sampleItem],
        shipping_address: shippingAddress,
        subtotal: payment.amount,
        discount: 0,
        offer_discount: 0,
        referral_discount: 0,
        tax: 0,
        shipping_charge: 0,
        final_amount: payment.amount,
        payment_method: "upi",
        payment_status: "failed",
        order_status: "pending",
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      });

      payment.order_id = newOrder._id;
      await payment.save();
    }
  } catch (err) {
    console.error("Error ensuring failed checkout orders:", err);
  }
};

const loadOrders = async (req, res) => {
  try {
    const userId = req.user._id;

    await ensureFailedCheckoutOrders(userId);

    const search = req.query.search?.trim() || "";
    const rawStatus = (req.query.status || "all").toString().trim().toLowerCase();

    const page = Math.max(Number(req.query.page) || 1, 1);

    const limit = 5;

    const skip = (page - 1) * limit;

    const query = {
      user_id: userId,
    };

    if (search) {
      query.$or = [
        {
          order_id: {
            $regex: search,
            $options: "i",
          },
        },
        {
          "items.product_name": {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    let currentStatus = "all";
    let currentStatusLabel = "All Orders";

    if (rawStatus === "failed" || rawStatus === "payment_failed") {
      query.payment_status = "failed";
      currentStatus = "failed";
      currentStatusLabel = "Failed";
    } else if (rawStatus === "pending") {
      query.order_status = "pending";
      query.payment_status = { $ne: "failed" };
      currentStatus = "pending";
      currentStatusLabel = "Pending";
    } else if (rawStatus === "in_transit" || rawStatus === "in transit" || rawStatus === "shipped" || rawStatus === "out_for_delivery") {
      query.order_status = { $in: ["shipped", "out_for_delivery"] };
      query.payment_status = { $ne: "failed" };
      currentStatus = "in_transit";
      currentStatusLabel = "In Transit";
    } else if (rawStatus === "delivered") {
      query.order_status = "delivered";
      query.payment_status = { $ne: "failed" };
      currentStatus = "delivered";
      currentStatusLabel = "Delivered";
    } else if (rawStatus === "cancelled") {
      query.order_status = "cancelled";
      currentStatus = "cancelled";
      currentStatusLabel = "Cancelled";
    } else if (rawStatus === "returned" || rawStatus === "return_requested") {
      query.order_status = { $in: ["return_requested", "returned"] };
      currentStatus = "returned";
      currentStatusLabel = "Returned";
    }

    const [orders, totalOrders] = await Promise.all([
      Order.find(query)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Order.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalOrders / limit);

    return res.render("user/orderList", {
      orders: await Promise.all(orders.map(calculateOrderAdjustedTotals)),
      search,
      currentStatus,
      currentStatusLabel,
      isAll: currentStatus === "all",
      isPending: currentStatus === "pending",
      isFailed: currentStatus === "failed",
      isInTransit: currentStatus === "in_transit",
      isDelivered: currentStatus === "delivered",
      isCancelled: currentStatus === "cancelled",
      isReturned: currentStatus === "returned",
      hasFilter: Boolean(search || currentStatus !== "all"),
      currentPage: page,
      totalPages,
      totalOrders,
      razorpayKey: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("List user orders error:", error);

    return res.status(500).send("Unable to load orders");
  }
};

const loadOrderDetails = async (req, res) => {
  try {
    const userId = req.user._id;

    const { orderId } = req.params;

    const order = await Order.findOne({
      order_id: orderId,
      user_id: userId,
    }).lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const adjustedOrder = await calculateOrderAdjustedTotals(order);

    const productIds = (adjustedOrder.items || [])
      .map((it) => it.product_id?._id || it.product_id)
      .filter(Boolean);

    const existingReviews = await Review.find({
      user_id: userId,
      product_id: { $in: productIds },
    }).lean();

    const reviewMap = new Map(
      existingReviews.map((r) => [r.product_id.toString(), r])
    );

    adjustedOrder.items = (adjustedOrder.items || []).map((item) => {
      const pId = (item.product_id?._id || item.product_id)?.toString();
      const existing = pId ? reviewMap.get(pId) : null;
      const isDelivered =
        item.status === "delivered" ||
        (adjustedOrder.order_status === "delivered" && item.status !== "cancelled");

      return {
        ...item,
        productIdString: pId,
        canReview: Boolean(isDelivered),
        existingReview: existing
          ? {
              ...existing,
              rating: existing.rating,
              title: existing.title || "",
              review: existing.review || "",
            }
          : null,
      };
    });

    return res.render("user/orderDetails", {
      order: adjustedOrder,
      hasInvoiceItems: getActiveOrderItems(order).length > 0,
      razorpayKey: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Order details error:", error);

    return res.status(500).send("Unable to load order");
  }
};

const retryOrderPayment = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;

    const order = await Order.findOne({ order_id: orderId, user_id: userId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (order.payment_status !== "failed") {
      return res.status(400).json({ success: false, message: "This order is not in failed payment status." });
    }

    for (const item of order.items) {
      const variant = await Variant.findById(item.variant_id);
      if (!variant || variant.stock_quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Item "${item.product_name}" is currently out of stock. Cannot retry payment.`,
        });
      }
    }

    const razorpayOrder = await createRazorpayOrder({
      amount: order.final_amount,
      receipt: `retry_${order.order_id}_${Date.now()}`.slice(0, 40),
    });

    await Payment.create({
      user_id: userId,
      order_id: order._id,
      razorpay_order_id: razorpayOrder.id,
      amount: order.final_amount,
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
        name: order.shipping_address?.full_name || req.user.name,
        email: req.user.email,
        contact: order.shipping_address?.phone_number || req.user.phone || "",
      },
    });
  } catch (error) {
    console.error("Retry order payment error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Unable to initiate payment retry.",
    });
  }
};

const verifyRetryPayment = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = req.body;

    const order = await Order.findOne({ order_id: orderId, user_id: userId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (order.payment_status !== "failed") {
      return res.status(400).json({ success: false, message: "Order is already paid." });
    }

    const isValidPayment = verifyRazorpaySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!isValidPayment) {
      await Payment.findOneAndUpdate(
        { user_id: userId, razorpay_order_id: razorpayOrderId },
        { status: "FAILED", failure_reason: "Signature verification failed" },
      );
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }

    for (const item of order.items) {
      await decreaseStock(item.variant_id, item.quantity);
    }

    order.payment_status = "paid";
    order.payment_method = "upi";
    await order.save();

    if (order.coupon_code) {
      try {
        await Coupon.updateOne(
          { code: order.coupon_code },
          {
            $inc: { used_count: 1 },
            $push: { used_by: userId },
          },
        );
      } catch (cErr) {
        console.error("Coupon claim error on retry payment:", cErr);
      }
    }

    await Payment.findOneAndUpdate(
      { user_id: userId, razorpay_order_id: razorpayOrderId },
      {
        status: "SUCCESS",
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      },
    );

    if (req.user?.referredBy) {
      try {
        await processReferralReward({ order, user: req.user });
      } catch (rewardErr) {
        console.error("Referral reward error on retry payment:", rewardErr);
      }
    }

    if (req.session) {
      req.session.loadedRetryOrderId = null;
    }

    return res.status(200).json({
      success: true,
      message: "Payment completed successfully!",
      orderId: order.order_id,
    });
  } catch (error) {
    console.error("Verify retry payment error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Unable to verify payment.",
    });
  }
};

const requestOrderReturn = async (req, res) => {
  try {
    const order = await Order.findOne({
      order_id: req.params.orderId,
      user_id: req.user._id,
    });

    if (!order) {
      if (isAjaxRequest(req)) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }
      req.session.error = "Order not found.";
      return res.redirect("/order/orders");
    }

    if (order.return_request?.status) {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "A return request has already been submitted for this order." });
      }
      req.session.error = "A return request has already been submitted for this order.";
      return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
    }

    if (order.order_status !== "delivered") {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Only delivered orders can be returned." });
      }
      req.session.error = "Only delivered orders can be returned.";
      return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
    }

    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

    if (reason.length < 10 || reason.length > 500) {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "Please provide a return reason between 10 and 500 characters." });
      }
      req.session.error = "Please provide a return reason between 10 and 500 characters.";
      return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
    }

    order.return_request = {
      reason,
      status: "pending",
      requested_at: new Date(),
      processed_at: null,
    };
    order.order_status = "return_requested";

    await order.save();
    req.session.success = "Your return request has been submitted.";
    if (isAjaxRequest(req)) {
      return res.status(200).json({
        success: true,
        message: "Your return request has been submitted.",
        redirectTo: `/order/orders/${encodeURIComponent(order.order_id)}`,
      });
    }
    return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
  } catch (error) {
    console.error("Return request error:", error);
    if (isAjaxRequest(req)) {
      return res.status(500).json({ success: false, message: "Unable to submit your return request. Please try again." });
    }
    req.session.error = "Unable to submit your return request. Please try again.";
    return res.redirect(`/order/orders/${encodeURIComponent(req.params.orderId)}`);
  }
};

const loadOrderTracking = async (req, res) => {
  try {
    const order = await Order.findOne({
      order_id: req.params.orderId,
      user_id: req.user._id,
    }).lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const isCancelled = order.order_status === "cancelled";
    const isReturned = order.order_status === "returned";
    const hasReturn =
      order.order_status === "return_requested" ||
      isReturned ||
      Boolean(order.return_request?.status) ||
      (order.items || []).some(
        (item) =>
          item.status === "return_requested" ||
          item.status === "returned" ||
          (item.returned_quantity && item.returned_quantity > 0),
      );
    const isReturnRequested = hasReturn && !isReturned;

    const activeMilestones = [...standardTrackingMilestones];
    if (hasReturn) {
      activeMilestones.push(returnRequestedMilestone);
    }

    const currentIndex = activeMilestones.findIndex(
      (milestone) => milestone.status === order.order_status,
    );

    const trackingSteps = isCancelled
      ? []
      : activeMilestones.map((milestone, index) => ({
        ...milestone,
        state: isReturned || (currentIndex !== -1 && index < currentIndex)
          ? "complete"
          : index === currentIndex
            ? "current"
            : "upcoming",
      }));

    const adjustedOrder = await calculateOrderAdjustedTotals(order);

    return res.render("user/orderTracking", {
      order: adjustedOrder,
      trackingSteps,
      isCancelled,
      isReturned,
      isReturnRequested,
      lastUpdatedAt: order.updatedAt || order.createdAt,
    });
  } catch (error) {
    console.error("Order tracking error:", error);
    return res.status(500).send("Unable to load order tracking");
  }
};

const buyAgain = async (req, res) => {
  try {
    const userId = req.user._id;
    const order = await Order.findOne({
      order_id: req.params.orderId,
      user_id: userId,
    }).lean();

    if (!order || order.order_status !== "delivered") {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "This order is not available to buy again." });
      }
      req.session.error = "This order is not available to buy again.";
      return res.redirect("/order/orders");
    }

    if (!order.items?.length) {
      if (isAjaxRequest(req)) {
        return res.status(400).json({ success: false, message: "This order has no products to add to your cart." });
      }
      req.session.error = "This order has no products to add to your cart.";
      return res.redirect("/cart");
    }

    const [products, variants, cart] = await Promise.all([
      Product.find({ _id: { $in: order.items.map((item) => item.product_id) } }).lean(),
      Variant.find({ _id: { $in: order.items.map((item) => item.variant_id) } }).lean(),
      Cart.findOne({ user_id: userId }),
    ]);

    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );
    const variantMap = new Map(
      variants.map((variant) => [variant._id.toString(), variant]),
    );
    const itemsToAdd = new Map();

    for (const orderItem of order.items) {
      const productId = orderItem.product_id.toString();
      const variantId = orderItem.variant_id.toString();
      const product = productMap.get(productId);
      const variant = variantMap.get(variantId);

      if (!product || !product.is_listed || product.is_blocked) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: `${orderItem.product_name} is currently unavailable.` });
        }
        req.session.error = `${orderItem.product_name} is currently unavailable.`;
        return res.redirect("/cart");
      }

      if (!variant || variant.product_id.toString() !== productId) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: `A variant for ${orderItem.product_name} is no longer available.` });
        }
        req.session.error = `A variant for ${orderItem.product_name} is no longer available.`;
        return res.redirect("/cart");
      }

      const itemQuantity = Number(orderItem.quantity);
      const quantityToAdd = (itemsToAdd.get(variantId)?.quantity || 0) + itemQuantity;
      const currentCartQuantity = cart?.items.find(
        (item) => item.variant_id.toString() === variantId,
      )?.quantity || 0;
      const resultingQuantity = currentCartQuantity + quantityToAdd;

      if (!Number.isInteger(itemQuantity) || itemQuantity < 1) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: `Invalid quantity for ${orderItem.product_name}.` });
        }
        req.session.error = `Invalid quantity for ${orderItem.product_name}.`;
        return res.redirect("/cart");
      }

      if (resultingQuantity > MAX_CART_QUANTITY) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: `Maximum ${MAX_CART_QUANTITY} units per product variant are allowed in your cart.` });
        }
        req.session.error = `Maximum ${MAX_CART_QUANTITY} units per product variant are allowed in your cart.`;
        return res.redirect("/cart");
      }

      if (resultingQuantity > variant.stock_quantity) {
        if (isAjaxRequest(req)) {
          return res.status(400).json({ success: false, message: `Only ${variant.stock_quantity} units of ${orderItem.product_name} are currently available.` });
        }
        req.session.error = `Only ${variant.stock_quantity} units of ${orderItem.product_name} are currently available.`;
        return res.redirect("/cart");
      }

      const existingPendingItem = itemsToAdd.get(variantId);
      if (existingPendingItem) {
        existingPendingItem.quantity = quantityToAdd;
      } else {
        itemsToAdd.set(variantId, {
          productId,
          quantity: quantityToAdd,
        });
      }
    }

    const targetCart = cart || new Cart({ user_id: userId, items: [] });

    for (const [variantId, itemToAdd] of itemsToAdd) {
      const cartItem = targetCart.items.find(
        (item) => item.variant_id.toString() === variantId,
      );

      if (cartItem) {
        cartItem.quantity += itemToAdd.quantity;
      } else {
        targetCart.items.push({
          product_id: itemToAdd.productId,
          variant_id: variantId,
          quantity: itemToAdd.quantity,
        });
      }
    }

    await targetCart.save();
    req.session.success = "Products from your previous order were added to your cart.";
    if (isAjaxRequest(req)) {
      return res.status(200).json({
        success: true,
        message: "Products from your previous order were added to your cart.",
        redirectTo: "/cart",
      });
    }
    return res.redirect("/cart");
  } catch (error) {
    console.error("Buy again error:", error);
    if (isAjaxRequest(req)) {
      return res.status(500).json({ success: false, message: "Unable to add the previous order to your cart. Please try again." });
    }
    req.session.error = "Unable to add the previous order to your cart. Please try again.";
    return res.redirect("/cart");
  }
};

const cancelOrderItem = async (req, res) => {
  try {
    const userId = req.user._id;

    const { orderId, itemId } = req.params;

    const { reason = "" } = req.body;

    // Find user's order
    const order = await Order.findOne({
      order_id: orderId,
      user_id: userId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Find item inside order
    const item = order.items.id(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Order item not found",
      });
    }

    // Only pending items can be cancelled
    if (item.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "This item cannot be cancelled",
      });
    }

    // Increase stock
    await increaseStock(item.variant_id, item.quantity);

    // Update item
    item.status = "cancelled";
    item.cancellation_reason = reason || null;

    const nonCancelledItems = (order.items || []).filter(
      (i) => i.status !== "cancelled",
    );
    const allCancelled = nonCancelledItems.length === 0;

    const previousFinalAmount = Number(order.final_amount || 0);

    let newDiscount = 0;
    let newShippingCharge = 0;
    let newFinalAmount = 0;
    let isCouponRemoved = false;

    if (allCancelled) {
      order.order_status = "cancelled";
      newDiscount = 0;
      newShippingCharge = 0;
      newFinalAmount = 0;

      if (order.coupon_code) {
        try {
          const couponDoc = await Coupon.findOne({ code: order.coupon_code });
          if (couponDoc) {
            couponDoc.used_count = Math.max(0, (couponDoc.used_count || 1) - 1);
            const idx = (couponDoc.used_by || []).findIndex(
              (id) => (id?._id || id).toString() === userId.toString(),
            );
            if (idx !== -1) {
              couponDoc.used_by.splice(idx, 1);
            }
            await couponDoc.save();
          }
        } catch (couponRestoreError) {
          console.error("Error restoring coupon on item cancellation:", couponRestoreError);
        }
      }
    } else {
      const activeSubtotal = nonCancelledItems.reduce(
        (acc, i) =>
          acc + Number(i.item_total != null ? i.item_total : (i.price * i.quantity) || 0),
        0,
      );

      // Check coupon validity on remaining active items
      const couponCheck = await evaluateOrderCouponEligibility(order, nonCancelledItems);
      if (couponCheck.isEligible) {
        newDiscount = couponCheck.discount;
      } else {
        newDiscount = 0;
        if (order.discount > 0 && order.coupon_code) {
          isCouponRemoved = true;
          try {
            const couponDoc = await Coupon.findOne({ code: order.coupon_code });
            if (couponDoc) {
              couponDoc.used_count = Math.max(0, (couponDoc.used_count || 1) - 1);
              const idx = (couponDoc.used_by || []).findIndex(
                (id) => (id?._id || id).toString() === userId.toString(),
              );
              if (idx !== -1) {
                couponDoc.used_by.splice(idx, 1);
              }
              await couponDoc.save();
            }
          } catch (couponRestoreError) {
            console.error("Error restoring coupon usage on coupon removal:", couponRestoreError);
          }
        }
      }

      // Check shipping charge: if activeSubtotal < 1000, add 50, otherwise 0
      newShippingCharge = calculateOrderShipping(activeSubtotal);

      const activeTax = Number(order.tax || 0);
      newFinalAmount = Number(
        Math.max(0, activeSubtotal - newDiscount + activeTax + newShippingCharge).toFixed(2),
      );
    }

    let refundAmount = 0;
    if (order.payment_status === "paid") {
      refundAmount = Number(
        Math.max(0, previousFinalAmount - newFinalAmount).toFixed(2),
      );
      if (refundAmount > 0) {
        await creditWallet({
          userId,
          amount: refundAmount,
          reason: "ORDER_CANCELLATION",
          orderId: order._id,
        });
      }

      if (allCancelled) {
        order.payment_status = "refunded";
      }
    }

    order.discount = newDiscount;
    order.shipping_charge = newShippingCharge;
    order.final_amount = newFinalAmount;

    // Save order
    await order.save();

    let message = "Product cancelled successfully.";
    if (allCancelled) {
      message = "All items cancelled successfully." + (order.payment_status === "refunded" ? " Refund credited to wallet." : "");
    } else {
      const extraNotes = [];
      if (isCouponRemoved) {
        extraNotes.push("Coupon discount removed");
      }
      if (newShippingCharge > 0 && order.shipping_charge === 0) {
        extraNotes.push("₹50 shipping charge applied");
      }
      if (refundAmount > 0) {
        extraNotes.push(`₹${refundAmount.toFixed(2)} refunded to wallet`);
      }
      if (extraNotes.length > 0) {
        message += ` (${extraNotes.join(", ")})`;
      }
    }

    return res.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("Cancel item error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to cancel item",
    });
  }
};

const cancelEntireOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const { reason = "" } = req.body;

    const order = await Order.findOne({
      order_id: orderId,
      user_id: userId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.order_status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "This order cannot be cancelled",
      });
    }

    for (const item of order.items) {
      // Already cancelled item
      if (item.status === "cancelled") {
        continue;
      }

      // Restore stock
      await increaseStock(item.variant_id, item.quantity);

      // Cancel item
      item.status = "cancelled";

      item.cancellation_reason = reason || null;
    }

    // Cancel entire order
    order.order_status = "cancelled";

    if (order.payment_status === "paid" && order.final_amount > 0) {
      await creditWallet({
        userId,
        amount: order.final_amount,
        reason: "ORDER_CANCELLATION",
        orderId: order._id,
      });
      order.payment_status = "refunded";
    }

    order.discount = 0;
    order.shipping_charge = 0;
    order.final_amount = 0;

    if (order.coupon_code) {
      try {
        const couponDoc = await Coupon.findOne({ code: order.coupon_code });
        if (couponDoc) {
          couponDoc.used_count = Math.max(0, (couponDoc.used_count || 1) - 1);
          const idx = (couponDoc.used_by || []).findIndex(
            (id) => (id?._id || id).toString() === userId.toString(),
          );
          if (idx !== -1) {
            couponDoc.used_by.splice(idx, 1);
          }
          await couponDoc.save();
        }
      } catch (couponRestoreError) {
        console.error("Error restoring coupon on entire order cancellation:", couponRestoreError);
      }
    }

    await order.save();

    return res.json({
      success: true,
      message: "Order cancelled successfully" + (order.payment_status === "refunded" ? ". Refund credited to wallet." : ""),
    });
  } catch (error) {
    console.error("Cancel order error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to cancel order",
    });
  }
};

const downloadInvoice = async (req, res) => {
  try {
    const userId = req.user._id;

    const { orderId } = req.params;

    const order = await Order.findOne({
      order_id: orderId,
      user_id: userId,
    }).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const invoiceItems = getInvoiceItems(order);

    if (invoiceItems.length === 0) {
      const currentStatus = order.order_status
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      return res.status(409).json({
        success: false,
        message: `Invoices are available only for delivered products. Current order status: ${currentStatus}.`,
      });
    }

    const totals = calculateCartTotals(invoiceItems);

    generateInvoicePDF(
      {
        ...order,
        items: invoiceItems,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        shipping_charge: totals.shipping,
        final_amount: totals.finalAmount,
      },
      res,
    );
  } catch (error) {
    console.error("Invoice error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate invoice",
    });
  }
};
export default {
  placeOrder,
  loadOrderSuccess,
  loadOrders,
  loadOrderDetails,
  retryOrderPayment,
  verifyRetryPayment,
  ensureFailedCheckoutOrders,
  requestOrderReturn,
  loadOrderTracking,
  buyAgain,
  cancelOrderItem,
  cancelEntireOrder,
  downloadInvoice,
};
