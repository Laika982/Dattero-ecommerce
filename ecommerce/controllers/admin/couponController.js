import Coupon from "../../models/couponSchema.js";
import Category from "../../models/categorySchema.js";
import Product from "../../models/productSchema.js";
import mongoose from "mongoose";

const listCoupons = async (req, res) => {
  try {
    const filter = ["active", "inactive", "expired"].includes(req.query.filter)
      ? req.query.filter
      : "all";
    const requestedPage = Math.max(Number(req.query.page) || 1, 1);
    const limit = 5;
    const query =
      filter === "active"
        ? { is_active: true }
        : filter === "inactive"
          ? { is_active: false }
          : filter === "expired"
            ? { expiry_date: { $lt: new Date() } }
            : {};
    const totalCoupons = await Coupon.countDocuments(query);
    const totalPages = Math.ceil(totalCoupons / limit);
    const currentPage = totalPages ? Math.min(requestedPage, totalPages) : 1;
    const skip = (currentPage - 1) * limit;
    const coupons = await Coupon.find(query)
      .populate("category_id", "category_name")
      .populate("product_id", "productName")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    return res.render("admin/coupons", {
      coupons,
      totalCoupons,
      totalPages,
      currentPage,
      filter,
      pages: Array.from({ length: totalPages }, (_, index) => index + 1),
      startItem: totalCoupons ? skip + 1 : 0,
      endItem: skip + coupons.length,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to load coupons",
    });
  }
};

const showCreateCoupon = async (req, res) => {
  try {
    const [categories, products] = await Promise.all([
      Category.find({ isListed: true }).sort({ category_name: 1 }).lean(),
      Product.find({ is_listed: true })
        .select("productName")
        .sort({ productName: 1 })
        .lean(),
    ]);
    return res.render("admin/addCoupon", {
      categories,
      products,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to load add coupons",
    });
  }
};

const createCoupon = async (req, res) => {
  try {
    const {
      couponCode,
      discountType,
      discountValue,
      status,
      minAmount,
      maxDiscount,
      usageLimit,
      applies_to,
      category_id,
      product_id,
      startDate,
      endDate,
    } = req.body;

    const requiredFields = [
      couponCode,
      discountType,
      discountValue,
      status,
      minAmount,
      usageLimit,
      startDate,
      endDate,
    ];

    if (
      requiredFields.some(
        (value) => value == null || String(value).trim() === "",
      )
    ) {
      req.session.error = "All required fields must be filled";
      return res.redirect("/admin/coupons/add");
    }

    const isActive = status === "active";

    const formatedCouponCode = couponCode.trim().toUpperCase();
    const parsedDiscountValue = Number(discountValue);
    const parsedMinAmount = Number(minAmount);
    const parsedMaxDiscount =
      maxDiscount == null || String(maxDiscount).trim() === ""
        ? null
        : Number(maxDiscount);
    const parsedUsageLimit = Number(usageLimit);

    if (!/^[A-Z0-9_-]{6,30}$/.test(formatedCouponCode)) {
      req.session.error =
        "Coupon code must be 6-30 letters, numbers, hyphens, or underscores";
      return res.redirect("/admin/coupons/add");
    }

    if (!["PERCENTAGE", "FIXED"].includes(discountType)) {
      req.session.error = "Invalid discount type";
      return res.redirect("/admin/coupons/add");
    }

    if (!["active", "inactive"].includes(status)) {
      req.session.error = "Invalid coupon status";
      return res.redirect("/admin/coupons/add");
    }

    if (discountType === "PERCENTAGE" && parsedDiscountValue > 100) {
      req.session.error = "Percentage discount cannot exceed 100";
      return res.redirect("/admin/coupons/add");
    }
    if (parsedUsageLimit < 1) {
      req.session.error = "Usage limit at least 1";
      return res.redirect("/admin/coupons/add");
    }

    if (
      !Number.isFinite(parsedDiscountValue) ||
      parsedDiscountValue <= 0 ||
      !Number.isFinite(parsedMinAmount) ||
      parsedMinAmount < 0 ||
      (parsedMaxDiscount !== null &&
        (!Number.isFinite(parsedMaxDiscount) || parsedMaxDiscount <= 0)) ||
      !Number.isInteger(parsedUsageLimit) ||
      parsedUsageLimit < 1
    ) {
      req.session.error = "Please enter valid numeric values";
      return res.redirect("/admin/coupons/add");
    }
    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    if (
      Number.isNaN(parsedStartDate.getTime()) ||
      Number.isNaN(parsedEndDate.getTime())
    ) {
      req.session.error = "Please enter valid dates";
      return res.redirect("/admin/coupons/add");
    }

    if (parsedEndDate <= parsedStartDate) {
      req.session.error = "End date must be after the start date";
      return res.redirect("/admin/coupons/add");
    }

    let finalAppliesTo = applies_to || "ALL";
    let finalCategoryId = null;
    let finalProductId = null;

    if (finalAppliesTo === "CATEGORY") {
      if (category_id === "ALL") {
        finalAppliesTo = "ALL";
      } else if (!category_id || !mongoose.isValidObjectId(category_id)) {
        req.session.error =
          "Please select a valid category or choose All Categories";
        return res.redirect("/admin/coupons/add");
      } else {
        const category = await Category.findById(category_id);
        if (!category) {
          req.session.error = "Category does not exist";
          return res.redirect("/admin/coupons/add");
        }
        finalCategoryId = category._id;
      }
    } else if (finalAppliesTo === "PRODUCT") {
      if (product_id === "ALL") {
        finalAppliesTo = "ALL";
      } else if (!product_id || !mongoose.isValidObjectId(product_id)) {
        req.session.error =
          "Please select a valid product or choose All Products";
        return res.redirect("/admin/coupons/add");
      } else {
        const product = await Product.findById(product_id);
        if (!product) {
          req.session.error = "Product does not exist";
          return res.redirect("/admin/coupons/add");
        }
        finalProductId = product._id;
      }
    } else {
      finalAppliesTo = "ALL";
    }

    const duplicate = await Coupon.findOne({ code: formatedCouponCode });
    if (duplicate) {
      req.session.error = "Coupon Name already exists";
      return res.redirect("/admin/coupons/add");
    }

    await Coupon.create({
      code: formatedCouponCode,
      discount_type: discountType,
      discount_value: parsedDiscountValue,
      max_discount: parsedMaxDiscount,
      minimum_purchase: parsedMinAmount,
      usage_limit: parsedUsageLimit,
      expiry_date: parsedEndDate,
      is_active: isActive,
      applies_to: finalAppliesTo,
      category_id: finalCategoryId,
      product_id: finalProductId,
      start_date: parsedStartDate,
    });

    req.session.success = "Coupon created successfully";
    return res.redirect("/admin/coupons");
  } catch (error) {
    if (error.code === 11000) {
      req.session.error = "Coupon code already exists";
      return res.redirect("/admin/coupons/add");
    }

    console.error("Create coupon:", error);

    req.session.error = "Unable to create coupon";
    return res.redirect("/admin/coupons/add");
  }
};

const showEditCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;

    if (!mongoose.isValidObjectId(couponId)) {
      req.session.error = "Invalid coupon";
      return res.redirect("/admin/coupons");
    }

    const coupon = await Coupon.findById(couponId).lean();

    if (!coupon) {
      req.session.error = "Coupon not found";
      return res.redirect("/admin/coupons");
    }

    const [categories, products] = await Promise.all([
      Category.find({ isListed: true }).sort({ category_name: 1 }).lean(),
      Product.find({ is_listed: true })
        .select("productName")
        .sort({ productName: 1 })
        .lean(),
    ]);

    coupon.startDateValue = coupon.start_date
      ? new Date(coupon.start_date).toISOString().slice(0, 10)
      : "";
    coupon.expiryDateValue = coupon.expiry_date
      ? new Date(coupon.expiry_date).toISOString().slice(0, 10)
      : "";

    if (!coupon.applies_to) {
      if (coupon.product_id) {
        coupon.applies_to = "PRODUCT";
      } else if (coupon.category_id) {
        coupon.applies_to = "CATEGORY";
      } else {
        coupon.applies_to = "ALL";
      }
    }

    return res.render("admin/editCoupon", {
      coupon,
      categories,
      products,
    });
  } catch (error) {
    console.error("Show edit coupon error:", error);
    req.session.error = "Unable to load edit coupon";
    return res.redirect("/admin/coupons");
  }
};

const editCoupon = async (req, res) => {
  const { couponId } = req.params;

  if (!mongoose.isValidObjectId(couponId)) {
    req.session.error = "Invalid coupon";
    return res.redirect("/admin/coupons");
  }

  const {
    couponCode,
    discountType,
    discountValue,
    status,
    minAmount,
    maxDiscount,
    usageLimit,
    applies_to,
    category_id,
    product_id,
    startDate,
    endDate,
  } = req.body;

  const code =
    typeof couponCode === "string" ? couponCode.trim().toUpperCase() : "";
  const value = Number(discountValue);
  const minimum = Number(minAmount);
  const maximum =
    maxDiscount == null || String(maxDiscount).trim() === ""
      ? null
      : Number(maxDiscount);
  const usage =
    usageLimit == null || String(usageLimit).trim() === ""
      ? null
      : Number(usageLimit);
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (!/^[A-Z0-9_-]{6,30}$/.test(code)) {
    req.session.error =
      "Coupon code must be 6-30 letters, numbers, hyphens, or underscores";
    return res.redirect(`/admin/coupons/edit/${couponId}`);
  }

  if (
    !["PERCENTAGE", "FIXED"].includes(discountType) ||
    !["active", "inactive"].includes(status)
  ) {
    req.session.error = "Choose a valid discount type and status";
    return res.redirect(`/admin/coupons/edit/${couponId}`);
  }

  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    (discountType === "PERCENTAGE" && value > 100) ||
    !Number.isFinite(minimum) ||
    minimum < 0 ||
    (maximum !== null && (!Number.isFinite(maximum) || maximum <= 0)) ||
    (usage !== null && (!Number.isInteger(usage) || usage < 1))
  ) {
    req.session.error = "Enter valid discount, purchase, and usage values";
    return res.redirect(`/admin/coupons/edit/${couponId}`);
  }

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    req.session.error = "End date must be after a valid start date";
    return res.redirect(`/admin/coupons/edit/${couponId}`);
  }

  let finalAppliesTo = applies_to || "ALL";
  let finalCategoryId = null;
  let finalProductId = null;

  if (finalAppliesTo === "CATEGORY") {
    if (category_id === "ALL") {
      finalAppliesTo = "ALL";
    } else if (!category_id || !mongoose.isValidObjectId(category_id)) {
      req.session.error =
        "Please select a valid category or choose All Categories";
      return res.redirect(`/admin/coupons/edit/${couponId}`);
    } else {
      const category = await Category.findById(category_id);
      if (!category) {
        req.session.error = "Category not found";
        return res.redirect(`/admin/coupons/edit/${couponId}`);
      }
      finalCategoryId = category._id;
    }
  } else if (finalAppliesTo === "PRODUCT") {
    if (product_id === "ALL") {
      finalAppliesTo = "ALL";
    } else if (!product_id || !mongoose.isValidObjectId(product_id)) {
      req.session.error =
        "Please select a valid product or choose All Products";
      return res.redirect(`/admin/coupons/edit/${couponId}`);
    } else {
      const product = await Product.findById(product_id);
      if (!product) {
        req.session.error = "Product not found";
        return res.redirect(`/admin/coupons/edit/${couponId}`);
      }
      finalProductId = product._id;
    }
  } else {
    finalAppliesTo = "ALL";
  }

  try {
    const [coupon, duplicate] = await Promise.all([
      Coupon.findById(couponId),
      Coupon.findOne({ code, _id: { $ne: couponId } }),
    ]);

    if (!coupon) {
      req.session.error = "Coupon not found";
      return res.redirect("/admin/coupons");
    }

    if (duplicate) {
      req.session.error = "Coupon code already exists";
      return res.redirect(`/admin/coupons/edit/${couponId}`);
    }

    await Coupon.findByIdAndUpdate(couponId, {
      code,
      discount_type: discountType,
      discount_value: value,
      max_discount: maximum,
      minimum_purchase: minimum,
      usage_limit: usage,
      expiry_date: end,
      is_active: status === "active",
      applies_to: finalAppliesTo,
      category_id: finalCategoryId,
      product_id: finalProductId,
      start_date: start,
    });

    req.session.success = "Coupon updated successfully";
    return res.redirect("/admin/coupons");
  } catch (error) {
    console.error("Edit coupon error:", error);
    req.session.error =
      error.code === 11000
        ? "Coupon code already exists"
        : "Unable to update coupon";
    return res.redirect(`/admin/coupons/edit/${couponId}`);
  }
};

const deleteCoupon = async (req, res) => {
  const { couponId } = req.params;

  if (!mongoose.isValidObjectId(couponId)) {
    req.session.error = "Invalid coupon";
    return res.redirect("/admin/coupons");
  }

  try {
    const coupon = await Coupon.findById(couponId);

    if (!coupon) {
      req.session.error = "Coupon not found";
      return res.redirect("/admin/coupons");
    }

    if (coupon.used_count > 0 || (coupon.used_by || []).length > 0) {
      req.session.error =
        "Used coupons cannot be deleted. Deactivate the coupon instead.";
      return res.redirect("/admin/coupons");
    }

    await coupon.deleteOne();

    req.session.success = "Coupon deleted successfully";
    return res.redirect("/admin/coupons");
  } catch (error) {
    console.error("Delete coupon error:", error);
    req.session.error = "Unable to delete coupon";
    return res.redirect("/admin/coupons");
  }
};

export default {
  listCoupons,
  showCreateCoupon,
  createCoupon,
  deleteCoupon,
  showEditCoupon,
  editCoupon,
};
