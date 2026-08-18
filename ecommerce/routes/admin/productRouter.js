const express = require("express");
const router = express.Router();

const upload = require("../../middleware/upload");
const {
  isAdminAuthenticated,
  isAdminLoggedIn,
} = require("../../middleware/authMidilware");


const productController = require("../../controllers/admin/productController")





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



module.exports = router;
