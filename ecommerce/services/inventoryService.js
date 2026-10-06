import Variant from "../models/variantSchema.js";


export const validateStock = async (variantId, quantity) => {

  const variant = await Variant.findById(variantId);

  if (!variant) {
    throw new Error("Variant not found");
  }

  if (variant.stock_quantity <= 0) {
    throw new Error("Product is out of stock");
  }

  if (variant.stock_quantity < quantity) {
    throw new Error(
      `Only ${variant.stock_quantity} items available`
    );
  }

  return variant;
};


export const decreaseStock = async (
  variantId,
  quantity,
  session = null
) => {

  const options = {
    new: true,
  };

  if (session) {
    options.session = session;
  }

  const variant = await Variant.findOneAndUpdate(
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

    options
  );

  if (!variant) {
    throw new Error(
      "Insufficient stock. Please refresh your cart."
    );
  }

  return variant;
};


export const increaseStock = async (
  variantId,
  quantity,
  session = null
) => {

  const options = {};

  if (session) {
    options.session = session;
  }

  return Variant.findByIdAndUpdate(
    variantId,

    {
      $inc: {
        stock_quantity: quantity,
      },
    },

    {
      new: true,
      ...options,
    }
  );
};