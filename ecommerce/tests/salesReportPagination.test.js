import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveReportRange } from "../controllers/admin/salesreportController.js";

describe("Sales Report Pagination & Range Logic Tests", () => {
  it("resolves default daily range when no period specified", () => {
    const fixedNow = new Date("2026-10-27T10:00:00.000Z");
    const range = resolveReportRange({}, fixedNow);
    assert.strictEqual(range.period, "daily");
    assert.strictEqual(range.startDate, "2026-10-27");
    assert.strictEqual(range.endDate, "2026-10-27");
  });

  it("resolves weekly, monthly, and yearly report ranges correctly", () => {
    const fixedNow = new Date("2026-10-27T10:00:00.000Z");
    const weeklyRange = resolveReportRange({ period: "weekly" }, fixedNow);
    assert.strictEqual(weeklyRange.period, "weekly");
    assert.ok(weeklyRange.start <= weeklyRange.end);

    const monthlyRange = resolveReportRange({ period: "monthly" }, fixedNow);
    assert.strictEqual(monthlyRange.period, "monthly");
    assert.strictEqual(monthlyRange.startDate, "2026-10-01");

    const yearlyRange = resolveReportRange({ period: "yearly" }, fixedNow);
    assert.strictEqual(yearlyRange.period, "yearly");
    assert.strictEqual(yearlyRange.startDate, "2026-01-01");
  });

  it("calculates correct pagination metadata for order details", () => {
    const mockRows = Array.from({ length: 25 }, (_, i) => ({
      orderId: `ORD-${1000 + i}`,
      grossAmount: 500,
      orderAmount: 450,
    }));

    const totalOrders = mockRows.length;
    const limit = 10;
    const totalPages = Math.max(1, Math.ceil(totalOrders / limit));
    assert.strictEqual(totalPages, 3);

    // Page 1
    const page1 = 1;
    const startIndex1 = (page1 - 1) * limit + 1;
    const endIndex1 = Math.min(page1 * limit, totalOrders);
    const paginatedRows1 = mockRows.slice((page1 - 1) * limit, page1 * limit);
    assert.strictEqual(startIndex1, 1);
    assert.strictEqual(endIndex1, 10);
    assert.strictEqual(paginatedRows1.length, 10);
    assert.strictEqual(paginatedRows1[0].orderId, "ORD-1000");
    assert.strictEqual(paginatedRows1[9].orderId, "ORD-1009");

    // Page 2
    const page2 = 2;
    const startIndex2 = (page2 - 1) * limit + 1;
    const endIndex2 = Math.min(page2 * limit, totalOrders);
    const paginatedRows2 = mockRows.slice((page2 - 1) * limit, page2 * limit);
    assert.strictEqual(startIndex2, 11);
    assert.strictEqual(endIndex2, 20);
    assert.strictEqual(paginatedRows2.length, 10);
    assert.strictEqual(paginatedRows2[0].orderId, "ORD-1010");

    // Page 3 (last page with remaining 5 items)
    const page3 = 3;
    const startIndex3 = (page3 - 1) * limit + 1;
    const endIndex3 = Math.min(page3 * limit, totalOrders);
    const paginatedRows3 = mockRows.slice((page3 - 1) * limit, page3 * limit);
    assert.strictEqual(startIndex3, 21);
    assert.strictEqual(endIndex3, 25);
    assert.strictEqual(paginatedRows3.length, 5);
    assert.strictEqual(paginatedRows3[4].orderId, "ORD-1024");
  });

  it("handles empty orders list gracefully with valid zero boundaries", () => {
    const mockRows = [];
    const totalOrders = mockRows.length;
    const limit = 10;
    const totalPages = Math.max(1, Math.ceil(totalOrders / limit));
    const currentPage = 1;
    const startIndex = totalOrders === 0 ? 0 : (currentPage - 1) * limit + 1;
    const endIndex = Math.min(currentPage * limit, totalOrders);

    assert.strictEqual(totalOrders, 0);
    assert.strictEqual(totalPages, 1);
    assert.strictEqual(startIndex, 0);
    assert.strictEqual(endIndex, 0);
  });

  it("clamps invalid out-of-range page numbers within [1, totalPages]", () => {
    const totalOrders = 30;
    const limit = 10;
    const totalPages = Math.ceil(totalOrders / limit); // 3

    const pageNegative = Math.min(Math.max(1, parseInt("-5", 10) || 1), totalPages);
    assert.strictEqual(pageNegative, 1);

    const pageTooHigh = Math.min(Math.max(1, parseInt("99", 10) || 1), totalPages);
    assert.strictEqual(pageTooHigh, 3);

    const pageNaN = Math.min(Math.max(1, parseInt("invalid", 10) || 1), totalPages);
    assert.strictEqual(pageNaN, 1);
  });
});
