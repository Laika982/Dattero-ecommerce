process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "mock_session_secret_for_csrf_test_32chars";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  generateCsrfToken,
  verifyCsrfToken,
  isValidOrigin,
  csrfProtection,
} from "../middleware/csrfProtection.js";

describe("BUG-SEC-002: CSRF Protection & Origin Validation Tests", () => {
  const secret = process.env.SESSION_SECRET;

  // 1. Cryptographic token generation & HMAC verification
  it("1. generates and verifies authentic HMAC-SHA256 signed CSRF tokens", () => {
    const token = generateCsrfToken(secret);
    assert.ok(token);
    assert.match(token, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);

    const isValid = verifyCsrfToken(token, secret);
    assert.strictEqual(isValid, true, "Authentic CSRF token must pass verification");
  });

  // 2. Rejection of invalid, tampered, or forged tokens
  it("2. rejects tampered, forged, or malformed CSRF tokens", () => {
    assert.strictEqual(verifyCsrfToken("", secret), false);
    assert.strictEqual(verifyCsrfToken(null, secret), false);
    assert.strictEqual(verifyCsrfToken("invalid-token-string", secret), false);

    // Tampered HMAC signature
    const validToken = generateCsrfToken(secret);
    const [salt] = validToken.split(".");
    const forgedToken = `${salt}.${crypto.randomBytes(32).toString("hex")}`;
    assert.strictEqual(verifyCsrfToken(forgedToken, secret), false, "Forged HMAC signature must fail verification");

    // Token signed with a different secret
    const alienSecret = "another_untrusted_secret_key_12345";
    const alienToken = generateCsrfToken(alienSecret);
    assert.strictEqual(verifyCsrfToken(alienToken, secret), false, "Token signed with foreign secret must fail");
  });

  // 3. Safe HTTP methods (GET, HEAD, OPTIONS) pass through and issue token
  it("3. safe HTTP methods (GET, HEAD, OPTIONS) bypass verification and set token", () => {
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    for (const method of safeMethods) {
      let nextCalled = false;
      const req = {
        method,
        cookies: {},
        headers: {},
      };
      const cookiesSet = {};
      const res = {
        cookie: (name, val, opts) => {
          cookiesSet[name] = val;
        },
        locals: {},
      };

      csrfProtection(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true, `${method} must call next() without blocking`);
      assert.ok(cookiesSet["_csrf"], `${method} must set the _csrf cookie`);
      assert.ok(res.locals._csrf, `${method} must expose _csrf in res.locals`);
    }
  });

  // 4. Missing CSRF token on state-changing requests is rejected with 403
  it("4. rejects state-changing requests (POST, PUT, PATCH, DELETE) when CSRF token is missing", () => {
    const stateChangingMethods = ["POST", "PUT", "PATCH", "DELETE"];
    const cookieToken = generateCsrfToken(secret);

    for (const method of stateChangingMethods) {
      let nextCalled = false;
      let statusCode = null;
      let responseBody = null;

      const req = {
        method,
        cookies: { _csrf: cookieToken },
        headers: {
          host: "localhost:3000",
          accept: "application/json",
        },
        body: {},
      };

      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              responseBody = data;
            },
          };
        },
        locals: {},
      };

      csrfProtection(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false, `${method} without token must not call next()`);
      assert.strictEqual(statusCode, 403, `${method} without token must return 403 Forbidden`);
      assert.strictEqual(responseBody?.code, "EBADCSRFTOKEN");
    }
  });

  // 5. Invalid or mismatched CSRF token is rejected with 403
  it("5. rejects state-changing requests when CSRF token is invalid or does not match cookie", () => {
    const cookieToken = generateCsrfToken(secret);
    const wrongToken = generateCsrfToken(secret); // Valid signature, but different session token

    let nextCalled = false;
    let statusCode = null;

    const req = {
      method: "POST",
      cookies: { _csrf: cookieToken },
      headers: {
        host: "localhost:3000",
        accept: "application/json",
        "x-csrf-token": wrongToken,
      },
      body: {},
    };

    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: () => {},
        };
      },
      locals: {},
    };

    csrfProtection(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusCode, 403, "Mismatched token must return 403 Forbidden");
  });

  // 6. Valid CSRF token in header, body, or query parameter is accepted
  it("6. accepts state-changing requests when valid CSRF token is provided via header or body", () => {
    const validToken = generateCsrfToken(secret);

    // Case A: Token in x-csrf-token header
    let headerNextCalled = false;
    const reqHeader = {
      method: "POST",
      cookies: { _csrf: validToken },
      headers: {
        host: "localhost:3000",
        "x-csrf-token": validToken,
      },
      body: {},
    };
    csrfProtection(reqHeader, { locals: {} }, () => {
      headerNextCalled = true;
    });
    assert.strictEqual(headerNextCalled, true, "Valid token in x-csrf-token header must pass");

    // Case B: Token in req.body._csrf
    let bodyNextCalled = false;
    const reqBody = {
      method: "POST",
      cookies: { _csrf: validToken },
      headers: {
        host: "localhost:3000",
      },
      body: { _csrf: validToken, name: "Sample Category" },
    };
    csrfProtection(reqBody, { locals: {} }, () => {
      bodyNextCalled = true;
    });
    assert.strictEqual(bodyNextCalled, true, "Valid token in form body must pass");

    // Case C: Token in query string (for multipart uploads)
    let queryNextCalled = false;
    const reqQuery = {
      method: "POST",
      cookies: { _csrf: validToken },
      headers: {
        host: "localhost:3000",
      },
      query: { _csrf: validToken },
      body: {},
    };
    csrfProtection(reqQuery, { locals: {} }, () => {
      queryNextCalled = true;
    });
    assert.strictEqual(queryNextCalled, true, "Valid token in query parameter must pass");
  });

  // 7. Request Origin & Referer validation
  it("7. blocks cross-origin state-changing requests based on Origin or Referer header", () => {
    // Cross-origin request from attacker domain
    const reqEvilOrigin = {
      headers: {
        host: "dattero.com",
        origin: "https://evil-attacker.site",
      },
    };
    assert.strictEqual(isValidOrigin(reqEvilOrigin), false, "Evil origin must be blocked");

    // Cross-origin referer from attacker domain
    const reqEvilReferer = {
      headers: {
        host: "dattero.com",
        referer: "https://evil-attacker.site/phish.html",
      },
    };
    assert.strictEqual(isValidOrigin(reqEvilReferer), false, "Evil referer must be blocked");

    // Legitimate same-origin request
    const reqLegitOrigin = {
      headers: {
        host: "dattero.com",
        origin: "https://dattero.com",
      },
    };
    assert.strictEqual(isValidOrigin(reqLegitOrigin), true, "Legitimate origin must be accepted");

    // Legitimate same-origin referer
    const reqLegitReferer = {
      headers: {
        host: "dattero.com",
        referer: "https://dattero.com/profile/address",
      },
    };
    assert.strictEqual(isValidOrigin(reqLegitReferer), true, "Legitimate referer must be accepted");
  });

  // 8. Customer state-changing routes CSRF protection
  it("8. protects customer state-changing operations (profile, cart, address, returns)", () => {
    const validToken = generateCsrfToken(secret);
    const customerRoutes = [
      { method: "POST", url: "/profile/edit" },
      { method: "POST", url: "/profile/address/add" },
      { method: "DELETE", url: "/profile/address/delete/123" },
      { method: "POST", url: "/cart/add" },
      { method: "PATCH", url: "/cart/var-1/increase" },
      { method: "POST", url: "/order/orders/ord-1/return" },
    ];

    for (const route of customerRoutes) {
      // 1. Without token -> Blocked
      let blocked = false;
      const reqBlocked = {
        method: route.method,
        url: route.url,
        cookies: { _csrf: validToken, token: "mock_jwt_customer_token" },
        headers: { host: "localhost:3000", accept: "application/json" },
        body: {},
      };
      const resBlocked = {
        status: (code) => {
          if (code === 403) blocked = true;
          return { json: () => {} };
        },
        locals: {},
      };
      csrfProtection(reqBlocked, resBlocked, () => {});
      assert.strictEqual(blocked, true, `Customer route ${route.method} ${route.url} must block request without CSRF token`);

      // 2. With valid token -> Allowed
      let passed = false;
      const reqAllowed = {
        method: route.method,
        url: route.url,
        cookies: { _csrf: validToken, token: "mock_jwt_customer_token" },
        headers: { host: "localhost:3000", "x-csrf-token": validToken },
        body: {},
      };
      csrfProtection(reqAllowed, { locals: {} }, () => {
        passed = true;
      });
      assert.strictEqual(passed, true, `Customer route ${route.method} ${route.url} must allow request with valid CSRF token`);
    }
  });

  // 9. Admin state-changing routes CSRF protection
  it("9. protects admin state-changing operations (category, product, coupon, order status)", () => {
    const validToken = generateCsrfToken(secret);
    const adminRoutes = [
      { method: "POST", url: "/admin/category/addCategory" },
      { method: "POST", url: "/admin/product/addProduct" },
      { method: "PATCH", url: "/admin/customer/blockCustomer" },
      { method: "POST", url: "/admin/coupons/add" },
      { method: "PATCH", url: "/admin/order/orders/ord-1/status" },
    ];

    for (const route of adminRoutes) {
      // 1. Without token -> Blocked
      let blocked = false;
      const reqBlocked = {
        method: route.method,
        url: route.url,
        cookies: { _csrf: validToken, adminToken: "mock_jwt_admin_token" },
        headers: { host: "localhost:3000", accept: "application/json" },
        body: {},
      };
      const resBlocked = {
        status: (code) => {
          if (code === 403) blocked = true;
          return { json: () => {} };
        },
        locals: {},
      };
      csrfProtection(reqBlocked, resBlocked, () => {});
      assert.strictEqual(blocked, true, `Admin route ${route.method} ${route.url} must block request without CSRF token`);

      // 2. With valid token -> Allowed
      let passed = false;
      const reqAllowed = {
        method: route.method,
        url: route.url,
        cookies: { _csrf: validToken, adminToken: "mock_jwt_admin_token" },
        headers: { host: "localhost:3000", "x-csrf-token": validToken },
        body: {},
      };
      csrfProtection(reqAllowed, { locals: {} }, () => {
        passed = true;
      });
      assert.strictEqual(passed, true, `Admin route ${route.method} ${route.url} must allow request with valid CSRF token`);
    }
  });

  // 10. Login and OTP authentication flows work with legitimate CSRF token
  it("10. legitimate login and OTP flows with valid CSRF token pass verification", () => {
    const authRoutes = [
      { method: "POST", url: "/login" },
      { method: "POST", url: "/signup" },
      { method: "POST", url: "/verify-otp" },
      { method: "POST", url: "/admin/login" },
    ];

    for (const authRoute of authRoutes) {
      // Legitimate user browser flow:
      // Step 1: User loaded GET page -> cookie _csrf was set and token was provided in form
      const token = generateCsrfToken(secret);
      let passed = false;

      const req = {
        method: authRoute.method,
        url: authRoute.url,
        cookies: { _csrf: token },
        headers: { host: "localhost:3000" },
        body: { _csrf: token },
      };

      csrfProtection(req, { locals: {} }, () => {
        passed = true;
      });

      assert.strictEqual(passed, true, `Legitimate ${authRoute.url} request with valid CSRF token must pass`);
    }
  });
});

