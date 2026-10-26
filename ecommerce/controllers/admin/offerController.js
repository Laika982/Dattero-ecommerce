
import Offer from "../../models/offerSchema.js";
import Product from "../../models/productSchema.js";
import Category from "../../models/categorySchema.js";
import mongoose from "mongoose";

const decorateOffer = (offer, now) => ({
  ...offer,
  targetLabel: offer.offer_type === "PRODUCT"
    ? offer.product_id?.productName || "Product unavailable"
    : offer.offer_type === "CATEGORY"
      ? offer.category_id?.category_name || "Category unavailable"
      : "Referred customer first order",
  discountLabel: offer.discount_type === "PERCENTAGE"
    ? `${offer.discount_value}% off`
    : `₹${offer.discount_value} off`,
  startLabel: new Date(offer.start_date).toLocaleDateString("en-IN"),
  endLabel: new Date(offer.end_date).toLocaleDateString("en-IN"),
  currentlyActive: offer.is_active && offer.start_date <= now && offer.end_date > now,
});

export const loadOffersPage = async (req, res) => {
  try {
    const filter = ["product", "category", "referral", "active", "inactive"].includes(req.query.filter)
      ? req.query.filter
      : "all";
    const requestedPage = Math.max(Number(req.query.page) || 1, 1);
    const limit = 5;
    const now = new Date();
    const search = req.query.search ? req.query.search.trim() : "";
    const query = filter === "product"
      ? { offer_type: "PRODUCT" }
      : filter === "category"
        ? { offer_type: "CATEGORY" }
        : filter === "referral"
          ? { offer_type: "REFERRAL" }
          : filter === "active"
            ? { is_active: true, start_date: { $lte: now }, end_date: { $gt: now } }
            : filter === "inactive"
              ? { $or: [{ is_active: false }, { end_date: { $lte: now } }, { start_date: { $gt: now } }] }
              : {};
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const totalOffers = await Offer.countDocuments(query);
    const totalPages = Math.ceil(totalOffers / limit);
    const currentPage = totalPages ? Math.min(requestedPage, totalPages) : 1;
    const skip = (currentPage - 1) * limit;

    const [offerDocuments, productCount, categoryCount, referralCount] = await Promise.all([
      Offer.find(query)
        .populate("product_id", "productName")
        .populate("category_id", "category_name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Offer.countDocuments({ offer_type: "PRODUCT" }),
      Offer.countDocuments({ offer_type: "CATEGORY" }),
      Offer.countDocuments({ offer_type: "REFERRAL" }),
    ]);

    return res.render("admin/offers", {
      offers: offerDocuments.map((offer) => decorateOffer(offer, now)),
      totalOffers,
      productCount,
      categoryCount,
      referralCount,
      totalPages,
      currentPage,
      filter,
      search,
      pages: Array.from({ length: totalPages }, (_, index) => index + 1),
      startItem: totalOffers ? skip + 1 : 0,
      endItem: skip + offerDocuments.length,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages,
    });
  } catch (error) {
    console.error("Load offers page:", error);
    return res.status(500).send("Unable to load offers");
  }
};

export const showCreateOffer = async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({ is_listed: true }).select("productName").sort({ productName: 1 }).lean(),
      Category.find({ isListed: true }).select("category_name").sort({ category_name: 1 }).lean(),
    ]);

    return res.render("admin/addOffer", { products, categories });
  } catch (error) {
    console.error("Show create offer:", error);
    req.session.error = "Unable to load create offer";
    return res.redirect("/admin/offers");
  }
};

export const createOffer = async (req, res) => {
  try {
    const {
      name,
      offer_type,
      product_id,
      category_id,
      discount_type,
      discount_value,
      start_date,
      end_date,
      status,
    } = req.body;

    const fail = (message) => {
      if (!req.is("application/json")) {
        req.session.error = message;
        return res.redirect("/admin/offers/add");
      }
      return res.status(400).json({ success: false, message });
    };

    if (!name?.trim()) {
      return fail("Offer name is required");
    }

    if (
      !["PRODUCT", "CATEGORY", "REFERRAL"].includes(offer_type) ||
      !["PERCENTAGE", "FIXED"].includes(discount_type)
    ) {
      return fail("Invalid offer type");
    }

    const value = Number(discount_value);
    const start = new Date(start_date);
    const end = new Date(end_date);

    if (!Number.isFinite(value) || value <= 0) {
      return fail("Discount must be greater than zero");
    }

    if (
      discount_type === "PERCENTAGE" &&
      value > 100
    ) {
      return fail("Percentage cannot exceed 100");
    }

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return fail("Invalid offer dates");
    }

    if (offer_type === "PRODUCT" && !mongoose.isValidObjectId(product_id)) {
      return fail("Choose a valid product");
    }
    if (offer_type === "CATEGORY" && !mongoose.isValidObjectId(category_id)) {
      return fail("Choose a valid category");
    }

    const target = offer_type === "PRODUCT"
      ? await Product.findById(product_id).select("_id")
      : offer_type === "CATEGORY"
        ? await Category.findById(category_id).select("_id")
        : true;
    if (!target) {
      return fail(offer_type === "PRODUCT" ? "Product not found" : "Category not found");
    }

    const offer = await Offer.create({
      name: name.trim(),
      offer_type,
      product_id:
        offer_type === "PRODUCT" ? product_id : null,
      category_id:
        offer_type === "CATEGORY" ? category_id : null,
      discount_type,
      discount_value: value,
      start_date: start,
      end_date: end,
      is_active: status !== "inactive",
    });

    if (!req.is("application/json")) {
      req.session.success = "Offer created successfully";
      return res.redirect("/admin/offers");
    }

    return res.status(201).json({
      success: true,
      message: "Offer created successfully",
      offer,
    });
  } catch (error) {
    console.error("Create offer:", error);

    if (!req.is("application/json")) {
      req.session.error = "Unable to create offer";
      return res.redirect("/admin/offers/add");
    }
    return res.status(500).json({ success: false, message: "Unable to create offer" });
  }
};

export const listOffers = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(req.query.limit) || 10)
    );

    const [offers, total] = await Promise.all([
      Offer.find()
        .populate("product_id", "productName")
        .populate("category_id", "category_name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Offer.countDocuments(),
    ]);

    return res.json({
      success: true,
      offers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("List offers:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load offers",
    });
  }
};

export const deleteOffer = async (req, res) => {
  try {
    const offer = await Offer.findByIdAndDelete(
      req.params.offerId
    );

    if (!offer && !req.is("application/json")) {
      req.session.error = "Offer not found";
      return res.redirect("/admin/offers");
    }

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    if (!req.is("application/json")) {
      req.session.success = "Offer deleted successfully";
      return res.redirect("/admin/offers");
    }

    return res.json({
      success: true,
      message: "Offer deleted successfully",
    });
  } catch (error) {
    if (!req.is("application/json")) {
      req.session.error = "Unable to delete offer";
      return res.redirect("/admin/offers");
    }
    return res.status(500).json({ success: false, message: "Unable to delete offer" });
  }
};

export const showEditOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    if (!mongoose.isValidObjectId(offerId)) {
      req.session.error = "Invalid offer ID";
      return res.redirect("/admin/offers");
    }

    const offer = await Offer.findById(offerId).lean();
    if (!offer) {
      req.session.error = "Offer not found";
      return res.redirect("/admin/offers");
    }

    const [products, categories] = await Promise.all([
      Product.find({ is_listed: true }).select("productName").sort({ productName: 1 }).lean(),
      Category.find({ isListed: true }).select("category_name").sort({ category_name: 1 }).lean(),
    ]);

    const formatDateForInput = (date) => {
      if (!date) return "";
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return "";
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    offer.startDateValue = formatDateForInput(offer.start_date);
    offer.endDateValue = formatDateForInput(offer.end_date);

    return res.render("admin/editOffer", {
      offer,
      products,
      categories,
    });
  } catch (error) {
    console.error("Show edit offer:", error);
    req.session.error = "Unable to load edit offer";
    return res.redirect("/admin/offers");
  }
};

export const updateOffer = async (req, res) => {
  const { offerId } = req.params;
  try {
    if (!mongoose.isValidObjectId(offerId)) {
      if (!req.is("application/json")) {
        req.session.error = "Invalid offer ID";
        return res.redirect("/admin/offers");
      }
      return res.status(400).json({ success: false, message: "Invalid offer ID" });
    }

    const {
      name,
      offer_type,
      product_id,
      category_id,
      discount_type,
      discount_value,
      start_date,
      end_date,
      status,
    } = req.body;

    const fail = (message) => {
      if (!req.is("application/json")) {
        req.session.error = message;
        return res.redirect(`/admin/offers/edit/${offerId}`);
      }
      return res.status(400).json({ success: false, message });
    };

    if (!name?.trim()) {
      return fail("Offer name is required");
    }

    if (
      !["PRODUCT", "CATEGORY", "REFERRAL"].includes(offer_type) ||
      !["PERCENTAGE", "FIXED"].includes(discount_type)
    ) {
      return fail("Invalid offer type");
    }

    const value = Number(discount_value);
    const start = new Date(start_date);
    const end = new Date(end_date);

    if (!Number.isFinite(value) || value <= 0) {
      return fail("Discount must be greater than zero");
    }

    if (
      discount_type === "PERCENTAGE" &&
      value > 100
    ) {
      return fail("Percentage cannot exceed 100");
    }

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return fail("Invalid offer dates");
    }

    if (offer_type === "PRODUCT" && !mongoose.isValidObjectId(product_id)) {
      return fail("Choose a valid product");
    }
    if (offer_type === "CATEGORY" && !mongoose.isValidObjectId(category_id)) {
      return fail("Choose a valid category");
    }

    const target = offer_type === "PRODUCT"
      ? await Product.findById(product_id).select("_id")
      : offer_type === "CATEGORY"
        ? await Category.findById(category_id).select("_id")
        : true;
    if (!target) {
      return fail(offer_type === "PRODUCT" ? "Product not found" : "Category not found");
    }

    const updatedOffer = await Offer.findByIdAndUpdate(
      offerId,
      {
        name: name.trim(),
        offer_type,
        product_id: offer_type === "PRODUCT" ? product_id : null,
        category_id: offer_type === "CATEGORY" ? category_id : null,
        discount_type,
        discount_value: value,
        start_date: start,
        end_date: end,
        is_active: status !== "inactive",
      },
      { new: true, runValidators: true }
    );

    if (!updatedOffer) {
      if (!req.is("application/json")) {
        req.session.error = "Offer not found";
        return res.redirect("/admin/offers");
      }
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    if (!req.is("application/json")) {
      req.session.success = "Offer updated successfully";
      return res.redirect("/admin/offers");
    }

    return res.json({
      success: true,
      message: "Offer updated successfully",
      offer: updatedOffer,
    });
  } catch (error) {
    console.error("Update offer:", error);
    if (!req.is("application/json")) {
      req.session.error = "Unable to update offer";
      return res.redirect(`/admin/offers/edit/${offerId}`);
    }
    return res.status(500).json({ success: false, message: "Unable to update offer" });
  }
};

export const editOffer = updateOffer;

