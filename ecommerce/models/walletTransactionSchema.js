import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    reason: {
      type: String,
      enum: [
        "ORDER_CANCELLATION",
        "ORDER_RETURN",
        "ORDER_PAYMENT",
        "WALLET_TOP_UP",
        "REFERRAL_REWARD",
        "OTHER",
      ],
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },

    balance_before: {
      type: Number,
      required: true,
    },

    balance_after: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "WalletTransaction",
  walletTransactionSchema
);