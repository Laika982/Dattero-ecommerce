import mongoose from "mongoose";
import RateLimit from "../models/rateLimitSchema.js";

/**
 * MongoRateLimitStore
 * Distributed rate-limit store backed by MongoDB with automatic TTL index cleanup.
 * Seamlessly falls back to an in-memory store if MongoDB is not yet connected or during isolated unit tests.
 */
export class MongoRateLimitStore {
  constructor(options = {}) {
    this.prefix = options.prefix || "rl:";
    this.windowMs = options.windowMs || 15 * 60 * 1000;
    this._memStore = new Map();
  }

  init(options = {}) {
    if (options.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  getPrefixedKey(key) {
    return `${this.prefix}${key}`;
  }

  isMongoAvailable() {
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  async increment(key) {
    const fullKey = this.getPrefixedKey(key);
    const now = new Date();

    if (!this.isMongoAvailable()) {
      return this._fallbackIncrement(fullKey, now);
    }

    try {
      // 1. Try to increment within an active window
      const updated = await RateLimit.findOneAndUpdate(
        {
          key: fullKey,
          resetTime: { $gt: now },
        },
        {
          $inc: { totalHits: 1 },
        },
        { returnDocument: "after" }
      );

      if (updated) {
        return {
          totalHits: updated.totalHits,
          resetTime: updated.resetTime,
        };
      }

      // 2. Window expired or first request: initialize new window
      const resetTime = new Date(now.getTime() + this.windowMs);
      const newDoc = await RateLimit.findOneAndUpdate(
        { key: fullKey },
        {
          $set: {
            totalHits: 1,
            resetTime,
            expiresAt: resetTime,
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      return {
        totalHits: newDoc.totalHits,
        resetTime: newDoc.resetTime,
      };
    } catch (err) {
      // Transient Mongo failure fallback
      return this._fallbackIncrement(fullKey, now);
    }
  }

  async decrement(key) {
    const fullKey = this.getPrefixedKey(key);
    if (this.isMongoAvailable()) {
      try {
        await RateLimit.updateOne(
          { key: fullKey, totalHits: { $gt: 0 } },
          { $inc: { totalHits: -1 } }
        );
      } catch (_) {}
    }
    const memEntry = this._memStore.get(fullKey);
    if (memEntry && memEntry.totalHits > 0) {
      memEntry.totalHits -= 1;
    }
  }

  async resetKey(key) {
    const fullKey = this.getPrefixedKey(key);
    if (this.isMongoAvailable()) {
      try {
        await RateLimit.deleteOne({ key: fullKey });
      } catch (_) {}
    }
    this._memStore.delete(fullKey);
  }

  async resetAll() {
    if (this.isMongoAvailable()) {
      try {
        await RateLimit.deleteMany({ key: { $regex: `^${this.prefix}` } });
      } catch (_) {}
    }
    this._memStore.clear();
  }

  _fallbackIncrement(fullKey, now) {
    const existing = this._memStore.get(fullKey);
    if (existing && existing.resetTime > now) {
      existing.totalHits += 1;
      return { totalHits: existing.totalHits, resetTime: existing.resetTime };
    }
    const resetTime = new Date(now.getTime() + this.windowMs);
    const newEntry = {
      totalHits: 1,
      resetTime,
    };
    this._memStore.set(fullKey, newEntry);
    return newEntry;
  }
}

export default MongoRateLimitStore;

