import mongoose from "mongoose";
import Variant from "../models/variantSchema.js";
import logger from "../utils/logger.js";

let _transactionsSupported = null;

/**
 * Checks whether the active MongoDB deployment supports multi-document transactions.
 * Transactions require a replica set or sharded cluster.
 * @returns {Promise<boolean>}
 */
export const areTransactionsSupported = async () => {
  if (_transactionsSupported !== null) {
    return _transactionsSupported;
  }

  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return false;
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await session.abortTransaction();
      _transactionsSupported = true;
    } catch (txnErr) {
      _transactionsSupported = false;
    } finally {
      await session.endSession();
    }
  } catch (err) {
    _transactionsSupported = false;
  }

  return _transactionsSupported;
};

/**
 * Resets cached transaction support detection (useful for testing different environments).
 * @param {boolean|null} val
 */
export const _setTransactionsSupportOverride = (val) => {
  _transactionsSupported = val;
};

/**
 * Atomically decreases stock for a single variant only if available stock is sufficient.
 * Prevents stock from ever dropping below 0 under concurrent purchases.
 *
 * @param {string|mongoose.Types.ObjectId} variantId
 * @param {number} quantity - Quantity to decrement (must be > 0)
 * @param {Object} options - Optional mongoose options (e.g. { session })
 * @returns {Promise<Object>} Updated variant document
 */
export const decreaseStock = async (variantId, quantity, options = {}) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`Invalid quantity ${quantity} for stock decrement`);
  }

  const query = {
    _id: variantId,
    stock_quantity: {
      $gte: qty,
    },
  };

  const update = {
    $inc: {
      stock_quantity: -qty,
    },
  };

  const updateOptions = {
    new: true,
    ...options,
  };

  const variant = await Variant.findOneAndUpdate(query, update, updateOptions);

  if (!variant) {
    // Check if variant doesn't exist vs stock insufficient
    const existing = await Variant.findById(variantId).session(options.session || null).lean();
    if (!existing) {
      throw new Error("Product variant not found");
    }
    throw new Error(`Insufficient stock for ${existing.sku || "product"}. Available: ${existing.stock_quantity}, requested: ${qty}`);
  }

  return variant;
};

/**
 * Atomically increases stock for a variant (e.g. for returns, cancellations, or rollback).
 *
 * @param {string|mongoose.Types.ObjectId} variantId
 * @param {number} quantity - Quantity to restore (must be > 0)
 * @param {Object} options - Optional mongoose options (e.g. { session })
 * @returns {Promise<Object>} Updated variant document
 */
export const increaseStock = async (variantId, quantity, options = {}) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`Invalid quantity ${quantity} for stock restore`);
  }

  const update = {
    $inc: {
      stock_quantity: qty,
    },
  };

  const updateOptions = {
    new: true,
    ...options,
  };

  const variant = await Variant.findByIdAndUpdate(variantId, update, updateOptions);

  if (!variant) {
    throw new Error("Product variant not found");
  }

  return variant;
};

/**
 * Atomically reserves inventory for an entire order (multiple variants).
 * Consolidates duplicate variant lines and ensures All-or-Nothing semantics:
 * if any variant fails, all previously decremented variants in the batch
 * are immediately and reliably restored.
 *
 * @param {Array<{ variant_id: string|ObjectId, quantity: number }>} items
 * @param {Object} options - { session }
 * @returns {Promise<Array<{ variant_id: string, quantity: number }>>} Successfully reserved items
 */
export const reserveOrderInventory = async (items, options = {}) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  // Consolidate duplicate variants in the order
  const consolidated = new Map();
  for (const item of items) {
    const rawId = item.variant_id?._id || item.variant_id || item._id;
    const variantId = rawId ? rawId.toString() : null;
    if (!variantId) {
      throw new Error("Missing variant ID in order items");
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`Invalid quantity ${item.quantity} for variant ${variantId}`);
    }
    consolidated.set(variantId, (consolidated.get(variantId) || 0) + qty);
  }

  const decreasedHistory = [];

  try {
    for (const [variantId, qty] of consolidated.entries()) {
      await decreaseStock(variantId, qty, options);
      decreasedHistory.push({ variant_id: variantId, quantity: qty });
    }
    return decreasedHistory;
  } catch (err) {
    // Compensating rollback for any variants that were already decremented in this batch
    if (decreasedHistory.length > 0) {
      logger.warn(
        `reserveOrderInventory failed at step. Initiating compensating rollback for ${decreasedHistory.length} variants: ${err.message}`
      );
      for (let i = decreasedHistory.length - 1; i >= 0; i--) {
        const item = decreasedHistory[i];
        try {
          await increaseStock(item.variant_id, item.quantity, options);
        } catch (rollbackErr) {
          logger.error(`Compensating rollback failed for variant ${item.variant_id}:`, rollbackErr);
        }
      }
    }
    throw err;
  }
};

/**
 * Compensating operation helper to roll back previously reserved inventory.
 * Used when a checkout step (payment capture, order persistence, wallet debit)
 * fails after inventory has already been reserved.
 *
 * @param {Array<{ variant_id: string|ObjectId, quantity: number }>} items
 * @param {Object} options - { session }
 */
export const rollbackOrderInventory = async (items, options = {}) => {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const rawId = item.variant_id?._id || item.variant_id || item._id;
    const variantId = rawId ? rawId.toString() : null;
    const qty = Number(item.quantity);

    if (variantId && Number.isInteger(qty) && qty > 0) {
      try {
        await increaseStock(variantId, qty, options);
      } catch (err) {
        logger.error(`Rollback inventory failed for variant ${variantId}:`, err);
      }
    }
  }
};

/**
 * Executes a function within a MongoDB session/transaction if supported by the deployment,
 * or runs it directly with compensating operations if standalone/transactions unavailable.
 *
 * @param {Function} workFn - async (session) => Promise<any>
 * @returns {Promise<any>}
 */
export const withInventoryTransaction = async (workFn) => {
  const supported = await areTransactionsSupported();

  if (!supported) {
    return await workFn(null);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await workFn(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      logger.error("Error aborting transaction:", abortErr);
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
