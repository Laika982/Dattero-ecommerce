import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validateEnv } from "../config/env.js";

describe("Environment Variable & Secret Boundary Validation Tests", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails safely in production when SESSION_SECRET is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    process.env.JWT_SECRET = "a_very_secure_long_random_jwt_secret_32_characters_minimum";
    process.env.DATABASE_URL = "mongodb://localhost:27017/testdb";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.throws(
      () => validateEnv(),
      /SESSION_SECRET is required in production/
    );
  });

  it("fails safely in production when SESSION_SECRET uses a weak/predictable default", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "your-session-secret-key";
    process.env.JWT_SECRET = "a_very_secure_long_random_jwt_secret_32_characters_minimum";
    process.env.DATABASE_URL = "mongodb://localhost:27017/testdb";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.throws(
      () => validateEnv(),
      /SESSION_SECRET is set to a known predictable\/insecure default/
    );
  });

  it("fails safely in production when SESSION_SECRET is shorter than 32 characters", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "short_secret_under_32_chars";
    process.env.JWT_SECRET = "a_very_secure_long_random_jwt_secret_32_characters_minimum";
    process.env.DATABASE_URL = "mongodb://localhost:27017/testdb";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.throws(
      () => validateEnv(),
      /SESSION_SECRET must be at least 32 characters long in production/
    );
  });

  it("fails safely in production when JWT_SECRET is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a_very_secure_long_random_session_secret_32_chars_min";
    delete process.env.JWT_SECRET;
    process.env.DATABASE_URL = "mongodb://localhost:27017/testdb";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.throws(
      () => validateEnv(),
      /JWT_SECRET is required in production/
    );
  });

  it("fails safely in production when JWT_SECRET uses a weak/predictable default", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a_very_secure_long_random_session_secret_32_chars_min";
    process.env.JWT_SECRET = "my_super_secret_key_123456789";
    process.env.DATABASE_URL = "mongodb://localhost:27017/testdb";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.throws(
      () => validateEnv(),
      /JWT_SECRET is set to a known predictable\/insecure default/
    );
  });

  it("fails safely in production when DATABASE_URL is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a_very_secure_long_random_session_secret_32_chars_min";
    process.env.JWT_SECRET = "a_very_secure_long_random_jwt_secret_32_characters_minimum";
    delete process.env.DATABASE_URL;
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.throws(
      () => validateEnv(),
      /DATABASE_URL is required in production/
    );
  });

  it("passes validation in production when all required secrets are strong and present", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a_very_secure_long_random_session_secret_32_chars_min";
    process.env.JWT_SECRET = "a_very_secure_long_random_jwt_secret_32_characters_minimum";
    process.env.DATABASE_URL = "mongodb://localhost:27017/testdb";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
    process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud";
    process.env.CLOUDINARY_API_KEY = "mock_key";
    process.env.CLOUDINARY_API_SECRET = "mock_secret";
    process.env.NODEMAILER_EMAIL = "test@example.com";
    process.env.NODEMAILER_PASSWORD = "app_password";

    assert.doesNotThrow(() => validateEnv());
  });

  it("allows running in test environment without throwing fatal errors", () => {
    process.env.NODE_ENV = "test";
    assert.doesNotThrow(() => validateEnv());
  });
});

