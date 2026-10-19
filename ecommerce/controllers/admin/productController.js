import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Category from "../../models/categorySchema.js";
import cloudinary from "../../config/cloudinary.js";
import { generatePageArray } from "../../utils/pagination.js";

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

      const variants = await Variant.find(variantQuery).select("product_id");

      const productIds = variants.map((variant) => variant.product_id);

      productQuery._id = {
        $in: productIds,
      };
    }

    const totalProducts = await Product.countDocuments(productQuery);

    const products = await Product.find(productQuery)
      .populate("category_id", "category_name")
      .sort({
        created_at: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean();

    const productsWithStock = await Variant.distinct("product_id", {
      stock_quantity: {
        $gt: 0,
      },
    });

    const outOfStockProducts = await Product.countDocuments({
      _id: {
        $nin: productsWithStock,
      },
    });
    const activeCategories = await Product.countDocuments({
      is_listed: true,
    });

    const productIds = products.map((product) => product._id);

    const variants = await Variant.find({
      product_id: {
        $in: productIds,
      },
    }).lean();

    products.forEach((product) => {
      product.variants = variants.filter(
        (variant) => variant.product_id.toString() === product._id.toString(),
      );
    });

    const totalPages = Math.ceil(totalProducts / limit);
    const pages = generatePageArray(totalPages);

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

const loadAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({
      isListed: true,
    }).lean();

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

const addProduct = async (req, res) => {
  const redirectWithError = (message) => {
    req.session.error = message;
    return res.redirect("/admin/product/addProduct");
  };

  try {
    let { product_name, description, category_id, variants } = req.body;

    if (variants && typeof variants === "object" && !Array.isArray(variants)) {
      variants = Object.values(variants);
    }

    if (!product_name || !description || !category_id) {
      return redirectWithError(
        "Product name, description and category are required.",
      );
    }

    if (!req.files || req.files.length < 3) {
      return redirectWithError("Please upload at least 3 product images.");
    }

    if (req.files.length > 5) {

      return redirectWithError("Maximum 5 images are allowed.");
    }

    const category = await Category.findById(category_id);

    if (!category) {

      return redirectWithError("Selected category does not exist.");
    }

    if (!variants || !Array.isArray(variants) || variants.length === 0) {

      return redirectWithError("Please add at least one variant.");
    }

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];

      if (
        !variant.weight ||
        !variant.sku ||
        variant.price === undefined ||
        variant.stock_quantity === undefined
      ) {

        return redirectWithError("All variant fields are required.");
      }

      if (Number.isNaN(Number(variant.price)) || Number(variant.price) < 0) {

        return redirectWithError("Price must be a valid positive number.");
      }

      if (
        Number.isNaN(Number(variant.stock_quantity)) ||
        Number(variant.stock_quantity) < 0
      ) {
  
        return redirectWithError("Stock must be a valid positive number.");
      }
    }

    const weightList = variants.map((variant) =>
      variant.weight.trim().replace(/\s+/g, "").toLowerCase(),
    );

    if (new Set(weightList).size !== weightList.length) {
      return redirectWithError("Each product variant must have a unique weight.");
    }

    const skuList = variants.map((variant) => variant.sku.trim().toUpperCase());

    if (new Set(skuList).size !== skuList.length) {
      return redirectWithError("Duplicate SKU found.");
    }


    const existingSku = await Variant.findOne({
      sku: {
        $in: skuList,
      },
    });

    if (existingSku) {

      return redirectWithError(`SKU ${existingSku.sku} already exists.`);
    }


    const images = req.files.map((file) => ({
      url: file.path,
      public_id: file.filename,
    }));

    const product = await Product.create({
      category_id,

      productName: product_name.trim(),

      productDescription: description.trim(),

      images: images,
    });

    const variantData = variants.map((variant) => ({
      product_id: product._id,

      sku: variant.sku.trim().toUpperCase(),

      weight: variant.weight.trim(),

      regular_price: Number(variant.price),

      stock_quantity: Number(variant.stock_quantity),
    }));

    await Variant.insertMany(variantData);

    req.session.success = `Product Added Successfull`

    return res.redirect("/admin/product/products");
  } catch (error) {
    console.error("❌ ADD PRODUCT ERROR:", error.message);
    console.error("Error Stack:", error.stack);
    console.error("Full Error:", error);

    return redirectWithError(
      "Something went wrong while adding the product. Please try again.",
    );
  }
};

const loadEditProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.redirect("/admin/product/products");
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

const editProduct = async (req, res) => {
  const editPath = `/admin/product/editProduct/${req.params.id}`;
  const redirectWithError = (message, path = editPath) => {
    req.session.error = message;
    return res.redirect(path);
  };

  try {
    const { id } = req.params;

    const {
      category_id,
      product_name,
      description,
      variants,
      deletedImages,
      status,
    } = req.body;

    if (!id) {
      return redirectWithError(
        "Product ID is required.",
        "/admin/product/products",
      );
    }

    const product = await Product.findById(id);

    if (!product) {
      return redirectWithError("Product not found.", "/admin/product/products");
    }

    if (!product_name || !description || !category_id) {
      return redirectWithError(
        "Product name, description and category are required.",
      );
    }

    const category = await Category.findById(category_id);

    if (!category) {
      return redirectWithError("Selected category does not exist.");
    }

    const duplicateProduct = await Product.findOne({
      productName: product_name.trim(),

      _id: {
        $ne: id,
      },
    });

    if (duplicateProduct) {
      return redirectWithError("Product name already exists.");
    }

    product.category_id = category_id;

    product.productName = product_name.trim();

    product.productDescription = description.trim();

    product.is_listed = status === "Active";

    let deletedImageIds = [];

    if (deletedImages) {
      try {
        deletedImageIds = JSON.parse(deletedImages);
      } catch (error) {

        deletedImageIds = [];
      }
    }

    if (deletedImageIds.length > 0) {
      for (const publicId of deletedImageIds) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (error) {
          console.error("Cloudinary delete error:", publicId, error);
        }
      }

      product.images = product.images.filter(
        (image) => !deletedImageIds.includes(image.public_id),
      );
    }

    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file) => ({
        url: file.path,

        public_id: file.filename,
      }));

      product.images.push(...newImages);
    }

    if (product.images.length < 3) {
      return redirectWithError("Product must have at least 3 images.");
    }

    if (product.images.length > 5) {
      return redirectWithError("Maximum 5 images are allowed.");
    }

    let variantData = [];

    if (variants) {
      let variantData = variants;

      // If only one variant is submitted
      if (!Array.isArray(variantData)) {
        variantData = [variantData];
      }

      for (const variant of variantData) {
        if (
          !variant.weight ||
          !variant.sku ||
          variant.price === undefined ||
          variant.stock_quantity === undefined
        ) {
          return redirectWithError("All variant fields are required.");
        }

        // PRICE

        if (Number.isNaN(Number(variant.price)) || Number(variant.price) < 0) {
          return redirectWithError("Price must be a valid positive number.");
        }

        // STOCK

        if (
          Number.isNaN(Number(variant.stock_quantity)) ||
          Number(variant.stock_quantity) < 0
        ) {
          return redirectWithError("Stock must be a valid positive number.");
        }
      }

      const skuList = variantData.map((variant) =>
        variant.sku.trim().toUpperCase(),
      );

      if (new Set(skuList).size !== skuList.length) {
        return redirectWithError("Duplicate SKU found.");
      }

      for (const variant of variantData) {
        const sku = variant.sku.trim().toUpperCase();

        if (variant._id) {
          const duplicateSku = await Variant.findOne({
            sku,

            _id: {
              $ne: variant._id,
            },
          });

          if (duplicateSku) {
            return redirectWithError(`SKU ${sku} already exists.`);
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
        } else {
          const existingSku = await Variant.findOne({
            sku,
          });

          if (existingSku) {
            return redirectWithError(`SKU ${sku} already exists.`);
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

    await product.save();

    req.session.success = `Product Edited Successfull`

    return res.redirect("/admin/product/products");
  } catch (error) {
    console.error("EDIT PRODUCT ERROR:", error);

    return redirectWithError("Unable to update product. Please try again.");
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).send("Category not found");
    }

    await Product.findByIdAndDelete(id);

    req.session.success = `Product Deleted Successfull`

    return res.redirect("/admin/product/products");
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).send("Internal Server Error");
  }
};


export default {
  productInfo,
  loadAddProduct,
  addProduct,
  loadEditProduct,
  editProduct,
  deleteProduct,
};
