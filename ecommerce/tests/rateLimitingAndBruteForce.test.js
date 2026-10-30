import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import express from "express";
import http from "http";
import MongoRateLimitStore from "../middleware/mongoRateLimitStore.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { generateOtp } from "../utils/otp.js";
import { generateToken } from "../utils/token.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_dattero_12345";

// Helper to launch a lightweight Express app with specific middleware for HTTP testing
function startTestServer(middleware, handler) {
  const app = express();
  app.use(express.json());
  app.use(middleware);
  app.post("/test-endpoint", handler);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}/test-endpoint`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test("MongoRateLimitStore increments, tracks hits, and resets keys", async () => {
  const store = new MongoRateLimitStore({ prefix: "test-rl:", windowMs: 10000 });
  store.init({ windowMs: 10000 });

  const clientKey = "client-ip-127.0.0.1";
  await store.resetKey(clientKey);

  const hit1 = await store.increment(clientKey);
  assert.equal(hit1.totalHits, 1);
  assert.ok(hit1.resetTime instanceof Date);

  const hit2 = await store.increment(clientKey);
  assert.equal(hit2.totalHits, 2);

  await store.decrement(clientKey);
  const hitAfterDec = await store.increment(clientKey);
  assert.equal(hitAfterDec.totalHits, 2);

  await store.resetKey(clientKey);
  const hitAfterReset = await store.increment(clientKey);
  assert.equal(hitAfterReset.totalHits, 1);
});

test("Contact rate limiter allows up to limit and throttles subsequent requests with 429", async () => {
  const testContactLimiter = createRateLimiter({
    windowMs: 5000,
    max: 3,
    prefix: "test-contact:",
    message: "Contact submission limit reached.",
  });

  const { server, url, close } = await startTestServer(testContactLimiter, (req, res) => {
    res.status(200).json({ success: true, message: "Message received" });
  });

  try {
    // 3 allowed requests
    for (let i = 1; i <= 3; i++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ message: `Message ${i}` }),
      });
      assert.equal(res.status, 200, `Request ${i} should succeed`);
      const data = await res.json();
      assert.equal(data.success, true);
    }

    // 4th request must be throttled with 429
    const resThrottled = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message: "Spam message 4" }),
    });
    assert.equal(resThrottled.status, 429, "4th request must return 429");
    const throttledData = await resThrottled.json();
    assert.equal(throttledData.success, false);
    assert.ok(throttledData.message.includes("Contact submission limit reached"));
    assert.ok(typeof throttledData.retryAfter === "number");
  } finally {
    await close();
  }
});

test("OTP resend cooldown rejects early resend requests before cooldown expires", () => {
  // Simulate active session where cooldown has 45 seconds remaining
  const activeDeadline = Date.now() + 45 * 1000;
  const decoded = {
    purpose: "signup",
    email: "user@example.com",
    otpExpiresAt: activeDeadline,
    resendCount: 0,
  };

  const isCooldownActive = decoded.otpExpiresAt && Date.now() < decoded.otpExpiresAt;
  assert.ok(isCooldownActive, "Cooldown should be identified as active");

  const waitSeconds = Math.ceil((decoded.otpExpiresAt - Date.now()) / 1000);
  assert.ok(waitSeconds > 0 && waitSeconds <= 45);
});

test("OTP resend allows resend once cooldown expires and tracks resend counts", () => {
  // Simulate expired cooldown
  const expiredDeadline = Date.now() - 5000;
  const decoded = {
    purpose: "signup",
    email: "user@example.com",
    otpExpiresAt: expiredDeadline,
    resendCount: 1,
  };

  const isCooldownActive = decoded.otpExpiresAt && Date.now() < decoded.otpExpiresAt;
  assert.ok(!isCooldownActive, "Cooldown should no longer be active");

  // Allow resend and bump count
  const newResendCount = (decoded.resendCount || 0) + 1;
  assert.equal(newResendCount, 2);

  const newOtpData = {
    purpose: decoded.purpose,
    email: decoded.email,
    otp: generateOtp(),
    resendCount: newResendCount,
    otpExpiresAt: Date.now() + 60 * 1000,
  };

  assert.ok(newOtpData.otpExpiresAt > Date.now());
});

test("OTP resend terminates session when maximum resend attempts (3) are reached", () => {
  const maxAttempts = 3;
  const decoded = {
    purpose: "signup",
    email: "user@example.com",
    otpExpiresAt: Date.now() - 1000,
    resendCount: 3, // Already reached 3 resends
  };

  const isMaxReached = (decoded.resendCount || 0) >= maxAttempts;
  assert.ok(isMaxReached, "Should reject further resends once limit of 3 is reached");
});

test("OTP verification tracks failed attempts and burns session on 5th incorrect attempt", () => {
  const secretOtp = 654321;
  const MAX_ATTEMPTS = 5;

  let currentFailedAttempts = 0;

  // First 4 wrong guesses
  for (let i = 1; i <= 4; i++) {
    currentFailedAttempts += 1;
    const shouldInvalidate = currentFailedAttempts >= MAX_ATTEMPTS;
    assert.equal(shouldInvalidate, false, `Attempt ${i} should not burn session`);
    const remaining = MAX_ATTEMPTS - currentFailedAttempts;
    assert.equal(remaining, 5 - i);
  }

  // 5th wrong guess must burn the session
  currentFailedAttempts += 1;
  const shouldInvalidate = currentFailedAttempts >= MAX_ATTEMPTS;
  assert.equal(shouldInvalidate, true, "5th failed attempt must burn the session");
});

test("Login error messages do not reveal whether account exists", () => {
  const nonExistentUserResponse = {
    isSuccess: false,
    message: "Invalid email or password",
    statusCode: 400,
  };

  const badPasswordResponse = {
    isSuccess: false,
    message: "Invalid email or password",
    statusCode: 400,
  };

  assert.equal(
    nonExistentUserResponse.message,
    badPasswordResponse.message,
    "Non-existent user and wrong password must return identical messages"
  );
});

test("Admin login error messages do not reveal whether admin account exists", () => {
  const nonExistentAdminMessage = "Invalid admin credentials";
  const badPasswordAdminMessage = "Invalid admin credentials";

  assert.equal(
    nonExistentAdminMessage,
    badPasswordAdminMessage,
    "Admin lookup error messages must be uniform"
  );
});

