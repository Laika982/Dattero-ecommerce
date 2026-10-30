/**
 * Centralized Cookie Security Configuration
 *
 * Configures all application cookies (token, adminToken, otpToken, signupToken,
 * resetEmail, _csrf, connect.sid) with consistent and secure attributes:
 * - httpOnly: true (prevents XSS theft)
 * - sameSite: "lax" (prevents cross-site request forgery)
 * - secure: true in production (requires HTTPS), false in development (supports local HTTP)
 * - path: "/" (consistent cookie scope across the entire domain)
 */

export const isSecureCookie = () => process.env.NODE_ENV === "production";

/**
 * Returns standard options for setting cookies.
 * @param {Object} customOptions
 * @returns {Object}
 */
export const getCookieOptions = (customOptions = {}) => {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(),
    path: "/",
    ...customOptions,
  };
};

/**
 * Returns standard matching options for clearing cookies.
 * Must match the path, sameSite, and secure attributes of the created cookie.
 * @param {Object} customOptions
 * @returns {Object}
 */
export const getClearCookieOptions = (customOptions = {}) => {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(),
    path: "/",
    ...customOptions,
  };
};

/**
 * Helper to set a cookie with standardized security defaults.
 * @param {Object} res - Express response object
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {Object} customOptions - Extra options (e.g. maxAge)
 */
export const setCookie = (res, name, value, customOptions = {}) => {
  res.cookie(name, value, getCookieOptions(customOptions));
};

/**
 * Helper to clear a cookie with matching path, sameSite, and security options.
 * @param {Object} res - Express response object
 * @param {string} name - Cookie name
 * @param {Object} customOptions - Extra options
 */
export const clearCookie = (res, name, customOptions = {}) => {
  res.clearCookie(name, getClearCookieOptions(customOptions));
};

