import mongoose from "mongoose";
import Wishlist from "../../models/wishlistSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";

export const getWishlist = async (req, res) => {
  try {
    const userId = req.user._id;

    const wishlist = await Wishlist.findOne({
      user_id: userId,
    })
      .populate({
        path: "products.product_id",
        populate: { path: "category_id" },
      })
      .lean();

    const products = (wishlist?.products || [])
      .map((item) => item.product_id)
      .filter((p) => p && p.is_listed && p.category_id && p.category_id.isListed === true);

    const variants = await Variant.find({
      product_id: { $in: products.map((product) => product._id) },
      stock_quantity: { $gt: 0 },
    }).lean();
    const variantsByProduct = new Map();

    variants.forEach((variant) => {
      const productId = variant.product_id.toString();
      const productVariants = variantsByProduct.get(productId) || [];
      productVariants.push(variant);
      variantsByProduct.set(productId, productVariants);
    });

    products.forEach((product) => {
      const availableVariants = variantsByProduct.get(product._id.toString()) || [];
      availableVariants.sort((left, right) => {
        const leftPrice =
          left.sale_price != null && left.sale_price < left.regular_price
            ? left.sale_price
            : left.regular_price;
        const rightPrice =
          right.sale_price != null && right.sale_price < right.regular_price
            ? right.sale_price
            : right.regular_price;
        return leftPrice - rightPrice;
      });
      product.defaultVariantId = availableVariants[0]?._id.toString() || "";
    });

    return res.render("user/wishlist", { products });
  } catch (error) {
    console.error("Get wishlist error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load wishlist",
    });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      if (
        req.xhr ||
        req.headers["accept"]?.includes("application/json") ||
        req.headers["content-type"]?.includes("application/json") ||
        req.headers["sec-fetch-dest"] === "empty"
      ) {
        return res.status(401).json({
          success: false,
          message: "Please log in to add items to wishlist",
          redirectTo: "/login",
        });
      }
      return res.redirect("/login");
    }

    const userId = req.user._id;
    const { productId } = req.params;

    if (!productId || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await Product.findOne({
      _id: productId,
      is_listed: true,
    }).populate("category_id");

    if (!product || !product.category_id || product.category_id.isListed === false) {
      return res.status(404).json({
        success: false,
        message: "Product unavailable",
      });
    }

    let wishlist = await Wishlist.findOne({
      user_id: userId,
    });

    if (!wishlist) {
      wishlist = await Wishlist.create({
        user_id: userId,
        products: [
          {
            product_id: productId,
          },
        ],
      });
    } else {
      const exists = wishlist.products.some(
        (item) => item.product_id.toString() === productId.toString()
      );

      if (exists) {
        return res.status(400).json({
          success: false,
          message: "Product already in wishlist",
        });
      }

      wishlist.products.push({
        product_id: productId,
      });

      await wishlist.save();
    }

    return res.status(200).json({
      success: true,
      message: "Added to wishlist",
    });
  } catch (error) {
    console.error("Add wishlist error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to add product",
    });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user._id;
    const { productId } = req.params;

    if (!productId || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const wishlist = await Wishlist.findOne({
      user_id: userId,
    });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    wishlist.products = wishlist.products.filter(
      (item) => item.product_id.toString() !== productId.toString()
    );

    await wishlist.save();

    return res.status(200).json({
      success: true,
      message: "Removed from wishlist",
    });
  } catch (error) {
    console.error("Remove wishlist error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to remove product",
    });
  }
};
