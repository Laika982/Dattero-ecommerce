import mongoose from "mongoose";

const variantSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    weight: {
      type: String,
      required: true,
      trim: true,
    },

    regular_price: {
      type: Number,
      required: true,
      min: 0,
    },

    sale_price: {
      type: Number,
      default: null,
      min: 0,
    },

    stock_quantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

export default mongoose.model("Variant", variantSchema);