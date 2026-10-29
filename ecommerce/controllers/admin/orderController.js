import mongoose from "mongoose";
import Order from "../../models/orderSchema.js";
import Coupon from "../../models/couponSchema.js";
import User from "../../models/userSchema.js";
import { increaseStock } from "../../services/inventoryService.js";
import { creditWallet } from "../../services/walletService.js";
import { processReferralReward } from "../../services/referralService.js";
import { evaluateOrderCouponEligibility } from "../../services/couponService.js";
import { calculateOrderShipping } from "../../services/pricingService.js";

const adminListOrders = async (req, res) => {
  try {
    const { search = "", status = "", sort = "newest", userId = "" } = req.query;

    const page = Math.max(Number(req.query.page) || 1, 1);

    const limit = 5;

    const skip = (page - 1) * limit;

    const filter = {};

    if (status) {
      filter.order_status = status;
    }

    let sortOption = {
      createdAt: -1,
    };

    if (sort === "oldest") {
      sortOption = {
        createdAt: 1,
      };
    }

    if (sort === "highest") {
      sortOption = {
        final_amount: -1,
      };
    }

    if (sort === "lowest") {
      sortOption = {
        final_amount: 1,
      };
    }

    let userIds = null;

    if (search) {
      const users = await User.find({
        $or: [
          {
            name: {
              $regex: search,
              $options: "i",
            },
          },
          {
            username: {
              $regex: search,
              $options: "i",
            },
          },
          {
            email: {
              $regex: search,
              $options: "i",
            },
          },
        ],
      }).select("_id");

      userIds = users.map((user) => user._id);

      filter.$or = [
        {
          order_id: {
            $regex: search,
            $options: "i",
          },
        },
      ];

      if (userIds?.length) {
        filter.$or.push({
          user_id: {
            $in: userIds,
          },
        });
      }
    }

    let filteredCustomer = null;
    if (userId && mongoose.isValidObjectId(userId)) {
      filter.user_id = userId;
      filteredCustomer = await User.findById(userId).lean();
    }

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate("user_id", "name username email phone phone_number profileImage")
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean(),

      Order.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalOrders / limit) || 1;
    const startIndex = totalOrders > 0 ? skip + 1 : 0;
    const endIndex = Math.min(skip + limit, totalOrders);

    return res.render("admin/orders", {
      orders,
      search,
      status,
      sort,
      userId,
      filteredCustomer,
      currentPage: page,
      totalPages,
      totalOrders,
      startIndex,
      endIndex,
    });
  } catch (error) {
    console.error("Admin orders error:", error);

    return res.status(500).send("Unable to load admin orders");
  }
};

const calculateOrderAdjustedTotals = async (order) => {
  const nonCancelledItems = (order.items || []).filter(
    (item) => item.status !== "cancelled"
  );

  const cancelledItems = (order.items || []).filter(
    (item) => item.status === "cancelled"
  );

  const cancelledAmount = cancelledItems.reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0
  );

  const activeSubtotal = nonCancelledItems.reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0
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
      console.error("Admin coupon eligibility error in calculateOrderAdjustedTotals:", err);
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

  const statusStyles = {
    pending: {
      badge: "bg-amber-100 text-amber-800 border-amber-300",
      dot: "bg-amber-500",
    },
    shipped: {
      badge: "bg-blue-100 text-blue-800 border-blue-300",
      dot: "bg-blue-500",
    },
    out_for_delivery: {
      badge: "bg-indigo-100 text-indigo-800 border-indigo-300",
      dot: "bg-indigo-500",
    },
    delivered: {
      badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
      dot: "bg-emerald-500",
    },
    cancelled: {
      badge: "bg-rose-100 text-rose-800 border-rose-300",
      dot: "bg-rose-500",
    },
    returned: {
      badge: "bg-purple-100 text-purple-800 border-purple-300",
      dot: "bg-purple-500",
    },
    return_requested: {
      badge: "bg-orange-100 text-orange-800 border-orange-300",
      dot: "bg-orange-500",
    },
  };

  const formattedItems = (order.items || []).map((item) => {
    const style = statusStyles[item.status] || {
      badge: "bg-gray-100 text-gray-800 border-gray-300",
      dot: "bg-gray-500",
    };
    return {
      ...item,
      is_cancelled: item.status === "cancelled",
      statusBadgeClass: style.badge,
      statusDotClass: style.dot,
    };
  });

  const fullSubtotal = (order.items || []).reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0
  );

  return {
    ...order,
    items: formattedItems,
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

const adminOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({
      order_id: orderId,
    })
      .populate("user_id", "name email phone profileImage")
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const adjustedOrder = await calculateOrderAdjustedTotals(order);

    return res.render("admin/orderDetails", {
      order: adjustedOrder,
    });
  } catch (error) {
    console.error("Admin order details error:", error);

    return res.status(500).send("Unable to load order");
  }
};

const adminEditOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ order_id: orderId })
      .populate("user_id", "name email phone profileImage")
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const adjustedOrder = await calculateOrderAdjustedTotals(order);
    adjustedOrder.items = (adjustedOrder.items || []).filter(
      (item) => item.status !== "cancelled" && !item.is_cancelled
    );
    adjustedOrder.subtotal = adjustedOrder.active_subtotal;

    const statusLabels = {
      pending: "Pending",
      shipped: "Shipped",
      out_for_delivery: "Out for delivery",
      delivered: "Delivered",
      return_requested: "Return requested",
      cancelled: "Cancelled",
      returned: "Returned",
    };
    const nextStatuses = (allowedTransitions[order.order_status] || []).map(
      (status) => ({
        value: status,
        label: statusLabels[status],
      }),
    );

    return res.render("admin/editOrder", { order: adjustedOrder, nextStatuses });
  } catch (error) {
    console.error("Admin edit order error:", error);
    return res.status(500).send("Unable to load order editor");
  }
};

const adminOrderReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ order_id: orderId })
      .populate("user_id", "name email phone profileImage")
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const adjustedOrder = await calculateOrderAdjustedTotals(order);

    adjustedOrder.items = adjustedOrder.items.map((item) => {
      const returnableQuantity = Math.max(
        item.quantity - (item.returned_quantity || 0),
        0,
      );
      const orderWasDelivered = ["delivered", "return_requested"].includes(
        order.order_status,
      );
      const delivered =
        item.status === "delivered" ||
        (orderWasDelivered && item.status === "pending");

      const isReturnable = delivered && returnableQuantity > 0 && item.status !== "cancelled";

      return {
        ...item,
        item_total: item.item_total != null ? Number(item.item_total) : Number((item.price * item.quantity).toFixed(2)),
        returnable_quantity: returnableQuantity,
        is_returnable: isReturnable,
      };
    });

    return res.render("admin/orderReturn", {
      order: adjustedOrder,
      hasReturnableItems: adjustedOrder.items.some((item) => item.is_returnable),
    });
  } catch (error) {
    console.error("Admin order return error:", error);
    return res.status(500).send("Unable to load order return page");
  }
};

const processOrderReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const requestedItems = req.body?.items;

    if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Select at least one delivered product to return.",
      });
    }

    const order = await Order.findOne({ order_id: orderId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const seenItemIds = new Set();
    const itemsToReturn = [];
    const orderWasDelivered = ["delivered", "return_requested"].includes(
      order.order_status,
    );

    for (const requestedItem of requestedItems) {
      const itemId = String(requestedItem.itemId || "");
      const item = order.items.id(itemId);

      if (!item || seenItemIds.has(itemId)) {
        return res.status(400).json({
          success: false,
          message: "One or more selected products are invalid.",
        });
      }

      seenItemIds.add(itemId);
      const returnableQuantity = item.quantity - (item.returned_quantity || 0);
      const delivered =
        item.status === "delivered" ||
        (orderWasDelivered && item.status === "pending");

      const parsedQty = Number(requestedItem.quantity);
      const quantity = Number.isInteger(parsedQty) && parsedQty >= 1
        ? parsedQty
        : returnableQuantity;

      const reason = String(requestedItem.reason || "").trim() ||
        String(order.return_request?.reason || "").trim() ||
        "Return approved by admin";

      if (
        !delivered ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > returnableQuantity ||
        item.status === "cancelled"
      ) {
        return res.status(400).json({
          success: false,
          message: `${item.product_name} is not eligible for the requested return.`,
        });
      }

      itemsToReturn.push({ item, quantity, reason });
    }

    const refundAmount = Number(itemsToReturn.reduce(
      (total, { item, quantity }) => total + Number(item.price) * quantity,
      0,
    ).toFixed(2));

    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Unable to calculate a valid refund for the selected items.",
      });
    }

    for (const { item, quantity } of itemsToReturn) {
      await increaseStock(item.variant_id, quantity);
    }

    for (const { item, quantity, reason } of itemsToReturn) {
      if (item.status === "pending" && orderWasDelivered) {
        item.status = "delivered";
      }
      item.returned_quantity = (item.returned_quantity || 0) + quantity;
      item.return_reason = reason;

      if (item.returned_quantity >= item.quantity) {
        item.status = "returned";
      }
    }

    const allItemsClosed = order.items.every(
      (item) => item.status === "cancelled" || item.status === "returned",
    );
    const hasReturnedItems = order.items.some(
      (item) => item.status === "returned",
    );

    if (allItemsClosed && hasReturnedItems) {
      order.order_status = "returned";
    } else if (order.order_status === "return_requested") {
      order.order_status = "delivered";
    }

    if (order.return_request?.status === "pending") {
      order.return_request.status = "processed";
      order.return_request.processed_at = new Date();
    }

    await order.save();
    await creditWallet({
      userId: order.user_id,
      amount: refundAmount,
      reason: "ORDER_RETURN",
      orderId: order._id,
    });

    return res.json({
      success: true,
      message: `Return processed. ₹${refundAmount.toFixed(2)} was credited to the customer's wallet.`,
      refundAmount,
    });
  } catch (error) {
    console.error("Process order return error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process this return. Please try again.",
    });
  }
};

const allowedTransitions = {
  pending: ["shipped", "cancelled"],

  shipped: ["out_for_delivery", "cancelled"],

  out_for_delivery: ["delivered"],

  delivered: [],

  return_requested: [],

  cancelled: [],

  returned: [],
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { status: newStatus } = req.body;

    const validStatuses = [
      "pending",
      "shipped",
      "out_for_delivery",
      "delivered",
      "return_requested",
      "cancelled",
    ];

    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({
        success: false,

        message: "Invalid order status",
      });
    }

    const order = await Order.findOne({
      order_id: orderId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,

        message: "Order not found",
      });
    }

    const currentStatus = order.order_status;

    if (newStatus === currentStatus) {
      return res.json({
        success: true,
        message: "Order status is unchanged",
      });
    }

    if (!allowedTransitions[currentStatus].includes(newStatus)) {
      return res.status(400).json({
        success: false,

        message: `Cannot change status from ${currentStatus} to ${newStatus}`,
      });
    }

    order.order_status = newStatus;

    // If entire order is cancelled
    if (newStatus === "cancelled") {
      for (const item of order.items) {
        if (item.status !== "cancelled") {
          await increaseStock(item.variant_id, item.quantity);
          item.status = "cancelled";
        }
      }

      if (order.payment_status === "paid" && order.final_amount > 0) {
        await creditWallet({
          userId: order.user_id,
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
              (id) => (id?._id || id).toString() === order.user_id.toString(),
            );
            if (idx !== -1) {
              couponDoc.used_by.splice(idx, 1);
            }
            await couponDoc.save();
          }
        } catch (couponRestoreError) {
          console.error("Error restoring coupon on admin order cancellation:", couponRestoreError);
        }
      }
    }

    // Delivered items
    if (newStatus === "delivered") {
      for (const item of order.items) {
        if (item.status === "pending") {
          item.status = "delivered";
        }
      }
      if (order.payment_status === "pending") {
        order.payment_status = "paid";
      }
    }

    await order.save();

    if (order.payment_status === "paid") {
      try {
        const orderCustomer = await User.findById(order.user_id);
        if (orderCustomer?.referredBy) {
          await processReferralReward({ order, user: orderCustomer });
        }
      } catch (rewardErr) {
        console.error("Admin order referral reward error:", rewardErr);
      }
    }

    return res.json({
      success: true,

      message: "Order status updated",
    });
  } catch (error) {
    console.error("Update order status error:", error);

    return res.status(500).json({
      success: false,

      message: "Unable to update order status",
    });
  }
};

export default {
  adminListOrders,
  adminOrderDetails,
  adminEditOrder,
  adminOrderReturn,
  processOrderReturn,
  updateOrderStatus,
};
