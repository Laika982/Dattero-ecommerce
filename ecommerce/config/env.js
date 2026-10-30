import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from ecommerce/.env first, then fallback to cwd
const envPath = path.resolve(__dirname, "..", ".env");
dotenv.config({ path: envPath });
dotenv.config();

const KNOWN_WEAK_SECRETS = new Set([
  "your-session-secret-key",
  "my_super_secret_key_123456789",
  "dattero_prod_session_secret_key_safe",
  "secret",
  "jwt_secret",
  "session_secret",
  "123456",
  "12345678",
  "password",
  "changeme",
  "admin",
  "root",
]);

/**
 * Validates essential application environment variables at startup.
 * In production (NODE_ENV=production), missing or predictable secrets
 * cause a fatal error and prevent application startup.
 */
export function validateEnv() {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test";

  const errors = [];
  const warnings = [];

  // 1. SESSION_SECRET
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || !sessionSecret.trim()) {
    if (isProduction) {
      errors.push("SESSION_SECRET is required in production and must not be empty.");
    } else if (!isTest) {
      warnings.push("SESSION_SECRET is not set. Please define it in your .env file.");
    }
  } else if (KNOWN_WEAK_SECRETS.has(sessionSecret.trim().toLowerCase())) {
    if (isProduction) {
      errors.push(
        "SESSION_SECRET is set to a known predictable/insecure default. Provide a strong random secret (minimum 32 characters)."
      );
    } else if (!isTest) {
      warnings.push(
        "SESSION_SECRET is using a known weak default. Set a strong random secret in .env."
      );
    }
  } else if (isProduction && sessionSecret.trim().length < 32) {
    errors.push(
      "SESSION_SECRET must be at least 32 characters long in production."
    );
  }

  // 2. JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || !jwtSecret.trim()) {
    if (isProduction) {
      errors.push("JWT_SECRET is required in production and must not be empty.");
    } else if (!isTest) {
      warnings.push("JWT_SECRET is not set. Please define it in your .env file.");
    }
  } else if (KNOWN_WEAK_SECRETS.has(jwtSecret.trim().toLowerCase())) {
    if (isProduction) {
      errors.push(
        "JWT_SECRET is set to a known predictable/insecure default. Provide a strong random secret (minimum 32 characters)."
      );
    } else if (!isTest) {
      warnings.push(
        "JWT_SECRET is using a known weak default. Set a strong random secret in .env."
      );
    }
  } else if (isProduction && jwtSecret.trim().length < 32) {
    errors.push(
      "JWT_SECRET must be at least 32 characters long in production."
    );
  }

  // 3. DATABASE_URL
  if (isProduction && (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim())) {
    errors.push("DATABASE_URL is required in production.");
  }

  // 4. Payment Gateway (Razorpay) in production
  if (isProduction) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      errors.push(
        "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production."
      );
    }
  }

  // 5. Cloudinary in production
  if (isProduction) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      errors.push(
        "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required in production."
      );
    }
  }

  // 6. SMTP Email in production
  if (isProduction) {
    if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASSWORD) {
      errors.push(
        "NODEMAILER_EMAIL and NODEMAILER_PASSWORD are required in production for OTP and notifications."
      );
    }
  }

  // 7. Google OAuth (optional warning in non-production, warning in production)
  if (isProduction) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      warnings.push(
        "GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET are missing; Google OAuth login will be unavailable."
      );
    }
  }

  // Output non-fatal warnings
  if (warnings.length > 0 && !isTest) {
    for (const warning of warnings) {
      console.warn(`[CONFIG WARNING] ${warning}`);
    }
  }

  // Fatal validation errors halt startup
  if (errors.length > 0) {
    const errorDetails = errors.map((err) => `  - ${err}`).join("\n");
    const fatalMessage = `[FATAL] Environment Configuration Error:\n${errorDetails}`;
    console.error(fatalMessage);
    throw new Error(fatalMessage);
  }

  return true;
}

export default validateEnv;

