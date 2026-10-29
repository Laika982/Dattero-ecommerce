import Coupon from "../models/couponSchema.js";
import Cart from "../models/cartSchema.js";
import Product from "../models/productSchema.js";

import Order from "../models/orderSchema.js";

export const evaluateCouponEligibility = (
  coupon,
  {
    subtotal = 0,
    cartItems = [],
    userId = null,
    userUsageCount = null,
    now = new Date(),
  } = {},
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

  // Check Usage Limit Per Customer
  if (
    coupon.usage_limit !== null &&
    coupon.usage_limit !== undefined &&
    coupon.usage_limit > 0
  ) {
    let usageCount = 0;
    if (userUsageCount !== null && userUsageCount !== undefined) {
      usageCount = Number(userUsageCount) || 0;
    } else if (userId && Array.isArray(coupon.used_by)) {
      usageCount = coupon.used_by.filter(
        (id) =>
          (id?._id ? id._id.toString() : id?.toString()) === userId.toString(),
      ).length;
    }

    if (userId && usageCount >= coupon.usage_limit) {
      return {
        eligible: false,
        reason: `You have reached the usage limit (${coupon.usage_limit} ${coupon.usage_limit === 1 ? "time" : "times"}) for this coupon.`,
      };
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

export const validateCoupon = async ({ code, userId, subtotal, cartItems, excludeOrderId = null }) => {
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

  let userUsageCount = 0;
  if (userId) {
    const orderQuery = {
      user_id: userId,
      coupon_code: coupon.code,
      order_status: { $nin: ["cancelled"] },
      payment_status: { $nin: ["failed"] },
    };
    if (excludeOrderId) {
      orderQuery.order_id = { $ne: excludeOrderId };
    }
    userUsageCount = await Order.countDocuments(orderQuery).catch(() => 0);
  }

  const eligibility = evaluateCouponEligibility(coupon, {
    subtotal,
    cartItems: items || [],
    userId,
    userUsageCount,
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

export const evaluateOrderCouponEligibility = async (order, activeItems = []) => {
  if (!order || !order.coupon_code) {
    return { isEligible: false, discount: 0 };
  }

  const activeSubtotal = (activeItems || []).reduce(
    (acc, item) =>
      acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
    0,
  );

  if (activeSubtotal <= 0) {
    return { isEligible: false, discount: 0 };
  }

  const coupon = await Coupon.findOne({
    code: order.coupon_code.trim().toUpperCase(),
  })
    .populate("category_id")
    .populate("product_id")
    .lean();

  if (!coupon) {
    return { isEligible: false, discount: 0 };
  }

  // Minimum purchase check
  const minPurchase = Number(coupon.minimum_purchase || 0);
  if (activeSubtotal < minPurchase) {
    return { isEligible: false, discount: 0, reason: "Minimum purchase amount not reached." };
  }

  const appliesTo =
    coupon.applies_to ||
    (coupon.product_id ? "PRODUCT" : coupon.category_id ? "CATEGORY" : "ALL");

  if (appliesTo === "PRODUCT") {
    const targetProductId = coupon.product_id?._id
      ? coupon.product_id._id.toString()
      : coupon.product_id?.toString();

    if (!targetProductId) {
      return { isEligible: false, discount: 0 };
    }

    const hasProduct = activeItems.some((item) => {
      const pid = item.product_id?._id
        ? item.product_id._id.toString()
        : item.product_id?.toString();
      return pid === targetProductId;
    });

    if (!hasProduct) {
      return { isEligible: false, discount: 0, reason: "Eligible product has been cancelled." };
    }

    const eligibleSubtotal = activeItems
      .filter((item) => {
        const pid = item.product_id?._id
          ? item.product_id._id.toString()
          : item.product_id?.toString();
        return pid === targetProductId;
      })
      .reduce(
        (acc, item) =>
          acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
        0,
      );

    let discount = 0;
    if (coupon.discount_type === "PERCENTAGE") {
      discount = (eligibleSubtotal * coupon.discount_value) / 100;
      if (
        coupon.max_discount !== null &&
        coupon.max_discount !== undefined &&
        coupon.max_discount > 0 &&
        discount > coupon.max_discount
      ) {
        discount = coupon.max_discount;
      }
    } else if (coupon.discount_type === "FIXED") {
      discount = Math.min(coupon.discount_value, eligibleSubtotal);
    }

    discount = Number(Math.min(discount, activeSubtotal).toFixed(2));
    return { isEligible: true, discount, coupon };
  }

  if (appliesTo === "CATEGORY") {
    const targetCategoryId = coupon.category_id?._id
      ? coupon.category_id._id.toString()
      : coupon.category_id?.toString();

    if (!targetCategoryId) {
      return { isEligible: false, discount: 0 };
    }

    const productIdsToFetch = [];
    const productCategoryMap = new Map();

    for (const item of activeItems) {
      const catId = item.product_id?.category_id?._id
        ? item.product_id.category_id._id.toString()
        : item.product_id?.category_id?.toString();
      const pid = item.product_id?._id
        ? item.product_id._id.toString()
        : item.product_id?.toString();

      if (catId && pid) {
        productCategoryMap.set(pid, catId);
      } else if (pid) {
        productIdsToFetch.push(pid);
      }
    }

    if (productIdsToFetch.length > 0) {
      const fetchedProducts = await Product.find({ _id: { $in: productIdsToFetch } })
        .select("category_id")
        .lean();
      for (const p of fetchedProducts) {
        const cid = p.category_id?._id
          ? p.category_id._id.toString()
          : p.category_id?.toString();
        if (cid) {
          productCategoryMap.set(p._id.toString(), cid);
        }
      }
    }

    const eligibleItems = activeItems.filter((item) => {
      const pid = item.product_id?._id
        ? item.product_id._id.toString()
        : item.product_id?.toString();
      return productCategoryMap.get(pid) === targetCategoryId;
    });

    if (eligibleItems.length === 0) {
      return { isEligible: false, discount: 0, reason: "Eligible category items have been cancelled." };
    }

    const eligibleSubtotal = eligibleItems.reduce(
      (acc, item) =>
        acc + Number(item.item_total != null ? item.item_total : (item.price * item.quantity) || 0),
      0,
    );

    let discount = 0;
    if (coupon.discount_type === "PERCENTAGE") {
      discount = (eligibleSubtotal * coupon.discount_value) / 100;
      if (
        coupon.max_discount !== null &&
        coupon.max_discount !== undefined &&
        coupon.max_discount > 0 &&
        discount > coupon.max_discount
      ) {
        discount = coupon.max_discount;
      }
    } else if (coupon.discount_type === "FIXED") {
      discount = Math.min(coupon.discount_value, eligibleSubtotal);
    }

    discount = Number(Math.min(discount, activeSubtotal).toFixed(2));
    return { isEligible: true, discount, coupon };
  }

  // ALL items
  let discount = 0;
  if (coupon.discount_type === "PERCENTAGE") {
    discount = (activeSubtotal * coupon.discount_value) / 100;
    if (
      coupon.max_discount !== null &&
      coupon.max_discount !== undefined &&
      coupon.max_discount > 0 &&
      discount > coupon.max_discount
    ) {
      discount = coupon.max_discount;
    }
  } else if (coupon.discount_type === "FIXED") {
    discount = Math.min(coupon.discount_value, activeSubtotal);
  }

  discount = Number(Math.min(discount, activeSubtotal).toFixed(2));
  return { isEligible: true, discount, coupon };
};
