import { validateCoupon } from "../../services/couponService.js";
import Cart from "../../models/cartSchema.js";
import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import {
  calculateCartTotals,
  getOfferedUnitPrice,
  loadOfferPricingMap,
  applyCheckoutDiscounts,
} from "../../services/pricingService.js";

export const applyCoupon = async (req, res) => {
  try {
    const userId = req.user._id;

    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Coupon code is required",
      });
    }

    const cart = await Cart.findOne({ user_id: userId }).lean();
    if (!cart?.items?.length) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty",
      });
    }

    const [products, variants] = await Promise.all([
      Product.find({ _id: { $in: cart.items.map((item) => item.product_id) } }).lean(),
      Variant.find({ _id: { $in: cart.items.map((item) => item.variant_id) } }).lean(),
    ]);
    const variantMap = new Map(
      variants.map((variant) => [variant._id.toString(), variant]),
    );
    const productMap = new Map(
      products.map((product) => [product._id.toString(), product]),
    );
    const offerPricing = await loadOfferPricingMap(products, variants);
    const items = [];
    const cartItems = [];

    for (const item of cart.items) {
      const variant = variantMap.get(item.variant_id.toString());
      const product = productMap.get(item.product_id.toString());
      const price = variant && getOfferedUnitPrice(variant, offerPricing.get(variant._id.toString()));

      if (!Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(price)) {
        return res.status(400).json({
          success: false,
          message: "Unable to validate the current cart",
        });
      }

      items.push({ item_total: price * item.quantity });
      cartItems.push({
        productId: item.product_id.toString(),
        categoryId: product?.category_id?.toString() || null,
        quantity: item.quantity,
      });
    }

    const totals = calculateCartTotals(items);
    const checkoutDiscounts = await applyCheckoutDiscounts({
      user: req.user,
      subtotal: totals.subtotal,
      couponCode: code,
      cartItems,
      validateCoupon,
    });

    return res.status(200).json({
      success: true,
      message: "Coupon applied successfully",
      coupon: {
        code: checkoutDiscounts.coupon.code,
      },
      discount: checkoutDiscounts.couponDiscount,
      referralDiscount: checkoutDiscounts.referralDiscount,
      subtotal: totals.subtotal,
      finalAmount: Math.max(
        0,
        totals.finalAmount - checkoutDiscounts.couponDiscount - checkoutDiscounts.referralDiscount,
      ),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
