import mongoose from "mongoose";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.DATABASE_URL);
        console.log("DB connected");
    } catch (error) {
        console.log("DB error", error);
    }
}

export default connectDB;