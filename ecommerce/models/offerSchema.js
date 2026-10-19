
import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    offer_type: {
      type: String,
      enum: ["PRODUCT", "CATEGORY", "REFERRAL"],
      required: true,
    },

    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },

    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },

    discount_type: {
      type: String,
      enum: ["PERCENTAGE", "FIXED"],
      required: true,
    },

    discount_value: {
      type: Number,
      required: true,
      min: 0.01,
    },

    start_date: {
      type: Date,
      required: true,
    },

    end_date: {
      type: Date,
      required: true,
    },

    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

offerSchema.pre("validate", function () {
  if (this.start_date && this.end_date &&
      this.end_date <= this.start_date) {
    this.invalidate(
      "end_date",
      "End date must be after start date"
    );
  }

  if (
    this.discount_type === "PERCENTAGE" &&
    this.discount_value > 100
  ) {
    this.invalidate(
      "discount_value",
      "Percentage cannot exceed 100"
    );
  }

  if (this.offer_type === "PRODUCT" && !this.product_id) {
    this.invalidate("product_id", "Product is required");
  }

  if (this.offer_type === "CATEGORY" && !this.category_id) {
    this.invalidate("category_id", "Category is required");
  }

  if (this.offer_type === "REFERRAL" && (this.product_id || this.category_id)) {
    this.invalidate("offer_type", "Referral offers cannot target a product or category");
  }
});

export default mongoose.model("Offer", offerSchema);
