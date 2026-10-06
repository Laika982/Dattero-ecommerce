import mongoose from "mongoose";

import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";
import Order from "../../models/orderSchema.js";

import {
  calculateItemPrice,
  calculateCartTotals,
} from "../../services/pricingService.js";

import { decreaseStock } from "../../services/inventoryService.js";

import { generateOrderId } from "../../utils/generateOrderId.js";

const placeOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const userId = req.user._id;

    const { addressId, paymentMethod } = req.body;

    if (!addressId) {
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

    session.startTransaction();

    // ------------------------------------------------
    // 1. ADDRESS
    // ------------------------------------------------

    const address = await Address.findOne({
      _id: addressId,
      user_id: userId,
    }).session(session);

    if (!address) {
      throw new Error("Invalid delivery address");
    }

    // ------------------------------------------------
    // 2. CART
    // ------------------------------------------------

    const cart = await Cart.findOne({
      user_id: userId,
    }).session(session);

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new Error("Your cart is empty");
    }

    const productIds = cart.items.map((item) => item.product_id);

    const variantIds = cart.items.map((item) => item.variant_id);

    // ------------------------------------------------
    // 3. PRODUCTS
    // ------------------------------------------------

    const products = await Product.find({
      _id: {
        $in: productIds,
      },
    }).session(session);

    const variants = await Variant.find({
      _id: {
        $in: variantIds,
      },
    }).session(session);

    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    const variantMap = new Map(
      variants.map((variant) => [variant._id.toString(), variant]),
    );

    const orderItems = [];

    // ------------------------------------------------
    // 4. VALIDATE EVERY CART ITEM
    // ------------------------------------------------

    for (const cartItem of cart.items) {
      const product = productMap.get(cartItem.product_id.toString());

      const variant = variantMap.get(cartItem.variant_id.toString());

      if (!product) {
        throw new Error("Product no longer exists");
      }

      if (!variant) {
        throw new Error("Product variant no longer exists");
      }

      // Product validation

      if (product.is_blocked) {
        throw new Error(`${product.productName} is unavailable`);
      }

      if (!product.is_listed) {
        throw new Error(`${product.productName} is no longer available`);
      }

      // Stock validation

      if (variant.stock_quantity < cartItem.quantity) {
        throw new Error(
          `Only ${variant.stock_quantity} ${product.productName} available`,
        );
      }

      // Price

      const price = calculateItemPrice(variant);

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

    // ------------------------------------------------
    // 5. CALCULATE TOTAL
    // ------------------------------------------------

    const totals = calculateCartTotals(orderItems);

    // ------------------------------------------------
    // 6. REDUCE STOCK
    // ------------------------------------------------

    for (const item of orderItems) {
      await decreaseStock(item.variant_id, item.quantity, session);
    }

    // ------------------------------------------------
    // 7. CREATE ORDER
    // ------------------------------------------------

    const orderId = generateOrderId();

    const orderData = {
      order_id: orderId,

      user_id: userId,

      items: orderItems,

      shipping_address: {
        full_name: address.full_name,

        phone_number: address.phone_number,

        address: address.address,

        company_name: address.company_name || "",

        city: address.city,

        state: address.state,

        zip_code: address.zip_code,

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

    const [order] = await Order.create([orderData], {
      session,
    });

    // ------------------------------------------------
    // 8. CLEAR CART
    // ------------------------------------------------

    cart.items = [];

    await cart.save({
      session,
    });

    // ------------------------------------------------
    // 9. COMMIT
    // ------------------------------------------------

    await session.commitTransaction();

    return res.status(201).json({
      success: true,

      message: "Order placed successfully",

      orderId: order.order_id,
    });
  } catch (error) {
    await session.abortTransaction();

    console.error("Place order error:", error);

    return res.status(400).json({
      success: false,

      message: error.message || "Unable to place order",
    });
  } finally {
    session.endSession();
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
    });
  } catch (error) {
    console.error("Order success error:", error);

    return res.redirect("/orders");
  }
};

export default {
  placeOrder,
  loadOrderSuccess,
};
