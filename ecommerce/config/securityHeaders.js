/**
 * HTTP Security Headers Configuration for Helmet
 *
 * Tailored specifically for Dattero E-Commerce:
 * - Content-Security-Policy (CSP) allows required CDNs (Tailwind, SweetAlert2, Cropper, Chart.js, FontAwesome),
 *   Razorpay payment modal & scripts, Cloudinary media, Google Fonts, and Google OAuth.
 * - Cross-Origin-Opener-Policy set to 'same-origin-allow-popups' to permit Razorpay & Google OAuth popups.
 * - HSTS enabled strictly in production behind HTTPS reverse proxy; disabled in development/test to preserve local HTTP.
 * - X-Frame-Options set to 'SAMEORIGIN' to protect against clickjacking while allowing same-origin frames.
 * - X-Content-Type-Options set to 'nosniff' to prevent MIME sniffing.
 */

export const getHelmetConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Required for embedded view scripts (forms, checkout, admin cropper)
          "'unsafe-eval'", // Required for runtime Tailwind CSS CDN & Chart.js
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "https://checkout.razorpay.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // Required for inline styles and Tailwind runtime dynamic styling
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
          "data:",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:", // Required for client-side Cropper.js image crop previews
          "https://res.cloudinary.com",
          "https://lh3.googleusercontent.com",
          "https://*.googleusercontent.com",
          "https://checkout.razorpay.com",
          "https://cdn.jsdelivr.net",
        ],
        connectSrc: [
          "'self'",
          "https://api.razorpay.com",
          "https://lumberjack.razorpay.com",
          "https://checkout.razorpay.com",
          "https://res.cloudinary.com",
          "https://cdn.jsdelivr.net",
        ],
        frameSrc: [
          "'self'",
          "https://api.razorpay.com",
          "https://checkout.razorpay.com", // Razorpay checkout popup/iframe
          "https://accounts.google.com", // Google OAuth
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: [
          "'self'",
          "https://accounts.google.com",
          "https://api.razorpay.com",
        ],
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // COEP require-corp blocks third-party CDN assets lacking CORP headers
    crossOriginEmbedderPolicy: false,
    // Allows Google OAuth and Razorpay payment popups while isolating untrusted windows
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    // Allows cross-origin client resources (e.g. static assets)
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // HSTS only in production to keep local HTTP development functional
    hsts: isProduction
      ? {
          maxAge: 31536000, // 1 year
          includeSubDomains: true,
          preload: true,
        }
      : false,
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xFrameOptions: { action: "sameorigin" },
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
  };
};

export default getHelmetConfig;
