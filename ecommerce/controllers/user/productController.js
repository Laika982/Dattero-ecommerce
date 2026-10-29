import mongoose from "mongoose";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Category from "../../models/categorySchema.js";
import Wishlist from "../../models/wishlistSchema.js";
import Review from "../../models/reviewSchema.js";
import Order from "../../models/orderSchema.js";
import { getProductOfferPricing } from "../../services/offerService.js";

const loadProducts = async (req, res) => {
  try {
    const { sort = "", page = 1 } = req.query;
    const search = req.query.search?.trim() || "";
    const minPrice = req.query.minPrice?.trim() || "";
    const maxPrice = req.query.maxPrice?.trim() || "";

    let category = req.query.category || [];

    if (!Array.isArray(category)) {
      category = [category];
    }

    const limit = 10;

    const currpage = Number(page) || 1;

    const skip = (currpage - 1) * limit;

    const categories = await Category.find({
      isListed: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    const activeCategoryIds = categories.map((cat) => cat._id);

    let productQuery = {
      is_listed: true,
      category_id: {
        $in: activeCategoryIds,
      },
    };

    if (search.trim()) {
      productQuery.productName = {
        $regex: search.trim(),
        $options: "i",
      };
    }

    if (category.length > 0) {
      const activeCategoryStrIds = new Set(activeCategoryIds.map((id) => id.toString()));
      const validCategoryIds = category.filter((cId) => activeCategoryStrIds.has(cId.toString()));
      productQuery.category_id = {
        $in: validCategoryIds,
      };
    }

    const rawProductsFromDb = await Product.find(productQuery)
      .populate("category_id")
      .lean();

    const productsFromDb = rawProductsFromDb.filter(
      (product) => product.category_id && product.category_id.isListed === true
    );

    //varieant logic
    const productIds = productsFromDb.map((product) => product._id);

    const varients = await Variant.find({
      product_id: {
        $in: productIds,
      },
    }).lean();

    //transform varients based on productId
    const matchVarients = {};

    varients.forEach((product) => {
      const productId = product.product_id.toString();

      if (!matchVarients[productId]) {
        matchVarients[productId] = [];
      }

      matchVarients[productId].push(product);
    });

    const offerPricing = await getProductOfferPricing(productsFromDb, varients);

    //calculate the one product price
    let products = productsFromDb.map((product) => {
      const productId = product._id.toString();

      const productVarient = matchVarients[productId] || [];

      const totalStock = productVarient.reduce(
        (sum, variant) => sum + (Number(variant.stock_quantity) || 0),
        0
      );

      const isOutOfStock = totalStock <= 0;
      const isLowStock = totalStock > 0 && totalStock <= 10;
      const isInStock = totalStock > 10;
      const stockStatus = isOutOfStock
        ? "Out of Stock"
        : isLowStock
        ? "Low Stock"
        : "In Stock";

      const pricedVariants = productVarient
        .map((variant) => {
          const pricing = offerPricing.get(String(variant._id));
          const listPrice = pricing?.price ?? Number(variant.regular_price);
          return Number.isFinite(listPrice)
            ? {
              listPrice,
              originalPrice: pricing?.basePrice ?? Number(variant.regular_price),
              offerPercent: pricing?.discountPercentage || 0,
              offerName: pricing?.offerName || null,
            }
            : null;
        })
        .filter(Boolean);

      if (!pricedVariants.length) {
        return {
          ...product,
          listPrice: null,
          totalStock,
          stockStatus,
          isOutOfStock,
          isLowStock,
          isInStock,
        };
      }

      const cheapest = pricedVariants.reduce((current, variant) =>
        variant.listPrice < current.listPrice ? variant : current,
      );

      return {
        ...product,
        listPrice: cheapest.listPrice,
        originalPrice: cheapest.offerPercent ? cheapest.originalPrice : null,
        offerPercent: cheapest.offerPercent,
        offerName: cheapest.offerName,
        totalStock,
        stockStatus,
        isOutOfStock,
        isLowStock,
        isInStock,
      };
    });

    products = products.filter((product) => product.listPrice !== null);

    //minPrice
    if (minPrice !== undefined && minPrice !== "") {
      const min = Number(minPrice);

      if (!Number.isNaN(min)) {
        products = products.filter((product) => product.listPrice >= min);
      }
    }

    //maxProce

    if (maxPrice !== undefined && maxPrice !== "") {
      const max = Number(maxPrice);

      if (!Number.isNaN(max)) {
        products = products.filter((product) => product.listPrice <= max);
      }
    }

    //sorting

    if (sort === "priceAcc") {
      products.sort((a, b) => {
        return a.listPrice - b.listPrice;
      });
    }
    if (sort === "priceDesc") {
      products.sort((a, b) => {
        return b.listPrice - a.listPrice;
      });
    }

    if (sort === "az") {
      products.sort((a, b) => a.productName.localeCompare(b.productName));
    }

    if (sort === "za") {
      products.sort((a, b) => b.productName.localeCompare(a.productName));
    }

    //total product

    const totalProduct = products.length;

    //total page

    const totalPage = Math.ceil(totalProduct / limit);

    const paginatatedProduct = products.slice(skip, skip + limit);

    const userId = req.user?._id || res.locals?.user?._id;
    let wishlistedProductIds = new Set();

    if (userId) {
      try {
        const userWishlist = await Wishlist.findOne({ user_id: userId }).lean();
        if (userWishlist && Array.isArray(userWishlist.products)) {
          wishlistedProductIds = new Set(
            userWishlist.products.map((item) =>
              (item.product_id?._id || item.product_id).toString()
            )
          );
        }
      } catch (wishlistErr) {
        console.error("Error fetching wishlist in loadProducts:", wishlistErr);
      }
    }

    const paginatedProductsWithWishlist = paginatatedProduct.map((prod) => ({
      ...prod,
      isWishlisted: wishlistedProductIds.has(prod._id.toString()),
    }));

    res.render("user/products", {
      currentNav: "products",
      products: paginatedProductsWithWishlist,
      categories,

      search,
      category,
      minPrice,
      maxPrice,
      sort,

      page,
      totalPage,
      totalProduct,
    });
  } catch (error) {
    console.error("Load products error:", error);

    res.status(500).send("Internal Server Error");
  }
};

const loadProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.isValidObjectId(id)) {
      req.session.error = "Product Not Found";
      return res.redirect("/products");
    }

    const product = await Product.findOne({
      _id: id,
      is_listed: true,
    })
      .populate("category_id")
      .lean();

    if (!product || !product.category_id || product.category_id.isListed === false) {
      req.session.error = "Product Not Found";

      return res.redirect("/products");
    }

    const variants = await Variant.find({
      product_id: product._id,
    }).lean();

    if (!variants.length) {
      req.session.error = "No Varient Found"

      return res.redirect("/products");
    }

    const offerPricing = await getProductOfferPricing([product], variants);

    const variantsWithPrice = variants.map((variant) => {
      const pricing = offerPricing.get(String(variant._id));
      const effectivePrice = pricing?.price ?? (
        variant.sale_price !== null && variant.sale_price !== undefined
          ? Number(variant.sale_price)
          : Number(variant.regular_price)
      );

      return {
        ...variant,
        effectivePrice,
        offerName: pricing?.offerName || null,
        offerPercent: pricing?.discountPercentage || 0,
      };
    });

    const cheapestVariant = variantsWithPrice.reduce((min, variant) => {
      return variant.effectivePrice < min.effectivePrice ? variant : min;
    }, variantsWithPrice[0]);

    const listingPrice = cheapestVariant.effectivePrice;

    const regularPrice = Number(cheapestVariant.regular_price);

    let discountPercentage = 0;

    if (regularPrice > 0 && listingPrice < regularPrice) {
      discountPercentage = Math.round(
        ((regularPrice - listingPrice) / regularPrice) * 100,
      );
    }

    const totalStock = variants.reduce((total, variant) => {
      return total + Number(variant.stock_quantity || 0);
    }, 0);

    const isOutOfStock = totalStock <= 0;

    // =====================================
    // 10. Get reviews
    // =====================================

    const rawReviews = await Review.find({
      product_id: product._id,
    })
      .populate("user_id", "name username email profileImage")
      .sort({ createdAt: -1 })
      .lean();

    const reviews = rawReviews
      .filter((r) => r.user_id)
      .map((r) => {
        const ratingVal = Math.min(Math.max(Math.round(Number(r.rating) || 5), 1), 5);
        return {
          ...r,
          rating: ratingVal,
          stars: [1, 2, 3, 4, 5].map((s) => ({
            filled: s <= ratingVal,
          })),
          formattedDate: r.createdAt
            ? new Date(r.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "",
          userName: r.user_id.name || r.user_id.username || "Verified Customer",
          userProfileImage: r.user_id.profileImage || "/images/avathar.jpg",
        };
      });

    // =====================================
    // 11. Calculate rating & breakdown
    // =====================================

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? (
            reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) /
            totalReviews
          ).toFixed(1)
        : "0.0";

    const avgNum = parseFloat(averageRating);
    const ratingStars = [1, 2, 3, 4, 5].map((i) => {
      if (avgNum >= i) {
        return { filled: true, half: false };
      } else if (avgNum >= i - 0.5) {
        return { filled: true, half: true };
      } else {
        return { filled: false, half: false };
      }
    });

    const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => {
      const count = reviews.filter((r) => r.rating === star).length;
      const percentage = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
      return {
        star,
        count,
        percentage,
      };
    });

    // Check if the current user has already submitted a review
    let userExistingReview = null;
    const loggedInUserId = req.user?._id || res.locals?.user?._id;
    if (loggedInUserId) {
      userExistingReview = reviews.find(
        (r) => r.user_id && r.user_id._id && r.user_id._id.toString() === loggedInUserId.toString()
      ) || null;
    }

    // =====================================
    // 12. Related products
    // =====================================

    let relatedProductsFromDb = [];
    if (product.category_id?._id && product.category_id.isListed === true) {
      relatedProductsFromDb = await Product.find({
        category_id: product.category_id._id,
        _id: { $ne: product._id },
        is_listed: true,
      })
        .populate("category_id")
        .limit(4)
        .lean();
    }

    if (relatedProductsFromDb.length < 4) {
      const activeCategories = await Category.find({ isListed: true }).select("_id").lean();
      const activeCatIds = activeCategories.map((c) => c._id);

      const existingIds = [product._id, ...relatedProductsFromDb.map((p) => p._id)];
      const additionalProducts = await Product.find({
        _id: { $nin: existingIds },
        category_id: { $in: activeCatIds },
        is_listed: true,
      })
        .populate("category_id")
        .limit(4 - relatedProductsFromDb.length)
        .lean();
      relatedProductsFromDb = relatedProductsFromDb.concat(
        additionalProducts.filter((p) => p.category_id && p.category_id.isListed === true)
      );
    }

    const relatedProductIds = relatedProductsFromDb.map((p) => p._id);
    const relatedVariants = await Variant.find({
      product_id: { $in: relatedProductIds },
    }).lean();

    const relatedMatchVariants = {};
    relatedVariants.forEach((v) => {
      const pId = v.product_id.toString();
      if (!relatedMatchVariants[pId]) {
        relatedMatchVariants[pId] = [];
      }
      relatedMatchVariants[pId].push(v);
    });

    const relatedOfferPricing = await getProductOfferPricing(
      relatedProductsFromDb,
      relatedVariants
    );

    const userId = req.user?._id || res.locals?.user?._id;
    let isWishlisted = false;
    let wishlistedProductIds = new Set();

    if (userId) {
      try {
        const userWishlist = await Wishlist.findOne({ user_id: userId }).lean();
        if (userWishlist && Array.isArray(userWishlist.products)) {
          const prodIdStr = product._id.toString();
          isWishlisted = userWishlist.products.some(
            (item) =>
              (item.product_id?._id || item.product_id).toString() === prodIdStr
          );
          wishlistedProductIds = new Set(
            userWishlist.products.map((item) =>
              (item.product_id?._id || item.product_id).toString()
            )
          );
        }
      } catch (wishlistErr) {
        console.error("Error fetching wishlist in loadProduct:", wishlistErr);
      }
    }

    product.isWishlisted = isWishlisted;

    const relatedProducts = relatedProductsFromDb.map((p) => {
      const pId = p._id.toString();
      const pVariants = relatedMatchVariants[pId] || [];

      const totalStock = pVariants.reduce(
        (sum, v) => sum + (Number(v.stock_quantity) || 0),
        0
      );

      const isOutOfStock = totalStock <= 0;
      const isLowStock = totalStock > 0 && totalStock <= 10;
      const isInStock = totalStock > 10;
      const stockStatus = isOutOfStock
        ? "Out of Stock"
        : isLowStock
        ? "Low Stock"
        : "In Stock";

      const pricedVariants = pVariants
        .map((variant) => {
          const pricing = relatedOfferPricing.get(String(variant._id));
          const listPrice = pricing?.price ?? Number(variant.regular_price);
          return Number.isFinite(listPrice)
            ? {
                listPrice,
                originalPrice: pricing?.basePrice ?? Number(variant.regular_price),
                offerPercent: pricing?.discountPercentage || 0,
                offerName: pricing?.offerName || null,
              }
            : null;
        })
        .filter(Boolean);

      const cheapest = pricedVariants.length
        ? pricedVariants.reduce((current, variant) =>
            variant.listPrice < current.listPrice ? variant : current
          )
        : null;

      return {
        ...p,
        listPrice: cheapest ? cheapest.listPrice : null,
        originalPrice: cheapest?.offerPercent ? cheapest.originalPrice : null,
        offerPercent: cheapest?.offerPercent || 0,
        offerName: cheapest?.offerName || null,
        totalStock,
        stockStatus,
        isOutOfStock,
        isLowStock,
        isInStock,
        isWishlisted: wishlistedProductIds.has(pId),
      };
    });

    //Render product detail

    return res.render("user/productDetailPage", {
      currentNav: "products",
      product,
      isWishlisted,

      variants: variantsWithPrice,

      listingPrice,

      regularPrice,

      discountPercentage,

      totalStock,

      isOutOfStock,

      relatedProducts,

      reviews,
      totalReviews,
      averageRating,
      ratingStars,
      ratingBreakdown,
      userExistingReview,
    });
  } catch (error) {
    console.error("Product details error:", error);

    return res.status(500).send("Something went wrong");
  }
};

const submitReview = async (req, res) => {
  try {
    const { id } = req.params;
    const productId = id || req.body.productId;

    const userId = req.user?._id || res.locals?.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "You must be logged in to submit a review.",
        redirectTo: "/login",
      });
    }

    if (!productId || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product identifier.",
      });
    }

    const product = await Product.findOne({ _id: productId, is_listed: true });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    let { rating, title = "", review = "" } = req.body;
    rating = Number(rating);

    if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid rating between 1 and 5 stars.",
      });
    }

    if (!review || !review.trim() || review.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Please provide a review description (at least 3 characters).",
      });
    }

    if (review.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Review description cannot exceed 1000 characters.",
      });
    }

    // Check if the user has a delivered order containing this product (Verified Buyer)
    const hasDeliveredOrder = await Order.exists({
      user_id: userId,
      order_status: "delivered",
      "items.product_id": productId,
    });

    const savedReview = await Review.findOneAndUpdate(
      { product_id: productId, user_id: userId },
      {
        product_id: productId,
        user_id: userId,
        rating: Math.round(rating),
        title: title.trim(),
        review: review.trim(),
        verifiedPurchase: Boolean(hasDeliveredOrder),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Recalculate average rating & review count on the Product
    const allReviews = await Review.find({ product_id: productId });
    const count = allReviews.length;
    const avg =
      count > 0
        ? Math.round((allReviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
        : 0;

    await Product.findByIdAndUpdate(productId, {
      average_rating: avg,
      review_count: count,
    });

    return res.status(200).json({
      success: true,
      message: "Thank you! Your review has been submitted successfully.",
      review: savedReview,
      averageRating: avg.toFixed(1),
      totalReviews: count,
    });
  } catch (error) {
    console.error("Submit review error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to submit your review. Please try again later.",
    });
  }
};

export default {
  loadProducts,
  loadProduct,
  submitReview,
};
