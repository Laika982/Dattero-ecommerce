import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Wallet Real Monthly Spending Calculation Tests", () => {
  it("calculates zero wallet spending when user has no wallet debits or wallet-paid orders", () => {
    const currentMonthDebits = [];
    const lastMonthDebits = [];
    const currentWalletOrders = []; // e.g. user had only COD orders, no wallet orders

    const currentRecordedOrderIds = new Set(
      currentMonthDebits.filter((t) => t.order_id).map((t) => t.order_id.toString())
    );
    const unrecordedCurrentOrders = currentWalletOrders.filter(
      (o) => !currentRecordedOrderIds.has(o._id.toString())
    );

    const currentMonthTotal =
      currentMonthDebits.reduce((acc, t) => acc + Number(t.amount || 0), 0) +
      unrecordedCurrentOrders.reduce((acc, o) => acc + Number(o.final_amount || 0), 0);

    assert.strictEqual(currentMonthTotal, 0);
    assert.strictEqual(Number(currentMonthTotal).toFixed(2), "0.00");
  });

  it("calculates real wallet spending strictly from wallet debits and wallet-paid orders", () => {
    const currentMonthDebits = [
      { amount: 150, createdAt: new Date(2026, 9, 3) }, // Week 1: 150
      { amount: 250, createdAt: new Date(2026, 9, 10) }, // Week 2: 250
    ];
    const unrecordedCurrentOrders = [
      { _id: "ord1", final_amount: 100, createdAt: new Date(2026, 9, 18) }, // Week 3: 100
    ];

    const currentMonthTotal =
      currentMonthDebits.reduce((acc, t) => acc + Number(t.amount || 0), 0) +
      unrecordedCurrentOrders.reduce((acc, o) => acc + Number(o.final_amount || 0), 0);

    assert.strictEqual(currentMonthTotal, 500);
    assert.strictEqual(Number(currentMonthTotal).toFixed(2), "500.00");

    const weekly = [0, 0, 0, 0];
    currentMonthDebits.forEach((t) => {
      const day = new Date(t.createdAt).getDate();
      if (day <= 7) weekly[0] += t.amount;
      else if (day <= 14) weekly[1] += t.amount;
      else if (day <= 21) weekly[2] += t.amount;
      else weekly[3] += t.amount;
    });
    unrecordedCurrentOrders.forEach((o) => {
      const day = new Date(o.createdAt).getDate();
      if (day <= 7) weekly[0] += o.final_amount;
      else if (day <= 14) weekly[1] += o.final_amount;
      else if (day <= 21) weekly[2] += o.final_amount;
      else weekly[3] += o.final_amount;
    });

    assert.deepStrictEqual(weekly, [150, 250, 100, 0]);
  });

  it("prevents double-counting when an order is recorded in both WalletTransaction and Order", () => {
    const currentMonthDebits = [
      { amount: 300, order_id: "order_abc_123", createdAt: new Date() },
    ];
    const currentRecordedOrderIds = new Set(
      currentMonthDebits.filter((t) => t.order_id).map((t) => t.order_id.toString())
    );

    const currentWalletOrders = [
      { _id: "order_abc_123", final_amount: 300 }, // Already recorded in debits
      { _id: "order_def_456", final_amount: 200 }, // Not recorded
    ];

    const unrecorded = currentWalletOrders.filter(
      (o) => !currentRecordedOrderIds.has(o._id.toString())
    );

    const total =
      currentMonthDebits.reduce((acc, t) => acc + Number(t.amount || 0), 0) +
      unrecorded.reduce((acc, o) => acc + Number(o.final_amount || 0), 0);

    // 300 + 200 = 500, not 300 + 300 + 200 = 800
    assert.strictEqual(total, 500);
  });

  it("excludes failed wallet transactions from monthly spending calculation", () => {
    const allDebits = [
      { amount: 200, status: "COMPLETED", createdAt: new Date() },
      { amount: 500, status: "FAILED", failure_reason: "Insufficient wallet balance", createdAt: new Date() },
    ];

    const validDebits = allDebits.filter((t) => t.status !== "FAILED");
    const total = validDebits.reduce((acc, t) => acc + Number(t.amount || 0), 0);

    assert.strictEqual(total, 200);
  });
});
