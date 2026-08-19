import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    price: {
      type: Number,
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    total_price: {
      type: Number,
      required: true
    },
    coupon_code: {
      type: String,
      required: false
    }
  }
);

export default mongoose.model("Cart", cartSchema);