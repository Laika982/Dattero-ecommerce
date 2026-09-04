import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: "ecommerce/products",
        allowed_formats: ["jpg", "jpeg", "png", "webp"]
    }
});

const upload = multer({
    storage: storage
});



export default upload;










// const profileStorage = new CloudinaryStorage({
//     cloudinary: cloudinary,
//     params: {
//         folder: "ecommerce/profiles",
//         allowed_formats: ["jpg", "jpeg", "png", "webp"]
//     }
// });

// const profileUpload = multer({
//     storage: profileStorage,
//     limits: {
//         fileSize: 5 * 1024 * 1024
//     },
//     fileFilter: (req, file, callback) => {
//         const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

//         if (!allowedMimeTypes.includes(file.mimetype)) {
//             return callback(new Error("Only JPG, PNG, and WEBP images are allowed."));
//         }

//         callback(null, true);
//     }
// }).single("profileImage");

// const validateProfileImageUpload = (req, res, next) => {
//     profileUpload(req, res, (error) => {
//         if (!error) {
//             return next();
//         }

//         const message = error.code === "LIMIT_FILE_SIZE"
//             ? "Profile image must be 5 MB or smaller."
//             : error.message;

//         return res.redirect(`/profile/edit?error=${encodeURIComponent(message)}`);
//     });
// };

// export { validateProfileImageUpload };
