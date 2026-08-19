import mongoose from "mongoose";

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

export default mongoose.model("Order", orderSchema);