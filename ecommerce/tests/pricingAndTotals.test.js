import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateItemPrice,
  calculateOrderShipping,
  calculateCartTotals,
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_CHARGE,
} from "../services/pricingService.js";
import { selectBestProductOffer } from "../services/offerService.js";

describe("Pricing, Shipping & Cart Totals Tests", () => {
  it("uses sale_price when sale_price < regular_price", () => {
    const variant = { regular_price: 500, sale_price: 399 };
    const price = calculateItemPrice(variant);
    assert.strictEqual(price, 399);
  });

  it("uses regular_price when sale_price is undefined, null, or greater than regular_price", () => {
    assert.strictEqual(calculateItemPrice({ regular_price: 600, sale_price: null }), 600);
    assert.strictEqual(calculateItemPrice({ regular_price: 600, sale_price: undefined }), 600);
    assert.strictEqual(calculateItemPrice({ regular_price: 600, sale_price: 700 }), 600);
  });

  it("calculates shipping charge correctly below free threshold", () => {
    const subtotal = 499;
    const shipping = calculateOrderShipping(subtotal);
    assert.strictEqual(shipping, STANDARD_SHIPPING_CHARGE);
    assert.strictEqual(shipping, 50);
  });

  it("awards free shipping when subtotal >= threshold", () => {
    const shippingExact = calculateOrderShipping(FREE_SHIPPING_THRESHOLD);
    assert.strictEqual(shippingExact, 0);

    const shippingAbove = calculateOrderShipping(1500);
    assert.strictEqual(shippingAbove, 0);
  });

  it("charges 0 shipping when subtotal is 0", () => {
    assert.strictEqual(calculateOrderShipping(0), 0);
  });

  it("calculates cart totals correctly for multiple items", () => {
    const items = [
      { item_total: 300, quantity: 1 },
      { item_total: 400, quantity: 2 },
    ];
    const totals = calculateCartTotals(items);
    assert.strictEqual(totals.subtotal, 700);
    assert.strictEqual(totals.shipping, 50);
    assert.strictEqual(totals.finalAmount, 750);
  });

  it("calculates cart totals for orders qualifying for free delivery", () => {
    const items = [
      { item_total: 600, quantity: 1 },
      { item_total: 500, quantity: 1 },
    ];
    const totals = calculateCartTotals(items);
    assert.strictEqual(totals.subtotal, 1100);
    assert.strictEqual(totals.shipping, 0);
    assert.strictEqual(totals.finalAmount, 1100);
  });

  it("selects best offer between product and category offers", () => {
    const offers = [
      {
        offer_type: "PRODUCT",
        product_id: "prod1",
        discount_type: "PERCENTAGE",
        discount_value: 10,
      },
      {
        offer_type: "CATEGORY",
        category_id: "cat1",
        discount_type: "PERCENTAGE",
        discount_value: 20,
      },
    ];

    const result = selectBestProductOffer({
      basePrice: 1000,
      productId: "prod1",
      categoryId: "cat1",
      offers,
    });

    // Best discount should be 20% (Rs. 200) from category offer
    assert.strictEqual(result.basePrice, 1000);
    assert.strictEqual(result.discount, 200);
    assert.strictEqual(result.price, 800);
    assert.strictEqual(result.offer.discount_value, 20);
  });
});
