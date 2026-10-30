import mongoose from "mongoose";
import "./env.js";
import { backfillUserReferralCodes } from "../services/referralService.js";

const connectDB = async () => {
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("DATABASE_URL environment variable is missing.");
      }
      console.warn("[DB WARNING] DATABASE_URL is not defined in environment.");
      return;
    }
    await mongoose.connect(dbUrl);
    console.log("DB connected");
    await backfillUserReferralCodes();
  } catch (error) {
    console.error("DB error:", error.message || error);
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }
};

export default connectDB;
