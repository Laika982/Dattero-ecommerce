const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    productName:{
        type: String,
        required: true
    },
     regular_price: {
      type: Number,
      required: true
    },
    sale_price: {
      type: Number,
      required: false
    },
    productDescription:{
        type: String,
        required: true
    },
    productStock:{
        type: Number,
        required: true
    },
    productImage:{
        type: String,
        required: true
    },
    status:{
        type: String,
        required : true
    }
});

module.exports = mongoose.model("Product", productSchema);