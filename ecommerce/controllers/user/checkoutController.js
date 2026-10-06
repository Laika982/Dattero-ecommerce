import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";

import {
  calculateItemPrice,
  calculateCartTotals,
} from "../../services/pricingService.js";

export const loadCheckout = async (req, res) => {
  try {
    const userId = req.user._id;

    const cart = await Cart.findOne({
      user_id: userId,
    }).lean();

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.redirect("/cart");
    }

    const productIds = cart.items.map((item) => item.product_id);

    const variantIds = cart.items.map((item) => item.variant_id);

    const [products, variants, addresses] = await Promise.all([
      Product.find({
        _id: { $in: productIds },
      }).lean(),

      Variant.find({
        _id: { $in: variantIds },
      }).lean(),

      Address.find({
        user_id: userId,
      })
        .sort({
          is_default: -1,
          created_at: -1,
        })
        .lean(),
    ]);

    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    const variantMap = new Map(
      variants.map((variant) => [variant._id.toString(), variant]),
    );

    const checkoutItems = [];

    for (const item of cart.items) {
      const product = productMap.get(item.product_id.toString());

      const variant = variantMap.get(item.variant_id.toString());

      if (!product || !variant) {
        return res.redirect("/cart");
      }

      if (product.is_listed !== true || product.is_blocked === true) {
        return res.redirect("/cart");
      }

      if (!item.quantity || item.quantity <= 0) {
        return res.redirect("/cart");
      }

      if (variant.stock_quantity < item.quantity) {
        return res.redirect("/cart");
      }

      const price = calculateItemPrice(variant);

      if (price === null || price === undefined || price <= 0) {
        return res.redirect("/cart");
      }

      const itemTotal = price * item.quantity;

      checkoutItems.push({
        productId: product._id,
        variantId: variant._id,

        productName: product.productName,

        image: product.images?.[0]?.url || "",

        sku: variant.sku,

        weight: variant.weight,

        quantity: item.quantity,

        price,

        itemTotal,
        item_total: itemTotal,
      });
    }

    const totals = calculateCartTotals(checkoutItems);

    const selectedAddress =
      addresses.find((address) => address.is_default === true) ||
      addresses[0] ||
      null;

    return res.render("user/checkout", {
      checkoutItems,
      addresses,
      selectedAddress,
      totals,
    });
  } catch (error) {
    console.error("Checkout load error:", error);

    return res.status(500).render("user/checkout", {
      checkoutItems: [],
      addresses: [],
      selectedAddress: null,
      totals: null,
      error: "Unable to load checkout",
    });
  }
};

const getUserAddresses = async (req, res) => {
  try {
    const userId = req.user._id;
    const addresses = await Address.find({ user_id: userId })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      addresses,
    });
  } catch (error) {
    console.error("Get addresses error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch addresses",
    });
  }
};

export default {
  loadCheckout,
  getUserAddresses,
};
