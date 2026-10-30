import winston from "winston";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function maskEmail(email) {
  if (!email || typeof email !== "string") return "";
  const parts = email.split("@");
  if (parts.length !== 2) return "[INVALID_EMAIL]";
  const [local, domain] = parts;
  if (local.length <= 1) {
    return `*@${domain}`;
  }
  return `${local[0]}${"*".repeat(Math.min(local.length - 1, 3))}@${domain}`;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "oldpassword",
  "otp",
  "otpval",
  "otptoken",
  "signuptoken",
  "token",
  "admintoken",
  "resettoken",
  "refreshtoken",
  "secret",
  "jwt_secret",
  "session_secret",
  "nodemailer_password",
  "razorpay_key_secret",
  "razorpay_signature",
  "authorization",
  "cookie",
  "set-cookie",
]);

export function sanitizeLogValue(value, depth = 0) {
  if (depth > 6) return "[DEPTH_LIMIT]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    let sanitized = value;
    // Redact OTP values (e.g., "OTP: 123456", "OTP is 123456", "otp=123456")
    sanitized = sanitized.replace(/\b(otp(?:\s*is|:|=|\s+sent\s+to\s+[^\s:]+:)?\s*)(["']?\d{4,8}["']?)/gi, "$1[REDACTED_OTP]");
    // Redact explicit passwords in strings
    sanitized = sanitized.replace(/\b(password(?:\s*is|:|=)\s*)(["']?[^\s,"']+["']?)/gi, "$1[REDACTED_PASSWORD]");
    // Redact JWT tokens
    sanitized = sanitized.replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g, "[REDACTED_JWT]");
    // Redact Bearer tokens
    sanitized = sanitized.replace(/\bBearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (value instanceof Error) {
      const sanitizedErr = {
        name: value.name,
        message: sanitizeLogValue(value.message, depth + 1),
        stack: sanitizeLogValue(value.stack, depth + 1),
      };
      for (const [key, val] of Object.entries(value)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
          sanitizedErr[key] = "[REDACTED]";
        } else {
          sanitizedErr[key] = sanitizeLogValue(val, depth + 1);
        }
      }
      return sanitizedErr;
    }

    const sanitizedObj = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitizedObj[key] = "[REDACTED]";
      } else {
        sanitizedObj[key] = sanitizeLogValue(val, depth + 1);
      }
    }
    return sanitizedObj;
  }

  return value;
}

const redactFormat = winston.format((info) => {
  if (typeof info.message === "string") {
    info.message = sanitizeLogValue(info.message);
  }
  for (const key of Object.keys(info)) {
    if (key === "level" || key === "timestamp") continue;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      info[key] = "[REDACTED]";
    } else {
      info[key] = sanitizeLogValue(info[key]);
    }
  }
  return info;
});

const logFormat = winston.format.combine(
  redactFormat(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  redactFormat(),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `[${timestamp}] ${level}: ${message}${stack ? `\n${stack}` : ""}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, "../logs/error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, "../logs/combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

export default logger;
