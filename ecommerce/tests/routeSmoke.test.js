process.env.NODE_ENV = "test";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import RateLimit from "../models/rateLimitSchema.js";

let server;
let baseUrl;

before(async () => {
  try {
    await connectDB();
    await RateLimit.deleteMany({});
  } catch (_) {}

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
  } catch (err) {
    // Ignore if already closed
  }
});

describe("Express Server Route Smoke & Security Integration Tests", () => {
  it("GET / returns 200 OK (Home Page)", async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
  });

  it("GET /products returns 200 OK (Product Listing) with search input, clear button, and stock status", async () => {
    const res = await fetch(`${baseUrl}/products`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="searchInput"/);
    assert.match(html, /id="clearSearchBtn"/);
    assert.match(html, /id="applySearchBtn"/);
    assert.match(html, /addEventListener\("click", applySearch\)/);
    assert.match(html, /In Stock|Low Stock|Out of Stock/);
    assert.match(html, /bg-(?:green|yellow|red)-500/);
    assert.match(html, /\(\d+\)/);
  });

  it("GET /products?search=burfi renders populated search and visible clear button", async () => {
    const res = await fetch(`${baseUrl}/products?search=burfi`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /value="burfi"/);
    assert.match(html, /id="clearSearchBtn"/);
  });

  it("GET /login returns 200 OK (Customer Login)", async () => {
    const res = await fetch(`${baseUrl}/login`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
  });

  it("GET /signup returns 200 OK (Customer Signup)", async () => {
    const res = await fetch(`${baseUrl}/signup`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
  });

  it("GET /forgotPassword returns 200 OK (Password Recovery)", async () => {
    const res = await fetch(`${baseUrl}/forgotPassword`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
  });

  it("GET /admin/login returns 200 OK (Admin Login)", async () => {
    const res = await fetch(`${baseUrl}/admin/login`, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
  });

  it("GET /admin without adminToken redirects to /admin/login (302)", async () => {
    const res = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/admin/login");
  });

  it("GET /admin/category/categories without admin credentials redirects to /admin/login", async () => {
    const res = await fetch(`${baseUrl}/admin/category/categories`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/admin/login");
  });

  it("GET /profile without token redirects to /login", async () => {
    const res = await fetch(`${baseUrl}/profile`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/login");
  });

  it("GET /cart without token redirects to /login", async () => {
    const res = await fetch(`${baseUrl}/cart`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/login");
  });

  it("GET /checkout without token redirects to /login", async () => {
    const res = await fetch(`${baseUrl}/checkout`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/login");
  });

  it("GET /nonexistent-route returns 404 with custom Not Found page", async () => {
    const res = await fetch(`${baseUrl}/nonexistent-route-for-testing-404`, { redirect: "manual" });
    assert.strictEqual(res.status, 404);
    const text = await res.text();
    assert.ok(text.includes("404") || text.includes("Page Not Found"));
  });

  it("AJAX request to protected route without credentials returns 401 JSON", async () => {
    const res = await fetch(`${baseUrl}/cart`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.redirectTo, "/login");
  });

  it("AJAX request to admin route without admin credentials returns 401 JSON", async () => {
    const res = await fetch(`${baseUrl}/admin/category/categories`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.redirectTo, "/admin/login");
  });

  it("Sets security headers (Helmet) on HTTP responses", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.ok(res.headers.get("x-dns-prefetch-control"));
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
  });

  async function getCsrfHeaders() {
    const res = await fetch(`${baseUrl}/login`);
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/_csrf=([^;]+)/);
    const token = match ? match[1] : "";
    return {
      Cookie: `_csrf=${token}`,
      "X-CSRF-Token": token,
    };
  }

  it("AJAX POST /login with invalid credentials returns JSON error without full redirect", async () => {
    const csrfHeaders = await getCsrfHeaders();
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...csrfHeaders,
      },
      body: JSON.stringify({ email: "nonexistent_ajax_user@example.com", password: "WrongPassword123!" }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message, "Should return an error message in JSON");
  });

  it("AJAX POST /signup with missing fields returns 400 JSON error", async () => {
    const csrfHeaders = await getCsrfHeaders();
    const res = await fetch(`${baseUrl}/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...csrfHeaders,
      },
      body: JSON.stringify({ email: "", password: "" }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message);
  });

  it("AJAX POST /forgotPassword with invalid email returns 400 JSON error", async () => {
    const csrfHeaders = await getCsrfHeaders();
    const res = await fetch(`${baseUrl}/forgotPassword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...csrfHeaders,
      },
      body: JSON.stringify({ email: "invalid-email" }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message);
  });

  it("AJAX POST /contact with valid data returns 200 JSON success", async () => {
    const csrfHeaders = await getCsrfHeaders();
    const res = await fetch(`${baseUrl}/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...csrfHeaders,
      },
      body: JSON.stringify({
        firstName: "Test",
        lastName: "Customer",
        email: "customer@example.com",
        inquiryType: "General Question",
        message: "Hello, this is a test inquiry message via AJAX.",
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.message.includes("Thank you for reaching out"));
  });

  it("AJAX POST /contact with missing message returns 400 JSON error", async () => {
    const csrfHeaders = await getCsrfHeaders();
    const res = await fetch(`${baseUrl}/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...csrfHeaders,
      },
      body: JSON.stringify({
        email: "customer@example.com",
        message: "",
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.message, "Please provide a valid email address and message.");
  });
});
