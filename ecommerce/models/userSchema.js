const mongoose = require("mongoose");


const userSchema = new mongoose.Schema({
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
        type: String,
        required: true
    },
    phone : {
        type : String,
        required: false,
        unique: false,
        sparse:true,
        default:null
    },
    isAdmin : {
    type: Boolean,
    required: false,
    default:false
    }
        
})

module.exports = mongoose.model("User", userSchema)