const express = require("express");
const router = express.Router();

const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/customerController")
const categoryController = require("../controllers/admin/categoryController")


const upload = require("../middleware/upload")
const {
isAdminAuthenticated,
isAdminLoggedIn
} = require("../middleware/authMidilware")


//adminLogin
router.get("/login",isAdminLoggedIn,adminController.loadLogin);
//loadAdminDashboard
router.post("/login",adminController.adminLogin);
router.get("/", isAdminAuthenticated, adminController.loadAdminDashboard);

//logout
router.get("/logout", adminController.logout);

// //customers
// router.get("/customers", customerController.customerInfo);
// // router.get("/user", customerController.customerInfo);
// router.get("/blockCustomer", customerController.customerBlocked);
// router.get("/unblockCustomer", customerController.customerUnBlocked);


router.get(
    "/customers",
    customerController.customerInfo
);

router.post(
    "/blockCustomer",
    customerController.customerBlocked
);

router.post(
    "/unblockCustomer",
    customerController.customerUnBlocked
);
// //category
router.get("/categories", categoryController.categoryInfo);
router.get("/addCategory", categoryController.addCategoryInfo);
router.post("/addCategory", upload.single("image"), categoryController.addCategory);
router.get(
    "/editCategory/:id",
    isAdminAuthenticated,
    categoryController.editCategoryInfo
);

router.post(
    "/editCategory/:id",
    isAdminAuthenticated,
    upload.single("image"),
    categoryController.editCategory
);
router.post("/deleteCategory/:id", categoryController.deleteCategory);

// //products
// router.get("/products", productController.productInfo);
// router.get("/addProduct", productController.loadAddProduct);
// router.post("/addProduct", upload.array("images", 5), productController.addProduct);
// router.get("/editProduct", productController.loadEditProduct);
// router.post("/editProduct", upload.array("images", 5), productController.editProduct);
// router.get("/deleteProduct", productController.deleteProduct);



module.exports = router;
