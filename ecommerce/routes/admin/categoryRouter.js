const express = require("express");
const router = express.Router();

const upload = require("../../middleware/upload");
const {
  isAdminAuthenticated,
  isAdminLoggedIn,
} = require("../../middleware/authMidilware");


const categoryController = require("../../controllers/admin/categoryController");

//category
router.get("/categories", categoryController.categoryInfo);
router.get("/addCategory", isAdminAuthenticated, categoryController.addCategoryInfo);
router.post("/addCategory", isAdminAuthenticated, upload.single("image"), categoryController.addCategory);
router.get("/editCategory/:id",isAdminAuthenticated,categoryController.editCategoryInfo,);
router.post("/editCategory/:id",isAdminAuthenticated,upload.single("image"),categoryController.editCategory,);
router.post("/deleteCategory/:id", categoryController.deleteCategory);



module.exports = router;
