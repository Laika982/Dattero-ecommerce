import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Address from "../../models/addressSchema.js";
import Coupon from "../../models/couponSchema.js";
import Order from "../../models/orderSchema.js";

import {
  calculateItemPrice,
  calculateCartTotals,
  getOfferedUnitPrice,
  loadOfferPricingMap,
  applyCheckoutDiscounts,
} from "../../services/pricingService.js";
import { validateCoupon, evaluateCouponEligibility } from "../../services/couponService.js";
import { getOrCreateWallet } from "../../services/walletService.js";

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

    const [products, variants, addresses, userWallet] = await Promise.all([
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

      getOrCreateWallet(userId),
    ]);

    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    const variantMap = new Map(
      variants.map((variant) => [variant._id.toString(), variant]),
    );

    const offerPricing = await loadOfferPricingMap(products, variants);
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

      const offer = offerPricing.get(variant._id.toString());
      const price = getOfferedUnitPrice(variant, offer);

      if (price === null || price === undefined || price <= 0) {
        return res.redirect("/cart");
      }

      const itemTotal = price * item.quantity;

      checkoutItems.push({
        productId: product._id.toString(),
        categoryId: product.category_id ? product.category_id.toString() : null,
        variantId: variant._id,

        productName: product.productName,
        product_name: product.productName,

        image: product.images?.[0]?.url || "",

        sku: variant.sku,

        weight: variant.weight,

        quantity: item.quantity,

        price,

        offerName: offer?.offerName || null,
        offerDiscount: Number(offer?.discount || 0) * item.quantity,

        itemTotal,
        item_total: itemTotal,
      });
    }

    const totals = calculateCartTotals(checkoutItems);
    const sessionCouponCode = typeof req.session?.appliedCouponCode === "string"
      ? req.session.appliedCouponCode.trim()
      : "";

    const checkoutDiscounts = await applyCheckoutDiscounts({
      user: req.user,
      subtotal: totals.subtotal,
      couponCode: sessionCouponCode,
      cartItems: checkoutItems,
      validateCoupon,
    });
    totals.offerDiscount = checkoutItems.reduce(
      (sum, item) => sum + Number(item.offerDiscount || 0),
      0,
    );
    totals.referralDiscount = checkoutDiscounts.referralDiscount;
    totals.referralOfferName = checkoutDiscounts.referralOffer?.name || null;
    totals.baseFinalAmount = Math.max(0, totals.finalAmount - checkoutDiscounts.referralDiscount);
    totals.couponDiscount = checkoutDiscounts.couponDiscount || 0;
    totals.finalAmount = Math.max(0, totals.baseFinalAmount - totals.couponDiscount);

    if (sessionCouponCode && !checkoutDiscounts.coupon && req.session) {
      req.session.appliedCouponCode = null;
    }

    const couponDocuments = await Coupon.find({
      is_active: true,
      expiry_date: { $gt: new Date() },
    })
      .populate("category_id", "category_name")
      .populate("product_id", "productName")
      .sort({ createdAt: -1 })
      .lean();

    const checkoutCartItems = checkoutItems.map((item) => ({
      productId: item.productId,
      categoryId: item.categoryId,
      quantity: item.quantity,
    }));

    const userCouponOrders = await Order.aggregate([
      {
        $match: {
          user_id: req.user._id,
          coupon_code: { $ne: null },
          order_status: { $nin: ["cancelled"] },
        },
      },
      {
        $group: {
          _id: "$coupon_code",
          count: { $sum: 1 },
        },
      },
    ]);
    const userOrderCountMap = new Map(
      userCouponOrders.map((entry) => [entry._id, entry.count]),
    );

    const availableCoupons = couponDocuments
      .filter((coupon) => {
        if (!coupon.is_active) return false;
        if (coupon.start_date && new Date() < new Date(coupon.start_date)) return false;
        if (new Date() > new Date(coupon.expiry_date)) return false;

        if (
          coupon.usage_limit !== null &&
          coupon.usage_limit !== undefined &&
          coupon.usage_limit > 0
        ) {
          const orderCount = userOrderCountMap.get(coupon.code) || 0;
          const usedByCount = (coupon.used_by || []).filter(
            (userId) =>
              (userId?._id ? userId._id.toString() : userId?.toString()) ===
              req.user._id.toString(),
          ).length;
          const userUsageCount = Math.max(orderCount, usedByCount);
          if (userUsageCount >= coupon.usage_limit) {
            return false;
          }
        }

        return true;
      })
      .map((coupon) => {
        const orderCount = userOrderCountMap.get(coupon.code) || 0;
        const usedByCount = (coupon.used_by || []).filter(
          (userId) =>
            (userId?._id ? userId._id.toString() : userId?.toString()) ===
            req.user._id.toString(),
        ).length;
        const userUsageCount = Math.max(orderCount, usedByCount);

        const eligibility = evaluateCouponEligibility(coupon, {
          subtotal: totals.subtotal,
          cartItems: checkoutCartItems,
          userId: req.user._id,
          userUsageCount,
        });

        const discountLabel = coupon.discount_type === "PERCENTAGE"
          ? `${coupon.discount_value}% off${coupon.max_discount ? ` (up to ₹${coupon.max_discount})` : ""}`
          : `₹${coupon.discount_value} off`;
        const minimumPurchase = Number(coupon.minimum_purchase || 0);

        const appliesTo = coupon.applies_to || (coupon.product_id ? "PRODUCT" : coupon.category_id ? "CATEGORY" : "ALL");
        let restrictionLabel = null;
        if (appliesTo === "PRODUCT") {
          restrictionLabel = `Valid on: ${coupon.product_id?.productName || "Selected product"}`;
        } else if (appliesTo === "CATEGORY") {
          restrictionLabel = `Valid on: ${coupon.category_id?.category_name || "Selected category"}`;
        }

        return {
          code: coupon.code,
          discount_type: coupon.discount_type,
          discount_value: coupon.discount_value,
          max_discount: coupon.max_discount,
          applies_to: appliesTo,
          target_product_id: coupon.product_id?._id ? coupon.product_id._id.toString() : coupon.product_id ? coupon.product_id.toString() : null,
          target_category_id: coupon.category_id?._id ? coupon.category_id._id.toString() : coupon.category_id ? coupon.category_id.toString() : null,
          discountLabel,
          minimumPurchase: minimumPurchase.toFixed(2),
          rawMinimumPurchase: minimumPurchase,
          restrictionLabel,
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          amountNeeded: Math.max(0, minimumPurchase - totals.subtotal).toFixed(2),
          expiryLabel: new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
          }).format(coupon.expiry_date),
        };
      });

    availableCoupons.sort((a, b) => {
      // 1. Applicable (eligible) coupons first
      if (a.eligible && !b.eligible) return -1;
      if (!a.eligible && b.eligible) return 1;

      // 2. Within each group: discount value descending
      if (b.discount_value !== a.discount_value) {
        return b.discount_value - a.discount_value;
      }
      return a.rawMinimumPurchase - b.rawMinimumPurchase;
    });

    const selectedAddress =
      addresses.find((address) => address.is_default === true) ||
      addresses[0] ||
      null;

    const wallet = {
      balance: Number(userWallet?.balance || 0).toFixed(2),
      rawBalance: Number(userWallet?.balance || 0),
    };

    return res.render("user/checkout", {
      checkoutItems,
      addresses,
      selectedAddress,
      totals,
      availableCoupons,
      wallet,
      appliedCoupon: checkoutDiscounts.coupon || null,
      couponDiscount: checkoutDiscounts.couponDiscount || 0,
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
