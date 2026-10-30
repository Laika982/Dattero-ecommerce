import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateItemProportionalPricing,
  calculateOrderReturnRefund,
} from "../services/refundService.js";

describe("BUG-BIZ-001: Refund Calculations & Return Flow Tests", () => {
  // 1. Full-price order refund (no coupon / order-level discount)
  it("1. Full-price order refund: calculates exact item price when no discount is applied", () => {
    const order = {
      order_id: "ORD-FULL-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 800,
      discount: 0,
      referral_discount: 0,
      final_amount: 800,
      original_final_amount: 800,
      refunded_amount: 0,
      items: [
        {
          _id: "item-1",
          product_name: "Medjool Dates 500g",
          price: 500,
          quantity: 1,
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
        {
          _id: "item-2",
          product_name: "Ajwa Dates 250g",
          price: 300,
          quantity: 1,
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
      ],
    };

    const pricing = calculateItemProportionalPricing(order);
    assert.strictEqual(pricing.length, 2);
    assert.strictEqual(pricing[0].net_item_paid, 500);
    assert.strictEqual(pricing[0].discount_share, 0);
    assert.strictEqual(pricing[1].net_item_paid, 300);
    assert.strictEqual(pricing[1].discount_share, 0);

    const result = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-1", quantity: 1 }],
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.refundAmount, 500);
    assert.strictEqual(result.itemsToReturn[0].itemRefund, 500);
  });

  // 2. Discounted order refund (coupon discount deducted proportionally)
  it("2. Discounted order refund: refunds net amount paid instead of gross list price", () => {
    const order = {
      order_id: "ORD-DISC-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 1000,
      discount: 200, // ₹200 coupon discount
      referral_discount: 0,
      final_amount: 800, // Customer paid ₹800
      original_final_amount: 800,
      refunded_amount: 0,
      items: [
        {
          _id: "item-single",
          product_name: "Premium Dates Box",
          price: 500,
          quantity: 2, // 2 x 500 = 1000 gross
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
      ],
    };

    const pricing = calculateItemProportionalPricing(order);
    assert.strictEqual(pricing[0].line_gross, 1000);
    assert.strictEqual(pricing[0].discount_share, 200);
    assert.strictEqual(pricing[0].net_item_paid, 800); // Net paid is 800
    assert.strictEqual(pricing[0].net_unit_price, 400); // 400 per unit, not 500

    const result = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-single", quantity: 2 }],
    });

    // CRITICAL BUG VERIFICATION: Refund must be net paid ₹800, NOT list price ₹1000!
    assert.strictEqual(result.refundAmount, 800);
    assert.strictEqual(result.itemsToReturn[0].itemRefund, 800);
  });

  // 3. Coupon applied to multiple items (proportional discount allocation)
  it("3. Coupon applied to multiple items: allocates discount proportionally by line value", () => {
    const order = {
      order_id: "ORD-MULTI-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 1000,
      discount: 200, // 20% coupon
      referral_discount: 0,
      final_amount: 800,
      original_final_amount: 800,
      refunded_amount: 0,
      items: [
        {
          _id: "item-a",
          product_name: "Item A",
          price: 600,
          quantity: 1, // Line gross: 600 (60%)
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
        {
          _id: "item-b",
          product_name: "Item B",
          price: 400,
          quantity: 1, // Line gross: 400 (40%)
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
      ],
    };

    const pricing = calculateItemProportionalPricing(order);
    // Item A (60%): 60% of 200 = 120 discount share -> net paid = 480
    assert.strictEqual(pricing[0].discount_share, 120);
    assert.strictEqual(pricing[0].net_item_paid, 480);
    assert.strictEqual(pricing[0].net_unit_price, 480);

    // Item B (40%): 40% of 200 = 80 discount share -> net paid = 320
    assert.strictEqual(pricing[1].discount_share, 80);
    assert.strictEqual(pricing[1].net_item_paid, 320);
    assert.strictEqual(pricing[1].net_unit_price, 320);

    // Returning Item A only
    const resultItemA = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-a", quantity: 1 }],
    });
    assert.strictEqual(resultItemA.refundAmount, 480); // NOT 600

    // Returning Item B only
    const resultItemB = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-b", quantity: 1 }],
    });
    assert.strictEqual(resultItemB.refundAmount, 320); // NOT 400

    // Total net paid equals total order final amount
    assert.strictEqual(resultItemA.refundAmount + resultItemB.refundAmount, 800);
  });

  // 4. Partial return of one item (multi-unit partial return)
  it("4. Partial return of one item: refunds proportional unit amount for partial return", () => {
    const order = {
      order_id: "ORD-PARTIAL-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 900,
      discount: 150,
      referral_discount: 0,
      final_amount: 750, // Net total: 750
      original_final_amount: 750,
      refunded_amount: 0,
      items: [
        {
          _id: "item-3pack",
          product_name: "Safari Dates 1kg",
          price: 300,
          quantity: 3, // 3 units @ 300 = 900
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
      ],
    };

    // Net paid: 900 - 150 = 750. Net per unit = 750 / 3 = 250
    const result = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-3pack", quantity: 1 }], // Return 1 of 3
    });

    assert.strictEqual(result.refundAmount, 250);
    assert.strictEqual(result.itemsToReturn[0].quantity, 1);
    assert.strictEqual(result.itemsToReturn[0].itemRefund, 250);
  });

  // 5. Multiple partial refunds (sequential returns eliminating penny drift)
  it("5. Multiple partial refunds: eliminates rounding penny drift across sequential returns", () => {
    // 3 units @ 100 = 300. Discount = 50. Net total = 250.
    // 250 / 3 = 83.333333...
    // Sequential returns must sum to exactly 250.00
    const order = {
      order_id: "ORD-PENNY-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 300,
      discount: 50,
      referral_discount: 0,
      final_amount: 250,
      original_final_amount: 250,
      refunded_amount: 0,
      items: [
        {
          _id: "item-split",
          product_name: "Split Unit Product",
          price: 100,
          quantity: 3,
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
      ],
    };

    // Return 1: First unit
    const return1 = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-split", quantity: 1 }],
    });
    assert.strictEqual(return1.refundAmount, 83.33);

    // Update order state as simulated in controller
    order.items[0].returned_quantity = 1;
    order.items[0].refunded_amount = 83.33;
    order.refunded_amount = 83.33;

    // Return 2: Second unit
    const return2 = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-split", quantity: 1 }],
    });
    assert.strictEqual(return2.refundAmount, 83.33);

    // Update order state
    order.items[0].returned_quantity = 2;
    order.items[0].refunded_amount = 166.66;
    order.refunded_amount = 166.66;

    // Return 3: Third and final unit
    const return3 = calculateOrderReturnRefund({
      order,
      requestedItems: [{ itemId: "item-split", quantity: 1 }],
    });
    // The final unit must absorb the 0.01 fractional remainder to reach exact 250.00
    assert.strictEqual(return3.refundAmount, 83.34);

    const totalRefunded = return1.refundAmount + return2.refundAmount + return3.refundAmount;
    assert.strictEqual(Number(totalRefunded.toFixed(2)), 250.00);
  });

  // 6. Duplicate refund request prevention
  it("6. Duplicate refund request: rejects already-returned items and duplicate payload items", () => {
    const order = {
      order_id: "ORD-DUP-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 500,
      discount: 0,
      referral_discount: 0,
      final_amount: 500,
      original_final_amount: 500,
      refunded_amount: 500,
      items: [
        {
          _id: "item-done",
          product_name: "Fully Returned Dates",
          price: 500,
          quantity: 1,
          returned_quantity: 1,
          refunded_amount: 500,
          status: "returned",
        },
      ],
    };

    // Attempting return of already fully returned item
    assert.throws(
      () => {
        calculateOrderReturnRefund({
          order,
          requestedItems: [{ itemId: "item-done", quantity: 1 }],
        });
      },
      (err) => err.message.includes("already been fully refunded") || err.message.includes("already been returned"),
    );

    // Duplicate item ID in the same request payload
    const activeOrder = {
      order_id: "ORD-DUP-02",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 500,
      discount: 0,
      final_amount: 500,
      items: [
        {
          _id: "item-active",
          product_name: "Active Product",
          price: 500,
          quantity: 2,
          returned_quantity: 0,
          status: "delivered",
        },
      ],
    };

    assert.throws(
      () => {
        calculateOrderReturnRefund({
          order: activeOrder,
          requestedItems: [
            { itemId: "item-active", quantity: 1 },
            { itemId: "item-active", quantity: 1 },
          ],
        });
      },
      /Duplicate or invalid item selected/,
    );
  });

  // 7. Concurrent refund requests (simulated race condition)
  it("7. Concurrent refund requests: guards against double refund race conditions", () => {
    // Simulating two concurrent requests hitting processOrderReturn with the same order state
    const orderSnapshot = {
      order_id: "ORD-RACE-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 400,
      discount: 0,
      final_amount: 400,
      original_final_amount: 400,
      refunded_amount: 0,
      items: [
        {
          _id: "item-race",
          product_name: "Race Test Product",
          price: 400,
          quantity: 1,
          returned_quantity: 0,
          refunded_amount: 0,
          status: "delivered",
        },
      ],
    };

    // Both requests calculate
    const req1Calc = calculateOrderReturnRefund({
      order: orderSnapshot,
      requestedItems: [{ itemId: "item-race", quantity: 1 }],
    });
    assert.strictEqual(req1Calc.refundAmount, 400);

    // Request 1 completes and commits state
    orderSnapshot.items[0].returned_quantity = 1;
    orderSnapshot.items[0].refunded_amount = 400;
    orderSnapshot.refunded_amount = 400;
    orderSnapshot.payment_status = "refunded";

    // Request 2 tries to commit or execute against the updated order
    assert.throws(
      () => {
        calculateOrderReturnRefund({
          order: orderSnapshot,
          requestedItems: [{ itemId: "item-race", quantity: 1 }],
        });
      },
      (err) =>
        err.message.includes("already been fully refunded") ||
        err.message.includes("payment status 'refunded'"),
    );
  });

  // 8. Refund request exceeding the amount paid
  it("8. Refund request exceeding amount paid: enforces strict caps and rejects invalid quantities", () => {
    const order = {
      order_id: "ORD-EXCEED-01",
      payment_status: "paid",
      order_status: "delivered",
      subtotal: 600,
      discount: 100,
      final_amount: 500,
      original_final_amount: 500,
      refunded_amount: 0,
      items: [
        {
          _id: "item-capped",
          product_name: "Capped Product",
          price: 300,
          quantity: 2,
          returned_quantity: 0,
          status: "delivered",
        },
      ],
    };

    // Cannot return more units than purchased
    assert.throws(
      () => {
        calculateOrderReturnRefund({
          order,
          requestedItems: [{ itemId: "item-capped", quantity: 5 }],
        });
      },
      /Invalid return quantity 5/,
    );

    // Cannot refund unpaid order
    const unpaidOrder = {
      ...order,
      payment_status: "pending",
    };
    assert.throws(
      () => {
        calculateOrderReturnRefund({
          order: unpaidOrder,
          requestedItems: [{ itemId: "item-capped", quantity: 1 }],
        });
      },
      /Cannot refund order with payment status 'pending'/,
    );

    // Order with existing partial refund cannot exceed original_final_amount
    const partiallyRefundedOrder = {
      ...order,
      refunded_amount: 450, // Only 50 remaining refundable
    };

    const cappedResult = calculateOrderReturnRefund({
      order: partiallyRefundedOrder,
      requestedItems: [{ itemId: "item-capped", quantity: 1 }], // Normal item net is 250
    });

    // Capped strictly to remaining 50
    assert.strictEqual(cappedResult.refundAmount, 50);
  });
});
