import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    discount_type: {
      type: String,
      enum: ["PERCENTAGE", "FIXED"],
      required: true,
    },

    discount_value: {
      type: Number,
      required: true,
      min: 0,
    },

    max_discount: {
      type: Number,
      default: null,
    },

    minimum_purchase: {
      type: Number,
      default: 0,
    },

    usage_limit: {
      type: Number,
      default: null,
    },

    used_count: {
      type: Number,
      default: 0,
    },

    expiry_date: {
      type: Date,
      required: true,
    },

    is_active: {
      type: Boolean,
      default: true,
    },

    applies_to: {
      type: String,
      enum: ["ALL", "CATEGORY", "PRODUCT"],
      default: "ALL",
    },

    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      required: false,
    },

    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
      required: false,
    },

    start_date: {
      type: Date,
      required: true,
    },

    used_by: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Coupon", couponSchema);
