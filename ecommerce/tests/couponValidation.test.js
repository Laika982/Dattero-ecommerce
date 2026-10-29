import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCouponEligibility } from "../services/couponService.js";

describe("Coupon Eligibility & Discount Business Logic Tests", () => {
  it("rejects null or undefined coupons", () => {
    const result = evaluateCouponEligibility(null, { subtotal: 1000 });
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /Invalid coupon/i);
  });

  it("rejects inactive coupons", () => {
    const coupon = {
      is_active: false,
      code: "SAVE20",
      discount_type: "PERCENTAGE",
      discount_value: 20,
    };
    const result = evaluateCouponEligibility(coupon, { subtotal: 1000 });
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /inactive/i);
  });

  it("rejects expired coupons", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const coupon = {
      is_active: true,
      code: "EXPIRED10",
      expiry_date: yesterday,
      discount_type: "PERCENTAGE",
      discount_value: 10,
    };
    const result = evaluateCouponEligibility(coupon, { subtotal: 1000 });
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /expired/i);
  });

  it("rejects coupons whose start date is in the future", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const coupon = {
      is_active: true,
      code: "FUTURE50",
      start_date: tomorrow,
      discount_type: "PERCENTAGE",
      discount_value: 50,
    };
    const result = evaluateCouponEligibility(coupon, { subtotal: 1000 });
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /not active yet/i);
  });

  it("rejects coupon if cart subtotal is below minimum purchase requirement", () => {
    const coupon = {
      is_active: true,
      code: "MIN500",
      minimum_purchase: 500,
      discount_type: "FIXED",
      discount_value: 50,
    };
    const result = evaluateCouponEligibility(coupon, { subtotal: 450 });
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /minimum purchase/i);
  });

  it("accepts coupon when cart subtotal meets minimum purchase requirement", () => {
    const coupon = {
      is_active: true,
      code: "MIN500",
      minimum_purchase: 500,
      discount_type: "FIXED",
      discount_value: 50,
    };
    const result = evaluateCouponEligibility(coupon, { subtotal: 500 });
    assert.strictEqual(result.eligible, true);
    assert.strictEqual(result.reason, null);
  });

  it("enforces usage limit per customer", () => {
    const userId = "user123";
    const coupon = {
      is_active: true,
      code: "ONCEONLY",
      usage_limit: 1,
      discount_type: "PERCENTAGE",
      discount_value: 15,
      used_by: [userId],
    };

    // User already used it 1 time
    const result = evaluateCouponEligibility(coupon, {
      subtotal: 1000,
      userId,
      userUsageCount: 1,
    });
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /reached the usage limit/i);

    // Another user who has 0 usages can use it
    const otherUserResult = evaluateCouponEligibility(coupon, {
      subtotal: 1000,
      userId: "user456",
      userUsageCount: 0,
    });
    assert.strictEqual(otherUserResult.eligible, true);
  });

  it("correctly validates category-restricted coupon", () => {
    const categoryId = "cat999";
    const coupon = {
      is_active: true,
      code: "CATDISCOUNT",
      applies_to: "CATEGORY",
      category_id: categoryId,
      discount_type: "PERCENTAGE",
      discount_value: 10,
    };

    // Cart with matching category
    const validCart = evaluateCouponEligibility(coupon, {
      subtotal: 600,
      cartItems: [{ categoryId, productId: "prod1" }],
    });
    assert.strictEqual(validCart.eligible, true);

    // Cart without matching category
    const invalidCart = evaluateCouponEligibility(coupon, {
      subtotal: 600,
      cartItems: [{ categoryId: "otherCat", productId: "prod2" }],
    });
    assert.strictEqual(invalidCart.eligible, false);
    assert.match(invalidCart.reason, /selected category/i);
  });

  it("correctly validates product-restricted coupon", () => {
    const productId = "prod123";
    const coupon = {
      is_active: true,
      code: "PRODSPECIAL",
      applies_to: "PRODUCT",
      product_id: productId,
      discount_type: "PERCENTAGE",
      discount_value: 20,
    };

    // Cart containing product
    const valid = evaluateCouponEligibility(coupon, {
      subtotal: 800,
      cartItems: [{ productId, quantity: 2 }],
    });
    assert.strictEqual(valid.eligible, true);

    // Cart not containing product
    const invalid = evaluateCouponEligibility(coupon, {
      subtotal: 800,
      cartItems: [{ productId: "diffProd", quantity: 1 }],
    });
    assert.strictEqual(invalid.eligible, false);
    assert.match(invalid.reason, /eligible product/i);
  });
});
