import mongoose from "mongoose";

const referralRewardSchema = new mongoose.Schema(
  {
    referrer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referred_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // Guarantees a referred user only ever triggers one reward
      index: true,
    },
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    offer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },
    reward_amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    referred_reward_amount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["PENDING", "CREDITED", "CANCELLED"],
      default: "CREDITED",
    },
  },
  { timestamps: true }
);

export default mongoose.model("ReferralReward", referralRewardSchema);
