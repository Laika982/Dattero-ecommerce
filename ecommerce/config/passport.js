import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/userSchema.js";
import dotenv from "dotenv";

import {
  REFERRAL_COOKIE,
  buildReferralAttribution,
  ensureUserReferralFields,
} from "../services/referralService.js";

dotenv.config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback",
      passReqToCallback: true,
    },

    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value?.toLowerCase();

        let user = await User.findOne({
          googleId: profile.id,
        });

        if (user) {
          if (user.isBlocked) {
            return done(null, false, { message: "Your account has been blocked." });
          }
          await ensureUserReferralFields(user);
          return done(null, user);
        }

        user = await User.findOne({
          email: email,
        });

        if (user) {
          if (user.isBlocked) {
            return done(null, false, { message: "Your account has been blocked." });
          }

          user.googleId = profile.id;
          await ensureUserReferralFields(user);
          await user.save();

          return done(null, user);
        }

        // New user via Google OAuth: check referral invite
        const invite = req?.cookies?.[REFERRAL_COOKIE] || req?.session?.referralCode;
        const attribution = await buildReferralAttribution({
          referralToken: invite,
          excludeEmail: email,
        });

        user = new User({
          name: profile.displayName || "Google User",
          email: email,
          googleId: profile.id,
          referredBy: attribution.referredBy,
          referralOfferId: attribution.referralOfferId,
        });

        await user.save();
        await ensureUserReferralFields(user);

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

export default passport;