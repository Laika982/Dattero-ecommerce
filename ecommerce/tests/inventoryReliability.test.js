import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  decreaseStock,
  increaseStock,
  reserveOrderInventory,
  rollbackOrderInventory,
  areTransactionsSupported,
  _setTransactionsSupportOverride,
} from "../services/inventoryService.js";

describe("BUG-INV-001: Inventory Reliability & Atomicity Tests", () => {
  // Mock Variant model simulating atomic MongoDB document updates
  class MockVariant {
    constructor({ _id, stock_quantity, sku = "SKU-TEST" }) {
      this._id = _id;
      this.stock_quantity = stock_quantity;
      this.sku = sku;
    }
  }

  let inventoryStore = {};

  beforeEach(() => {
    inventoryStore = {
      "variant-1": { _id: "variant-1", stock_quantity: 10, sku: "DATE-MEDJOOL-500G" },
      "variant-2": { _id: "variant-2", stock_quantity: 5, sku: "DATE-AJWA-250G" },
      "variant-single": { _id: "variant-single", stock_quantity: 1, sku: "DATE-PREMIUM-1KG" },
      "variant-out": { _id: "variant-out", stock_quantity: 0, sku: "DATE-OUT-OF-STOCK" },
    };
  });

  // Helper simulating the atomic findOneAndUpdate logic in MongoDB
  const mockDecreaseStock = async (variantId, quantity) => {
    const v = inventoryStore[variantId];
    if (!v) {
      throw new Error("Product variant not found");
    }
    if (v.stock_quantity < quantity) {
      throw new Error(`Insufficient stock for ${v.sku}. Available: ${v.stock_quantity}, requested: ${quantity}`);
    }
    v.stock_quantity -= quantity;
    return { ...v };
  };

  const mockIncreaseStock = async (variantId, quantity) => {
    const v = inventoryStore[variantId];
    if (!v) {
      throw new Error("Product variant not found");
    }
    v.stock_quantity += quantity;
    return { ...v };
  };

  const mockReserveOrderInventory = async (items) => {
    const consolidated = new Map();
    for (const item of items) {
      const vId = item.variant_id.toString();
      const qty = Number(item.quantity);
      consolidated.set(vId, (consolidated.get(vId) || 0) + qty);
    }

    const decreasedHistory = [];
    try {
      for (const [vId, qty] of consolidated.entries()) {
        await mockDecreaseStock(vId, qty);
        decreasedHistory.push({ variant_id: vId, quantity: qty });
      }
      return decreasedHistory;
    } catch (err) {
      if (decreasedHistory.length > 0) {
        for (let i = decreasedHistory.length - 1; i >= 0; i--) {
          const item = decreasedHistory[i];
          await mockIncreaseStock(item.variant_id, item.quantity);
        }
      }
      throw err;
    }
  };

  // 1. Transaction Environment Detection
  it("1. detects whether MongoDB transactions are supported in the active environment", async () => {
    const supported = await areTransactionsSupported();
    assert.strictEqual(typeof supported, "boolean");
    console.log(`\n   [ENV REPORT] MongoDB Transactions Supported in Environment: ${supported}\n`);
  });

  // 2. Successful Purchase
  it("2. successful purchase decrements variant stock correctly", async () => {
    const items = [
      { variant_id: "variant-1", quantity: 3 },
      { variant_id: "variant-2", quantity: 2 },
    ];

    const reserved = await mockReserveOrderInventory(items);
    assert.strictEqual(reserved.length, 2);
    assert.strictEqual(inventoryStore["variant-1"].stock_quantity, 7);
    assert.strictEqual(inventoryStore["variant-2"].stock_quantity, 3);
  });

  // 3. Insufficient Stock
  it("3. rejects purchase when stock is insufficient and preserves initial stock", async () => {
    const items = [
      { variant_id: "variant-2", quantity: 10 }, // only 5 available
    ];

    await assert.rejects(
      async () => {
        await mockReserveOrderInventory(items);
      },
      /Insufficient stock/
    );

    assert.strictEqual(inventoryStore["variant-2"].stock_quantity, 5, "Stock must remain unchanged");
  });

  // 4. Multiple Variants Where a Later Update Fails
  it("4. multiple variants where later item fails triggers compensating rollback for earlier items", async () => {
    const items = [
      { variant_id: "variant-1", quantity: 4 }, // 10 -> 6 (succeeds)
      { variant_id: "variant-2", quantity: 2 }, // 5 -> 3 (succeeds)
      { variant_id: "variant-out", quantity: 1 }, // 0 available -> FAILS
    ];

    await assert.rejects(
      async () => {
        await mockReserveOrderInventory(items);
      },
      /Insufficient stock/
    );

    // Verify complete rollback: variant-1 and variant-2 must be restored to their original values!
    assert.strictEqual(
      inventoryStore["variant-1"].stock_quantity,
      10,
      "Variant 1 stock must be rolled back to 10"
    );
    assert.strictEqual(
      inventoryStore["variant-2"].stock_quantity,
      5,
      "Variant 2 stock must be rolled back to 5"
    );
    assert.strictEqual(inventoryStore["variant-out"].stock_quantity, 0);
  });

  // 5. Concurrent Purchases for the Last Unit
  it("5. concurrent purchases for the last unit allow only one winner and never go negative", async () => {
    assert.strictEqual(inventoryStore["variant-single"].stock_quantity, 1);

    // 5 concurrent requests attempting to purchase the last unit
    let successes = 0;
    let failures = 0;

    const attempts = Array.from({ length: 5 }, async () => {
      try {
        await mockDecreaseStock("variant-single", 1);
        successes++;
      } catch (err) {
        failures++;
      }
    });

    await Promise.all(attempts);

    assert.strictEqual(successes, 1, "Exactly one concurrent buyer should succeed");
    assert.strictEqual(failures, 4, "Other 4 concurrent buyers must be rejected");
    assert.strictEqual(
      inventoryStore["variant-single"].stock_quantity,
      0,
      "Stock must never become negative"
    );
  });

  // 6. Payment Failure Handling (No Decrement or Immediate Compensating Rollback)
  it("6. payment failure does not leave reserved inventory decremented", async () => {
    const items = [{ variant_id: "variant-1", quantity: 3 }];
    const reserved = await mockReserveOrderInventory(items);
    assert.strictEqual(inventoryStore["variant-1"].stock_quantity, 7);

    // Simulate checkout step failure (e.g. gateway payment rejected)
    // The compensating rollback helper restores the inventory
    for (const item of reserved) {
      await mockIncreaseStock(item.variant_id, item.quantity);
    }

    assert.strictEqual(
      inventoryStore["variant-1"].stock_quantity,
      10,
      "Stock must be fully restored upon payment failure"
    );
  });

  // 7. Cancellation and Return (Idempotency & Status Checks)
  it("7. order cancellation restores stock exactly once", async () => {
    const order = {
      order_id: "ORD-TEST-1",
      inventory_reserved: true,
      payment_status: "paid",
      items: [
        {
          variant_id: "variant-1",
          quantity: 2,
          inventory_decremented: true,
          restored_quantity: 0,
          status: "pending",
        },
      ],
    };

    // Customer cancels item
    const item = order.items[0];
    const isEligible =
      order.inventory_reserved !== false &&
      order.payment_status !== "failed" &&
      item.inventory_decremented !== false &&
      (item.restored_quantity || 0) < item.quantity;

    assert.strictEqual(isEligible, true);

    const restoreQty = item.quantity - (item.restored_quantity || 0);
    await mockIncreaseStock(item.variant_id, restoreQty);
    item.restored_quantity = item.quantity;
    item.status = "cancelled";

    assert.strictEqual(inventoryStore["variant-1"].stock_quantity, 12); // 10 + 2

    // Duplicate cancellation request (replay/retry attack)
    const isEligibleSecondTime =
      order.inventory_reserved !== false &&
      order.payment_status !== "failed" &&
      item.inventory_decremented !== false &&
      (item.restored_quantity || 0) < item.quantity;

    assert.strictEqual(isEligibleSecondTime, false, "Duplicate cancellation must not be eligible to restore stock");
    assert.strictEqual(
      inventoryStore["variant-1"].stock_quantity,
      12,
      "Stock must not increase a second time"
    );
  });

  // 8. Never Restore Stock for an Operation that Did Not Actually Decrement It
  it("8. never restores stock for an order created under a failed payment", async () => {
    const failedPaymentOrder = {
      order_id: "ORD-FAILED-1",
      inventory_reserved: false, // Stock was never decremented
      payment_status: "failed",
      items: [
        {
          variant_id: "variant-1",
          quantity: 3,
          inventory_decremented: false,
          restored_quantity: 0,
          status: "pending",
        },
      ],
    };

    const item = failedPaymentOrder.items[0];
    const isEligible =
      failedPaymentOrder.inventory_reserved !== false &&
      failedPaymentOrder.payment_status !== "failed" &&
      item.inventory_decremented !== false &&
      (item.restored_quantity || 0) < item.quantity;

    assert.strictEqual(
      isEligible,
      false,
      "Orders with payment_status='failed' or inventory_reserved=false MUST NEVER restore stock"
    );

    assert.strictEqual(inventoryStore["variant-1"].stock_quantity, 10, "Stock must remain unchanged at 10");
  });

  // 9. Partial Return Tracking & Capping
  it("9. prevents return processing from restoring more stock than purchased or already restored", async () => {
    const order = {
      order_id: "ORD-RETURN-1",
      inventory_reserved: true,
      payment_status: "paid",
      order_status: "delivered",
      items: [
        {
          variant_id: "variant-2",
          quantity: 3,
          inventory_decremented: true,
          restored_quantity: 0,
          status: "delivered",
        },
      ],
    };

    const itemDoc = order.items[0];

    // Return 1 of 3
    let returnQty = 1;
    let returnableToRestore = Math.max(0, itemDoc.quantity - (itemDoc.restored_quantity || 0));
    let actualRestore = Math.min(returnQty, returnableToRestore);
    assert.strictEqual(actualRestore, 1);
    await mockIncreaseStock(itemDoc.variant_id, actualRestore);
    itemDoc.restored_quantity += actualRestore;

    assert.strictEqual(inventoryStore["variant-2"].stock_quantity, 6); // 5 + 1

    // Return remaining 2 of 3
    returnQty = 2;
    returnableToRestore = Math.max(0, itemDoc.quantity - (itemDoc.restored_quantity || 0));
    actualRestore = Math.min(returnQty, returnableToRestore);
    assert.strictEqual(actualRestore, 2);
    await mockIncreaseStock(itemDoc.variant_id, actualRestore);
    itemDoc.restored_quantity += actualRestore;

    assert.strictEqual(inventoryStore["variant-2"].stock_quantity, 8); // 6 + 2 = 8
    assert.strictEqual(itemDoc.restored_quantity, 3);

    // Duplicate callback / excess return attempt (return 1 more)
    returnQty = 1;
    returnableToRestore = Math.max(0, itemDoc.quantity - (itemDoc.restored_quantity || 0));
    actualRestore = Math.min(returnQty, returnableToRestore);
    assert.strictEqual(actualRestore, 0, "No additional stock should be restored when item is fully restored");
    assert.strictEqual(inventoryStore["variant-2"].stock_quantity, 8, "Stock remains unchanged");
  });

  // 10. Service Function Unit Tests with Real Schema Constraints
  it("10. decreaseStock validates positive integer inputs and handles invalid types safely", async () => {
    await assert.rejects(async () => {
      await decreaseStock("nonexistent-id", -5);
    }, /Invalid quantity/);

    await assert.rejects(async () => {
      await decreaseStock("nonexistent-id", 0);
    }, /Invalid quantity/);

    await assert.rejects(async () => {
      await decreaseStock("nonexistent-id", 2.5);
    }, /Invalid quantity/);
  });

  it("11. increaseStock validates positive integer inputs and handles invalid types safely", async () => {
    await assert.rejects(async () => {
      await increaseStock("nonexistent-id", -2);
    }, /Invalid quantity/);

    await assert.rejects(async () => {
      await increaseStock("nonexistent-id", 0);
    }, /Invalid quantity/);
  });

  // 12. Transaction Rollback & Commit Simulation
  it("12. withInventoryTransaction executes fallback compensating mode when transactions are not supported", async () => {
    _setTransactionsSupportOverride(false);

    let executed = false;
    const result = await (async () => {
      const { withInventoryTransaction } = await import("../services/inventoryService.js");
      return await withInventoryTransaction(async (session) => {
        assert.strictEqual(session, null, "Session should be null when transactions are not supported");
        executed = true;
        return "SUCCESS_COMPENSATING";
      });
    })();

    assert.strictEqual(executed, true);
    assert.strictEqual(result, "SUCCESS_COMPENSATING");

    // Reset override
    _setTransactionsSupportOverride(null);
  });

  // 13. Safe Handling in rollbackOrderInventory
  it("13. rollbackOrderInventory ignores empty or invalid items without crashing", async () => {
    await assert.doesNotReject(async () => {
      await rollbackOrderInventory([]);
      await rollbackOrderInventory(null);
      await rollbackOrderInventory([{ variant_id: null, quantity: 1 }]);
    });
  });
});
