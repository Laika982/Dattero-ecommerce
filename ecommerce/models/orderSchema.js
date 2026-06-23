const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
   user:{
      type:mongoose.Schema.Types.ObjectId,
      ref:"User"
   },

   products:[
      {
         product:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"Product"
         },
         quantity:Number
      }
   ],

   totalPrice:Number,

   paymentMethod:String,

   orderStatus:{
      type:String,
      default:"Pending"
   },

   shippingAddress:Object
});

module.exports = mongoose.model("Order", orderSchema);