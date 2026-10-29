import Wallet from "../models/walletSchema.js";
import WalletTransaction from "../models/walletTransactionSchema.js";

export const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({
    user_id: userId,
  });

  if (!wallet) {
    wallet = await Wallet.create({
      user_id: userId,
      balance: 0,
    });
  }

  return wallet;
};

export const creditWallet = async ({
  userId,
  amount,
  reason,
  description = "",
  orderId = null,
  session = null,
}) => {
  if (!amount || amount <= 0) {
    throw new Error("Invalid wallet credit amount");
  }

  const creditAmount = Number(Number(amount).toFixed(2));
  if (creditAmount <= 0) {
    throw new Error("Invalid wallet credit amount");
  }

  let wallet = await Wallet.findOne({ user_id: userId }).session(session);

  if (!wallet) {
    wallet = new Wallet({
      user_id: userId,
      balance: 0,
    });
  }

  const balanceBefore = Number(wallet.balance.toFixed(2));
  const balanceAfter = Number((balanceBefore + creditAmount).toFixed(2));

  wallet.balance = balanceAfter;
  await wallet.save({ session });

  const txOptions = session ? { session } : {};
  const [transaction] = await WalletTransaction.create(
    [
      {
        user_id: userId,
        type: "CREDIT",
        amount: creditAmount,
        reason,
        description,
        order_id: orderId,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      },
    ],
    txOptions
  );

  return { wallet, transaction };
};

export const debitWallet = async ({
  userId,
  amount,
  reason,
  description = "",
  orderId = null,
  session = null,
}) => {
  if (!amount || amount <= 0) {
    throw new Error("Invalid wallet debit amount");
  }

  const debitAmount = Number(Number(amount).toFixed(2));
  if (debitAmount <= 0) {
    throw new Error("Invalid wallet debit amount");
  }

  let wallet = await Wallet.findOne({ user_id: userId }).session(session);

  if (!wallet || wallet.balance < debitAmount) {
    throw new Error("Insufficient wallet balance");
  }

  const balanceBefore = Number(wallet.balance.toFixed(2));
  const balanceAfter = Number((balanceBefore - debitAmount).toFixed(2));

  wallet.balance = balanceAfter;
  await wallet.save({ session });

  const txOptions = session ? { session } : {};
  const [transaction] = await WalletTransaction.create(
    [
      {
        user_id: userId,
        type: "DEBIT",
        amount: debitAmount,
        reason,
        description,
        order_id: orderId,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      },
    ],
    txOptions
  );

  return { wallet, transaction };
};
