import PDFDocument from "pdfkit";

/**
 * Calculates complete, accurate invoice totals using immutable order snapshots.
 * Preserves original purchase amounts, discounts, shipping, taxes, and refunds.
 */
export const calculateInvoiceTotals = (order = {}) => {
  const items = order.items || [];
  const rawSubtotal = items.reduce(
    (acc, it) =>
      acc +
      Number(
        it.item_total != null
          ? it.item_total
          : (Number(it.price || 0) * Number(it.quantity || 0)) || 0
      ),
    0
  );

  const subtotal = Number(
    (order.subtotal != null ? order.subtotal : rawSubtotal).toFixed(2)
  );

  const couponDiscount = Number(
    (order.discount != null
      ? order.discount
      : (order.coupon_discount || 0)
    ).toFixed(2)
  );

  const referralDiscount = Number((order.referral_discount || 0).toFixed(2));
  const offerDiscount = Number((order.offer_discount || 0).toFixed(2));
  const totalDiscount = Number(
    (couponDiscount + referralDiscount + offerDiscount).toFixed(2)
  );

  const shippingCharge = Number((order.shipping_charge != null ? order.shipping_charge : 0).toFixed(2));
  const tax = Number((order.tax != null ? order.tax : 0).toFixed(2));

  const originalFinalAmount = Number(
    (order.original_final_amount != null
      ? order.original_final_amount
      : (order.final_amount != null
          ? order.final_amount
          : Math.max(0, subtotal - couponDiscount - referralDiscount + shippingCharge + tax))
    ).toFixed(2)
  );

  const refundedAmount = Number((order.refunded_amount || 0).toFixed(2));
  const netPaidAmount = Number(Math.max(0, originalFinalAmount - refundedAmount).toFixed(2));

  return {
    subtotal,
    couponDiscount,
    couponCode: order.coupon_code || null,
    referralDiscount,
    offerDiscount,
    totalDiscount,
    shippingCharge,
    tax,
    finalAmount: originalFinalAmount,
    originalFinalAmount,
    refundedAmount,
    netPaidAmount,
  };
};

export const generateInvoicePDF = (order, res) => {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
  });

  // --------------------------------------------------
  // RESPONSE HEADERS & STREAMING
  // --------------------------------------------------

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${order.order_id || "invoice"}.pdf"`
    );
  }

  if (res && (typeof res.pipe === "function" || typeof res.write === "function")) {
    doc.pipe(res);
  }

  // --------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // --------------------------------------------------
  // HELPER FUNCTIONS
  // --------------------------------------------------

  const formatCurrency = (value) => {
    return `Rs. ${Number(value || 0).toFixed(2)}`;
  };

  const formatDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const drawLine = (yPosition) => {
    doc
      .moveTo(margin, yPosition)
      .lineTo(pageWidth - margin, yPosition)
      .stroke();
  };

  const drawLabelValue = (
    label,
    value,
    x,
    yPosition,
    width = 200
  ) => {
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(label, x, yPosition);

    doc
      .font("Helvetica")
      .text(value || "-", x + 80, yPosition, {
        width: width - 80,
      });
  };

  // --------------------------------------------------
  // HEADER
  // --------------------------------------------------

  doc
    .font("Helvetica-Bold")
    .fontSize(24)
    .text("Nutri Burfi", margin, y, {
      width: contentWidth,
      align: "center",
    });

  y += 32;

  doc
    .font("Helvetica")
    .fontSize(9)
    .text(
      "Your Store Address • Kerala, India • +91 XXXXX XXXXX",
      margin,
      y,
      {
        width: contentWidth,
        align: "center",
      }
    );

  y += 30;

  // --------------------------------------------------
  // INVOICE TITLE
  // --------------------------------------------------

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("INVOICE", margin, y, {
      width: contentWidth,
      align: "center",
    });

  y += 30;

  drawLine(y);

  y += 15;

  // --------------------------------------------------
  // ORDER INFORMATION
  // --------------------------------------------------

  const leftColumn = margin;
  const rightColumn = pageWidth / 2 + 20;

  drawLabelValue(
    "Order ID:",
    order.order_id,
    leftColumn,
    y
  );

  drawLabelValue(
    "Order Date:",
    formatDate(order.createdAt || Date.now()),
    rightColumn,
    y
  );

  y += 18;

  drawLabelValue(
    "Payment:",
    (order.payment_method || "COD").toUpperCase(),
    leftColumn,
    y
  );

  y += 25;

  drawLine(y);

  y += 18;

  // --------------------------------------------------
  // CUSTOMER / SHIPPING INFORMATION
  // --------------------------------------------------

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("CUSTOMER INFORMATION", leftColumn, y);

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("SHIPPING ADDRESS", rightColumn, y);

  y += 22;

  const customer = order.shipping_address || {};

  // Customer column
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(customer.full_name || "-", leftColumn, y);

  y += 16;

  doc
    .font("Helvetica")
    .fontSize(10)
    .text(customer.phone_number || "-", leftColumn, y);

  y += 16;

  // Shipping column
  const shippingStartY = y - 32;

  doc
    .font("Helvetica")
    .fontSize(10)
    .text(
      customer.address || "-",
      rightColumn,
      shippingStartY,
      {
        width: 200,
      }
    );

  doc.text(
    `${customer.city || "-"}, ${customer.state || "-"
    }`,
    rightColumn,
    shippingStartY + 16,
    {
      width: 200,
    }
  );

  doc.text(
    `${customer.zip_code || ""}`,
    rightColumn,
    shippingStartY + 32,
    {
      width: 200,
    }
  );

  y += 45;

  drawLine(y);

  y += 18;

  // --------------------------------------------------
  // PRODUCTS TITLE
  // --------------------------------------------------

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("PRODUCTS", margin, y);

  y += 22;

  // --------------------------------------------------
  // PRODUCT TABLE
  // --------------------------------------------------

  const tableX = margin;

  const productWidth = 190;
  const skuWidth = 75;
  const qtyWidth = 45;
  const priceWidth = 70;
  const totalWidth = 75;

  const productX = tableX;
  const skuX = productX + productWidth;
  const qtyX = skuX + skuWidth;
  const priceX = qtyX + qtyWidth;
  const totalX = priceX + priceWidth;

  // Table header background
  doc
    .rect(
      tableX,
      y - 5,
      contentWidth,
      25
    )
    .fill("#eeeeee");

  doc
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .fontSize(9);

  doc.text(
    "Product",
    productX + 5,
    y + 3,
    {
      width: productWidth - 10,
    }
  );

  doc.text(
    "SKU",
    skuX,
    y + 3,
    {
      width: skuWidth,
    }
  );

  doc.text(
    "Qty",
    qtyX,
    y + 3,
    {
      width: qtyWidth,
      align: "center",
    }
  );

  doc.text(
    "Price",
    priceX,
    y + 3,
    {
      width: priceWidth,
      align: "right",
    }
  );

  doc.text(
    "Total",
    totalX,
    y + 3,
    {
      width: totalWidth,
      align: "right",
    }
  );

  y += 30;

  // --------------------------------------------------
  // PRODUCT ROWS
  // --------------------------------------------------

  doc.font("Helvetica").fontSize(9);

  const items = order.items || [];
  items.forEach((item) => {
    const rowHeight = 35;

    const statusSuffix =
      item.status === "cancelled"
        ? " (Cancelled)"
        : item.status === "returned"
        ? " (Returned)"
        : "";

    // Product
    doc.text(
      `${item.product_name || "-"}${statusSuffix}`,
      productX + 5,
      y,
      {
        width: productWidth - 10,
      }
    );

    // SKU
    doc.text(
      item.sku || "-",
      skuX,
      y,
      {
        width: skuWidth,
      }
    );

    // Quantity
    doc.text(
      String(item.quantity || 0),
      qtyX,
      y,
      {
        width: qtyWidth,
        align: "center",
      }
    );

    // Price
    doc.text(
      formatCurrency(item.price),
      priceX,
      y,
      {
        width: priceWidth,
        align: "right",
      }
    );

    // Total
    const itemTotal =
      item.item_total != null
        ? item.item_total
        : Number(item.price || 0) * Number(item.quantity || 0);

    doc.text(
      formatCurrency(itemTotal),
      totalX,
      y,
      {
        width: totalWidth,
        align: "right",
      }
    );

    y += rowHeight;

    drawLine(y - 10);
  });

  y += 15;

  // --------------------------------------------------
  // TOTALS
  // --------------------------------------------------

  const totalsLabelX = pageWidth - margin - 190;
  const totalsValueX = pageWidth - margin - 75;

  const drawTotalRow = (
    label,
    value,
    bold = false
  ) => {
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 12 : 10)
      .text(
        label,
        totalsLabelX,
        y,
        {
          width: 110,
          align: "right",
        }
      );

    doc.text(
      value,
      totalsValueX,
      y,
      {
        width: 75,
        align: "right",
      }
    );

    y += bold ? 22 : 18;
  };

  const totals = calculateInvoiceTotals(order);

  drawTotalRow(
    "Subtotal",
    formatCurrency(totals.subtotal)
  );

  if (totals.couponDiscount > 0) {
    const couponLabel = totals.couponCode
      ? `Coupon (${totals.couponCode})`
      : "Coupon Discount";
    drawTotalRow(
      couponLabel,
      `- ${formatCurrency(totals.couponDiscount)}`
    );
  }

  if (totals.referralDiscount > 0) {
    drawTotalRow(
      "Referral Discount",
      `- ${formatCurrency(totals.referralDiscount)}`
    );
  }

  if (totals.offerDiscount > 0) {
    drawTotalRow(
      "Offer Discount",
      `- ${formatCurrency(totals.offerDiscount)}`
    );
  }

  drawTotalRow(
    "Tax",
    formatCurrency(totals.tax)
  );

  drawTotalRow(
    "Shipping",
    totals.shippingCharge === 0 ? "Free" : formatCurrency(totals.shippingCharge)
  );

  y += 5;
  drawLine(y);
  y += 15;

  // --------------------------------------------------
  // GRAND TOTAL
  // --------------------------------------------------

  drawTotalRow(
    "GRAND TOTAL",
    formatCurrency(totals.originalFinalAmount),
    true
  );

  // Partial Return / Refund section if order had refunds
  if (totals.refundedAmount > 0) {
    y += 5;
    drawTotalRow(
      "Refunded",
      `- ${formatCurrency(totals.refundedAmount)}`
    );
    drawTotalRow(
      "Net Paid",
      formatCurrency(totals.netPaidAmount),
      true
    );
  }

  y += 45;

  // --------------------------------------------------
  // FOOTER
  // --------------------------------------------------

  drawLine(y);

  y += 18;

  doc
    .font("Helvetica")
    .fontSize(10)
    .text(
      "Thank you for shopping with us!",
      margin,
      y,
      {
        width: contentWidth,
        align: "center",
      }
    );

  y += 18;

  doc
    .fontSize(8)
    .text(
      "This is a computer-generated invoice and does not require a signature.",
      margin,
      y,
      {
        width: contentWidth,
        align: "center",
      }
    );

  // --------------------------------------------------
  // END PDF
  // --------------------------------------------------

  doc.end();
  return doc;
};

export default {
  calculateInvoiceTotals,
  generateInvoicePDF,
};
