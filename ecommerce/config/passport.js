const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/userSchema");

require("dotenv").config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback"
    },

    async (accessToken, refreshToken, profile, done) => {
      try {

        const email = profile.emails[0].value;

        let user = await User.findOne({
          googleId: profile.id
        });

        if (user) {
          return done(null, user);
        }

        user = await User.findOne({
          email: email
        });

        if (user) {

          user.googleId = profile.id;

          await user.save();

          return done(null, user);
        }

        user = new User({
          name: profile.displayName,
          email: email,
          googleId: profile.id
        });

        await user.save();

        return done(null, user);

      } catch (error) {
        return done(error, null);
      }
    }
  )
);

module.exports = passport;