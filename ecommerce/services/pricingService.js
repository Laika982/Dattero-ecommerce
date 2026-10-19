import {
  calculateOfferDiscount,
  getProductOfferPricing,
  getReferralOffer,
} from "./offerService.js";

export const calculateItemPrice = (variant) => {
  if (
    variant.sale_price !== null &&
    variant.sale_price !== undefined &&
    variant.sale_price < variant.regular_price
  ) {
    return variant.sale_price;
  }

  return variant.regular_price;
};

export const getOfferedUnitPrice = (variant, offerPricing) => {
  if (offerPricing && Number.isFinite(Number(offerPricing.price))) {
    return Number(offerPricing.price);
  }
  return Number(calculateItemPrice(variant));
};

export const applyCheckoutDiscounts = async ({
  user,
  subtotal,
  couponCode,
  cartItems,
  validateCoupon,
}) => {
  let coupon = null;
  let couponDiscount = 0;

  if (typeof couponCode === "string" && couponCode.trim()) {
    const couponResult = await validateCoupon({
      code: couponCode,
      userId: user?._id || user,
      subtotal,
      cartItems,
    });
    coupon = couponResult.coupon;
    couponDiscount = Math.min(subtotal, couponResult.discount);
  }

  const referralOffer = user ? await getReferralOffer(user) : null;
  const remaining = Math.max(0, subtotal - couponDiscount);
  const referralDiscount = Math.min(
    remaining,
    calculateOfferDiscount(remaining, referralOffer),
  );

  return {
    coupon,
    couponDiscount,
    referralOffer,
    referralDiscount,
  };
};

export const loadOfferPricingMap = async (products, variants) => {
  return getProductOfferPricing(products, variants);
};

export const calculateCartTotals = (items) => {
  let subtotal = 0;

  for (const item of items) {
    subtotal += item.item_total;
  }

  // You can change these business rules later
  const discount = 0;

  const tax = 0;

  const shipping = subtotal >= 1000 ? 0 : 50;

  const finalAmount = subtotal - discount + tax + shipping;

  return {
    subtotal,
    discount,
    tax,
    shipping,
    finalAmount,
  };
};
