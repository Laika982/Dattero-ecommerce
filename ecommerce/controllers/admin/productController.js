import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Category from "../../models/categorySchema.js";
import cloudinary from "../../config/cloudinary.js";
import { generatePageArray } from "../../utils/pagination.js";

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
    const pages = generatePageArray(totalPages);

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
    let { product_name, description, category_id, variants } = req.body;

    console.log("=== ADD PRODUCT REQUEST ===");
    console.log("Body:", req.body);
    console.log("Files Count:", req.files?.length || 0);
    console.log("Files:", req.files);
    console.log("Variants (before conversion):", variants);

    // ====================================================
    // CONVERT VARIANTS OBJECT TO ARRAY
    // ====================================================

    if (variants && typeof variants === "object" && !Array.isArray(variants)) {
      variants = Object.values(variants);
    }

    console.log("Variants (after conversion):", variants);
    console.log("Is variants array?", Array.isArray(variants));
    console.log("Variants length:", variants?.length);

    // ====================================================
    // PRODUCT VALIDATION
    // ====================================================

    if (!product_name || !description || !category_id) {
      console.log("VALIDATION ERROR: Missing required fields");
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Product name, description and category are required.",
      });
    }

    console.log("✓ Product fields validation passed");

    // ====================================================
    // IMAGE VALIDATION
    // ====================================================

    if (!req.files || req.files.length < 3) {
      console.log("VALIDATION ERROR: Not enough images");
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Please upload at least 3 product images.",
      });
    }

    if (req.files.length > 5) {
      console.log("VALIDATION ERROR: Too many images");
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Maximum 5 images are allowed.",
      });
    }

    console.log("✓ Image validation passed");

    // ====================================================
    // CHECK CATEGORY
    // ====================================================

    const category = await Category.findById(category_id);

    if (!category) {
      console.log("VALIDATION ERROR: Category not found");
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Selected category does not exist.",
      });
    }

    console.log("✓ Category validation passed");

    // ====================================================
    // CHECK VARIANTS
    // ====================================================

    if (!variants || !Array.isArray(variants) || variants.length === 0) {
      console.log("VALIDATION ERROR: No variants");
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Please add at least one variant.",
      });
    }

    console.log("✓ Variants validation passed");

    // ====================================================
    // VALIDATE VARIANTS
    // ====================================================

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      console.log(`\nValidating variant ${i}:`, variant);
      console.log(`  weight: "${variant.weight}" (type: ${typeof variant.weight})`);
      console.log(`  price: "${variant.price}" (type: ${typeof variant.price})`);
      console.log(`  sku: "${variant.sku}" (type: ${typeof variant.sku})`);
      console.log(`  stock_quantity: "${variant.stock_quantity}" (type: ${typeof variant.stock_quantity})`);

      // ----------------------------------------------
      // REQUIRED FIELDS
      // ----------------------------------------------

      if (
        !variant.weight ||
        !variant.sku ||
        variant.price === undefined ||
        variant.stock_quantity === undefined
      ) {
        console.log(`VALIDATION ERROR: Missing fields in variant ${i}`);
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
        console.log(`VALIDATION ERROR: Invalid price in variant ${i}`);
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
        console.log(`VALIDATION ERROR: Invalid stock in variant ${i}`);
        const categories = await Category.find({
          isListed: true,
        }).lean();

        return res.status(400).render("admin/addProduct", {
          categories,
          error: "Stock must be a valid positive number.",
        });
      }
    }

    console.log("✓ All variant fields validation passed");

    // ====================================================
    // SKU LIST
    // ====================================================

    const skuList = variants.map((variant) => variant.sku.trim().toUpperCase());
    console.log("SKU List:", skuList);

    // ====================================================
    // DUPLICATE SKU INSIDE FORM
    // ====================================================

    if (new Set(skuList).size !== skuList.length) {
      console.log("VALIDATION ERROR: Duplicate SKU in form");
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: "Duplicate SKU found.",
      });
    }

    console.log("✓ No duplicate SKUs in form");

    // ====================================================
    // CHECK SKU IN DATABASE
    // ====================================================

    console.log("Checking for existing SKU in database...");
    const existingSku = await Variant.findOne({
      sku: {
        $in: skuList,
      },
    });

    if (existingSku) {
      console.log("VALIDATION ERROR: SKU already exists in DB:", existingSku.sku);
      const categories = await Category.find({
        isListed: true,
      }).lean();

      return res.status(400).render("admin/addProduct", {
        categories,
        error: `SKU ${existingSku.sku} already exists.`,
      });
    }

    console.log("✓ SKU is unique in database");

    // ====================================================
    // PRODUCT IMAGES
    // ====================================================

    console.log("Processing images...");
    const images = req.files.map((file) => ({
      url: file.path,
      public_id: file.filename,
    }));
    console.log("Images processed:", images.length);

    // ====================================================
    // CREATE PRODUCT
    // ====================================================

    console.log("Creating product with data:", {
      productName: product_name.trim(),
      productDescription: description.trim(),
      category_id,
      images_count: images.length
    });

    const product = await Product.create({
      category_id,

      productName: product_name.trim(),

      productDescription: description.trim(),

      images: images,
    });

    console.log("✓ Product created:", product._id);

    // ====================================================
    // CREATE VARIANTS
    // ====================================================

    console.log("Creating variants...");
    const variantData = variants.map((variant) => ({
      product_id: product._id,

      sku: variant.sku.trim().toUpperCase(),

      weight: variant.weight.trim(),

      regular_price: Number(variant.price),

      stock_quantity: Number(variant.stock_quantity),
    }));

    console.log("Variant data prepared:", variantData);

    await Variant.insertMany(variantData);

    console.log("✓ Variants created successfully");

    // ====================================================
    // REDIRECT
    // ====================================================

    console.log("✓ Product added successfully! Redirecting...");
    return res.redirect("/admin/product/products");
  } catch (error) {
    console.error("❌ ADD PRODUCT ERROR:", error.message);
    console.error("Error Stack:", error.stack);
    console.error("Full Error:", error);

    const categories = await Category.find({
      isListed: true,
    }).lean();

    return res.status(500).render("admin/addProduct", {
      categories,
      error: `Something went wrong while adding the product. Error: ${error.message}`,
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

    return res.redirect("/admin/product/products");
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

        return res.redirect("/admin/product/products");

    } catch (error) {
        console.error("Error deleting category:", error);
        return res.status(500).send("Internal Server Error");
    }
};

export {
  productInfo,
  loadAddProduct,
  addProduct,
  loadEditProduct,
  editProduct,
  deleteProduct,
};

export default {
  productInfo,
  loadAddProduct,
  addProduct,
  loadEditProduct,
  editProduct,
  deleteProduct,
};
