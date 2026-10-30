import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import http from "http";
import {
  isSecureCookie,
  getCookieOptions,
  getClearCookieOptions,
  setCookie,
  clearCookie,
} from "../config/cookie.js";

describe("BUG-SEC-003: Cookie Security & Environment Attribute Tests", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // 1. Local Development Configuration
  describe("1. Local Development Mode (NODE_ENV !== 'production')", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("evaluates isSecureCookie() to false in development", () => {
      assert.strictEqual(isSecureCookie(), false);
    });

    it("generates development cookie options with secure: false and httpOnly: true", () => {
      const options = getCookieOptions({ maxAge: 60000 });
      assert.strictEqual(options.secure, false, "Development cookie should allow HTTP");
      assert.strictEqual(options.httpOnly, true, "Development cookie must still protect from XSS");
      assert.strictEqual(options.sameSite, "lax", "Development cookie must enforce SameSite=Lax");
      assert.strictEqual(options.path, "/", "Development cookie must have root path scope");
      assert.strictEqual(options.maxAge, 60000);
    });

    it("generates clearCookie options matching creation options in development", () => {
      const clearOptions = getClearCookieOptions();
      assert.strictEqual(clearOptions.secure, false);
      assert.strictEqual(clearOptions.httpOnly, true);
      assert.strictEqual(clearOptions.sameSite, "lax");
      assert.strictEqual(clearOptions.path, "/");
    });
  });

  // 2. Production Configuration
  describe("2. Production Mode (NODE_ENV === 'production')", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("evaluates isSecureCookie() to true in production", () => {
      assert.strictEqual(isSecureCookie(), true);
    });

    it("enforces secure: true, httpOnly: true, sameSite: 'lax', path: '/' in production", () => {
      const options = getCookieOptions({ maxAge: 24 * 60 * 60 * 1000 });
      assert.strictEqual(options.secure, true, "Production cookie MUST require HTTPS (secure: true)");
      assert.strictEqual(options.httpOnly, true, "Production cookie MUST be httpOnly");
      assert.strictEqual(options.sameSite, "lax", "Production cookie MUST have sameSite: lax");
      assert.strictEqual(options.path, "/", "Production cookie MUST have path: /");
      assert.strictEqual(options.maxAge, 24 * 60 * 60 * 1000);
    });

    it("enforces clearCookie options with matching secure: true and path: '/' in production", () => {
      const clearOptions = getClearCookieOptions();
      assert.strictEqual(clearOptions.secure, true, "Production clearCookie MUST match secure: true");
      assert.strictEqual(clearOptions.httpOnly, true);
      assert.strictEqual(clearOptions.sameSite, "lax");
      assert.strictEqual(clearOptions.path, "/");
    });
  });

  // 3. Customer & Admin Cookie Issuance and Clearing Lifecycle
  describe("3. HTTP Cookie Lifecycle (Set & Clear with Headers)", () => {
    let server;
    let baseUrl;

    beforeEach(async () => {
      const app = express();
      app.use(cookieParser());

      // Login customer
      app.post("/test-login", (req, res) => {
        setCookie(res, "token", "mock_customer_jwt_token", { maxAge: 86400000 });
        res.json({ success: true, message: "Logged in" });
      });

      // Logout customer
      app.post("/test-logout", (req, res) => {
        clearCookie(res, "token");
        res.json({ success: true, message: "Logged out" });
      });

      // Admin login
      app.post("/test-admin-login", (req, res) => {
        setCookie(res, "adminToken", "mock_admin_jwt_token", { maxAge: 86400000 });
        res.json({ success: true, message: "Admin logged in" });
      });

      // Admin logout
      app.post("/test-admin-logout", (req, res) => {
        clearCookie(res, "adminToken");
        res.json({ success: true, message: "Admin logged out" });
      });

      // OTP session
      app.post("/test-send-otp", (req, res) => {
        setCookie(res, "otpToken", "mock_otp_jwt", { maxAge: 600000 });
        setCookie(res, "signupToken", "mock_signup_jwt", { maxAge: 600000 });
        res.json({ success: true });
      });

      // Password reset session
      app.post("/test-reset-session", (req, res) => {
        setCookie(res, "resetEmail", "mock_reset_jwt", { maxAge: 600000 });
        res.json({ success: true });
      });

      await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("sets customer 'token' cookie with HttpOnly, SameSite=Lax, and Path=/", async () => {
      process.env.NODE_ENV = "development";
      const res = await fetch(`${baseUrl}/test-login`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /token=mock_customer_jwt_token/);
      assert.match(setCookieHeader, /HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=Lax/i);
      assert.match(setCookieHeader, /Path=\//i);
    });

    it("clears customer 'token' cookie with matching attributes and epoch expiry", async () => {
      process.env.NODE_ENV = "development";
      const res = await fetch(`${baseUrl}/test-logout`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /token=;/);
      assert.match(setCookieHeader, /Expires=Thu, 01 Jan 1970/i);
      assert.match(setCookieHeader, /Path=\//i);
      assert.match(setCookieHeader, /HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=Lax/i);
    });

    it("sets admin 'adminToken' cookie with HttpOnly, SameSite=Lax, and Path=/", async () => {
      process.env.NODE_ENV = "development";
      const res = await fetch(`${baseUrl}/test-admin-login`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /adminToken=mock_admin_jwt_token/);
      assert.match(setCookieHeader, /HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=Lax/i);
      assert.match(setCookieHeader, /Path=\//i);
    });

    it("clears admin 'adminToken' cookie with matching attributes", async () => {
      process.env.NODE_ENV = "development";
      const res = await fetch(`${baseUrl}/test-admin-logout`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /adminToken=;/);
      assert.match(setCookieHeader, /Expires=Thu, 01 Jan 1970/i);
      assert.match(setCookieHeader, /Path=\//i);
    });

    it("sets OTP cookies (otpToken, signupToken) with 10m TTL and HttpOnly", async () => {
      process.env.NODE_ENV = "development";
      const res = await fetch(`${baseUrl}/test-send-otp`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /otpToken=mock_otp_jwt/);
      assert.match(setCookieHeader, /signupToken=mock_signup_jwt/);
      assert.match(setCookieHeader, /HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=Lax/i);
    });

    it("sets password-reset cookie (resetEmail) with HttpOnly and SameSite=Lax", async () => {
      process.env.NODE_ENV = "development";
      const res = await fetch(`${baseUrl}/test-reset-session`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /resetEmail=mock_reset_jwt/);
      assert.match(setCookieHeader, /HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=Lax/i);
    });

    it("emits 'Secure' attribute in Set-Cookie header when running under NODE_ENV=production", async () => {
      process.env.NODE_ENV = "production";
      const res = await fetch(`${baseUrl}/test-login`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /token=mock_customer_jwt_token/);
      assert.match(setCookieHeader, /Secure/i, "Must include Secure attribute in production");
      assert.match(setCookieHeader, /HttpOnly/i);
      assert.match(setCookieHeader, /SameSite=Lax/i);
    });

    it("emits 'Secure' attribute when clearing cookies under NODE_ENV=production", async () => {
      process.env.NODE_ENV = "production";
      const res = await fetch(`${baseUrl}/test-logout`, { method: "POST" });
      const setCookieHeader = res.headers.get("set-cookie") || "";

      assert.match(setCookieHeader, /token=;/);
      assert.match(setCookieHeader, /Secure/i, "Must include Secure attribute when clearing in production");
      assert.match(setCookieHeader, /Path=\//i);
    });
  });

  // 4. Proxy Trust & HTTPS Detection
  describe("4. Proxy Trust & HTTPS Detection behind Reverse Proxy", () => {
    let app;
    let server;
    let baseUrl;

    beforeEach(async () => {
      app = express();
      // Configure proxy trust exactly as in app.js
      app.set("trust proxy", 1);
      app.use(cookieParser());

      app.get("/test-proxy-detection", (req, res) => {
        res.json({
          secure: req.secure,
          protocol: req.protocol,
          ip: req.ip,
        });
      });

      await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("recognizes HTTPS protocol when behind a TLS terminating proxy with X-Forwarded-Proto", async () => {
      const res = await fetch(`${baseUrl}/test-proxy-detection`, {
        headers: {
          "X-Forwarded-Proto": "https",
          "X-Forwarded-For": "203.0.113.195",
        },
      });

      const data = await res.json();
      assert.strictEqual(data.secure, true, "req.secure must be true when X-Forwarded-Proto is https");
      assert.strictEqual(data.protocol, "https", "req.protocol must be https");
      assert.strictEqual(data.ip, "203.0.113.195");
    });

    it("evaluates req.secure to false when direct HTTP request without proxy headers", async () => {
      const res = await fetch(`${baseUrl}/test-proxy-detection`);
      const data = await res.json();
      assert.strictEqual(data.secure, false, "req.secure must be false for plain HTTP");
      assert.strictEqual(data.protocol, "http");
    });
  });
});

