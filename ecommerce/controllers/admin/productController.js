const Product = require("../../models/productSchema");
const Variant = require("../../models/variantSchema");
const Category = require("../../models/categorySchema");
const cloudinary = require("../../config/cloudinary");

// ============================================================
// GET ALL PRODUCTS
// ============================================================

const productInfo = async (req, res) => {
  try {
    const { search, filter, page = 1 } = req.query;

    const limit = 5;

    const currentPage = Number(page);

    const skip = (currentPage - 1) * limit;

    const productQuery = {};

    if (search && search.trim()) {
      productQuery.productName = {
        $regex: search.trim(),
        $options: "i",
      };
    }
    // ====================================================
    // FILTER BASED ON VARIANTS
    // ====================================================

    if (filter) {
      let variantQuery = {};
      if (filter === "in-stock") {
        variantQuery = {
          stock_quantity: {
            $gt: 10,
          },
        };
      }

      if (filter === "low-stock") {
        variantQuery = {
          stock_quantity: {
            $gt: 0,
            $lte: 10,
          },
        };
      }

      if (filter === "out-of-stock") {
        variantQuery = {
          stock_quantity: 0,
        };
      }

      if (filter === "listed") {
    productQuery.is_listed = true;
}

if (filter === "unlisted") {
    productQuery.is_listed = false;
}

      // -----------------------------
      // FIND VARIANTS
      // -----------------------------

      const variants = await Variant.find(variantQuery).select("product_id");

      const productIds = variants.map((variant) => variant.product_id);

      productQuery._id = {
        $in: productIds,
      };
    }

    const totalProducts = await Product.countDocuments(productQuery);

    // ====================================================
    // GET PRODUCTS
    // ====================================================

    const products = await Product.find(productQuery)
      .populate("category_id", "category_name")
      .sort({
        created_at: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean();



// Get products that have at least one variant
// with stock greater than 0
const productsWithStock = await Variant.distinct("product_id", {
  stock_quantity: {
    $gt: 0,
  },
});


// Products whose ALL variants are out of stock
const outOfStockProducts = await Product.countDocuments({
  _id: {
    $nin: productsWithStock,
  },
});
const activeCategories = await Product.countDocuments({
    is_listed: true
});
    // ====================================================
    // GET VARIANTS
    // ====================================================

    const productIds = products.map((product) => product._id);

    const variants = await Variant.find({
      product_id: {
        $in: productIds,
      },
    }).lean();

    // ====================================================
    // ATTACH VARIANTS TO PRODUCTS
    // ====================================================

    products.forEach((product) => {
      product.variants = variants.filter(
        (variant) => variant.product_id.toString() === product._id.toString(),
      );
    });

    // ====================================================
    // PAGINATION
    // ====================================================

    const totalPages = Math.ceil(totalProducts / limit);
    const pages = [];

for (let i = 1; i <= totalPages; i++) {
  pages.push(i);
}

    // ====================================================
    // RENDER
    // ====================================================

return res.render("admin/products", {
  products,
  search,
  filter,
  currentPage,
  totalPages,
  totalProducts,
  outOfStockProducts,
    activeCategories,
  pages,
});
  } catch (error) {
    console.error("Product info error:", error);

    return res.status(500).render("admin/products", {
      error: "Unable to load products",
      products: [],
    });
  }
};

// ============================================================
// LOAD ADD PRODUCT PAGE
// ============================================================

const loadAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({
      isListed: true,
    }).lean();

    console.log("Categories:", categories);

    return res.render("admin/addProduct", {
      categories,
    });
  } catch (error) {
    console.error("Load Add Product Error:", error);

    return res.status(500).render("admin/addProduct", {
      categories: [],
      error: "Unable to load categories",
    });
  }
};

// ============================================================
// ADD PRODUCT
// ============================================================

const addProduct = async (req, res) => {
  try {
    const { product_name, description, category_id, variants } = req.body;

    // ====================================================
    // PRODUCT VALIDATION
    // ====================================================

    if (!product_name || !description || !category_id) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Product name, description and category are required.",
      });
    }

    // ====================================================
    // IMAGE VALIDATION
    // ====================================================

    if (!req.files || req.files.length < 3) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Please upload at least 3 product images.",
      });
    }

    if (req.files.length > 5) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Maximum 5 images are allowed.",
      });
    }

    // ====================================================
    // CHECK CATEGORY
    // ====================================================

    const category = await Category.findById(category_id);

    if (!category) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Selected category does not exist.",
      });
    }

    // ====================================================
    // CHECK VARIANTS
    // ====================================================

    if (!variants || !Array.isArray(variants) || variants.length === 0) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Please add at least one variant.",
      });
    }

    // ====================================================
    // VALIDATE VARIANTS
    // ====================================================

    for (const variant of variants) {
      // ----------------------------------------------
      // REQUIRED FIELDS
      // ----------------------------------------------

      if (
        !variant.weight ||
        !variant.sku ||
        variant.price === undefined ||
        variant.stock_quantity === undefined
      ) {
        const categories = await Category.find({
          isListed: true,
        }).lean();

        return res.status(400).render("admin/addProduct", {
          categories,
          error: "All variant fields are required.",
        });
      }

      // ----------------------------------------------
      // PRICE
      // ----------------------------------------------

      if (Number.isNaN(Number(variant.price)) || Number(variant.price) < 0) {
        const categories = await Category.find({
          isListed: true,
        }).lean();

        return res.status(400).render("admin/addProduct", {
          categories,
          error: "Price must be a valid positive number.",
        });
      }

      // ----------------------------------------------
      // STOCK
      // ----------------------------------------------

      if (
        Number.isNaN(Number(variant.stock_quantity)) ||
        Number(variant.stock_quantity) < 0
      ) {
        const categories = await Category.find({
          isListed: true,
        }).lean();

        return res.status(400).render("admin/addProduct", {
          categories,
          error: "Stock must be a valid positive number.",
        });
      }
    }

    // ====================================================
    // SKU LIST
    // ====================================================

    const skuList = variants.map((variant) => variant.sku.trim().toUpperCase());

    // ====================================================
    // DUPLICATE SKU INSIDE FORM
    // ====================================================

    if (new Set(skuList).size !== skuList.length) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Duplicate SKU found.",
      });
    }

    // ====================================================
    // CHECK SKU IN DATABASE
    // ====================================================

    const existingSku = await Variant.findOne({
      sku: {
        $in: skuList,
      },
    });

    if (existingSku) {
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: `SKU ${existingSku.sku} already exists.`,
      });
    }

    // ====================================================
    // PRODUCT IMAGES
    // ====================================================

    const images = req.files.map((file) => ({
      url: file.path,
      public_id: file.filename,
    }));

    // ====================================================
    // CREATE PRODUCT
    // ====================================================

    const product = await Product.create({
      category_id,

      productName: product_name.trim(),

      productDescription: description.trim(),

      images: images,
    });

    // ====================================================
    // CREATE VARIANTS
    // ====================================================

    const variantData = variants.map((variant) => ({
      product_id: product._id,

      sku: variant.sku.trim().toUpperCase(),

      weight: variant.weight.trim(),

      regular_price: Number(variant.price),

      stock_quantity: Number(variant.stock_quantity),
    }));

    await Variant.insertMany(variantData);

    // ====================================================
    // REDIRECT
    // ====================================================

    return res.redirect("/admin/products");
  } catch (error) {
    console.error("ADD PRODUCT ERROR:", error);

    const categories = await Category.find({
      isListed: true,
    }).lean();

    return res.status(500).render("admin/addProduct", {
      categories,
      error: "Something went wrong while adding the product.",
    });
  }
};

// ============================================================
// LOAD EDIT PRODUCT PAGE
// ============================================================

const loadEditProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.redirect("/admin/products");
    }

    const product = await Product.findById(id).populate("category_id").lean();

    if (!product) {
      return res.status(404).send("Product not found");
    }

    const variants = await Variant.find({
      product_id: id,
    }).lean();

    const categories = await Category.find({
      isListed: true,
    }).lean();

    product.variants = variants;

    return res.render("admin/editProduct", {
      product,
      categories,
    });
  } catch (error) {
    console.error("Load edit product error:", error);

    return res.status(500).send("Internal Server Error");
  }
};

// ============================================================
// EDIT PRODUCT
// ============================================================

const editProduct = async (req, res) => {
  try {

    const { id } = req.params;

    const { category_id, product_name, description, variants, deletedImages , status } = req.body;

    // ====================================================
    // CHECK PRODUCT ID
    // ====================================================

    if (!id) {
      return res.status(400).send("Product ID is required");
    }

    // ====================================================
    // FIND PRODUCT
    // ====================================================

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).send("Product not found");
    }

    // ====================================================
    // VALIDATE PRODUCT
    // ====================================================

    if (!product_name || !description || !category_id) {
      return res
        .status(400)
        .send("Product name, description and category are required.");
    }

    // ====================================================
    // CHECK CATEGORY
    // ====================================================

    const category = await Category.findById(category_id);

    if (!category) {
      return res.status(400).send("Selected category does not exist.");
    }

    // ====================================================
    // CHECK DUPLICATE PRODUCT NAME
    // ====================================================

    const duplicateProduct = await Product.findOne({
      productName: product_name.trim(),

      _id: {
        $ne: id,
      },
    });

    if (duplicateProduct) {
      return res.status(409).send("Product name already exists");
    }

    // ====================================================
    // UPDATE PRODUCT DETAILS
    // ====================================================

    product.category_id = category_id;

    product.productName = product_name.trim();

    product.productDescription = description.trim();


        // ====================================================
    // UPDATE PRODUCT LISTING STATUS
    // ====================================================
    //
    // Active -> true
    // Delete -> false
    //

    product.is_listed = status === "Active";
    // ====================================================
    // HANDLE DELETED EXISTING IMAGES
    // ====================================================

    let deletedImageIds = [];

    if (deletedImages) {
      try {
        deletedImageIds = JSON.parse(deletedImages);
      } catch (error) {
        console.log("Invalid deletedImages JSON");
        deletedImageIds = [];
      }
    }

    // ====================================================
    // DELETE IMAGES FROM CLOUDINARY
    // ====================================================

    if (deletedImageIds.length > 0) {
      for (const publicId of deletedImageIds) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (error) {
          console.error("Cloudinary delete error:", publicId, error);
        }
      }

      // ==================================================
      // REMOVE DELETED IMAGES FROM MONGODB
      // ==================================================

      product.images = product.images.filter(
        (image) => !deletedImageIds.includes(image.public_id),
      );
    }

    // ====================================================
    // ADD NEW IMAGES
    // ====================================================

    if (req.files && req.files.length > 0) {

      const newImages = req.files.map((file) => ({
        url: file.path,

        public_id: file.filename,
      }));

      product.images.push(...newImages);
    }

    // ====================================================
    // TOTAL IMAGE VALIDATION
    // ====================================================

    if (product.images.length < 3) {
      return res.status(400).send("Product must have at least 3 images.");
    }

    if (product.images.length > 5) {
      return res.status(400).send("Maximum 5 images are allowed.");
    }


    // ====================================================
    // UPDATE VARIANTS
    // ====================================================

    let variantData = [];

    if (variants) {
      let variantData = variants;

      // If only one variant is submitted
      if (!Array.isArray(variantData)) {
        variantData = [variantData];
      }


      // ==================================================
      // VALIDATE VARIANTS
      // ==================================================

      for (const variant of variantData) {
        if (
          !variant.weight ||
          !variant.sku ||
          variant.price === undefined ||
          variant.stock_quantity === undefined
        ) {
          return res.status(400).send("All variant fields are required.");
        }

        // PRICE

        if (Number.isNaN(Number(variant.price)) || Number(variant.price) < 0) {
          return res.status(400).send("Price must be a valid positive number.");
        }

        // STOCK

        if (
          Number.isNaN(Number(variant.stock_quantity)) ||
          Number(variant.stock_quantity) < 0
        ) {
          return res.status(400).send("Stock must be a valid positive number.");
        }
      }

      // ==================================================
      // SKU LIST
      // ==================================================

      const skuList = variantData.map((variant) =>
        variant.sku.trim().toUpperCase(),
      );

      // ==================================================
      // DUPLICATE SKU INSIDE REQUEST
      // ==================================================

      if (new Set(skuList).size !== skuList.length) {
        return res.status(400).send("Duplicate SKU found.");
      }

      // ==================================================
      // UPDATE / CREATE VARIANTS
      // ==================================================

      for (const variant of variantData) {
        const sku = variant.sku.trim().toUpperCase();

        // ==============================================
        // EXISTING VARIANT
        // ==============================================

        if (variant._id) {
          const duplicateSku = await Variant.findOne({
            sku,

            _id: {
              $ne: variant._id,
            },
          });

          if (duplicateSku) {
            return res.status(409).send(`SKU ${sku} already exists.`);
          }

          await Variant.findByIdAndUpdate(
            variant._id,

            {
              sku,

              weight: variant.weight.trim(),

              regular_price: Number(variant.price),

              stock_quantity: Number(variant.stock_quantity),
            },

            {
              runValidators: true,
            },
          );
        }

        // ==============================================
        // NEW VARIANT
        // ==============================================
        else {
          const existingSku = await Variant.findOne({
            sku,
          });

          if (existingSku) {
            return res.status(409).send(`SKU ${sku} already exists.`);
          }

          await Variant.create({
            product_id: id,

            sku,

            weight: variant.weight.trim(),

            regular_price: Number(variant.price),

            stock_quantity: Number(variant.stock_quantity),
          });
        }
      }
    }

    // ====================================================
    // SAVE PRODUCT
    // ====================================================

    await product.save();


        // ====================================================
    // SUCCESS
    // ====================================================

    return res.redirect("/admin/products");
  } catch (error) {
    console.error("EDIT PRODUCT ERROR:", error);

    return res.status(500).send("Unable to update product");
  }
};

// ============================================================
// SOFT DELETE PRODUCT
// ============================================================


const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).send("Category not found");
        }

        await Product.findByIdAndDelete(id);

        return res.redirect("/admin/products");

    } catch (error) {
        console.error("Error deleting category:", error);
        return res.status(500).send("Internal Server Error");
    }
};

module.exports = {
  productInfo,
  loadAddProduct,
  addProduct,
  loadEditProduct,
  editProduct,
  deleteProduct,
};
