import mongoose from "mongoose";

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
            default: null
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

        addresses: [{
            fullName: { type: String, required: true },
            phone: { type: String, required: true },
            street: { type: String, required: true },
            suite: { type: String },
            city: { type: String, required: true },
            state: { type: String, required: true },
            zip: { type: String, required: true },
            country: { type: String, required: true },
            addressLabel: { type: String },
            isDefault: { type: Boolean, default: false }
        }]
    },
    {
        timestamps: true
    }
);

export default mongoose.model("User", userSchema);