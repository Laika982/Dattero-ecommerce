import express from "express";
const router = express.Router();

import upload from "../../middleware/upload.js";
import { isAdminAuthenticated,
  isAdminLoggedIn, } from "../../middleware/authMidilware.js";


import productController from "../../controllers/admin/productController.js";





// //products
router.get("/products", isAdminAuthenticated, productController.productInfo);
router.get("/addProduct", isAdminAuthenticated, productController.loadAddProduct);
router.post(
    "/addProduct",
    isAdminAuthenticated,
    upload.array("images", 5),
    productController.addProduct
);
router.get(
    "/editProduct/:id",
    isAdminAuthenticated,
    productController.loadEditProduct
);

router.post(
    "/editProduct/:id",
    isAdminAuthenticated,
    upload.array("images", 5),
    productController.editProduct
);
router.post("/deleteProduct/:id", isAdminAuthenticated, productController.deleteProduct);



export default router;
