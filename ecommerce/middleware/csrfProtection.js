import crypto from "crypto";
import { getCookieOptions } from "../config/cookie.js";

const getCsrfSecret = () =>
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "dattero_default_secure_csrf_secret_key_32";

/**
 * Generates an HMAC-SHA256 cryptographically signed CSRF token.
 * Token structure: <salt>.<hmac(salt, secret)>
 */
export function generateCsrfToken(secret = getCsrfSecret()) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(salt)
    .digest("hex");
  return `${salt}.${hmac}`;
}

/**
 * Validates the HMAC signature of a CSRF token.
 */
export function verifyCsrfToken(token, secret = getCsrfSecret()) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [salt, hmac] = parts;
  if (!salt || !hmac) return false;

  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(salt)
    .digest("hex");

  if (hmac.length !== expectedHmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac));
  } catch {
    return false;
  }
}

/**
 * Validates request Origin and Referer headers against the host header.
 * Prevents cross-origin forged requests.
 */
export function isValidOrigin(req) {
  const origin = req.headers["origin"];
  const referer = req.headers["referer"];
  const host = req.headers["host"];

  if (!host) return true;

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        return false;
      }
    } catch {
      return false;
    }
  } else if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host !== host) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Responds with 403 Forbidden on CSRF failure.
 */
export function handleCsrfError(req, res, message = "Invalid or missing CSRF token.") {
  const isAjax = Boolean(
    req.xhr ||
    req.headers["x-requested-with"] === "XMLHttpRequest" ||
    req.headers["accept"]?.includes("application/json") ||
    req.headers["content-type"]?.includes("application/json") ||
    req.headers["sec-fetch-dest"] === "empty"
  );

  if (isAjax) {
    return res.status(403).json({
      success: false,
      message,
      code: "EBADCSRFTOKEN",
    });
  }

  return res.status(403).render("user/server-error", {
    title: "Security Verification Failed",
    message: "Security verification failed. Please refresh the page and try again.",
  });
}

/**
 * Express middleware implementing CSRF defense-in-depth:
 * 1. Generates and exposes CSRF token on safe methods (GET, HEAD, OPTIONS).
 * 2. Enforces Origin/Referer verification on state-changing methods.
 * 3. Enforces double-submit HMAC signed token verification on state-changing methods (POST, PUT, PATCH, DELETE).
 */
export function csrfProtection(req, res, next) {
  const secret = getCsrfSecret();

  // Retrieve existing token from cookie or generate a new signed token
  let token = req.cookies?._csrf;
  if (!token || !verifyCsrfToken(token, secret)) {
    token = generateCsrfToken(secret);
    res.cookie("_csrf", token, getCookieOptions({ httpOnly: false }));
  }

  // Expose token to Handlebars templates & request object
  res.locals._csrf = token;
  res.locals.csrfToken = token;
  req.csrfToken = () => token;

  // Safe HTTP methods do not change state
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method.toUpperCase())) {
    return next();
  }

  // 1. Origin / Referer Validation (blocks cross-origin forged requests)
  if (!isValidOrigin(req)) {
    return handleCsrfError(req, res, "Cross-origin request blocked by CSRF defense.");
  }

  // 2. Token Extraction from Headers, Body, or Query
  const submittedToken =
    req.headers["x-csrf-token"] ||
    req.headers["x-xsrf-token"] ||
    req.headers["csrf-token"] ||
    req.body?._csrf ||
    req.query?._csrf;

  if (!submittedToken) {
    return handleCsrfError(req, res, "CSRF token missing.");
  }

  if (!verifyCsrfToken(submittedToken, secret)) {
    return handleCsrfError(req, res, "CSRF token signature invalid.");
  }

  // Double-submit comparison: submitted token must match active cookie token
  try {
    const isMatch =
      submittedToken.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(submittedToken), Buffer.from(token));
    if (!isMatch) {
      return handleCsrfError(req, res, "CSRF token mismatch.");
    }
  } catch {
    return handleCsrfError(req, res, "CSRF token verification failed.");
  }

  return next();
}

export default csrfProtection;

