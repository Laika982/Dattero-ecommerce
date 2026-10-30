process.env.NODE_ENV = "test";
process.env.USE_MOCK_CLOUDINARY = "true";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { generateCsrfToken } from "../middleware/csrfProtection.js";
import {
  detectImageMimeType,
  cleanupUploadedFiles,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from "../middleware/upload.js";

let server;
let baseUrl;

const JWT_SECRET = process.env.JWT_SECRET || "my_super_secret_key_123456789";

const createCsrfAndCookieHeaders = (extraCookie = "") => {
  const csrf = generateCsrfToken();
  const cookieStr = `_csrf=${csrf}${extraCookie ? "; " + extraCookie : ""}`;
  return {
    "x-csrf-token": csrf,
    Cookie: cookieStr,
    Accept: "application/json",
  };
};

// Minimal valid file buffers for testing
const VALID_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00]),
  Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]),
  Buffer.alloc(64, 0x01),
  Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  Buffer.from([0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  Buffer.alloc(16, 0x00),
  Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  Buffer.from([0xbf, 0x00]),
  Buffer.from([0xff, 0xd9]),
]);

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, // IHDR chunk length (13)
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, // width: 1
  0x00, 0x00, 0x00, 0x01, // height: 1
  0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
  0x1f, 0x15, 0xc4, 0x89, // CRC
  0x00, 0x00, 0x00, 0x0a, // IDAT chunk length (10)
  0x49, 0x44, 0x41, 0x54, // "IDAT"
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, // CRC
  0x00, 0x00, 0x00, 0x00, // IEND chunk length (0)
  0x49, 0x45, 0x4e, 0x44, // "IEND"
  0xae, 0x42, 0x60, 0x82, // CRC
]);

const VALID_WEBP = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
  Buffer.from([0x1a, 0x00, 0x00, 0x00]), // file size - 8
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // "WEBP"
  Buffer.from([0x56, 0x50, 0x38, 0x4c]), // "VP8L"
  Buffer.from([0x0d, 0x00, 0x00, 0x00]),
  Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00, 0x07, 0x88, 0x85, 0x08, 0x88, 0x00, 0x00, 0x00]),
]);

before(async () => {
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

describe("BUG-SEC-007: File Upload Limits and Security Validation", () => {
  describe("1. Magic Bytes and File Signature Detection Unit Tests", () => {
    it("correctly identifies valid JPEG file signature", () => {
      const detected = detectImageMimeType(VALID_JPEG);
      assert.strictEqual(detected, "image/jpeg");
    });

    it("correctly identifies valid PNG file signature", () => {
      const detected = detectImageMimeType(VALID_PNG);
      assert.strictEqual(detected, "image/png");
    });

    it("correctly identifies valid WEBP file signature", () => {
      const detected = detectImageMimeType(VALID_WEBP);
      assert.strictEqual(detected, "image/webp");
    });

    it("rejects non-image text content pretending to be an image", () => {
      const plainText = Buffer.from("PLAIN_TEXT_DUMMY_CONTENT_NOT_AN_IMAGE_DATA");
      const jsonText = Buffer.from('{"name": "test", "type": "not_an_image"}');
      const randomBytes = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);

      assert.strictEqual(detectImageMimeType(plainText), null);
      assert.strictEqual(detectImageMimeType(jsonText), null);
      assert.strictEqual(detectImageMimeType(randomBytes), null);
    });

    it("rejects empty and truncated buffers", () => {
      assert.strictEqual(detectImageMimeType(Buffer.alloc(0)), null);
      assert.strictEqual(detectImageMimeType(Buffer.from([0xff, 0xd8])), null); // only 2 bytes
      assert.strictEqual(detectImageMimeType(null), null);
      assert.strictEqual(detectImageMimeType(undefined), null);
    });

    it("verifies allowed configuration constants", () => {
      assert.deepStrictEqual(ALLOWED_EXTENSIONS, [".jpg", ".jpeg", ".png", ".webp"]);
      assert.deepStrictEqual(ALLOWED_MIME_TYPES, ["image/jpeg", "image/png", "image/webp"]);
      assert.strictEqual(MAX_FILE_SIZE, 5 * 1024 * 1024);
    });
  });

  describe("2. Admin Upload Endpoint Access Control", () => {
    it("rejects unauthenticated POST to /admin/product/addProduct (401 or redirect)", async () => {
      const formData = new FormData();
      formData.append("product_name", "Test");
      formData.append("images", new Blob([VALID_PNG], { type: "image/png" }), "test.png");

      const res = await fetch(`${baseUrl}/admin/product/addProduct`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(),
        redirect: "manual",
      });

      assert.ok(res.status === 401 || res.status === 302);
    });

    it("rejects non-admin (customer) token on admin upload routes with 403 or redirect", async () => {
      const customerToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString(), isAdmin: false },
        JWT_SECRET
      );

      const formData = new FormData();
      formData.append("product_name", "Test");
      formData.append("images", new Blob([VALID_PNG], { type: "image/png" }), "test.png");

      const res = await fetch(`${baseUrl}/admin/product/addProduct`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${customerToken}`),
        redirect: "manual",
      });

      assert.ok(res.status === 403 || res.status === 302);
    });

    it("rejects unauthenticated PUT to /admin/customer/editCustomer/:id", async () => {
      const dummyId = new mongoose.Types.ObjectId().toString();
      const formData = new FormData();
      formData.append("name", "New Name");
      formData.append("profileImage", new Blob([VALID_PNG], { type: "image/png" }), "avatar.png");

      const res = await fetch(`${baseUrl}/admin/customer/editCustomer/${dummyId}`, {
        method: "PUT",
        body: formData,
        headers: createCsrfAndCookieHeaders(),
        redirect: "manual",
      });

      assert.ok(res.status === 401 || res.status === 302);
    });
  });

  describe("3. File Validation on Upload Endpoints", () => {
    let adminToken;

    before(() => {
      adminToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString(), isAdmin: true, email: "admin@test.com" },
        JWT_SECRET
      );
    });

    it("rejects unsupported file extension (.exe or .pdf) with 400", async () => {
      const formData = new FormData();
      formData.append("category_name", "New Electronics");
      formData.append("description", "Electronics category");
      formData.append(
        "image",
        new Blob([Buffer.from("DUMMY_PDF_CONTENT")], { type: "application/pdf" }),
        "document.pdf"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Only JPG, PNG, and WEBP/i);
    });

    it("rejects MIME spoofing: text file named .jpg claiming image/jpeg", async () => {
      const nonImagePayload = Buffer.from("THIS_IS_PLAIN_TEXT_NOT_AN_IMAGE_PAYLOAD");
      const formData = new FormData();
      formData.append("category_name", "Test Category");
      formData.append("description", "Category with spoofed image");
      formData.append(
        "image",
        new Blob([nonImagePayload], { type: "image/jpeg" }),
        "spoofed.jpg"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Invalid image content or corrupted file/i);
    });

    it("rejects content/extension mismatch: PNG bytes in a .jpg file", async () => {
      const formData = new FormData();
      formData.append("category_name", "Mismatch Category");
      formData.append("description", "Testing mismatch");
      formData.append(
        "image",
        new Blob([VALID_PNG], { type: "image/jpeg" }),
        "mismatch.jpg"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /File extension does not match/i);
    });

    it("rejects empty 0-byte file with 400", async () => {
      const formData = new FormData();
      formData.append("category_name", "Empty Category");
      formData.append("description", "Testing empty file");
      formData.append(
        "image",
        new Blob([Buffer.alloc(0)], { type: "image/png" }),
        "empty.png"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Uploaded file is empty/i);
    });

    it("rejects oversized file exceeding 5MB limit with 400", async () => {
      // 5.5 MB payload starting with valid JPEG header
      const oversizedPayload = Buffer.concat([
        VALID_JPEG,
        Buffer.alloc(5.5 * 1024 * 1024, 0xaa),
      ]);

      const formData = new FormData();
      formData.append("category_name", "Oversized Category");
      formData.append("description", "Testing oversized file");
      formData.append(
        "image",
        new Blob([oversizedPayload], { type: "image/jpeg" }),
        "giant.jpg"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /File size exceeds the 5MB limit/i);
    });

    it("rejects excessive file count (> 5 images for products) with 400", async () => {
      const formData = new FormData();
      formData.append("product_name", "Product With Too Many Images");
      formData.append("description", "Description");
      formData.append("category_id", new mongoose.Types.ObjectId().toString());

      // Send 6 files when max is 5
      for (let i = 1; i <= 6; i++) {
        formData.append(
          "images",
          new Blob([VALID_JPEG], { type: "image/jpeg" }),
          `image${i}.jpg`
        );
      }

      const res = await fetch(`${baseUrl}/admin/product/addProduct`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Maximum 5 images are allowed/i);
    });

    it("rejects excessive file count (> 1 image for single-upload categories) with 400", async () => {
      const formData = new FormData();
      formData.append("category_name", "Dual Image Category");
      formData.append("description", "Description");
      formData.append(
        "image",
        new Blob([VALID_JPEG], { type: "image/jpeg" }),
        "image1.jpg"
      );
      formData.append(
        "image",
        new Blob([VALID_JPEG], { type: "image/jpeg" }),
        "image2.jpg"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Only 1 image can be uploaded/i);
    });

    it("verifies error messages do not leak internal stack traces or server paths", async () => {
      const formData = new FormData();
      formData.append("category_name", "Safe Error Category");
      formData.append(
        "image",
        new Blob([Buffer.from("invalid-binary-content")], { type: "image/jpeg" }),
        "corrupt.jpg"
      );

      const res = await fetch(`${baseUrl}/admin/category/addCategory`, {
        method: "POST",
        body: formData,
        headers: createCsrfAndCookieHeaders(`adminToken=${adminToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.ok(typeof data.message === "string");
      assert.ok(!data.message.includes("Error:"));
      assert.ok(!data.message.includes("node_modules"));
      assert.ok(!data.message.includes("C:\\"));
      assert.ok(!data.message.includes("stack"));
    });
  });

  describe("4. Customer Profile Upload Endpoint Security", () => {
    let customerUser;
    let customerToken;

    before(async () => {
      const User = mongoose.model("User");
      customerUser = await User.create({
        name: "Upload Test Customer",
        email: `upload_test_${Date.now()}@example.com`,
        password: "hashedpassword123",
      });

      customerToken = jwt.sign(
        { userId: customerUser._id.toString(), email: customerUser.email, isAdmin: false },
        JWT_SECRET
      );
    });

    after(async () => {
      if (customerUser) {
        const User = mongoose.model("User");
        await User.findByIdAndDelete(customerUser._id);
      }
    });

    it("rejects unauthenticated PUT to /profile/edit (401 or redirect)", async () => {
      const formData = new FormData();
      formData.append("name", "New Name");
      formData.append(
        "profileImage",
        new Blob([VALID_PNG], { type: "image/png" }),
        "avatar.png"
      );

      const res = await fetch(`${baseUrl}/profile/edit`, {
        method: "PUT",
        body: formData,
        headers: createCsrfAndCookieHeaders(),
        redirect: "manual",
      });

      assert.ok(res.status === 401 || res.status === 302);
    });

    it("rejects oversized profile image (> 5MB) on /profile/edit with 400", async () => {
      const oversizedPayload = Buffer.concat([
        VALID_PNG,
        Buffer.alloc(5.5 * 1024 * 1024, 0xbb),
      ]);

      const formData = new FormData();
      formData.append("name", "Upload Test Customer");
      formData.append("email", customerUser.email);
      formData.append(
        "profileImage",
        new Blob([oversizedPayload], { type: "image/png" }),
        "giant-avatar.png"
      );

      const res = await fetch(`${baseUrl}/profile/edit`, {
        method: "PUT",
        body: formData,
        headers: createCsrfAndCookieHeaders(`token=${customerToken}`),
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /File size exceeds the 5MB limit/i);
    });

    it("accepts valid profile image upload on /profile/edit and updates profile", async () => {
      const formData = new FormData();
      formData.append("name", "Upload Test Customer");
      formData.append("email", customerUser.email);
      formData.append(
        "profileImage",
        new Blob([VALID_PNG], { type: "image/png" }),
        "valid-avatar.png"
      );

      const res = await fetch(`${baseUrl}/profile/edit`, {
        method: "PUT",
        body: formData,
        headers: createCsrfAndCookieHeaders(`token=${customerToken}`),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    });
  });

  describe("5. Cleanup and Resource Safety", () => {
    it("cleanupUploadedFiles safely handles null, undefined, and empty arrays without throwing", async () => {
      await assert.doesNotReject(async () => {
        await cleanupUploadedFiles(null);
        await cleanupUploadedFiles(undefined);
        await cleanupUploadedFiles([]);
        await cleanupUploadedFiles([{ filename: "ecommerce/mock_test_123" }]);
      });
    });
  });
});
