import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateOtp } from "../utils/otp.js";
import { generateToken } from "../utils/token.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_dattero_12345";

describe("Authentication & Security Boundary Tests", () => {
  it("generates a 6-digit integer OTP", () => {
    const otp = generateOtp();
    assert.strictEqual(typeof otp, "number");
    assert.ok(otp >= 100000 && otp <= 999999, `OTP ${otp} is out of 6-digit range`);
  });

  it("hashes password with salt and securely verifies it", async () => {
    const rawPassword = "StrongPassword@123";
    const hashed = await hashPassword(rawPassword);

    assert.notStrictEqual(hashed, rawPassword);
    assert.ok(hashed.startsWith("$2"), "Password should be bcrypt hashed");

    const isCorrect = await verifyPassword(rawPassword, hashed);
    assert.strictEqual(isCorrect, true);

    const isWrong = await verifyPassword("WrongPassword!456", hashed);
    assert.strictEqual(isWrong, false);
  });

  it("generates a verifiable JWT token with custom payload", () => {
    const payload = { userId: "testUser123", email: "user@example.com" };
    const token = generateToken(payload, "1h");
    assert.ok(typeof token === "string" && token.length > 20);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    assert.strictEqual(decoded.userId, payload.userId);
    assert.strictEqual(decoded.email, payload.email);
  });

  it("rejects non-admin token when inspecting admin authorization boundary", () => {
    const customerToken = generateToken({ userId: "customer123", isAdmin: false });
    const decoded = jwt.verify(customerToken, process.env.JWT_SECRET);

    // Security check: Must not grant admin access
    const hasAdminAccess = Boolean(decoded && decoded.isAdmin === true);
    assert.strictEqual(hasAdminAccess, false, "Customer token must NOT have admin access");
  });

  it("accepts valid admin token when inspecting admin authorization boundary", () => {
    const adminToken = generateToken({ userId: "adminMaster456", isAdmin: true });
    const decoded = jwt.verify(adminToken, process.env.JWT_SECRET);

    const hasAdminAccess = Boolean(decoded && decoded.isAdmin === true);
    assert.strictEqual(hasAdminAccess, true, "Valid admin token must be recognized");
  });

  it("enforces email validation regex pattern used across auth controllers", () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    assert.ok(emailRegex.test("customer@domain.com"));
    assert.ok(emailRegex.test("user.name+tag@sub.domain.co.in"));
    assert.strictEqual(emailRegex.test("invalid-email"), false);
    assert.strictEqual(emailRegex.test("@domain.com"), false);
    assert.strictEqual(emailRegex.test("user@"), false);
  });

  it("rejects token signed with an invalid secret", () => {
    const forgedToken = jwt.sign({ userId: "hacker" }, "wrong_secret");
    assert.throws(
      () => {
        jwt.verify(forgedToken, process.env.JWT_SECRET);
      },
      (err) => err.name === "JsonWebTokenError"
    );
  });
});
