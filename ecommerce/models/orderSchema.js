import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    variant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Variant",
      required: true,
    },

    product_name: {
      type: String,
      required: true,
    },

    product_image: {
      type: String,
      default: "",
    },

    sku: {
      type: String,
      required: true,
    },

    weight: {
      type: String,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    inventory_decremented: {
      type: Boolean,
      default: false,
    },

    restored_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    returned_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    refunded_amount: {
      type: Number,
      default: 0,
      min: 0,
    },

    price: {
      type: Number,
      required: true,
    },

    discount: {
      type: Number,
      default: 0,
    },

    coupon_code: {
      type: String,
      default: null,
    },

    item_total: {
      type: Number,
      required: true,
    },

    gross_total: {
      type: Number,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "returned",
      ],
      default: "pending",
    },

    cancellation_reason: {
      type: String,
      default: null,
    },

    return_reason: {
      type: String,
      default: null,
    },
  },
  {
    _id: true,
  }
);

const orderSchema = new mongoose.Schema(
  {
    order_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    items: {
      type: [orderItemSchema],
      required: true,
    },

    shipping_address: {
      full_name: {
        type: String,
        required: true,
      },

      phone_number: {
        type: String,
        required: true,
      },

      address: {
        type: String,
        required: true,
      },

      company_name: {
        type: String,
        default: "",
      },

      city: {
        type: String,
        required: true,
      },

      state: {
        type: String,
        required: true,
      },

      zip_code: {
        type: String,
        required: true,
      },

      country: {
        type: String,
        required: true,
      },
    },

    subtotal: {
      type: Number,
      required: true,
    },

    discount: {
      type: Number,
      default: 0,
    },

    offer_discount: {
      type: Number,
      default: 0,
    },

    referral_discount: {
      type: Number,
      default: 0,
    },

    referral_offer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },

    coupon_code: {
      type: String,
      default: null,
    },

    tax: {
      type: Number,
      default: 0,
    },

    shipping_charge: {
      type: Number,
      default: 0,
    },

    final_amount: {
      type: Number,
      required: true,
    },

    original_final_amount: {
      type: Number,
      default: null,
    },

    refunded_amount: {
      type: Number,
      default: 0,
      min: 0,
    },

    payment_method: {
      type: String,
      enum: ["cod", "upi", "wallet"],
      default: "cod",
    },

    payment_status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },

    inventory_reserved: {
      type: Boolean,
      default: false,
    },

    order_status: {
      type: String,
      enum: [
        "pending",
        "shipped",
        "out_for_delivery",
        "delivered",
        "return_requested",
        "cancelled",
        "returned",
      ],
      default: "pending",
    },

    return_request: {
      reason: {
        type: String,
        default: null,
        maxlength: 500,
      },
      status: {
        type: String,
        enum: ["pending", "processed"],
        default: null,
      },
      requested_at: {
        type: Date,
        default: null,
      },
      processed_at: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model("Order", orderSchema);

export default Order;
