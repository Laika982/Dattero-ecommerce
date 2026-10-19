import Coupon from "../models/couponSchema.js";
import Cart from "../models/cartSchema.js";
import Product from "../models/productSchema.js";

export const evaluateCouponEligibility = (
  coupon,
  { subtotal = 0, cartItems = [], userId = null, now = new Date() } = {},
) => {
  if (!coupon) {
    return { eligible: false, reason: "Invalid coupon" };
  }

  if (coupon.is_active === false) {
    return { eligible: false, reason: "This coupon is inactive." };
  }

  const currentDate = new Date(now);
  if (coupon.start_date && currentDate < new Date(coupon.start_date)) {
    return { eligible: false, reason: "This coupon is not active yet." };
  }

  if (coupon.expiry_date && currentDate > new Date(coupon.expiry_date)) {
    return { eligible: false, reason: "This coupon has expired." };
  }

  if (
    coupon.usage_limit !== null &&
    coupon.usage_limit !== undefined &&
    coupon.used_count >= coupon.usage_limit
  ) {
    return { eligible: false, reason: "Coupon usage limit reached" };
  }

  if (userId && Array.isArray(coupon.used_by)) {
    const alreadyUsed = coupon.used_by.some(
      (id) =>
        (id?._id ? id._id.toString() : id?.toString()) === userId.toString(),
    );
    if (alreadyUsed) {
      return { eligible: false, reason: "You have already used this coupon" };
    }
  }

  const appliesTo =
    coupon.applies_to ||
    (coupon.product_id ? "PRODUCT" : coupon.category_id ? "CATEGORY" : "ALL");

  if (appliesTo === "PRODUCT") {
    const targetProductId = coupon.product_id?._id
      ? coupon.product_id._id.toString()
      : coupon.product_id?.toString();

    if (!targetProductId) {
      return {
        eligible: false,
        reason: "Add an eligible product to your cart.",
      };
    }

    const hasProduct = (cartItems || []).some((item) => {
      const pid = item.productId?._id
        ? item.productId._id.toString()
        : item.productId?.toString() || item.product_id?.toString();
      return pid === targetProductId;
    });

    if (!hasProduct) {
      return {
        eligible: false,
        reason: "Add an eligible product to your cart.",
      };
    }
  } else if (appliesTo === "CATEGORY") {
    const targetCategoryId = coupon.category_id?._id
      ? coupon.category_id._id.toString()
      : coupon.category_id?.toString();

    if (!targetCategoryId) {
      return {
        eligible: false,
        reason: "Add products from the selected category to use this coupon.",
      };
    }

    const hasCategory = (cartItems || []).some((item) => {
      const cid = item.categoryId?._id
        ? item.categoryId._id.toString()
        : item.categoryId?.toString() || item.category_id?.toString();
      return cid === targetCategoryId;
    });

    if (!hasCategory) {
      return {
        eligible: false,
        reason: "Add products from the selected category to use this coupon.",
      };
    }
  }

  const minPurchase = Number(coupon.minimum_purchase || 0);
  if (Number(subtotal || 0) < minPurchase) {
    return { eligible: false, reason: "Minimum purchase amount not reached." };
  }

  return { eligible: true, reason: null };
};

export const validateCoupon = async ({ code, userId, subtotal, cartItems }) => {
  if (!code) {
    throw new Error("Coupon code is required");
  }

  const coupon = await Coupon.findOne({
    code: code.trim().toUpperCase(),
    is_active: true,
  })
    .populate("category_id")
    .populate("product_id");

  if (!coupon) {
    throw new Error("Invalid coupon");
  }

  let items = cartItems;
  if (!items && userId) {
    const cart = await Cart.findOne({ user_id: userId }).lean();
    if (cart?.items?.length) {
      const products = await Product.find({
        _id: { $in: cart.items.map((i) => i.product_id) },
      }).lean();
      const productMap = new Map(products.map((p) => [p._id.toString(), p]));
      items = cart.items.map((i) => ({
        productId: i.product_id.toString(),
        categoryId:
          productMap.get(i.product_id.toString())?.category_id?.toString() ||
          null,
        quantity: i.quantity,
      }));
    } else {
      items = [];
    }
  }

  const eligibility = evaluateCouponEligibility(coupon, {
    subtotal,
    cartItems: items || [],
    userId,
  });

  if (!eligibility.eligible) {
    throw new Error(eligibility.reason);
  }

  let discount = 0;

  if (coupon.discount_type === "PERCENTAGE") {
    discount = (subtotal * coupon.discount_value) / 100;

    if (
      coupon.max_discount !== null &&
      coupon.max_discount !== undefined &&
      coupon.max_discount > 0 &&
      discount > coupon.max_discount
    ) {
      discount = coupon.max_discount;
    }
  }

  if (coupon.discount_type === "FIXED") {
    discount = coupon.discount_value;
  }

  if (discount > subtotal) {
    discount = subtotal;
  }

  return {
    coupon,
    discount,
  };
};
