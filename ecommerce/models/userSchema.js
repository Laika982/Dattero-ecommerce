const mongoose = require("mongoose");

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
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("User", userSchema);