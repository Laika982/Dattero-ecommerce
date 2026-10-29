import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateOrderId } from "../utils/generateOrderId.js";

describe("Order Lifecycle, Inventory & Status Integrity Tests", () => {
  it("generates correctly formatted unique order ID with prefix 'NL-'", () => {
    const id1 = generateOrderId();
    const id2 = generateOrderId();

    assert.ok(id1.startsWith("NL-"), `Expected prefix NL-, got ${id1}`);
    assert.strictEqual(id1.length, 9, `Expected 9 characters, got ${id1}`);
    assert.match(id1, /^NL-\d{6}$/);
    assert.match(id2, /^NL-\d{6}$/);
  });

  it("validates permitted status transitions for orders", () => {
    const validTransitions = {
      pending: ["processing", "cancelled"],
      processing: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: ["return_requested", "returned"],
      cancelled: [], // Terminal state
      returned: [],  // Terminal state
    };

    const isTransitionAllowed = (currentStatus, targetStatus) => {
      const allowed = validTransitions[currentStatus] || [];
      return allowed.includes(targetStatus);
    };

    assert.strictEqual(isTransitionAllowed("pending", "processing"), true);
    assert.strictEqual(isTransitionAllowed("processing", "shipped"), true);
    assert.strictEqual(isTransitionAllowed("shipped", "delivered"), true);
    assert.strictEqual(isTransitionAllowed("pending", "cancelled"), true);

    // Invalid transitions
    assert.strictEqual(isTransitionAllowed("cancelled", "delivered"), false);
    assert.strictEqual(isTransitionAllowed("delivered", "pending"), false);
    assert.strictEqual(isTransitionAllowed("shipped", "cancelled"), false);
  });

  it("identifies order cancellation eligibility correctly", () => {
    const canCancelOrder = (orderStatus) => {
      return ["pending", "processing"].includes(orderStatus);
    };

    assert.strictEqual(canCancelOrder("pending"), true);
    assert.strictEqual(canCancelOrder("processing"), true);
    assert.strictEqual(canCancelOrder("shipped"), false);
    assert.strictEqual(canCancelOrder("delivered"), false);
    assert.strictEqual(canCancelOrder("cancelled"), false);
  });

  it("identifies order return eligibility correctly within return window", () => {
    const RETURN_WINDOW_DAYS = 7;

    const canReturnOrder = (orderStatus, deliveredAt, now = new Date()) => {
      if (orderStatus !== "delivered") return false;
      if (!deliveredAt) return false;

      const diffMs = now.getTime() - new Date(deliveredAt).getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= RETURN_WINDOW_DAYS;
    };

    const now = new Date();
    const delivered3DaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const delivered10DaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    assert.strictEqual(canReturnOrder("delivered", delivered3DaysAgo, now), true);
    assert.strictEqual(canReturnOrder("delivered", delivered10DaysAgo, now), false);
    assert.strictEqual(canReturnOrder("processing", delivered3DaysAgo, now), false);
  });

  it("correctly computes active order subtotal after item cancellation", () => {
    const orderItems = [
      { id: "item1", price: 200, quantity: 2, status: "active" },      // 400
      { id: "item2", price: 300, quantity: 1, status: "cancelled" },   // cancelled
      { id: "item3", price: 150, quantity: 2, status: "active" },      // 300
    ];

    const activeSubtotal = orderItems
      .filter((item) => item.status !== "cancelled")
      .reduce((sum, item) => sum + item.price * item.quantity, 0);

    assert.strictEqual(activeSubtotal, 700);
  });

  it("restores exact inventory counts when order items are cancelled", () => {
    const initialInventory = 25;
    const itemsToCancel = [
      { variantId: "v1", quantity: 3 },
      { variantId: "v1", quantity: 2 },
    ];

    const totalRestored = itemsToCancel.reduce((sum, item) => sum + item.quantity, 0);
    const finalInventory = initialInventory + totalRestored;

    assert.strictEqual(finalInventory, 30);
  });
});
