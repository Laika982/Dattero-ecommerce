import path from "path";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import logger from "../utils/logger.js";

export const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Detects the real image MIME type by inspecting the file buffer's magic bytes.
 * Returns 'image/jpeg', 'image/png', 'image/webp', or null if not a recognized valid image.
 */
export const detectImageMimeType = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
};

/**
 * Uploads an in-memory buffer to Cloudinary using upload_stream.
 */
export const uploadBufferToCloudinary = (buffer, options = {}) => {
  if (
    process.env.MOCK_CLOUDINARY === "true" ||
    (process.env.NODE_ENV === "test" && process.env.USE_MOCK_CLOUDINARY === "true")
  ) {
    const mockId = `ecommerce/mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return Promise.resolve({
      secure_url: `https://res.cloudinary.com/demo/image/upload/${mockId}.jpg`,
      public_id: mockId,
      bytes: buffer.length,
    });
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

/**
 * Destroys uploaded assets in Cloudinary if a later step or validation fails.
 */
export const cleanupUploadedFiles = async (files) => {
  if (!files) return;
  const fileList = Array.isArray(files) ? files : [files];
  for (const file of fileList) {
    if (!file) continue;
    const publicId = file.filename || file.public_id;
    if (publicId && typeof publicId === "string") {
      try {
        if (!publicId.startsWith("ecommerce/mock_")) {
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (err) {
        logger.error(`Error destroying asset ${publicId}: ${err.message}`);
      }
    }
  }
};

/**
 * Responds with a safe, user-friendly error message for AJAX or form requests.
 */
const sendUploadError = (req, res, statusCode, message) => {
  const isAjax = Boolean(
    req.xhr ||
    req.headers["x-requested-with"] === "XMLHttpRequest" ||
    req.headers["accept"]?.includes("application/json") ||
    req.headers["content-type"]?.includes("application/json") ||
    req.headers["sec-fetch-dest"] === "empty"
  );

  if (isAjax || !req.session) {
    return res.status(statusCode).json({
      success: false,
      message,
    });
  }

  req.session.error = message;
  const url = (req.originalUrl || req.url || "").split("?")[0];

  if (url.includes("/profile")) {
    return res.redirect(`/profile/edit?error=${encodeURIComponent(message)}`);
  }
  if (url.includes("/addProduct")) {
    return res.redirect("/admin/product/addProduct");
  }
  if (url.includes("/editProduct")) {
    return res.redirect(req.originalUrl || "/admin/product/products");
  }
  if (url.includes("/addCategory")) {
    return res.redirect("/admin/category/addCategory");
  }
  if (url.includes("/editCategory")) {
    return res.redirect(req.originalUrl || "/admin/category/categories");
  }
  if (url.includes("/editCustomer")) {
    return res.redirect(req.originalUrl || "/admin/customer/customers");
  }

  const referer = req.headers["referer"];
  if (referer) {
    return res.redirect(referer);
  }

  return res.status(statusCode).send(message);
};

/**
 * Creates upload middleware with file limits, magic-byte inspection, and Cloudinary upload.
 */
export const createUploadMiddleware = (type, fieldName, maxCount = 1, options = {}) => {
  const folder =
    options.folder ||
    (fieldName === "profileImage"
      ? "ecommerce/profiles"
      : fieldName === "image"
        ? "ecommerce/categories"
        : "ecommerce/products");

  const multerInstance = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: maxCount,
    },
    fileFilter: (req, file, cb) => {
      // Allow empty/unset originalname to fall through to the empty handler
      if (!file.originalname || file.originalname.trim() === "") {
        return cb(null, true);
      }

      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return cb(new Error("Only JPG, PNG, and WEBP images are allowed."));
      }

      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new Error("Only JPG, PNG, and WEBP images are allowed."));
      }

      cb(null, true);
    },
  });

  const multerHandler =
    type === "array"
      ? multerInstance.array(fieldName, maxCount)
      : multerInstance.single(fieldName);

  return (req, res, next) => {
    multerHandler(req, res, async (err) => {
      if (err) {
        let msg = "File upload failed. Please try again.";
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            msg = "File size exceeds the 5MB limit. Please upload a smaller image.";
          } else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
            msg =
              maxCount === 1
                ? "Only 1 image can be uploaded."
                : `Maximum ${maxCount} images are allowed.`;
          } else {
            msg = err.message || "File upload limit exceeded.";
          }
        } else if (err.message) {
          msg = err.message;
        }
        return sendUploadError(req, res, 400, msg);
      }

      // Collect uploaded files
      const rawFiles =
        type === "array"
          ? req.files || []
          : req.file
            ? [req.file]
            : [];

      // Filter out empty ghost items where user didn't pick any file
      const candidateFiles = rawFiles.filter(
        (f) => f && f.originalname && f.originalname.trim() !== ""
      );

      // If user uploaded a named file with 0 bytes, flag as empty
      for (const file of candidateFiles) {
        if (!file.buffer || file.buffer.length === 0 || file.size === 0) {
          return sendUploadError(req, res, 400, "Uploaded file is empty.");
        }
      }

      // If no valid files submitted (optional upload), proceed
      if (candidateFiles.length === 0) {
        return next();
      }

      if (candidateFiles.length > maxCount) {
        return sendUploadError(
          req,
          res,
          400,
          maxCount === 1
            ? "Only 1 image can be uploaded."
            : `Maximum ${maxCount} images are allowed.`
        );
      }

      // Validate magic bytes and extensions for all candidate files
      for (const file of candidateFiles) {
        if (file.buffer.length > MAX_FILE_SIZE) {
          return sendUploadError(
            req,
            res,
            400,
            "File size exceeds the 5MB limit. Please upload a smaller image."
          );
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return sendUploadError(
            req,
            res,
            400,
            "Only JPG, PNG, and WEBP images are allowed."
          );
        }

        const detectedMime = detectImageMimeType(file.buffer);
        if (!detectedMime) {
          return sendUploadError(
            req,
            res,
            400,
            "Invalid image content or corrupted file."
          );
        }

        // Validate extension matches detected content
        if ((ext === ".jpg" || ext === ".jpeg") && detectedMime !== "image/jpeg") {
          return sendUploadError(
            req,
            res,
            400,
            "File extension does not match actual image content."
          );
        }
        if (ext === ".png" && detectedMime !== "image/png") {
          return sendUploadError(
            req,
            res,
            400,
            "File extension does not match actual image content."
          );
        }
        if (ext === ".webp" && detectedMime !== "image/webp") {
          return sendUploadError(
            req,
            res,
            400,
            "File extension does not match actual image content."
          );
        }

        file.mimetype = detectedMime;
      }

      // All files passed validation. Stream to Cloudinary
      const uploadedPublicIds = [];
      try {
        for (const file of candidateFiles) {
          const result = await uploadBufferToCloudinary(file.buffer, { folder });
          uploadedPublicIds.push(result.public_id);
          file.path = result.secure_url;
          file.filename = result.public_id;
          file.public_id = result.public_id;
          delete file.buffer;
        }

        // Attach cleanup function to req so controllers can rollback on error
        req.cleanupUploadedFiles = async () => {
          for (const publicId of uploadedPublicIds) {
            try {
              if (!publicId.startsWith("ecommerce/mock_")) {
                await cloudinary.uploader.destroy(publicId);
              }
            } catch (destroyErr) {
              logger.error(`Error cleaning up asset ${publicId}: ${destroyErr.message}`);
            }
          }
        };

        return next();
      } catch (uploadErr) {
        logger.error(`Cloudinary upload failed: ${uploadErr.message}`);
        // Destroy any partially uploaded assets
        for (const publicId of uploadedPublicIds) {
          try {
            if (!publicId.startsWith("ecommerce/mock_")) {
              await cloudinary.uploader.destroy(publicId);
            }
          } catch (destroyErr) {
            logger.error(`Failed to clean up asset ${publicId}: ${destroyErr.message}`);
          }
        }
        return sendUploadError(req, res, 500, "Failed to upload image. Please try again.");
      }
    });
  };
};

const upload = {
  array: (fieldName, maxCount = 5, options) =>
    createUploadMiddleware("array", fieldName, maxCount, options),
  single: (fieldName, options) =>
    createUploadMiddleware("single", fieldName, 1, options),
};

export default upload;
