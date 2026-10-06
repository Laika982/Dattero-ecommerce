export const calculateItemPrice = (variant) => {
  if (
    variant.sale_price !== null &&
    variant.sale_price !== undefined &&
    variant.sale_price < variant.regular_price
  ) {
    return variant.sale_price;
  }

  return variant.regular_price;
};

export const calculateCartTotals = (items) => {
  let subtotal = 0;

  for (const item of items) {
    subtotal += item.item_total;
  }

  // You can change these business rules later
  const discount = 0;

  const tax = 0;

  const shipping = subtotal >= 1000 ? 0 : 50;

  const finalAmount = subtotal - discount + tax + shipping;

  return {
    subtotal,
    discount,
    tax,
    shipping,
    finalAmount,
  };
};
