import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Wishlist from "../../models/wishlistSchema.js";
import {
  calculateCartTotals,
  calculateItemPrice,
} from "../../services/pricingService.js";

const MAX_CART_QUANTITY = 5;
//  Load cart
const loadCart = async (req, res) => {
  try {
    const userId = req.user._id;

    const cart = await Cart.findOne({
      user_id: userId,
    });

    if (!cart || !cart.items?.length) {
      return res.render("user/cart", {
        cartItems: [],
        totals: {
          subtotal: 0,
          discount: 0,
          tax: 0,
          shipping: 0,
          finalAmount: 0,
        },
      });
    }

    const productIds = cart.items.map((items) => {
      return items.product_id;
    });

    const variantIds = cart.items.map((items) => {
      return items.variant_id;
    });

    const products = await Product.find({
      _id: { $in: productIds },
    }).lean();

    const variants = await Variant.find({
      _id: { $in: variantIds },
    }).lean();

    const productMap = new Map(
      products.map((item) => [item._id.toString(), item]),
    );

    const variantMap = new Map(
      variants.map((item) => [item._id.toString(), item]),
    );

    const cartItems = [];

    for (const item of cart.items) {
      const product = productMap.get(item.product_id.toString());

      const variant = variantMap.get(item.variant_id.toString());

      if (!product || !variant) {
        continue;
      }

      const price = calculateItemPrice(variant);

      const itemTotal = price * item.quantity;

      let availability = "available";

      if (!product.is_listed) {
        availability = "unlisted";
      }

      if (product.is_blocked) {
        availability = "blocked";
      }

      if (variant.stock_quantity <= 0) {
        availability = "out_of_stock";
      }

      if (variant.stock_quantity < item.quantity) {
        availability = "insufficient_stock";
      }

      cartItems.push({
        cartItemId: item._id,

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

        stock: variant.stock_quantity,

        availability,

        canCheckout: availability === "available",
      });
    }

    const totals = calculateCartTotals(cartItems);

    const hasUnavailableItems = cartItems.some((item) => !item.canCheckout);

    return res.render("user/cart", {
      cartItems,

      totals,

      hasUnavailableItems,
    });
  } catch (error) {
    console.error("Load cart error:", error);

    req.session.error = "Unable to load cart";
    return res.status(500).send("Unable to load cart");
  }
};

//  Add to cart
const addToCart = async (req, res) => {
  try {
    const userId = req.user._id;

    const { productId, variantId, quantity = 1 } = req.query;

    const parsedQuantity = Number(quantity);

    if (
      !productId ||
      !variantId ||
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      req.session.error = "Invalid cart data";
      return res.status(400).json({
        success: false,
        message: "Invalid cart data",
      });
    }

    if (parsedQuantity > MAX_CART_QUANTITY) {
      req.session.error = `Maximum ${MAX_CART_QUANTITY} items allowed`;
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_CART_QUANTITY} items allowed`,
      });
    }

    const product = await Product.findById(productId);

    if (!product) {
      req.session.error = "Product not found";
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!product.is_listed) {
      req.session.error = "This product is unavailable";
      return res.status(400).json({
        success: false,
        message: "This product is unavailable",
      });
    }

    const variant = await Variant.findById(variantId);

    if (!variant) {
      req.session.error = "Variant not found";
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    if (variant.product_id.toString() !== productId.toString()) {
      req.session.error = "Invalid variant for this product";
      return res.status(400).json({
        success: false,
        message: "Invalid variant for this product",
      });
    }

    if (variant.stock_quantity <= 0) {
      req.session.error = "This product is out of stock";
      return res.status(400).json({
        success: false,
        message: "This product is out of stock",
      });
    }

    if (variant.stock_quantity < parsedQuantity) {
      req.session.error = `Only ${variant.stock_quantity} available`;
      return res.status(400).json({
        success: false,
        message: `Only ${variant.stock_quantity} available`,
      });
    }

    let cart = await Cart.findOne({
      user_id: userId,
    });

    if (!cart) {
      cart = new Cart({
        user_id: userId,
        items: [
          {
            product_id: productId,
            variant_id: variantId,
            quantity: parsedQuantity,
          },
        ],
      });

      await cart.save();

      await Wishlist.updateOne(
        {
          user_id: userId,
        },
        {
          $pull: {
            products: productId,
          },
        },
      );

      return res.status(201).json({
        success: true,
        message: "Product added to cart",
        cart,
      });
    }

    const existingItem = cart.items.find(
      (item) => item.variant_id.toString() === variantId.toString(),
    );

    if (existingItem) {
      const newQuantity = existingItem.quantity + parsedQuantity;

      if (newQuantity > MAX_CART_QUANTITY) {
        req.session.error = `Maximum ${MAX_CART_QUANTITY} items allowed`;
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_CART_QUANTITY} items allowed`,
        });
      }

      if (newQuantity > variant.stock_quantity) {
        req.session.error = `Only ${variant.stock_quantity} available`;
        return res.status(400).json({
          success: false,
          message: `Only ${variant.stock_quantity} available`,
        });
      }

      existingItem.quantity = newQuantity;
    } else {
      cart.items.push({
        product_id: productId,
        variant_id: variantId,
        quantity: parsedQuantity,
      });
    }

    await cart.save();

    await Wishlist.updateOne(
      {
        user_id: userId,
      },
      {
        $pull: {
          products: productId,
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "Product added to cart",
      cart,
    });
  } catch (error) {
    console.error("Add cart error:", error);

    req.session.error = "Unable to add product to cart";
    return res.status(500).json({
      success: false,
      message: "Unable to add product to cart",
    });
  }
};

//  Increase quantity

const increaseQuantity = async (req, res) => {
  try {
    const userId = req.user._id;

    const { variantId } = req.params;

    const cart = await Cart.findOne({
      user_id: userId,
    });

    if (!cart) {
      req.session.error = "Cart not found";
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const item = cart.items.find(
      (item) => item.variant_id.toString() === variantId.toString(),
    );

    if (!item) {
      req.session.error = "Cart item not found";
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
      });
    }

    if (item.quantity >= MAX_CART_QUANTITY) {
      req.session.error = `Maximum ${MAX_CART_QUANTITY} items allowed`;
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_CART_QUANTITY} items allowed`,
      });
    }

    const variant = await Variant.findById(variantId);

    if (!variant) {
      req.session.error = "Variant not found";
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    if (variant.stock_quantity <= item.quantity) {
      req.session.error = "No more stock available";
      return res.status(400).json({
        success: false,
        message: "No more stock available",
      });
    }

    item.quantity += 1;

    await cart.save();
    req.session.success = "Cart quantity updated.";

    return res.json({
      success: true,
      message: "Cart quantity updated.",
      quantity: item.quantity,
    });
  } catch (error) {
    console.error("Increase quantity error:", error);

    req.session.error = "Unable to increase quantity";
    return res.status(500).json({
      success: false,
      message: "Unable to increase quantity",
    });
  }
};
//  Decrease quantity

const decreaseQuantity = async (req, res) => {
  try {
    const userId = req.user._id;

    const { variantId } = req.params;

    const cart = await Cart.findOne({
      user_id: userId,
    });

    if (!cart) {
      req.session.error = "Cart not found";
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const item = cart.items.find(
      (item) => item.variant_id.toString() === variantId.toString(),
    );

    if (!item) {
      req.session.error = "Cart item not found";
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
      });
    }

    if (item.quantity <= 1) {
      req.session.error = "Minimum quantity is 1";
      return res.status(400).json({
        success: false,
        message: "Minimum quantity is 1",
      });
    }

    item.quantity -= 1;

    await cart.save();
    req.session.success = "Cart quantity updated.";

    return res.json({
      success: true,
      message: "Cart quantity updated.",
      quantity: item.quantity,
    });
  } catch (error) {
    console.error("Decrease quantity error:", error);

    req.session.error = "Unable to decrease quantity";
    return res.status(500).json({
      success: false,
      message: "Unable to decrease quantity",
    });
  }
};
//  Remove item

const removeFromCart = async (req, res) => {
  try {
    const userId = req.user._id;

    const { variantId } = req.params;

    const cart = await Cart.findOne({
      user_id: userId,
    });

    if (!cart) {
      req.session.error = "Cart not found";
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.items = cart.items.filter(
      (item) => item.variant_id.toString() !== variantId.toString(),
    );

    await cart.save();
    req.session.success = "Item removed from cart.";

    return res.json({
      success: true,
      message: "Item removed from cart.",
    });
  } catch (error) {
    console.error("Remove cart item error:", error);

    req.session.error = "Unable to remove item";
    return res.status(500).json({
      success: false,
      message: "Unable to remove item",
    });
  }
};

export default {
  loadCart,
  addToCart,
  increaseQuantity,
  decreaseQuantity,
  removeFromCart,
};



