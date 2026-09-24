import Product from "../../models/productSchema.js";
import Variant from "../../models/variantSchema.js";
import Category from "../../models/categorySchema.js";

const loadProducts = async (req, res) => {
  try {
    const { sort = "", page = 1 } = req.query;
    const search = req.query.search?.trim() || "";
    const minPrice = req.query.minPrice?.trim() || "";
    const maxPrice = req.query.maxPrice?.trim() || "";

    let category = req.query.category || [];

    if (!Array.isArray(category)) {
      category = [category];
    }

    const limit = 10;

    const currpage = Number(page) || 1;

    const skip = (currpage - 1) * limit;

    const categories = await Category.find({
      isListed: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    let productQuery = {
      is_listed: true,
    };

    if (search.trim()) {
      productQuery.productName = {
        $regex: search.trim(),
        $options: "i",
      };
    }

    if (category.length > 0) {
      productQuery.category_id = {
        $in: category,
      };
    }

    const productsFromDb = await Product.find(productQuery)
      .populate("category_id")
      .lean();

    //varieant logic
    const productIds = productsFromDb.map((product) => product._id);

    const varients = await Variant.find({
      product_id: {
        $in: productIds,
      },
    }).lean();

    //transform varients based on productId
    const matchVarients = {};

    varients.forEach((product) => {
      const productId = product.product_id.toString();

      if (!matchVarients[productId]) {
        matchVarients[productId] = [];
      }

      matchVarients[productId].push(product);
    });

    //calculate the one product price
    let products = productsFromDb.map((product) => {
      const productId = product._id.toString();

      const productVarient = matchVarients[productId] || [];

      const price = productVarient
        .map((variant) => Number(variant.regular_price))
        .filter((price) => !Number.isNaN(price));

      const listPrice = price.length > 0 ? Math.min(...price) : null;

      return { ...product, listPrice };
    });

    products = products.filter((product) => product.listPrice !== null);

    //minPrice
    if (minPrice !== undefined && minPrice !== "") {
      const min = Number(minPrice);

      if (!Number.isNaN(min)) {
        products = products.filter((product) => product.listPrice >= min);
      }
    }

    //maxProce

    if (maxPrice !== undefined && maxPrice !== "") {
      const max = Number(maxPrice);

      if (!Number.isNaN(max)) {
        products = products.filter((product) => product.listPrice <= max);
      }
    }

    //sorting

    if (sort === "priceAcc") {
      products.sort((a, b) => {
        return a.listPrice - b.listPrice;
      });
    }
    if (sort === "priceDesc") {
      products.sort((a, b) => {
        return b.listPrice - a.listPrice;
      });
    }

    if (sort === "az") {
      products.sort((a, b) => a.productName.localeCompare(b.productName));
    }

    if (sort === "za") {
      products.sort((a, b) => b.productName.localeCompare(a.productName));
    }

    //total product

    const totalProduct = products.length;

    //total page

    const totalPage = Math.ceil(totalProduct / limit);

    const paginatatedProduct = products.slice(skip, skip + limit);

    res.render("user/products", {
      currentNav: "products",
      products: paginatatedProduct,
      categories,

      search,
      category,
      minPrice,
      maxPrice,
      sort,

      page,
      totalPage,
      totalProduct,
    });
  } catch (error) {
    console.error("Load products error:", error);

    res.status(500).send("Internal Server Error");
  }
};

const loadProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      is_listed: true,
    })
      .populate("category_id")
      .lean();

    if (!product) {
      req.session.error = " Product Not Found"

      return res.redirect("/products");
    }

    const variants = await Variant.find({
      product_id: product._id,
    }).lean();

    if (!variants.length) {
      req.session.error = "No Varient Found"

      return res.redirect("/products");
    }

    const variantsWithPrice = variants.map((variant) => {
      const effectivePrice =
        variant.sale_price !== null && variant.sale_price !== undefined
          ? Number(variant.sale_price)
          : Number(variant.regular_price);

      return {
        ...variant,
        effectivePrice,
      };
    });

    const cheapestVariant = variantsWithPrice.reduce((min, variant) => {
      return variant.effectivePrice < min.effectivePrice ? variant : min;
    }, variantsWithPrice[0]);

    const listingPrice = cheapestVariant.effectivePrice;

    const regularPrice = Number(cheapestVariant.regular_price);

    let discountPercentage = 0;

    if (regularPrice > 0 && listingPrice < regularPrice) {
      discountPercentage = Math.round(
        ((regularPrice - listingPrice) / regularPrice) * 100,
      );
    }

    const totalStock = variants.reduce((total, variant) => {
      return total + Number(variant.stock_quantity || 0);
    }, 0);

    const isOutOfStock = totalStock <= 0;

    // =====================================
    // 10. Get reviews
    // =====================================

    // const reviews = await Review.find({
    //     product_id: product._id
    // })
    //     .populate(
    //         "user_id",
    //         "username photo"
    //     )
    //     .sort({
    //         createdAt: -1
    //     })
    //     .lean();

    // =====================================
    // 11. Calculate rating
    // =====================================

    // const totalReviews = reviews.length;

    // const averageRating =
    //     totalReviews > 0
    //         ? reviews.reduce(
    //             (sum, review) =>
    //                 sum + Number(review.rating || 0),
    //             0
    //         ) / totalReviews
    //         : 0;

    // =====================================
    // 12. Related products
    // =====================================

    const relatedProducts = await Product.find({
      category_id: product.category_id?._id,

      _id: {
        $ne: product._id,
      },

      is_listed: true,
    })
      .limit(4)
      .lean();

    //Render product detail

    return res.render("user/productDetailPage", {
      currentNav: "products",
      product,

      variants: variantsWithPrice,

      listingPrice,

      regularPrice,

      discountPercentage,

      totalStock,

      isOutOfStock,

      relatedProducts,
    });
  } catch (error) {
    console.error("Product details error:", error);

    return res.status(500).send("Something went wrong");
  }
};

export default {
  loadProducts,
  loadProduct,
};
