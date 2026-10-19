import mongoose from "mongoose";

import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";
import Order from "../../models/orderSchema.js";
import Payment from "../../models/paymentSchema.js";
import Coupon from "../../models/couponSchema.js";

import { generateInvoicePDF } from "../../services/invoiceService.js";

import User from "../../models/userSchema.js";
import {
  calculateItemPrice,
  calculateCartTotals,
  getOfferedUnitPrice,
  loadOfferPricingMap,
  applyCheckoutDiscounts,
} from "../../services/pricingService.js";

import {
  decreaseStock,
  increaseStock,
} from "../../services/inventoryService.js";

import { generateOrderId } from "../../utils/generateOrderId.js";
import { validateCoupon } from "../../services/couponService.js";
import { verifyRazorpaySignature } from "../../services/paymentService.js";
import {
  getOrCreateWallet,
  debitWallet,
  creditWallet,
} from "../../services/walletService.js";
import { processReferralReward } from "../../services/referralService.js";

const getActiveOrderItems = (order) =>
  (order.items || []).filter(
    (item) => !["cancelled", "returned"].includes(item.status),
  );

const getInvoiceItems = (order) =>
  (order.items || []).filter((item) => item.status === "delivered");

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

  try {
    const userId = req.user._id;

    const { addressId, paymentMethod } = req.body;
    const couponCode = typeof req.body.couponCode === "string"
      ? req.body.couponCode.trim()
      : "";

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
    const orderItems = [];
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

    const finalAmount = Math.max(0, totals.finalAmount - discount - referralDiscount);

    if (paymentMethod === "wallet") {
      const userWallet = await getOrCreateWallet(userId);
      if (finalAmount > 0 && userWallet.balance < finalAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Available: ₹${userWallet.balance.toFixed(2)}, Order total: ₹${finalAmount.toFixed(2)}.`,
        });
      }
    }

    let checkoutPayment = null;
    let paymentDetails = null;

    if (paymentMethod === "upi") {
      const {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      } = req.body;

      checkoutPayment = await Payment.findOne({
        user_id: userId,
        razorpay_order_id: razorpayOrderId,
        purpose: "ORDER_CHECKOUT",
        method: "RAZORPAY",
        status: "PENDING",
      });

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

    if (coupon) {
      const reservation = await Coupon.updateOne(
        {
          _id: coupon._id,
          is_active: true,
          expiry_date: { $gt: new Date() },
          used_by: { $ne: userId },
          $or: [
            { usage_limit: null },
            { $expr: { $lt: ["$used_count", "$usage_limit"] } },
          ],
        },
        {
          $inc: { used_count: 1 },
          $addToSet: { used_by: userId },
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

    if (checkoutPayment) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: checkoutPayment._id, status: "PENDING" },
        {
          $set: {
            status: "PROCESSING",
            razorpay_payment_id: paymentDetails.razorpayPaymentId,
            razorpay_signature: paymentDetails.razorpaySignature,
          },
        },
        { new: true },
      );

      if (!claimedPayment) {
        if (couponReservationId) {
          await Coupon.updateOne(
            { _id: couponReservationId, used_by: userId },
            { $inc: { used_count: -1 }, $pull: { used_by: userId } },
          );
          couponReservationId = null;
        }
        return res.status(409).json({
          success: false,
          message: "This payment is already being processed.",
        });
      }

      processingPaymentId = claimedPayment._id;
    }

    for (const item of orderItems) {
      await decreaseStock(item.variant_id, item.quantity);
    }

    const orderId = generateOrderId();

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

      payment_status: ["upi", "wallet"].includes(paymentMethod) ? "paid" : "pending",

      order_status: "pending",
    };

    const order = await Order.create(orderData);
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

    if (processingPaymentId) {
      await Payment.findByIdAndUpdate(processingPaymentId, {
        status: "SUCCESS",
        order_id: order._id,
      });
    }

    couponReservationId = null;

    cart.items = [];

    await cart.save();

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
        await Coupon.updateOne(
          { _id: couponReservationId, used_by: req.user._id },
          {
            $inc: { used_count: -1 },
            $pull: { used_by: req.user._id },
          },
        );
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
      return res.redirect("/orders");
    }

    return res.render("user/orderSuccess", {
      order,
      orderDate: order.createdAt?.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      paymentMethodLabel: order.payment_method.toUpperCase(),
    });
  } catch (error) {
    console.error("Order success error:", error);

    return res.redirect("/orders");
  }
};

const loadOrders = async (req, res) => {
  try {
    const userId = req.user._id;

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

    if (rawStatus === "pending") {
      query.order_status = "pending";
      currentStatus = "pending";
      currentStatusLabel = "Pending";
    } else if (rawStatus === "in_transit" || rawStatus === "in transit" || rawStatus === "shipped" || rawStatus === "out_for_delivery") {
      query.order_status = { $in: ["shipped", "out_for_delivery"] };
      currentStatus = "in_transit";
      currentStatusLabel = "In Transit";
    } else if (rawStatus === "delivered") {
      query.order_status = "delivered";
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
      orders,
      search,
      currentStatus,
      currentStatusLabel,
      isAll: currentStatus === "all",
      isPending: currentStatus === "pending",
      isInTransit: currentStatus === "in_transit",
      isDelivered: currentStatus === "delivered",
      isCancelled: currentStatus === "cancelled",
      isReturned: currentStatus === "returned",
      hasFilter: Boolean(search || currentStatus !== "all"),
      currentPage: page,
      totalPages,
      totalOrders,
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

    return res.render("user/orderDetails", {
      order,
      hasInvoiceItems: getActiveOrderItems(order).length > 0,
    });
  } catch (error) {
    console.error("Order details error:", error);

    return res.status(500).send("Unable to load order");
  }
};

const requestOrderReturn = async (req, res) => {
  try {
    const order = await Order.findOne({
      order_id: req.params.orderId,
      user_id: req.user._id,
    });

    if (!order) {
      req.session.error = "Order not found.";
      return res.redirect("/order/orders");
    }

    if (order.return_request?.status) {
      req.session.error = "A return request has already been submitted for this order.";
      return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
    }

    if (order.order_status !== "delivered") {
      req.session.error = "Only delivered orders can be returned.";
      return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
    }

    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

    if (reason.length < 10 || reason.length > 500) {
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
    return res.redirect(`/order/orders/${encodeURIComponent(order.order_id)}`);
  } catch (error) {
    console.error("Return request error:", error);
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

    return res.render("user/orderTracking", {
      order,
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
      req.session.error = "This order is not available to buy again.";
      return res.redirect("/order/orders");
    }

    if (!order.items?.length) {
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
        req.session.error = `${orderItem.product_name} is currently unavailable.`;
        return res.redirect("/cart");
      }

      if (!variant || variant.product_id.toString() !== productId) {
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
        req.session.error = `Invalid quantity for ${orderItem.product_name}.`;
        return res.redirect("/cart");
      }

      if (resultingQuantity > MAX_CART_QUANTITY) {
        req.session.error = `Maximum ${MAX_CART_QUANTITY} units per product variant are allowed in your cart.`;
        return res.redirect("/cart");
      }

      if (resultingQuantity > variant.stock_quantity) {
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
    return res.redirect("/cart");
  } catch (error) {
    console.error("Buy again error:", error);
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

    if (order.payment_status === "paid") {
      const itemRefundAmount = Number(((item.price - (item.discount || 0)) * item.quantity).toFixed(2));
      if (itemRefundAmount > 0) {
        await creditWallet({
          userId,
          amount: Math.min(itemRefundAmount, order.final_amount),
          reason: "ORDER_CANCELLATION",
          orderId: order._id,
        });
      }
    }

    // Check whether every item is cancelled
    const allCancelled = order.items.every(
      (item) => item.status === "cancelled",
    );

    if (allCancelled) {
      order.order_status = "cancelled";
      if (order.payment_status === "paid") {
        order.payment_status = "refunded";
      }
    }

    // Save order
    await order.save();

    return res.json({
      success: true,
      message: "Product cancelled successfully" + (order.payment_status === "refunded" ? ". Refund credited to wallet." : ""),
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
  requestOrderReturn,
  loadOrderTracking,
  buyAgain,
  cancelOrderItem,
  cancelEntireOrder,
  downloadInvoice,
};
