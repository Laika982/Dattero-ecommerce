import { randomBytes } from "node:crypto";
import User from "../models/userSchema.js";
import Offer from "../models/offerSchema.js";
import ReferralReward from "../models/referralRewardSchema.js";
import { creditWallet } from "./walletService.js";

export const REFERRAL_COOKIE = "referralInvite";

const activeReferralQuery = (now) => ({
  offer_type: "REFERRAL",
  is_active: true,
  start_date: { $lte: now },
  end_date: { $gt: now },
});

export const setReferralCookie = (res, token) => {
  if (!res || !token) return;
  res.cookie(REFERRAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

export const clearReferralCookie = (res) => {
  if (!res) return;
  res.clearCookie(REFERRAL_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
};

export const generateUniqueReferralCode = async () => {
  let attempts = 0;
  while (attempts < 10) {
    const code = `NB-${randomBytes(4).toString("hex").toUpperCase()}`;
    const existing = await User.findOne({ referalCode: code });
    if (!existing) return code;
    attempts++;
  }
  return `NB-${Date.now().toString(36).toUpperCase()}`;
};

export const generateUniqueReferralToken = async () => {
  let attempts = 0;
  while (attempts < 10) {
    const token = randomBytes(18).toString("hex");
    const existing = await User.findOne({ referralToken: token });
    if (!existing) return token;
    attempts++;
  }
  return randomBytes(24).toString("hex");
};

export const ensureUserReferralFields = async (user) => {
  if (!user) return null;
  let changed = false;

  if (!user.referalCode) {
    user.referalCode = await generateUniqueReferralCode();
    changed = true;
  }

  if (!user.referralToken) {
    user.referralToken = await generateUniqueReferralToken();
    changed = true;
  }

  if (changed) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          referalCode: user.referalCode,
          referralToken: user.referralToken,
        },
      }
    );
  }

  return user;
};

export const backfillUserReferralCodes = async () => {
  try {
    const usersWithoutCodes = await User.find({
      $or: [
        { referalCode: null },
        { referalCode: { $exists: false } },
        { referralToken: null },
        { referralToken: { $exists: false } },
      ],
    });

    if (usersWithoutCodes.length === 0) return 0;

    let updatedCount = 0;
    for (const user of usersWithoutCodes) {
      await ensureUserReferralFields(user);
      updatedCount++;
    }

    console.log(`[Referral] Backfilled referral fields for ${updatedCount} users.`);
    return updatedCount;
  } catch (error) {
    console.error("[Referral] Error backfilling referral codes:", error);
    return 0;
  }
};

export const findReferrerByInvite = async (value) => {
  const invite = String(value || "").trim();
  if (!invite) return null;

  return User.findOne({
    $or: [
      { referralToken: invite },
      { referalCode: invite.toUpperCase() },
      { referalCode: invite },
    ],
  });
};

export const getActiveReferralOffer = async (now = new Date()) => {
  return Offer.findOne(activeReferralQuery(now)).sort({ createdAt: -1 }).lean();
};

export const buildReferralAttribution = async ({
  referralCode,
  referralToken,
  excludeUserId,
  excludeEmail,
} = {}) => {
  const invite = String(referralCode || referralToken || "").trim();
  if (!invite) {
    return { referredBy: null, referralOfferId: null, referrer: null, offer: null };
  }

  const referrer = await findReferrerByInvite(invite);
  if (!referrer) {
    return { referredBy: null, referralOfferId: null, referrer: null, offer: null };
  }

  // Prevent self-referral by user ID
  if (excludeUserId && String(referrer._id) === String(excludeUserId)) {
    return { referredBy: null, referralOfferId: null, referrer: null, offer: null };
  }

  // Prevent self-referral by email
  if (
    excludeEmail &&
    referrer.email &&
    String(referrer.email).trim().toLowerCase() ===
      String(excludeEmail).trim().toLowerCase()
  ) {
    return { referredBy: null, referralOfferId: null, referrer: null, offer: null };
  }

  const offer = await getActiveReferralOffer();
  return {
    referredBy: referrer._id,
    referralOfferId: offer?._id || null,
    referrer,
    offer,
  };
};

export const followReferralInvite = async (req, res) => {
  try {
    const referrer = await findReferrerByInvite(req.params.token);

    if (!referrer?.referralToken) {
      req.session.error = "This referral link is invalid.";
      return res.redirect("/signup");
    }

    setReferralCookie(res, referrer.referralToken);
    return res.redirect("/signup");
  } catch (error) {
    console.error("Follow referral invite error:", error);
    req.session.error = "Unable to apply this referral link.";
    return res.redirect("/signup");
  }
};

export const buildReferralShareUrl = (req, tokenOrCode) => {
  if (!req || !tokenOrCode) return "";
  const origin = `${req.protocol}://${req.get("host")}`;
  return `${origin}/invite/${encodeURIComponent(tokenOrCode)}`;
};

/**
 * Process referral reward for a completed and eligible order.
 * Ensures strict idempotency via ReferralReward unique index.
 */
export const processReferralReward = async ({ order, user, session = null }) => {
  try {
    if (!order || !user) {
      return { success: false, reason: "INVALID_PARAMETERS" };
    }

    const userId = user._id || user;
    const referredByUser = user.referredBy;

    if (!referredByUser) {
      return { success: false, reason: "NOT_REFERRED_USER" };
    }

    // Prevent self-referral reward
    if (String(referredByUser) === String(userId)) {
      return { success: false, reason: "SELF_REFERRAL_DISALLOWED" };
    }

    // Must be paid and not cancelled
    if (order.payment_status !== "paid" || order.order_status === "cancelled") {
      return { success: false, reason: "ORDER_NOT_PAID_OR_CANCELLED" };
    }

    // Fast check if already rewarded
    const alreadyRewarded = await ReferralReward.findOne({
      referred_user_id: userId,
    });
    if (alreadyRewarded) {
      return { success: false, reason: "ALREADY_REWARDED" };
    }

    // Resolve active offer
    let offer = null;
    const now = new Date();

    if (user.referralOfferId) {
      const userOffer = await Offer.findById(user.referralOfferId).lean();
      if (
        userOffer &&
        userOffer.is_active &&
        userOffer.offer_type === "REFERRAL" &&
        new Date(userOffer.start_date) <= now &&
        new Date(userOffer.end_date) > now
      ) {
        offer = userOffer;
      }
    }

    if (!offer) {
      offer = await getActiveReferralOffer(now);
    }

    if (!offer) {
      return { success: false, reason: "NO_ACTIVE_REFERRAL_OFFER" };
    }

    // Calculate reward amount for referrer
    let rewardAmount = 0;
    if (offer.discount_type === "PERCENTAGE") {
      const baseAmount = Number(order.subtotal || order.final_amount || 0);
      rewardAmount = Number(((baseAmount * offer.discount_value) / 100).toFixed(2));
    } else {
      rewardAmount = Number(Number(offer.discount_value).toFixed(2));
    }

    if (rewardAmount <= 0) {
      return { success: false, reason: "INVALID_REWARD_AMOUNT" };
    }

    // Check if referred user should also receive a wallet reward
    // (If they didn't receive an instant referral discount on checkout)
    let referredRewardAmount = 0;
    if (!order.referral_discount || order.referral_discount <= 0) {
      if (offer.discount_type === "FIXED") {
        referredRewardAmount = Number(Number(offer.discount_value).toFixed(2));
      } else {
        const baseAmount = Number(order.subtotal || order.final_amount || 0);
        referredRewardAmount = Number(
          ((baseAmount * offer.discount_value) / 100).toFixed(2)
        );
      }
    }

    // Atomic DB insert into ReferralReward.
    // Unique index on referred_user_id prevents any duplicate execution.
    let rewardRecord;
    try {
      rewardRecord = await ReferralReward.create(
        [
          {
            referrer_id: referredByUser,
            referred_user_id: userId,
            order_id: order._id,
            offer_id: offer._id,
            reward_amount: rewardAmount,
            referred_reward_amount: referredRewardAmount,
            status: "CREDITED",
          },
        ],
        session ? { session } : {}
      );
      rewardRecord = rewardRecord[0];
    } catch (insertError) {
      if (insertError.code === 11000 || insertError.name === "MongoServerError") {
        console.warn(`[Referral] Prevented duplicate reward for user ${userId}`);
        return { success: false, reason: "DUPLICATE_REWARD_PREVENTED" };
      }
      throw insertError;
    }

    // Credit referrer wallet
    const referrerDescription = `Referral reward for inviting ${user.name || "friend"} (Order #${order.order_id || order._id})`;
    await creditWallet({
      userId: referredByUser,
      amount: rewardAmount,
      reason: "REFERRAL_REWARD",
      description: referrerDescription,
      orderId: order._id,
      session,
    });

    // Credit referred user wallet if applicable
    if (referredRewardAmount > 0) {
      const referredDescription = `Welcome bonus for joining via referral (Order #${order.order_id || order._id})`;
      await creditWallet({
        userId,
        amount: referredRewardAmount,
        reason: "REFERRAL_REWARD",
        description: referredDescription,
        orderId: order._id,
        session,
      });
    }

    // Mark referral offer as used
    await User.updateOne(
      { _id: userId },
      { $set: { referralOfferUsed: true } },
      session ? { session } : {}
    );

    return {
      success: true,
      reward: rewardRecord,
      rewardAmount,
      referredRewardAmount,
    };
  } catch (error) {
    console.error("[Referral] Error processing referral reward:", error);
    return { success: false, error: error.message };
  }
};
