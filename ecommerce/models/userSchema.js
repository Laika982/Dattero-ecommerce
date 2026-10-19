import mongoose from "mongoose";
import { randomBytes } from "node:crypto";

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true
        },

        email: {
            type: String,
            required: true,
            unique: true
        },

        password: {
            type: String
        },

        phone: {
            type: String,
            required: false,
            unique: false,
            sparse: true,
            default: null
        },

        referalCode: {
            type: String,
            required: false,
            unique: true,
            sparse: true,
            default: () => `NB-${randomBytes(5).toString("hex").toUpperCase()}`
        },

        referralToken: {
            type: String,
            required: false,
            unique: true,
            sparse: true,
            default: () => randomBytes(18).toString("hex")
        },

        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        referralOfferId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Offer",
            default: null
        },

        referralOfferUsed: {
            type: Boolean,
            default: false
        },

        profileImage: {
            type: String,
            required: false,
            default: null
        },

        googleId: {
            type: String,
            unique: true,
            sparse: true
        },

        isAdmin: {
            type: Boolean,
            required: false,
            default: false
        },

        isBlocked: {
            type: Boolean,
            required: false,
            default: false
        },
        isGoogleUser: {
            type: Boolean,
            required: false,
            default: false
        },
    },
    {
        timestamps: true
    }
);

export default mongoose.model("User", userSchema);