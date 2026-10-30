import mongoose from "mongoose";

const rateLimitSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    totalHits: {
      type: Number,
      required: true,
      default: 1,
    },
    resetTime: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// TTL index to automatically purge expired records
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit =
  mongoose.models.RateLimit || mongoose.model("RateLimit", rateLimitSchema);

export default RateLimit;

