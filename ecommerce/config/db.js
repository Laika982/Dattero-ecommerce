const mongoose = require("mongoose");
const env = require("dotenv").config({ path: require('path').join(__dirname, '..', '.env') })

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.DATABASE_URL)
        console.log("DB connected");
    } catch (error) {
        console.log("DB error", error);
    }
}

module.exports = connectDB;