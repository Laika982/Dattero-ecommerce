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
  try {
    const userId = req.user._id;

    const {
      addressId,
      paymentMethod,
    } = req.body;

    // ------------------------------------------------
    // 1. VALIDATE ADDRESS ID
    // ------------------------------------------------

    if (!mongoose.isValidObjectId(addressId)) {
      return res.status(400).json({
        success: false,
        message: "Please select an address",
      });
    }

    // ------------------------------------------------
    // 2. VALIDATE PAYMENT METHOD
    // ------------------------------------------------

    if (paymentMethod !== "cod") {
      return res.status(400).json({
        success: false,
        message:
          "Only Cash on Delivery is available",
      });
    }

    // ------------------------------------------------
    // 3. ADDRESS
    // ------------------------------------------------

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

    // ------------------------------------------------
    // 4. CART
    // ------------------------------------------------

    const cart = await Cart.findOne({
      user_id: userId,
    });

    if (
      !cart ||
      !cart.items ||
      cart.items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty",
      });
    }

    // ------------------------------------------------
    // 5. GET PRODUCT & VARIANT IDS
    // ------------------------------------------------

    const productIds = cart.items.map(
      (item) => item.product_id
    );

    const variantIds = cart.items.map(
      (item) => item.variant_id
    );

    // ------------------------------------------------
    // 6. LOAD PRODUCTS & VARIANTS
    // ------------------------------------------------

    const [products, variants] =
      await Promise.all([
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

    // ------------------------------------------------
    // 7. CREATE MAPS
    // ------------------------------------------------

    const productMap = new Map(
      products.map((product) => [
        product._id.toString(),
        product,
      ])
    );

    const variantMap = new Map(
      variants.map((variant) => [
        variant._id.toString(),
        variant,
      ])
    );

    const orderItems = [];

    // ------------------------------------------------
    // 8. VALIDATE EVERY CART ITEM
    // ------------------------------------------------

    for (const cartItem of cart.items) {
      const product =
        productMap.get(
          cartItem.product_id.toString()
        );

      const variant =
        variantMap.get(
          cartItem.variant_id.toString()
        );

      // Product exists
      if (!product) {
        return res.status(400).json({
          success: false,
          message:
            "Product no longer exists",
        });
      }

      // Variant exists
      if (!variant) {
        return res.status(400).json({
          success: false,
          message:
            "Product variant no longer exists",
        });
      }

      // ------------------------------------------------
      // PRODUCT VALIDATION
      // ------------------------------------------------

      if (product.is_blocked) {
        return res.status(400).json({
          success: false,
          message:
            `${product.productName} is unavailable`,
        });
      }

      if (!product.is_listed) {
        return res.status(400).json({
          success: false,
          message:
            `${product.productName} is no longer available`,
        });
      }

      // ------------------------------------------------
      // QUANTITY VALIDATION
      // ------------------------------------------------

      if (
        !Number.isInteger(
          cartItem.quantity
        ) ||
        cartItem.quantity < 1
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Cart contains an invalid quantity",
        });
      }

      // ------------------------------------------------
      // VARIANT-PRODUCT VALIDATION
      // ------------------------------------------------

      if (
        variant.product_id.toString() !==
        product._id.toString()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid product variant in cart",
        });
      }

      // ------------------------------------------------
      // STOCK VALIDATION
      // ------------------------------------------------

      if (
        variant.stock_quantity <
        cartItem.quantity
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Only ${variant.stock_quantity} ${product.productName} available`,
        });
      }

      // ------------------------------------------------
      // PRICE
      // ------------------------------------------------

      const price =
        calculateItemPrice(variant);

      if (
        price === null ||
        price === undefined ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            `${product.productName} has an invalid price`,
        });
      }

      // ------------------------------------------------
      // ITEM TOTAL
      // ------------------------------------------------

      const itemTotal =
        price * cartItem.quantity;

      // ------------------------------------------------
      // ADD TO ORDER ITEMS
      // ------------------------------------------------

      orderItems.push({
        product_id:
          product._id,

        variant_id:
          variant._id,

        product_name:
          product.productName,

        product_image:
          product.images?.[0]?.url || "",

        sku:
          variant.sku,

        weight:
          variant.weight,

        quantity:
          cartItem.quantity,

        price,

        discount: 0,

        item_total:
          itemTotal,

        status:
          "pending",
      });
    }

    // ------------------------------------------------
    // 9. CALCULATE TOTAL
    // ------------------------------------------------

    const totals =
      calculateCartTotals(
        orderItems
      );

    // ------------------------------------------------
    // 10. REDUCE STOCK
    // ------------------------------------------------

    for (const item of orderItems) {
      await decreaseStock(
        item.variant_id,
        item.quantity
      );
    }

    // ------------------------------------------------
    // 11. GENERATE ORDER ID
    // ------------------------------------------------

    const orderId =
      generateOrderId();

    // ------------------------------------------------
    // 12. CREATE ORDER
    // ------------------------------------------------

    const orderData = {
      order_id:
        orderId,

      user_id:
        userId,

      items:
        orderItems,

      shipping_address: {
        full_name:
          address.fullName,

        phone_number:
          address.phone,

        address:
          [
            address.street,
            address.suite,
          ]
            .filter(Boolean)
            .join(", "),

        company_name:
          "",

        city:
          address.city,

        state:
          address.state,

        zip_code:
          address.zip,

        country:
          address.country,
      },

      subtotal:
        totals.subtotal,

      discount:
        totals.discount,

      tax:
        totals.tax,

      shipping_charge:
        totals.shipping,

      final_amount:
        totals.finalAmount,

      payment_method:
        "cod",

      payment_status:
        "pending",

      order_status:
        "pending",
    };

    const order =
      await Order.create(
        orderData
      );

    // ------------------------------------------------
    // 13. CLEAR CART
    // ------------------------------------------------

    cart.items = [];

    await cart.save();

    // ------------------------------------------------
    // 14. RESPONSE
    // ------------------------------------------------

    return res.status(201).json({
      success: true,

      message:
        "Order placed successfully",

      orderId:
        order.order_id,
    });

  } catch (error) {

    console.error(
      "Place order error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to place order",
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


export default {
  placeOrder,
  loadOrderSuccess,
};
