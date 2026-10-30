/**
 * Refund & Return Calculation Service
 *
 * Implements net-paid refund calculations allocating order-level discounts
 * (coupons, promotional offers, referral rewards) proportionally across items,
 * preventing refund overpayments and duplicate credits.
 */

/**
 * Calculates the proportional order-level discount allocated to each item,
 * determining the exact net amount paid per item and per unit.
 *
 * @param {Object} order - Mongoose order document or plain object
 * @returns {Array<Object>} Enriched items array with net pricing snapshots
 */
export function calculateItemProportionalPricing(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return [];
  }

  // Calculate gross line totals for all items in the order
  const itemsWithLineTotals = order.items.map((item) => {
    const rawPrice = Number(item.price) || 0;
    const qty = Number(item.quantity) || 1;
    const lineGross =
      item.item_total != null
        ? Number(item.item_total)
        : Number((rawPrice * qty).toFixed(2));
    return {
      item,
      lineGross,
    };
  });

  const totalItemsGross = itemsWithLineTotals.reduce(
    (sum, { lineGross }) => sum + lineGross,
    0,
  );

  // Total order-level discounts (coupons + referral discounts)
  const couponDiscount = Number(order.discount || 0);
  const referralDiscount = Number(order.referral_discount || 0);
  const totalOrderDiscount = Math.max(
    0,
    Math.min(couponDiscount + referralDiscount, totalItemsGross),
  );

  // Proportional discount allocation
  let allocatedDiscountSum = 0;
  const enrichedItems = itemsWithLineTotals.map(({ item, lineGross }, index) => {
    let discountShare = 0;
    if (totalItemsGross > 0 && totalOrderDiscount > 0) {
      discountShare = Number(
        ((lineGross / totalItemsGross) * totalOrderDiscount).toFixed(2),
      );
    }
    allocatedDiscountSum += discountShare;

    return {
      _id: item._id,
      item,
      lineGross,
      discountShare,
    };
  });

  // Adjust any fractional rounding difference (e.g. +/- 0.01) on the item with the largest line total
  const roundingDifference = Number(
    (totalOrderDiscount - allocatedDiscountSum).toFixed(2),
  );
  if (roundingDifference !== 0 && enrichedItems.length > 0) {
    let maxItemIndex = 0;
    let maxGross = -1;
    enrichedItems.forEach((entry, idx) => {
      if (entry.lineGross > maxGross) {
        maxGross = entry.lineGross;
        maxItemIndex = idx;
      }
    });
    enrichedItems[maxItemIndex].discountShare = Number(
      (enrichedItems[maxItemIndex].discountShare + roundingDifference).toFixed(2),
    );
  }

  // Compute final net paid amounts per item and unit
  return enrichedItems.map((entry) => {
    const { item, lineGross, discountShare } = entry;
    const qty = Number(item.quantity) || 1;
    const netItemPaid = Math.max(
      0,
      Number((lineGross - discountShare).toFixed(2)),
    );
    const netUnitPrice = Number((netItemPaid / qty).toFixed(2));
    const returnedQty = Number(item.returned_quantity || 0);
    const returnableQuantity = Math.max(0, qty - returnedQty);
    const previouslyRefunded = Number(item.refunded_amount || 0);
    const remainingItemRefundable = Math.max(
      0,
      Number((netItemPaid - previouslyRefunded).toFixed(2)),
    );

    return {
      _id: String(item._id),
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name,
      quantity: qty,
      returned_quantity: returnedQty,
      returnable_quantity: returnableQuantity,
      original_price: Number(item.price) || 0,
      line_gross: lineGross,
      discount_share: discountShare,
      net_item_paid: netItemPaid,
      net_unit_price: netUnitPrice,
      previously_refunded: previouslyRefunded,
      remaining_item_refundable: remainingItemRefundable,
      status: item.status,
    };
  });
}

/**
 * Calculates the exact return refund for selected items, enforcing:
 * 1. Proportional discount deduction (net amount paid, not gross price)
 * 2. Per-item refundable limits
 * 3. Total order refundable limits (cannot exceed order.final_amount)
 * 4. Payment status validation (only paid orders can be refunded)
 * 5. Idempotent returnable quantity validation
 *
 * @param {Object} params
 * @param {Object} params.order - Order document
 * @param {Array<Object>} params.requestedItems - [{ itemId, quantity, reason }]
 * @returns {Object} { success, refundAmount, itemsToReturn, summary }
 */
export function calculateOrderReturnRefund({ order, requestedItems }) {
  if (!order) {
    throw new Error("Order is required for return refund calculation.");
  }

  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new Error("Select at least one product to return.");
  }

  // Payment status check: unpaid orders cannot receive wallet refunds
  if (order.payment_status !== "paid") {
    throw new Error(
      `Cannot refund order with payment status '${order.payment_status}'. Only paid orders are eligible for refunds.`,
    );
  }

  // Check cumulative order-level refund cap
  const originalFinalAmount =
    order.original_final_amount != null
      ? Number(order.original_final_amount)
      : Number(order.final_amount || 0);

  const orderRefundedSoFar = Number(order.refunded_amount || 0);
  const maxOrderRefundable = Math.max(
    0,
    Number((originalFinalAmount - orderRefundedSoFar).toFixed(2)),
  );

  if (maxOrderRefundable <= 0) {
    throw new Error(
      "This order has already been fully refunded. No additional refunds are possible.",
    );
  }

  // Calculate proportional net pricing for all items in the order
  const pricingMap = new Map();
  const pricingList = calculateItemProportionalPricing(order);
  pricingList.forEach((entry) => {
    pricingMap.set(entry._id, entry);
  });

  const orderWasDelivered = ["delivered", "return_requested"].includes(
    order.order_status,
  );

  const itemsToReturn = [];
  const seenItemIds = new Set();
  let rawTotalRefund = 0;

  for (const requestedItem of requestedItems) {
    const itemId = String(requestedItem.itemId || "");
    if (!itemId || seenItemIds.has(itemId)) {
      throw new Error("Duplicate or invalid item selected in return request.");
    }
    seenItemIds.add(itemId);

    const pricingInfo = pricingMap.get(itemId);
    const itemDoc = order.items.id ? order.items.id(itemId) : order.items.find((i) => String(i._id) === itemId);

    if (!pricingInfo || !itemDoc) {
      throw new Error(`Item ${itemId} not found in this order.`);
    }

    if (itemDoc.status === "cancelled") {
      throw new Error(`${itemDoc.product_name} is cancelled and cannot be returned.`);
    }

    const delivered =
      itemDoc.status === "delivered" ||
      (orderWasDelivered && itemDoc.status === "pending");

    if (!delivered) {
      throw new Error(`${itemDoc.product_name} is not in delivered status.`);
    }

    const returnableQty = pricingInfo.returnable_quantity;
    if (returnableQty <= 0) {
      throw new Error(
        `All units of ${itemDoc.product_name} have already been returned or refunded.`,
      );
    }

    const parsedQty = Number(requestedItem.quantity);
    const returnQty =
      Number.isInteger(parsedQty) && parsedQty >= 1
        ? parsedQty
        : returnableQty;

    if (returnQty < 1 || returnQty > returnableQty) {
      throw new Error(
        `Invalid return quantity ${returnQty} for ${itemDoc.product_name}. Maximum returnable is ${returnableQty}.`,
      );
    }

    // Calculate item-level refund:
    // If returning all remaining units of this item, refund exact remaining refundable amount to prevent penny rounding drift.
    // If partial return, refund proportional fraction of net paid amount.
    let itemRefund = 0;
    if (returnQty === returnableQty) {
      itemRefund = pricingInfo.remaining_item_refundable;
    } else {
      const rawRefund = (pricingInfo.net_item_paid / pricingInfo.quantity) * returnQty;
      itemRefund = Math.min(
        pricingInfo.remaining_item_refundable,
        Number(rawRefund.toFixed(2)),
      );
    }

    // Guard: Item refund cannot exceed remaining refundable for this item
    itemRefund = Math.min(itemRefund, pricingInfo.remaining_item_refundable);
    itemRefund = Number(Math.max(0, itemRefund).toFixed(2));

    rawTotalRefund += itemRefund;

    const reason =
      String(requestedItem.reason || "").trim() ||
      String(order.return_request?.reason || "").trim() ||
      "Return approved by admin";

    itemsToReturn.push({
      itemDoc,
      pricingInfo,
      quantity: returnQty,
      itemRefund,
      reason,
    });
  }

  // Guard: Order total refund cannot exceed the remaining refundable amount for the order
  const finalRefundAmount = Number(
    Math.min(rawTotalRefund, maxOrderRefundable).toFixed(2),
  );

  if (finalRefundAmount <= 0) {
    throw new Error("Unable to calculate a valid positive refund for the selected items.");
  }

  return {
    success: true,
    refundAmount: finalRefundAmount,
    maxOrderRefundable,
    orderRefundedSoFar,
    originalFinalAmount,
    itemsToReturn,
  };
}

