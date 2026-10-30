import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "stream";
import {
  calculateInvoiceTotals,
  generateInvoicePDF,
} from "../services/invoiceService.js";

// Helper to collect PDF document output into a buffer
function getPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    doc.pipe(writable);
    writable.on("finish", () => resolve(Buffer.concat(chunks)));
    writable.on("error", reject);
  });
}

test("1. Order with No Coupon: calculates exact subtotal, shipping, and grand total", () => {
  const order = {
    order_id: "ORD-NO-COUPON-001",
    subtotal: 800,
    discount: 0,
    shipping_charge: 50,
    tax: 0,
    final_amount: 850,
    original_final_amount: 850,
    refunded_amount: 0,
    items: [
      { product_name: "Ajwa Dates 250g", sku: "AJWA-250", quantity: 2, price: 250, item_total: 500 },
      { product_name: "Medjool Dates 250g", sku: "MED-250", quantity: 1, price: 300, item_total: 300 },
    ],
  };

  const totals = calculateInvoiceTotals(order);

  assert.equal(totals.subtotal, 800);
  assert.equal(totals.couponDiscount, 0);
  assert.equal(totals.couponCode, null);
  assert.equal(totals.shippingCharge, 50);
  assert.equal(totals.tax, 0);
  assert.equal(totals.originalFinalAmount, 850);
  assert.equal(totals.refundedAmount, 0);
  assert.equal(totals.netPaidAmount, 850);
});

test("2. Order with Percentage Discount: preserves coupon discount and calculates consistent totals", () => {
  const order = {
    order_id: "ORD-PERCENT-COUPON-002",
    subtotal: 600,
    discount: 120, // 20% of 600
    coupon_code: "SAVE20",
    shipping_charge: 0,
    tax: 0,
    final_amount: 480,
    original_final_amount: 480,
    refunded_amount: 0,
    items: [
      { product_name: "Organic Safawi 500g", sku: "SAF-500", quantity: 1, price: 350, item_total: 350 },
      { product_name: "Organic Mabroom 250g", sku: "MAB-250", quantity: 1, price: 250, item_total: 250 },
    ],
  };

  const totals = calculateInvoiceTotals(order);

  assert.equal(totals.subtotal, 600);
  assert.equal(totals.couponDiscount, 120);
  assert.equal(totals.couponCode, "SAVE20");
  assert.equal(totals.shippingCharge, 0);
  assert.equal(totals.originalFinalAmount, 480);
  assert.equal(totals.netPaidAmount, 480);
});

test("3. Order with Maximum Discount Cap: respects capped discount recorded at placement", () => {
  // 25% of 2000 is 500, but capped at 250
  const order = {
    order_id: "ORD-CAPPED-COUPON-003",
    subtotal: 2000,
    discount: 250,
    coupon_code: "MAX250",
    shipping_charge: 0,
    tax: 0,
    final_amount: 1750,
    original_final_amount: 1750,
    refunded_amount: 0,
    items: [
      { product_name: "Premium Gift Box", sku: "GIFT-01", quantity: 2, price: 1000, item_total: 2000 },
    ],
  };

  const totals = calculateInvoiceTotals(order);

  assert.equal(totals.subtotal, 2000);
  assert.equal(totals.couponDiscount, 250);
  assert.equal(totals.couponCode, "MAX250");
  assert.equal(totals.originalFinalAmount, 1750);
});

test("4. Order with Fixed Discount: preserves flat coupon reduction", () => {
  const order = {
    order_id: "ORD-FIXED-COUPON-004",
    subtotal: 750,
    discount: 150,
    coupon_code: "FLAT150",
    shipping_charge: 0,
    tax: 0,
    final_amount: 600,
    original_final_amount: 600,
    refunded_amount: 0,
    items: [
      { product_name: "Sukari Dates 500g", sku: "SUK-500", quantity: 3, price: 250, item_total: 750 },
    ],
  };

  const totals = calculateInvoiceTotals(order);

  assert.equal(totals.subtotal, 750);
  assert.equal(totals.couponDiscount, 150);
  assert.equal(totals.couponCode, "FLAT150");
  assert.equal(totals.originalFinalAmount, 600);
});

test("5. Multiple items below free shipping threshold: retains shipping and coupon simultaneously", () => {
  const order = {
    order_id: "ORD-SHIPPING-COUPON-005",
    subtotal: 420,
    discount: 50,
    coupon_code: "WELCOME50",
    shipping_charge: 50,
    tax: 0,
    final_amount: 420, // 420 - 50 + 50 = 420
    original_final_amount: 420,
    refunded_amount: 0,
    items: [
      { product_name: "Item A", sku: "SKU-A", quantity: 2, price: 150, item_total: 300 },
      { product_name: "Item B", sku: "SKU-B", quantity: 1, price: 120, item_total: 120 },
    ],
  };

  const totals = calculateInvoiceTotals(order);

  assert.equal(totals.subtotal, 420);
  assert.equal(totals.couponDiscount, 50);
  assert.equal(totals.shippingCharge, 50);
  assert.equal(totals.originalFinalAmount, 420);
  assert.equal(totals.netPaidAmount, 420);
});

test("6. Partial return/refund preserves original purchase totals and accurately displays refund", () => {
  const order = {
    order_id: "ORD-REFUND-006",
    subtotal: 1000,
    discount: 100,
    coupon_code: "SAVE10",
    shipping_charge: 0,
    tax: 0,
    original_final_amount: 900,
    final_amount: 630, // final_amount mutated by partial return
    refunded_amount: 270, // 300 item - 30 proportional discount = 270
    items: [
      { product_name: "Item Kept", sku: "KEPT-1", quantity: 1, price: 700, item_total: 700, status: "delivered" },
      { product_name: "Item Returned", sku: "RET-1", quantity: 1, price: 300, item_total: 300, status: "returned" },
    ],
  };

  const totals = calculateInvoiceTotals(order);

  // Original commercial invoice totals must remain intact
  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.couponDiscount, 100);
  assert.equal(totals.couponCode, "SAVE10");
  assert.equal(totals.originalFinalAmount, 900);

  // Refunded details clearly recorded
  assert.equal(totals.refundedAmount, 270);
  assert.equal(totals.netPaidAmount, 630);
});

test("7. generateInvoicePDF successfully creates a valid non-empty PDF document buffer", async () => {
  const order = {
    order_id: "ORD-PDF-STREAM-007",
    createdAt: new Date("2026-10-15"),
    payment_method: "upi",
    subtotal: 1200,
    discount: 150,
    coupon_code: "FESTIVE150",
    shipping_charge: 0,
    tax: 0,
    original_final_amount: 1050,
    final_amount: 1050,
    refunded_amount: 0,
    shipping_address: {
      full_name: "Priya Sharma",
      phone_number: "+91 9876543210",
      address: "123 Palm Avenue",
      city: "Kochi",
      state: "Kerala",
      zip_code: "682001",
    },
    items: [
      { product_name: "Medjool Jumbo 500g", sku: "MED-JUMBO", quantity: 2, price: 600, item_total: 1200, status: "delivered" },
    ],
  };

  const doc = generateInvoicePDF(order);
  const pdfBuffer = await getPdfBuffer(doc);

  assert.ok(pdfBuffer.length > 500, "PDF buffer must be non-empty");
  // PDF standard header check: starts with %PDF-
  const header = pdfBuffer.slice(0, 5).toString("utf-8");
  assert.equal(header, "%PDF-", "Generated document must be a valid PDF file");
});

