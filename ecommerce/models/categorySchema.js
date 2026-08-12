const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    category_name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: false
    },
    sales_quantity: {
      type: Number,
      required: false
    },
    stock_quantity: {
      type: Number,
      required: false
    },
    isListed: {
      type: Boolean,
      required: true
    },
    image: {
      type: String,
      required: false
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Category", categorySchema);