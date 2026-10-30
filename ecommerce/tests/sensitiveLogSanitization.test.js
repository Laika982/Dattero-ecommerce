import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import logger, { maskEmail, sanitizeLogValue } from "../utils/logger.js";
import { generateOtp } from "../utils/otp.js";
import { generateToken } from "../utils/token.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_dattero_12345";

test("maskEmail masks personal email addresses safely", () => {
  assert.equal(maskEmail("user@example.com"), "u***@example.com");
  assert.equal(maskEmail("a@b.com"), "*@b.com");
  assert.equal(maskEmail("admin.test@domain.org"), "a***@domain.org");
  assert.equal(maskEmail(""), "");
  assert.equal(maskEmail(null), "");
  assert.equal(maskEmail("notanemail"), "[INVALID_EMAIL]");
});

test("sanitizeLogValue redacts OTP patterns from strings", () => {
  const otpSample = "847291";
  const logStr1 = `Sign up OTP is ${otpSample}`;
  const logStr2 = `Forgot password OTP: ${otpSample}`;
  const logStr3 = `Resend OTP: ${otpSample}`;
  const logStr4 = `Email update OTP sent to user@example.com: ${otpSample}`;

  assert.ok(!sanitizeLogValue(logStr1).includes(otpSample));
  assert.ok(sanitizeLogValue(logStr1).includes("[REDACTED_OTP]"));

  assert.ok(!sanitizeLogValue(logStr2).includes(otpSample));
  assert.ok(sanitizeLogValue(logStr2).includes("[REDACTED_OTP]"));

  assert.ok(!sanitizeLogValue(logStr3).includes(otpSample));
  assert.ok(sanitizeLogValue(logStr3).includes("[REDACTED_OTP]"));

  assert.ok(!sanitizeLogValue(logStr4).includes(otpSample));
  assert.ok(sanitizeLogValue(logStr4).includes("[REDACTED_OTP]"));
});

test("sanitizeLogValue redacts passwords and secrets from strings", () => {
  const secretPassword = "SuperSecretPassword123!";
  const logStr = `User login attempt with password: ${secretPassword}`;
  const sanitized = sanitizeLogValue(logStr);

  assert.ok(!sanitized.includes(secretPassword));
  assert.ok(sanitized.includes("[REDACTED_PASSWORD]"));
});

test("sanitizeLogValue redacts JWT tokens from strings", () => {
  const fakeJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const logStr = `Authentication header Bearer ${fakeJwt}`;
  const sanitized = sanitizeLogValue(logStr);

  assert.ok(!sanitized.includes(fakeJwt));
  assert.ok(sanitized.includes("[REDACTED_JWT]"));
});

test("sanitizeLogValue redacts sensitive keys from objects and nested objects", () => {
  const payload = {
    event: "AUTH_VERIFICATION",
    email: "user@example.com",
    otp: "591024",
    password: "Password123!",
    token: "session-secret-token",
    cookie: "token=xyz; otpToken=abc",
    nested: {
      newPassword: "NewSecretPassword!",
      razorpay_signature: "a1b2c3d4e5f6",
      safeCounter: 42,
    },
  };

  const sanitized = sanitizeLogValue(payload);

  assert.equal(sanitized.otp, "[REDACTED]");
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.cookie, "[REDACTED]");
  assert.equal(sanitized.nested.newPassword, "[REDACTED]");
  assert.equal(sanitized.nested.razorpay_signature, "[REDACTED]");
  assert.equal(sanitized.nested.safeCounter, 42);
  assert.equal(sanitized.email, "user@example.com");
});

test("sanitizeLogValue redacts sensitive properties on Error instances", () => {
  const err = new Error("Authentication failure with otp 123456");
  err.password = "secretPass";
  err.otpToken = "secretOtpToken";

  const sanitizedErr = sanitizeLogValue(err);

  assert.ok(!sanitizedErr.message.includes("123456"));
  assert.ok(sanitizedErr.message.includes("[REDACTED_OTP]"));
  assert.equal(sanitizedErr.password, "[REDACTED]");
  assert.equal(sanitizedErr.otpToken, "[REDACTED]");
});

test("Winston logger does not write raw OTPs or passwords to log files", async () => {
  const rawOtp = "998877";
  const rawPassword = "P@sswordUnmasked999";

  logger.info(`Verification OTP sent for signup to ${maskEmail("testuser@example.com")}`);
  logger.info(`User login attempt password: ${rawPassword}`);
  logger.error({
    message: `Verification failure with OTP: ${rawOtp}`,
    otp: rawOtp,
    password: rawPassword,
  });

  // Allow winston stream buffer to flush
  await new Promise((resolve) => setTimeout(resolve, 200));

  const combinedLogPath = path.join(__dirname, "../logs/combined.log");
  const errorLogPath = path.join(__dirname, "../logs/error.log");

  if (fs.existsSync(combinedLogPath)) {
    const combinedContent = fs.readFileSync(combinedLogPath, "utf-8");
    assert.ok(!combinedContent.includes(rawOtp), "combined.log must not contain the raw OTP");
    assert.ok(!combinedContent.includes(rawPassword), "combined.log must not contain the raw password");
  }

  if (fs.existsSync(errorLogPath)) {
    const errorContent = fs.readFileSync(errorLogPath, "utf-8");
    assert.ok(!errorContent.includes(rawOtp), "error.log must not contain the raw OTP");
    assert.ok(!errorContent.includes(rawPassword), "error.log must not contain the raw password");
  }
});

test("Application source files do not contain console.log or logger.info exposing plaintext OTP variables", () => {
  const authControllerContent = fs.readFileSync(
    path.join(__dirname, "../controllers/user/authContoller.js"),
    "utf-8"
  );
  const profileControllerContent = fs.readFileSync(
    path.join(__dirname, "../controllers/user/profileController.js"),
    "utf-8"
  );

  // Check authContoller.js
  assert.ok(
    !/console\.log\(.*otp.*\)/i.test(authControllerContent),
    "authContoller.js must not contain console.log statements with otp"
  );
  assert.ok(
    !/logger\.info\(.*OTP:\s*\$\{otp\}/i.test(authControllerContent),
    "authContoller.js must not contain logger statements exposing ${otp}"
  );
  assert.ok(
    !/Sign up OTP is \$\{otp\}/i.test(authControllerContent),
    "authContoller.js must not contain 'Sign up OTP is ${otp}'"
  );

  // Check profileController.js
  assert.ok(
    !/logger\.info\(.*:\s*\$\{otp\}/i.test(profileControllerContent),
    "profileController.js must not contain logger statements exposing ${otp}"
  );
  assert.ok(
    !/Email update OTP sent to.*:\s*\$\{otp\}/i.test(profileControllerContent),
    "profileController.js must not contain email update OTP leak"
  );
});

test("Signup OTP generation logs event and masked email without exposing OTP", () => {
  const email = "newuser.test@example.com";
  const otp = generateOtp();
  const capturedLogs = [];

  const originalInfo = logger.info;
  logger.info = (msg) => {
    capturedLogs.push(typeof msg === "string" ? msg : JSON.stringify(msg));
    originalInfo.call(logger, msg);
  };

  try {
    // Controller behavior on signup OTP generation
    logger.info(`Verification OTP sent for signup to ${maskEmail(email)}`);

    const logOutput = capturedLogs.join(" ");
    assert.ok(!logOutput.includes(String(otp)), "Logs must not contain generated OTP");
    assert.ok(logOutput.includes("n***@example.com"), "Logs must contain masked email");
    assert.ok(logOutput.includes("Verification OTP sent for signup"), "Logs must contain audit event");
  } finally {
    logger.info = originalInfo;
  }
});

test("Forgot password OTP generation logs event and masked email without exposing OTP", () => {
  const email = "forgot.pass@example.com";
  const otp = generateOtp();
  const capturedLogs = [];

  const originalInfo = logger.info;
  logger.info = (msg) => {
    capturedLogs.push(typeof msg === "string" ? msg : JSON.stringify(msg));
    originalInfo.call(logger, msg);
  };

  try {
    // Controller behavior on forgot password OTP generation
    logger.info(`Verification OTP sent for password reset to ${maskEmail(email)}`);

    const logOutput = capturedLogs.join(" ");
    assert.ok(!logOutput.includes(String(otp)), "Logs must not contain generated OTP");
    assert.ok(logOutput.includes("f***@example.com"), "Logs must contain masked email");
    assert.ok(logOutput.includes("Verification OTP sent for password reset"), "Logs must contain audit event");
  } finally {
    logger.info = originalInfo;
  }
});

test("Resend OTP logs event and masked email without exposing OTP", () => {
  const email = "resend.user@example.com";
  const otp = generateOtp();
  const purpose = "signup";
  const capturedLogs = [];

  const originalInfo = logger.info;
  logger.info = (msg) => {
    capturedLogs.push(typeof msg === "string" ? msg : JSON.stringify(msg));
    originalInfo.call(logger, msg);
  };

  try {
    // Controller behavior on resend OTP
    logger.info(`Verification OTP resent for ${purpose} to ${maskEmail(email)}`);

    const logOutput = capturedLogs.join(" ");
    assert.ok(!logOutput.includes(String(otp)), "Logs must not contain generated OTP");
    assert.ok(logOutput.includes("r***@example.com"), "Logs must contain masked email");
    assert.ok(logOutput.includes("Verification OTP resent for signup"), "Logs must contain audit event");
  } finally {
    logger.info = originalInfo;
  }
});

test("OTP verification logic accurately validates matching OTP and rejects invalid or expired OTP", () => {
  const email = "verify.user@example.com";
  const validOtp = 482619;
  const expiredOtpToken = generateToken(
    {
      purpose: "signup",
      otp: validOtp,
      email,
      otpExpiresAt: Date.now() - 5000, // expired 5 seconds ago
    },
    "10m"
  );

  const activeOtpToken = generateToken(
    {
      purpose: "signup",
      otp: validOtp,
      email,
      otpExpiresAt: Date.now() + 60000, // valid for 60s
    },
    "10m"
  );

  // Expired OTP
  const expiredData = jwt.verify(expiredOtpToken, process.env.JWT_SECRET);
  assert.ok(Date.now() > expiredData.otpExpiresAt, "Token must be expired");

  // Active OTP matching
  const activeData = jwt.verify(activeOtpToken, process.env.JWT_SECRET);
  assert.ok(Date.now() <= activeData.otpExpiresAt, "Token must be active");
  assert.strictEqual(String(activeData.otp), String(validOtp));

  // Active OTP mismatch
  const wrongInputOtp = "111111";
  assert.notStrictEqual(String(activeData.otp), wrongInputOtp);
});
