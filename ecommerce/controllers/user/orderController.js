import mongoose from "mongoose";

import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";
import Order from "../../models/orderSchema.js";

import { generateInvoicePDF } from "../../services/invoiceService.js";

import {
  calculateItemPrice,
  calculateCartTotals,
} from "../../services/pricingService.js";

import {
  decreaseStock,
  increaseStock,
} from "../../services/inventoryService.js";

import { generateOrderId } from "../../utils/generateOrderId.js";

const getActiveOrderItems = (order) =>
  (order.items || []).filter(
    (item) => !["cancelled", "returned"].includes(item.status),
  );

const getInvoiceItems = (order) =>
  (order.items || []).filter((item) => item.status === "delivered");

const placeOrder = async (req, res) => {
  try {
    const userId = req.user._id;

    const { addressId, paymentMethod } = req.body;

    if (!mongoose.isValidObjectId(addressId)) {
      return res.status(400).json({
        success: false,
        message: "Please select an address",
      });
    }

    if (paymentMethod !== "cod") {
      return res.status(400).json({
        success: false,
        message: "Only Cash on Delivery is available",
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

    const orderItems = [];

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

      const price = calculateItemPrice(variant);

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

      discount: totals.discount,

      tax: totals.tax,

      shipping_charge: totals.shipping,

      final_amount: totals.finalAmount,

      payment_method: "cod",

      payment_status: "pending",

      order_status: "pending",
    };

    const order = await Order.create(orderData);

    cart.items = [];

    await cart.save();

    return res.status(201).json({
      success: true,

      message: "Order placed successfully",

      orderId: order.order_id,
    });
  } catch (error) {
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
    console.log(search);

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

    // Check whether every item is cancelled
    const allCancelled = order.items.every(
      (item) => item.status === "cancelled",
    );

    if (allCancelled) {
      order.order_status = "cancelled";
    }

    // Save order
    await order.save();

    return res.json({
      success: true,
      message: "Product cancelled successfully",
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

    await order.save();

    return res.json({
      success: true,
      message: "Order cancelled successfully",
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
  cancelOrderItem,
  cancelEntireOrder,
  downloadInvoice,
};
