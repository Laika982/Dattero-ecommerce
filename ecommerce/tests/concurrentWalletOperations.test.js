import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Wallet from "../models/walletSchema.js";
import WalletTransaction from "../models/walletTransactionSchema.js";
import {
  getOrCreateWallet,
  creditWallet,
  debitWallet,
} from "../services/walletService.js";

const testUserIds = [];

before(async () => {
  await connectDB();
});

after(async () => {
  try {
    if (testUserIds.length > 0) {
      await Wallet.deleteMany({ user_id: { $in: testUserIds } });
      await WalletTransaction.deleteMany({ user_id: { $in: testUserIds } });
    }
    await mongoose.connection.close();
  } catch (_) {}
});

function getTestUserId() {
  const id = new mongoose.Types.ObjectId();
  testUserIds.push(id);
  return id;
}

test("Insufficient balance check prevents overdraft and rejects debit", async () => {
  const userId = getTestUserId();
  const initialBalance = 100;

  // Create wallet with 100
  await Wallet.create({ user_id: userId, balance: initialBalance });

  // Attempt debit of 150
  await assert.rejects(
    async () => {
      await debitWallet({
        userId,
        amount: 150,
        reason: "ORDER_PAYMENT",
      });
    },
    /Insufficient wallet balance/
  );

  const wallet = await Wallet.findOne({ user_id: userId });
  assert.equal(wallet.balance, 100, "Balance must remain unchanged after rejected debit");
});

test("Rejects non-positive debit and credit amounts", async () => {
  const userId = getTestUserId();

  await assert.rejects(
    () => debitWallet({ userId, amount: 0, reason: "ORDER_PAYMENT" }),
    /Invalid wallet debit amount/
  );

  await assert.rejects(
    () => debitWallet({ userId, amount: -50, reason: "ORDER_PAYMENT" }),
    /Invalid wallet debit amount/
  );

  await assert.rejects(
    () => creditWallet({ userId, amount: 0, reason: "WALLET_TOP_UP" }),
    /Invalid wallet credit amount/
  );

  await assert.rejects(
    () => creditWallet({ userId, amount: -25, reason: "WALLET_TOP_UP" }),
    /Invalid wallet credit amount/
  );
});

test("Simultaneous concurrent debits prevent overdraft and double-spending", async () => {
  const userId = getTestUserId();
  const initialBalance = 500;

  await Wallet.create({ user_id: userId, balance: initialBalance });

  // Two simultaneous debits of 300 each (Total requested: 600 > 500)
  const results = await Promise.allSettled([
    debitWallet({
      userId,
      amount: 300,
      reason: "ORDER_PAYMENT",
      idempotencyKey: "concurrent-debit-1",
    }),
    debitWallet({
      userId,
      amount: 300,
      reason: "ORDER_PAYMENT",
      idempotencyKey: "concurrent-debit-2",
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "Exactly one debit must succeed");
  assert.equal(rejected.length, 1, "Exactly one debit must fail");
  assert.ok(
    rejected[0].reason.message.includes("Insufficient wallet balance"),
    "Failure must be due to insufficient balance"
  );

  const wallet = await Wallet.findOne({ user_id: userId });
  assert.equal(wallet.balance, 200, "Final balance must strictly equal 500 - 300 = 200");

  const transactions = await WalletTransaction.find({ user_id: userId });
  assert.equal(transactions.length, 1, "Only one debit transaction ledger entry must exist");
  assert.equal(transactions[0].amount, 300);
  assert.equal(transactions[0].balance_before, 500);
  assert.equal(transactions[0].balance_after, 200);
});

test("Duplicate requests with the same idempotencyKey are idempotent and do not double-debit", async () => {
  const userId = getTestUserId();
  await Wallet.create({ user_id: userId, balance: 1000 });

  const idempotencyKey = "order-pay-idem-xyz-123";

  // First debit
  const firstRes = await debitWallet({
    userId,
    amount: 250,
    reason: "ORDER_PAYMENT",
    idempotencyKey,
  });

  assert.equal(firstRes.wallet.balance, 750);
  assert.equal(firstRes.transaction.amount, 250);

  // Duplicate replay of the exact same debit
  const secondRes = await debitWallet({
    userId,
    amount: 250,
    reason: "ORDER_PAYMENT",
    idempotencyKey,
  });

  assert.equal(secondRes.isDuplicate, true, "Must flag as duplicate");
  assert.equal(secondRes.wallet.balance, 750, "Balance must not decrease again");

  const wallet = await Wallet.findOne({ user_id: userId });
  assert.equal(wallet.balance, 750, "Database balance must remain 750");

  const count = await WalletTransaction.countDocuments({
    user_id: userId,
    idempotency_key: idempotencyKey,
  });
  assert.equal(count, 1, "Must have exactly 1 ledger record");
});

test("Duplicate requests with the same idempotencyKey are idempotent and do not double-credit", async () => {
  const userId = getTestUserId();
  await Wallet.create({ user_id: userId, balance: 100 });

  const idempotencyKey = "refund-idem-abc-456";

  // First credit
  const firstCredit = await creditWallet({
    userId,
    amount: 150,
    reason: "ORDER_RETURN",
    idempotencyKey,
  });
  assert.equal(firstCredit.wallet.balance, 250);

  // Duplicate credit
  const secondCredit = await creditWallet({
    userId,
    amount: 150,
    reason: "ORDER_RETURN",
    idempotencyKey,
  });
  assert.equal(secondCredit.isDuplicate, true);
  assert.equal(secondCredit.wallet.balance, 250, "Balance must not increase again");

  const wallet = await Wallet.findOne({ user_id: userId });
  assert.equal(wallet.balance, 250);
});

test("Refunds calculate accurate ledger history with balance_before and balance_after", async () => {
  const userId = getTestUserId();
  await Wallet.create({ user_id: userId, balance: 350 });

  const refundRes = await creditWallet({
    userId,
    amount: 125.5,
    reason: "ORDER_CANCELLATION",
  });

  assert.equal(refundRes.transaction.type, "CREDIT");
  assert.equal(refundRes.transaction.balance_before, 350);
  assert.equal(refundRes.transaction.balance_after, 475.5);
  assert.equal(refundRes.wallet.balance, 475.5);
});

test("Compensating rollback restores wallet balance if transaction ledger write fails", async () => {
  const userId = getTestUserId();
  await Wallet.create({ user_id: userId, balance: 500 });

  // Temporarily stub WalletTransaction.create to throw
  const originalCreate = WalletTransaction.create;
  WalletTransaction.create = async () => {
    throw new Error("Simulated database failure during ledger entry insertion");
  };

  try {
    await assert.rejects(
      async () => {
        await debitWallet({
          userId,
          amount: 200,
          reason: "ORDER_PAYMENT",
        });
      },
      /Simulated database failure/
    );

    // Verify compensating rollback restored the balance to 500
    const wallet = await Wallet.findOne({ user_id: userId });
    assert.equal(
      wallet.balance,
      500,
      "Wallet balance must be restored to 500 by compensating rollback"
    );
  } finally {
    WalletTransaction.create = originalCreate;
  }
});

test("Concurrent getOrCreateWallet safely handles simultaneous wallet initializations", async () => {
  const userId = getTestUserId();

  const [wallet1, wallet2] = await Promise.all([
    getOrCreateWallet(userId),
    getOrCreateWallet(userId),
  ]);

  assert.ok(wallet1 && wallet2);
  assert.equal(wallet1._id.toString(), wallet2._id.toString(), "Both must reference the same wallet");
  assert.equal(wallet1.balance, 0);

  const count = await Wallet.countDocuments({ user_id: userId });
  assert.equal(count, 1, "Only one wallet document must exist");
});
