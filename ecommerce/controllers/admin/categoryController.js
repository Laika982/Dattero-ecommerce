import mongoose from "mongoose";
import Category from "../../models/categorySchema.js";
import Product from "../../models/productSchema.js";
import { generateActivePageArray } from "../../utils/pagination.js";

const escapeRegex = (string) => {
  if (typeof string !== "string") return "";
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const categoryInfo = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 3;
    const skip = (page - 1) * limit;

    const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
    const search = rawSearch.trim().slice(0, 100);
    const isListed = req.query.isListed || "";

    // Search condition: use regex only when a search term is provided, with all regex metacharacters escaped
    const query = {};

    if (search.length > 0) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        {
          category_name: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          description: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
      ];
    }

    // Category status filter
    if (isListed === "true") {
      query.isListed = true;
    }

    if (isListed === "false") {
      query.isListed = false;
    }

    // Get filtered categories
    const categoryData = await Category.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Format date
    categoryData.forEach((category) => {
      category.formattedDate = new Date(category.createdAt).toLocaleDateString(
        "en-US",
        {
          month: "short",
          day: "numeric",
          year: "numeric",
        },
      );
    });

    // Count filtered categories
    const totalCategories = await Category.countDocuments(query);

    // Count all categories
    const totalCount = await Category.countDocuments();

    // Count active categories
    const totalListedCategories = await Category.countDocuments({
      isListed: true,
    });

    // Calculate pages
    const totalPages = Math.ceil(totalCategories / limit);

    // Create page numbers
    const pages = generateActivePageArray(totalPages, page);

    return res.render("admin/category", {
      categoryData,
      currentPage: page,
      totalPages,
      pages,
      search,
      isListed,
      totalCount,
      totalListedCategories,
    });
  } catch (error) {
    console.error("Error loading categories:", error);

    return res.status(500).send("Internal Server Error");
  }
};
const addCategoryInfo = async (req, res) => {
  try {
    res.render("admin/addCategory");
  } catch (error) {
    console.error("Error adding category:", error);
    return res.status(500).send("Internal Server Error");
  }
};

const addCategory = async (req, res) => {
  try {
    const { category_name, description } = req.body;

    if (!category_name || !description || !category_name.trim() || !description.trim()) {
      if (req.cleanupUploadedFiles) await req.cleanupUploadedFiles();
      req.session.error = "Both fields are required";
      return res.redirect("/admin/category/addCategory");
    }

    const escapedName = escapeRegex(category_name.trim());
    const category = await Category.findOne({
      category_name: { $regex: new RegExp(`^${escapedName}$`, "i") },
    });

    if (category) {
      if (req.cleanupUploadedFiles) await req.cleanupUploadedFiles();
      return res.render("admin/addCategory", {
        error: "Category already exists",
      });
    }

    const newCategory = new Category({
      category_name: category_name.trim(),
      description: description.trim(),
      image: req.file
        ? {
          url: req.file.path,
          public_id: req.file.filename,
        }
        : {},
      isListed: true,
    });

    await newCategory.save();

    req.session.success = "Category Created Successfully"

    return res.redirect("/admin/category/categories");
  } catch (error) {
    if (req.cleanupUploadedFiles) await req.cleanupUploadedFiles();
    console.error("Error adding category:", error);
    return res.status(500).send("Internal Server Error");
  }
};

const editCategoryInfo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      req.session.error = "Invalid category";
      return res.redirect("/admin/category/categories");
    }

    const category = await Category.findById(id).lean();

    if (!category) {
      req.session.error = "Category Not Found";
      return res.redirect("/admin/category/categories");
    }

    return res.render("admin/editCategory", {
      category,
    });
  } catch (error) {
    console.error("Error loading edit category:", error);

    return res.status(500).send("Internal Server Error");
  }
};

const editCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      req.session.error = "Invalid category";
      return res.redirect("/admin/category/categories");
    }

    const category = await Category.findById(id);

    if (!category) {
      req.session.error = "Category Not Found";
      return res.redirect("/admin/category/categories");
    }

    const updateData = {
      category_name: req.body.category_name?.trim() || category.category_name,

      description: req.body.description?.trim() || category.description,


      isListed: req.body.isListed === "true",
    };


    // Remove existing image
    if (req.body.removeImage === "true") {
      updateData.image = {
        url: "",
        public_id: "",
      };
    }

    // New image selected
    if (req.file) {
      updateData.image = {
        url: req.file.path,
        public_id: req.file.filename,
      };
    }

    await Category.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    req.session.success = "Category Edited Successfully"
    return res.redirect("/admin/category/categories");
  } catch (error) {
    if (req.cleanupUploadedFiles) await req.cleanupUploadedFiles();
    console.error("Error editing category:", error);

    return res.status(500).send("Internal Server Error");
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      req.session.error = "Invalid category";
      return res.redirect("/admin/category/categories");
    }

    const category = await Category.findById(id);

    if (!category) {
      req.session.error = "Category Not Found";
      return res.redirect("/admin/category/categories");
    }

    const productCount = await Product.countDocuments({ category_id: id });
    if (productCount > 0) {
      req.session.error = `Cannot delete category. ${productCount} active ${productCount === 1 ? "product depends" : "products depend"} on this category.`;
      return res.redirect("/admin/category/categories");
    }

    await Category.findByIdAndDelete(id);

    req.session.success = "Category Deleted Successfully";

    return res.redirect("/admin/category/categories");
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).send("Internal Server Error");
  }
};

export {
  categoryInfo,
  addCategoryInfo,
  addCategory,
  editCategoryInfo,
  editCategory,
  deleteCategory,
  escapeRegex,
};

export default {
  categoryInfo,
  addCategoryInfo,
  addCategory,
  editCategoryInfo,
  editCategory,
  deleteCategory,
  escapeRegex,
};
