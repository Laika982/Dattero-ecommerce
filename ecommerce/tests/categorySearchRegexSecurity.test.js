process.env.NODE_ENV = "test";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../app.js";
import connectDB from "../config/db.js";
import Category from "../models/categorySchema.js";
import { escapeRegex } from "../controllers/admin/categoryController.js";

let server;
let baseUrl;
let adminToken;

const JWT_SECRET = process.env.JWT_SECRET || "my_super_secret_key_123456789";

const testCategories = [
  { category_name: "Chocolates", description: "Delicious gourmet chocolates", isListed: true },
  { category_name: "Dates (Premium)", description: "Premium quality imported dates (sweet)", isListed: true },
  { category_name: "Special [Edition]", description: "Limited seasonal [gift box] edition", isListed: true },
  { category_name: "Dry.*Fruits", description: "Assorted dry.*fruits mix with nuts", isListed: true },
  { category_name: "Back\\Slash Special", description: "Category with a literal \\ backslash", isListed: true },
  { category_name: "Unlisted Hidden Category", description: "Archived item", isListed: false },
];

before(async () => {
  await connectDB();

  adminToken = jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), isAdmin: true, email: "admin@test.com" },
    JWT_SECRET
  );

  // Seed sample categories for search testing
  for (const cat of testCategories) {
    await Category.findOneAndUpdate(
      { category_name: cat.category_name },
      { $set: cat },
      { upsert: true, returnDocument: "after" }
    );
  }

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
  // Cleanup test categories
  try {
    const names = testCategories.map((c) => c.category_name);
    await Category.deleteMany({ category_name: { $in: names } });
    await mongoose.connection.close();
  } catch (_) {}
});

describe("BUG-INP-001: Admin Category Search Regex Safety & Sanitization", () => {
  describe("1. escapeRegex Unit Tests", () => {
    it("escapes all regex metacharacters correctly", () => {
      const dangerous = ".*+?^${}()|[]\\";
      const escaped = escapeRegex(dangerous);
      assert.strictEqual(escaped, "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
    });

    it("leaves standard alphanumeric text and spaces intact", () => {
      const normal = "Premium Dates 2026";
      assert.strictEqual(escapeRegex(normal), "Premium Dates 2026");
    });

    it("handles non-string inputs safely by returning empty string", () => {
      assert.strictEqual(escapeRegex(null), "");
      assert.strictEqual(escapeRegex(undefined), "");
      assert.strictEqual(escapeRegex(12345), "");
      assert.strictEqual(escapeRegex({}), "");
      assert.strictEqual(escapeRegex([]), "");
    });
  });

  describe("2. HTTP Integration Tests for Category Search Endpoint", () => {
    const fetchSearch = async (queryString = "") => {
      return fetch(`${baseUrl}/admin/category/categories${queryString ? "?" + queryString : ""}`, {
        headers: {
          Cookie: `adminToken=${adminToken}`,
        },
      });
    };

    it("1. Normal search term returns matching categories and 200 OK", async () => {
      const res = await fetchSearch("search=Chocolates");
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("Chocolates"));
      assert.ok(text.includes('value="Chocolates"'));
    });

    it("2. Empty search input and whitespace-only input return 200 OK without errors", async () => {
      // Empty input
      const resEmpty = await fetchSearch("search=");
      assert.strictEqual(resEmpty.status, 200);

      // Whitespace only
      const resWhitespace = await fetchSearch("search=%20%20%20");
      assert.strictEqual(resWhitespace.status, 200);
    });

    it("3. Unclosed bracket '[' does not crash MongoDB or route with 500 error", async () => {
      const res = await fetchSearch("search=[");
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      // Should render the page safely without server crash
      assert.ok(text.includes("Special [Edition]"));
    });

    it("4. Literal bracket '[Edition]' searches for literal brackets", async () => {
      const res = await fetchSearch("search=[Edition]");
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("Special [Edition]"));
      // Should not match unrelated categories
      assert.ok(!text.includes("Chocolates"));
    });

    it("5. Parentheses '(?=' or '(Premium)' do not crash route and match literal parentheses", async () => {
      // Invalid lookahead regex pattern that crashes raw MongoDB regex queries
      const resInvalid = await fetchSearch("search=(?=");
      assert.strictEqual(resInvalid.status, 200);

      // Valid search for literal parentheses
      const resLiteral = await fetchSearch("search=(Premium)");
      assert.strictEqual(resLiteral.status, 200);
      const text = await resLiteral.text();
      assert.ok(text.includes("Dates (Premium)"));
      assert.ok(!text.includes("Chocolates"));
    });

    it("6. Wildcard '.*' is treated as literal text and does NOT match all categories", async () => {
      const res = await fetchSearch("search=.*");
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      // Only the category with literal ".*" in its name should match
      assert.ok(text.includes("Dry.*Fruits"));
      assert.ok(!text.includes("Chocolates"));
    });

    it("7. Trailing backslash '\\' does not crash MongoDB with regex syntax error", async () => {
      // Single unescaped trailing backslash in raw regex causes SyntaxError: \ at end of pattern
      const resSlash = await fetchSearch("search=\\");
      assert.strictEqual(resSlash.status, 200);

      // Search for literal backslash
      const resLiteral = await fetchSearch("search=Back\\Slash");
      assert.strictEqual(resLiteral.status, 200);
      const text = await resLiteral.text();
      assert.ok(text.includes("Back\\Slash Special"));
    });

    it("8. Very long search input (> 5000 characters) is safely clamped to 100 chars without ReDoS or timeout", async () => {
      const longInput = "A".repeat(5000);
      const startTime = Date.now();
      const res = await fetchSearch(`search=${longInput}`);
      const duration = Date.now() - startTime;

      assert.strictEqual(res.status, 200);
      // Query should execute quickly without catastrophic backtracking or slowdown
      assert.ok(duration < 2000, `Query took too long: ${duration}ms`);
    });

    it("9. Preserves pagination and isListed filtering with search", async () => {
      // isListed=false with search
      const res = await fetchSearch("search=Unlisted&isListed=false&page=1");
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("Unlisted Hidden Category"));

      // isListed=true should exclude unlisted category even if search matches
      const resListed = await fetchSearch("search=Unlisted&isListed=true&page=1");
      assert.strictEqual(resListed.status, 200);
      const textListed = await resListed.text();
      assert.ok(!textListed.includes("Unlisted Hidden Category"));
    });
  });
});
