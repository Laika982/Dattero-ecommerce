const Category = require("../../models/categorySchema");

const categoryInfo = async (req, res) => {
    try {

        const page = parseInt(req.query.page) || 1;
        const limit = 3;
        const skip = (page - 1) * limit;

        const search = req.query.search || "";
        const isListed = req.query.isListed || "";

        // Search condition
        const query = {
            $or: [
                {
                    category_name: {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    description: {
                        $regex: search,
                        $options: "i"
                    }
                }
            ]
        };

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
        categoryData.forEach(category => {

            category.formattedDate = new Date(
                category.createdAt
            ).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });

        });

        // Count filtered categories
        const totalCategories = await Category.countDocuments(query);

        // Count all categories
        const totalCount = await Category.countDocuments();

        // Count active categories
        const totalListedCategories =
            await Category.countDocuments({
                isListed: true
            });

        // Calculate pages
        const totalPages = Math.ceil(
            totalCategories / limit
        );

        // Create page numbers
        const pages = [];

        for (let i = 1; i <= totalPages; i++) {

            pages.push({
                page: i,
                active: i === page
            });

        }

        return res.render("admin/category", {
            categoryData,
            currentPage: page,
            totalPages,
            pages,
            search,
            isListed,
            totalCount,
            totalListedCategories
        });

    } catch (error) {

        console.error("Error loading categories:", error);

        return res.status(500).send("Internal Server Error");
    }
};
const addCategoryInfo = async (req,res) => {
  try {
   
    res.render("admin/addCategory")

  }  catch (error) {
        console.error("Error adding category:", error);
        return res.status(500).send("Internal Server Error");
    }
};


const addCategory = async (req, res) => {
    try {
        const { category_name, description } = req.body;

        const category = await Category.findOne({
            category_name: category_name.trim()
        });

        if (category) {
            return res.render("admin/addCategory", {
                error: "Category already exists"
            });
        }

        const newCategory = new Category({
            category_name: category_name.trim(),
            description: description.trim(),
            image: req.file
                ? {
                    url: req.file.path,
                    public_id: req.file.filename
                }
                : {}
                ,
                isListed: true
        });

        await newCategory.save();

        return res.redirect("/admin/category/categories");

    } catch (error) {
        console.error("Error adding category:", error);
        return res.status(500).send("Internal Server Error");
    }
};


const editCategoryInfo  = async (req, res) => {
    try {

        const { id } = req.params;

        const category = await Category.findById(id).lean();

        if (!category) {
            return res.status(404).send("Category not found");
        }

        return res.render("admin/editCategory", {
            category
        });

    } catch (error) {

        console.error("Error loading edit category:", error);

        return res.status(500).send("Internal Server Error");
    }
};

const editCategory = async (req, res) => {
    try {

        const { id } = req.params;

        const category = await Category.findById(id);

        if (!category) {
            return res.status(404).send("Category not found");
        }

        const updateData = {
            category_name:
                req.body.category_name?.trim() ||
                category.category_name,

            description:
                req.body.description?.trim() ||
                category.description,

            // "true" → true
            // "false" → false
            isListed: req.body.isListed === "true"
        };


        // Remove existing image
        if (req.body.removeImage === "true") {

            updateData.image = {
                url: "",
                public_id: ""
            };
        }


        // New image selected
        if (req.file) {

            updateData.image = {
                url: req.file.path,
                public_id: req.file.filename
            };

        }


        await Category.findByIdAndUpdate(
            id,
            updateData,
            {
                new: true,
                runValidators: true
            }
        );


        return res.redirect("/admin/category/categories");

    } catch (error) {

        console.error("Error editing category:", error);

        return res.status(500).send("Internal Server Error");
    }
};



const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await Category.findById(id);

        if (!category) {
            return res.status(404).send("Category not found");
        }

        await Category.findByIdAndDelete(id);

        return res.redirect("/admin/category/categories");

    } catch (error) {
        console.error("Error deleting category:", error);
        return res.status(500).send("Internal Server Error");
    }
};

module.exports = {
  categoryInfo,
  addCategoryInfo,
  addCategory,
  editCategoryInfo,
  editCategory,
  deleteCategory,
};
