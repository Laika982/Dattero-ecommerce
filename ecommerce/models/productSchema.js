import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    productName: {
      type: String,
      required: true,
      trim: true,
    },

    productDescription: {
      type: String,
      required: true,
      trim: true,
    },

    images: [
      {
        url: {
          type: String,
          required: true,
        },

        public_id: {
          type: String,
          required: true,
        },
      },
    ],

    average_rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    review_count: {
      type: Number,
      default: 0,
      min: 0,
    },

    is_listed: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

export default mongoose.model("Product", productSchema);