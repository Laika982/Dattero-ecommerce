import express from "express";
const router = express.Router();

import upload from "../../middleware/upload.js";
import { isAdminAuthenticated,
  isAdminLoggedIn, } from "../../middleware/authMidilware.js";


import categoryController from "../../controllers/admin/categoryController.js";

//category
router.get("/categories", isAdminAuthenticated, categoryController.categoryInfo);
router.get("/addCategory", isAdminAuthenticated, categoryController.addCategoryInfo);
router.post("/addCategory", isAdminAuthenticated, upload.single("image"), categoryController.addCategory);
router.get("/editCategory/:id",isAdminAuthenticated,categoryController.editCategoryInfo,);
router.put("/editCategory/:id",isAdminAuthenticated,upload.single("image"),categoryController.editCategory,);
router.delete("/deleteCategory/:id", isAdminAuthenticated, categoryController.deleteCategory);



export default router;
