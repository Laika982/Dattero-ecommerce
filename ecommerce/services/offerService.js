import Offer from "../models/offerSchema.js";

const activeOfferQuery = (now) => ({
  is_active: true,
  start_date: { $lte: now },
  end_date: { $gt: now },
});

const calculateDiscount = (basePrice, offer) => {
  const value = Number(offer.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const rawDiscount = offer.discount_type === "PERCENTAGE"
    ? basePrice * value / 100
    : value;
  return Math.min(basePrice, rawDiscount);
};

export const selectBestProductOffer = ({
  basePrice,
  productId,
  categoryId,
  offers,
}) => {
  const price = Number(basePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { basePrice: price, price, discount: 0, offer: null };
  }

  const best = (offers || []).reduce((currentBest, offer) => {
    const targetsProduct = offer.offer_type === "PRODUCT" &&
      String(offer.product_id) === String(productId);
    const targetsCategory = offer.offer_type === "CATEGORY" &&
      String(offer.category_id) === String(categoryId);
    if (!targetsProduct && !targetsCategory) return currentBest;

    const discount = calculateDiscount(price, offer);
    return discount > currentBest.discount
      ? { offer, discount }
      : currentBest;
  }, { offer: null, discount: 0 });

  return {
    basePrice: price,
    price: Number((price - best.discount).toFixed(2)),
    discount: Number(best.discount.toFixed(2)),
    offer: best.offer,
  };
};

export const getProductOfferPricing = async (products, variants, now = new Date()) => {
  const productMap = new Map(
    (products || []).map((product) => [String(product._id), product]),
  );
  const productIds = [...productMap.keys()];
  const categoryIds = [...new Set((products || [])
    .map((product) => String(product.category_id?._id || product.category_id || ""))
    .filter(Boolean))];

  if (!productIds.length) return new Map();

  const offers = await Offer.find({
    ...activeOfferQuery(now),
    $or: [
      { offer_type: "PRODUCT", product_id: { $in: productIds } },
      { offer_type: "CATEGORY", category_id: { $in: categoryIds } },
    ],
  }).lean();

  const pricingByVariant = new Map();
  for (const variant of variants || []) {
    const product = productMap.get(String(variant.product_id));
    if (!product) continue;

    const basePrice = variant.sale_price != null &&
      Number(variant.sale_price) < Number(variant.regular_price)
      ? Number(variant.sale_price)
      : Number(variant.regular_price);
    const pricing = selectBestProductOffer({
      basePrice,
      productId: product._id,
      categoryId: product.category_id?._id || product.category_id,
      offers,
    });

    pricingByVariant.set(String(variant._id), {
      ...pricing,
      offerName: pricing.offer?.name || null,
      offerType: pricing.offer?.offer_type || null,
      discountPercentage: basePrice > 0
        ? Math.round(pricing.discount / basePrice * 100)
        : 0,
    });
  }

  return pricingByVariant;
};

export const getReferralOffer = async (user, now = new Date()) => {
  if (!user || user.referralOfferUsed) return null;
  if (!user.referredBy && !user.referralOfferId) return null;

  if (user.referralOfferId) {
    const attached = await Offer.findOne({
      _id: user.referralOfferId,
      offer_type: "REFERRAL",
      ...activeOfferQuery(now),
    }).lean();
    if (attached) return attached;
  }

  return Offer.findOne({
    offer_type: "REFERRAL",
    ...activeOfferQuery(now),
  })
    .sort({ createdAt: -1 })
    .lean();
};

export const calculateOfferDiscount = (subtotal, offer) => {
  const amount = Number(subtotal);
  if (!offer || !Number.isFinite(amount) || amount <= 0) return 0;
  return Number(calculateDiscount(amount, offer).toFixed(2));
};
