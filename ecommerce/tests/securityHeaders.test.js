process.env.NODE_ENV = "test";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { getHelmetConfig } from "../config/securityHeaders.js";

let server;
let baseUrl;

before(async () => {
  await connectDB();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await mongoose.connection.close();
  } catch (_) {}
});

describe("HTTP Security Headers & Helmet Configuration Tests", () => {
  describe("1. Static Policy & Environment-Specific Configuration", () => {
    it("generates development/test policy with HSTS disabled to protect local HTTP", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";
      const config = getHelmetConfig();

      assert.strictEqual(config.hsts, false, "HSTS must be disabled in test/development mode");
      assert.strictEqual(
        config.contentSecurityPolicy.directives.upgradeInsecureRequests,
        undefined,
        "upgradeInsecureRequests must not be enforced in non-production mode"
      );
      process.env.NODE_ENV = originalEnv;
    });

    it("generates production policy with HSTS and upgradeInsecureRequests enabled", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const config = getHelmetConfig();

      assert.ok(config.hsts, "HSTS must be enabled in production");
      assert.strictEqual(config.hsts.maxAge, 31536000);
      assert.strictEqual(config.hsts.includeSubDomains, true);
      assert.strictEqual(config.hsts.preload, true);
      assert.ok(
        Array.isArray(config.contentSecurityPolicy.directives.upgradeInsecureRequests),
        "upgradeInsecureRequests must be present in production CSP"
      );
      process.env.NODE_ENV = originalEnv;
    });

    it("configures COOP to allow OAuth and payment gateway popups", () => {
      const config = getHelmetConfig();
      assert.deepStrictEqual(config.crossOriginOpenerPolicy, {
        policy: "same-origin-allow-popups",
      });
    });

    it("configures clickjacking protection with X-Frame-Options: SAMEORIGIN", () => {
      const config = getHelmetConfig();
      assert.deepStrictEqual(config.xFrameOptions, { action: "sameorigin" });
    });
  });

  describe("2. Live HTTP Response Headers Verification", () => {
    it("GET / returns all required security headers", async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.strictEqual(res.status, 200);

      // 1. Content-Type Options
      assert.strictEqual(
        res.headers.get("x-content-type-options"),
        "nosniff",
        "X-Content-Type-Options must be nosniff"
      );

      // 2. Clickjacking Frame Options
      assert.strictEqual(
        res.headers.get("x-frame-options"),
        "SAMEORIGIN",
        "X-Frame-Options must be SAMEORIGIN"
      );

      // 3. Referrer Policy
      assert.strictEqual(
        res.headers.get("referrer-policy"),
        "strict-origin-when-cross-origin",
        "Referrer-Policy must be strict-origin-when-cross-origin"
      );

      // 4. Cross-Origin Opener Policy (COOP)
      assert.strictEqual(
        res.headers.get("cross-origin-opener-policy"),
        "same-origin-allow-popups",
        "COOP must allow popups for payment gateways and OAuth"
      );

      // 5. Cross-Origin Resource Policy (CORP)
      assert.strictEqual(
        res.headers.get("cross-origin-resource-policy"),
        "cross-origin",
        "CORP must allow cross-origin asset access"
      );

      // 6. X-DNS-Prefetch-Control
      assert.strictEqual(
        res.headers.get("x-dns-prefetch-control"),
        "off",
        "X-DNS-Prefetch-Control must be off"
      );

      // 7. X-Download-Options
      assert.strictEqual(
        res.headers.get("x-download-options"),
        "noopen",
        "X-Download-Options must be noopen"
      );

      // 8. X-Permitted-Cross-Domain-Policies
      assert.strictEqual(
        res.headers.get("x-permitted-cross-domain-policies"),
        "none",
        "X-Permitted-Cross-Domain-Policies must be none"
      );
    });

    it("verifies Content-Security-Policy header contains necessary origins and directives", async () => {
      const res = await fetch(`${baseUrl}/`);
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, "Content-Security-Policy header must be present");

      // Verify default-src
      assert.ok(csp.includes("default-src 'self'"), "CSP must include default-src 'self'");

      // Verify script-src allows required CDNs and payment gateway
      assert.ok(csp.includes("https://cdn.tailwindcss.com"), "CSP script-src must allow Tailwind CDN");
      assert.ok(csp.includes("https://cdn.jsdelivr.net"), "CSP script-src must allow jsDelivr");
      assert.ok(csp.includes("https://cdnjs.cloudflare.com"), "CSP script-src must allow Cloudflare CDN");
      assert.ok(csp.includes("https://checkout.razorpay.com"), "CSP script-src must allow Razorpay checkout script");
      assert.ok(csp.includes("'unsafe-inline'"), "CSP script-src must allow inline scripts used by view templates");
      assert.ok(csp.includes("'unsafe-eval'"), "CSP script-src must allow unsafe-eval for Tailwind compiler");

      // Verify style-src allows Google fonts and CDNs
      assert.ok(csp.includes("https://fonts.googleapis.com"), "CSP style-src must allow Google Fonts");

      // Verify font-src
      assert.ok(csp.includes("https://fonts.gstatic.com"), "CSP font-src must allow fonts.gstatic.com");

      // Verify img-src allows Cloudinary, Google avatars, Razorpay, data, blob
      assert.ok(csp.includes("https://res.cloudinary.com"), "CSP img-src must allow Cloudinary");
      assert.ok(csp.includes("https://lh3.googleusercontent.com"), "CSP img-src must allow Google user avatars");
      assert.ok(csp.includes("data:"), "CSP img-src must allow data URIs");
      assert.ok(csp.includes("blob:"), "CSP img-src must allow blob URIs for cropper previews");

      // Verify frame-src allows Razorpay iframe and Google OAuth
      assert.ok(csp.includes("https://api.razorpay.com"), "CSP frame-src must allow Razorpay API iframe");
      assert.ok(csp.includes("https://checkout.razorpay.com"), "CSP frame-src must allow Razorpay checkout iframe");
      assert.ok(csp.includes("https://accounts.google.com"), "CSP frame-src must allow Google Accounts");

      // Verify connect-src
      assert.ok(csp.includes("https://api.razorpay.com"), "CSP connect-src must allow Razorpay API");
      assert.ok(csp.includes("https://lumberjack.razorpay.com"), "CSP connect-src must allow Razorpay telemetry");

      // Verify object-src 'none' and base-uri 'self'
      assert.ok(csp.includes("object-src 'none'"), "CSP object-src must be 'none'");
      assert.ok(csp.includes("base-uri 'self'"), "CSP base-uri must be 'self'");
    });

    it("GET /products (Customer Catalog) serves security headers with 200 OK", async () => {
      const res = await fetch(`${baseUrl}/products`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get("content-security-policy"));
      assert.strictEqual(res.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    });

    it("GET /admin/login (Admin Portal) serves security headers with 200 OK", async () => {
      const res = await fetch(`${baseUrl}/admin/login`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get("content-security-policy"));
      assert.strictEqual(res.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    });

    it("does not send Strict-Transport-Security over local test HTTP", async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.strictEqual(
        res.headers.get("strict-transport-security"),
        null,
        "HSTS must not be sent on non-production HTTP requests"
      );
    });
  });
});
