import winston from "winston";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
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
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

export default logger;
