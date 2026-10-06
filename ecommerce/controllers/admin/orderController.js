import Order from "../../models/orderSchema.js";
import User from "../../models/userSchema.js";
import { increaseStock } from "../../services/inventoryService.js";

const adminListOrders = async (req, res) => {
  try {
    const { search = "", status = "", sort = "newest" } = req.query;

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
    }

    if (search) {
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

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate("user_id", "username email phone_number")
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean(),

      Order.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalOrders / limit);

    return res.render("admin/orders", {
      orders,

      search,

      status,

      sort,

      currentPage: page,

      totalPages,

      totalOrders,
    });
  } catch (error) {
    console.error("Admin orders error:", error);

    return res.status(500).send("Unable to load admin orders");
  }
};

const adminOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({
      order_id: orderId,
    })
      .populate("user_id", "name email phone")
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    return res.render("admin/orderDetails", {
      order,
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
      .populate("user_id", "name email phone")
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    return res.render("admin/editOrder", { order });
  } catch (error) {
    console.error("Admin edit order error:", error);
    return res.status(500).send("Unable to load order editor");
  }
};

const adminOrderReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ order_id: orderId })
      .populate("user_id", "name email phone")
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    order.items = order.items.map((item) => {
      const returnableQuantity = Math.max(
        item.quantity - (item.returned_quantity || 0),
        0,
      );
      const delivered =
        item.status === "delivered" ||
        (order.order_status === "delivered" && item.status === "pending");

      return {
        ...item,
        returnable_quantity: returnableQuantity,
        is_returnable: delivered && returnableQuantity > 0,
      };
    });

    return res.render("admin/orderReturn", {
      order,
      hasReturnableItems: order.items.some(
        (item) => item.is_returnable,
      ),
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

    for (const requestedItem of requestedItems) {
      const itemId = String(requestedItem.itemId || "");
      const quantity = Number(requestedItem.quantity);
      const reason = String(requestedItem.reason || "").trim();
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
        (order.order_status === "delivered" && item.status === "pending");

      if (
        !delivered ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > returnableQuantity ||
        !reason
      ) {
        return res.status(400).json({
          success: false,
          message: `${item.product_name} is not eligible for the requested return.`,
        });
      }

      itemsToReturn.push({ item, quantity, reason });
    }

    for (const { item, quantity } of itemsToReturn) {
      await increaseStock(item.variant_id, quantity);
    }

    for (const { item, quantity, reason } of itemsToReturn) {
      if (item.status === "pending" && order.order_status === "delivered") {
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
    }

    await order.save();

    return res.json({
      success: true,
      message: "Return processed successfully.",
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
          item.status = "cancelled";
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
    }

    await order.save();

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
