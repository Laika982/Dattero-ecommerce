import Wallet from "../models/walletSchema.js";
import WalletTransaction from "../models/walletTransactionSchema.js";

/**
 * Retrieves the user's wallet or creates a new one with zero balance concurrency-safely.
 */
export const getOrCreateWallet = async (userId, session = null) => {
  let wallet = await Wallet.findOne({
    user_id: userId,
  }).session(session);

  if (!wallet) {
    try {
      const [newWallet] = await Wallet.create(
        [
          {
            user_id: userId,
            balance: 0,
          },
        ],
        session ? { session } : {}
      );
      wallet = newWallet;
    } catch (createErr) {
      // Handle potential race condition on unique user_id index
      wallet = await Wallet.findOne({ user_id: userId }).session(session);
      if (!wallet) {
        throw createErr;
      }
    }
  }

  return wallet;
};

/**
 * Atomically credits a user's wallet with idempotency protection and compensating rollback.
 */
export const creditWallet = async ({
  userId,
  amount,
  reason,
  description = "",
  orderId = null,
  paymentId = null,
  razorpayOrderId = null,
  idempotencyKey = null,
  session = null,
}) => {
  if (!amount || amount <= 0) {
    throw new Error("Invalid wallet credit amount");
  }

  const creditAmount = Number(Number(amount).toFixed(2));
  if (creditAmount <= 0) {
    throw new Error("Invalid wallet credit amount");
  }

  // Idempotency check: if transaction with this key already completed, return existing
  if (idempotencyKey) {
    const existingTx = await WalletTransaction.findOne({
      idempotency_key: idempotencyKey,
      status: "COMPLETED",
    }).session(session);

    if (existingTx) {
      const currentWallet = await Wallet.findOne({ user_id: userId }).session(session);
      return { wallet: currentWallet, transaction: existingTx, isDuplicate: true };
    }
  }

  // Ensure wallet exists
  await getOrCreateWallet(userId, session);

  // Atomic increment update
  const updatedWallet = await Wallet.findOneAndUpdate(
    { user_id: userId },
    { $inc: { balance: creditAmount } },
    { returnDocument: "after", session }
  );

  const balanceAfter = Number(updatedWallet.balance.toFixed(2));
  const balanceBefore = Number((balanceAfter - creditAmount).toFixed(2));

  // Align DB balance with exact 2-decimal rounded figure
  if (updatedWallet.balance !== balanceAfter) {
    await Wallet.updateOne(
      { _id: updatedWallet._id },
      { $set: { balance: balanceAfter } },
      { session }
    );
    updatedWallet.balance = balanceAfter;
  }

  const txOptions = session ? { session } : {};
  let transaction;
  try {
    const [createdTx] = await WalletTransaction.create(
      [
        {
          user_id: userId,
          type: "CREDIT",
          amount: creditAmount,
          reason,
          description,
          order_id: orderId,
          payment_id: paymentId,
          razorpay_order_id: razorpayOrderId,
          idempotency_key: idempotencyKey || null,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          status: "COMPLETED",
        },
      ],
      txOptions
    );
    transaction = createdTx;
  } catch (txError) {
    // Compensating decrement if non-transactional ledger write fails
    if (!session || !session.inTransaction || !session.inTransaction()) {
      try {
        await Wallet.updateOne(
          { user_id: userId },
          { $inc: { balance: -creditAmount } }
        );
      } catch (compErr) {
        console.error("Compensating wallet deduction failed after credit write error:", compErr);
      }
    }
    throw txError;
  }

  return { wallet: updatedWallet, transaction };
};

/**
 * Atomically debits a user's wallet using conditional atomic decrement to eliminate
 * race conditions and ensure balance sufficiency under high concurrency.
 */
export const debitWallet = async ({
  userId,
  amount,
  reason,
  description = "",
  orderId = null,
  idempotencyKey = null,
  session = null,
}) => {
  if (!amount || amount <= 0) {
    throw new Error("Invalid wallet debit amount");
  }

  const debitAmount = Number(Number(amount).toFixed(2));
  if (debitAmount <= 0) {
    throw new Error("Invalid wallet debit amount");
  }

  // Idempotency check: if transaction with this key already completed, return existing
  if (idempotencyKey) {
    const existingTx = await WalletTransaction.findOne({
      idempotency_key: idempotencyKey,
      status: "COMPLETED",
    }).session(session);

    if (existingTx) {
      const currentWallet = await Wallet.findOne({ user_id: userId }).session(session);
      return { wallet: currentWallet, transaction: existingTx, isDuplicate: true };
    }
  }

  // Atomic conditional decrement: only matches if current balance is >= debitAmount
  const updatedWallet = await Wallet.findOneAndUpdate(
    {
      user_id: userId,
      balance: { $gte: debitAmount },
    },
    {
      $inc: { balance: -debitAmount },
    },
    {
      returnDocument: "after",
      session,
    }
  );

  if (!updatedWallet) {
    throw new Error("Insufficient wallet balance");
  }

  const balanceAfter = Number(updatedWallet.balance.toFixed(2));
  const balanceBefore = Number((balanceAfter + debitAmount).toFixed(2));

  // Align DB balance with exact 2-decimal rounded figure
  if (updatedWallet.balance !== balanceAfter) {
    await Wallet.updateOne(
      { _id: updatedWallet._id },
      { $set: { balance: balanceAfter } },
      { session }
    );
    updatedWallet.balance = balanceAfter;
  }

  const txOptions = session ? { session } : {};
  let transaction;
  try {
    const [createdTx] = await WalletTransaction.create(
      [
        {
          user_id: userId,
          type: "DEBIT",
          amount: debitAmount,
          reason,
          description,
          order_id: orderId,
          idempotency_key: idempotencyKey || null,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          status: "COMPLETED",
        },
      ],
      txOptions
    );
    transaction = createdTx;
  } catch (txError) {
    // Compensating increment if non-transactional ledger write fails
    if (!session || !session.inTransaction || !session.inTransaction()) {
      try {
        await Wallet.updateOne(
          { user_id: userId },
          { $inc: { balance: debitAmount } }
        );
      } catch (compErr) {
        console.error("Compensating wallet refund failed after debit write error:", compErr);
      }
    }
    throw txError;
  }

  return { wallet: updatedWallet, transaction };
};
