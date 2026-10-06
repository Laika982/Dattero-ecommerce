import Variant from "../models/variantSchema.js";


export const decreaseStock = async (
  variantId,
  quantity
) => {
  const variant =
    await Variant.findOneAndUpdate(
      {
        _id: variantId,

        stock_quantity: {
          $gte: quantity,
        },
      },

      {
        $inc: {
          stock_quantity: -quantity,
        },
      },

      {
        new: true,
      }
    );

  if (!variant) {
    throw new Error(
      "Insufficient stock"
    );
  }

  return variant;
};