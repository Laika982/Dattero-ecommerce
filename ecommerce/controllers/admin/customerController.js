import mongoose from "mongoose";
import User from "../../models/userSchema.js";
import Address from "../../models/addressSchema.js";
import Order from "../../models/orderSchema.js";
import Wallet from "../../models/walletSchema.js";
import { generateActivePageArray } from "../../utils/pagination.js";
// import { options } from "../../routes/adminRouter.js";

const customerInfo = async (req, res) => {
  try {
    const search = req.query.search || "";

    const page = parseInt(req.query.page) || 1;
    const limit = 5;

    const query = {
      isAdmin: false,
      $or: [
        {
          name: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
      ],
    };

    // Get customers
    const userData = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Format created date
    userData.forEach((user) => {
      user.formattedDate = new Date(user.createdAt).toLocaleDateString(
        "en-US",
        {
          month: "short",
          day: "numeric",
          year: "numeric",
        },
      );
    });

    // Count customers matching the search
    const count = await User.countDocuments(query);

    // Calculate total pages
    const totalPages = Math.ceil(count / limit);

    // Create page numbers
    const pages = generateActivePageArray(totalPages, page);

    return res.render("admin/customers", {
      data: userData,
      totalPages,
      currentPage: page,
      pages,
      count,
      search,
    });
  } catch (error) {
    console.error("Error loading customers:", error);

    return res.status(500).send("Internal Server Error");
  }
};
const customerBlocked = async (req, res) => {
  try {
    const id = req.query.id;

    if (!mongoose.isValidObjectId(id)) {
      req.session.error = "Invalid customer ID";
      return res.redirect("/admin/customer/customers");
    }

    const targetUser = await User.findById(id);

    if (!targetUser) {
      req.session.error = "User not found";
      return res.redirect("/admin/customer/customers");
    }

    if (targetUser.isAdmin) {
      req.session.error = "Cannot block an administrator account";
      return res.redirect("/admin/customer/customers");
    }

    targetUser.isBlocked = true;
    await targetUser.save();

    req.session.success = `Customer ${targetUser.name} Blocked Successfully`;

    return res.redirect("/admin/customer/customers");
  } catch (error) {
    console.error("Error blocking customer:", error);

    req.session.error = "Unable to block customer";
    return res.redirect("/admin/customer/customers");
  }
};

const customerUnBlocked = async (req, res) => {
  try {
    const id = req.query.id;

    if (!mongoose.isValidObjectId(id)) {
      req.session.error = "Invalid customer ID";
      return res.redirect("/admin/customer/customers");
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isBlocked: false },
      { new: true },
    );

    if (!user) {
      req.session.error = "User not found";
      return res.redirect("/admin/customer/customers");
    }

    req.session.success = `Customer ${user.name} Unblocked Successfully`;

    return res.redirect("/admin/customer/customers");
  } catch (error) {
    console.error("Error unblocking customer:", error);

    req.session.error = "Unable to unblock customer";
    return res.redirect("/admin/customer/customers");
  }
};

const loadEditCustomer = async (req, res) => {
  try {
    const customerId = req.params.id;

    if (!mongoose.isValidObjectId(customerId)) {
      req.session.error = "Invalid customer ID";
      return res.redirect("/admin/customer/customers");
    }

    const customer = await User.findById(customerId).lean();
    if (!customer) {
      req.session.error = "Customer not found";
      return res.redirect("/admin/customer/customers");
    }
    // Format registration date
    customer.formattedDate = customer.createdAt
      ? new Date(customer.createdAt).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "";

    // 1. Fetch user addresses
    const addresses = await Address.find({ user_id: customerId })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    // 2. Fetch user wallet balance
    const wallet = await Wallet.findOne({ user_id: customerId }).lean();
    const rawWalletBalance = Number(wallet?.balance || 0);

    // 3. Fetch user orders
    const rawOrders = await Order.find({ user_id: customerId })
      .sort({ createdAt: -1 })
      .lean();

    const totalOrders = rawOrders.length;

    // Calculate total spend on non-cancelled orders
    const totalSpent = rawOrders
      .filter((o) => o.order_status !== "cancelled")
      .reduce((sum, o) => sum + (Number(o.final_amount) || 0), 0);

    const deliveredOrders = rawOrders.filter(
      (o) => o.order_status === "delivered"
    ).length;
    const fulfillmentRate =
      totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 100;
    const avgOrderValue =
      totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;

    const formattedOrders = rawOrders.map((order) => {
      const itemsCount = (order.items || []).reduce(
        (sum, item) => sum + (Number(item.quantity) || 0),
        0
      );

      const productNames = (order.items || [])
        .map((item) => `${item.product_name} x ${item.quantity}`)
        .join(", ");

      const shortProducts =
        order.items && order.items.length > 0
          ? `${order.items[0].product_name} x ${order.items[0].quantity}${
              order.items.length > 1 ? ` + ${order.items.length - 1} more` : ""
            }`
          : "N/A";

      const formattedDate = order.createdAt
        ? new Date(order.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "N/A";

      let statusColor = "bg-surface-container-high text-brand-gold";
      if (order.order_status === "delivered") {
        statusColor = "bg-green-100 text-green-700";
      } else if (order.order_status === "cancelled") {
        statusColor = "bg-red-100 text-red-700";
      } else if (order.order_status === "shipped") {
        statusColor = "bg-blue-100 text-blue-700";
      } else if (order.order_status === "out_for_delivery") {
        statusColor = "bg-amber-100 text-amber-700";
      }

      return {
        ...order,
        orderId: order.order_id,
        formattedDate,
        itemsCount,
        productNames,
        shortProducts,
        statusColor,
        finalAmount: Number(order.final_amount || 0).toLocaleString("en-IN"),
        rawFinalAmount: Number(order.final_amount || 0),
        paymentMethod: (order.payment_method || "COD").toUpperCase(),
        statusLabel:
          order.order_status.charAt(0).toUpperCase() +
          order.order_status.slice(1).replace(/_/g, " "),
      };
    });

    const recentOrders = formattedOrders.slice(0, 5);

    return res.render("admin/edit-customer", {
      customer: {
        ...customer,
        addresses,
      },
      addresses,
      walletBalance: rawWalletBalance.toLocaleString("en-IN"),
      rawWalletBalance,
      totalOrders,
      totalSpent: totalSpent.toLocaleString("en-IN"),
      rawTotalSpent: totalSpent,
      fulfillmentRate,
      avgOrderValue: avgOrderValue.toLocaleString("en-IN"),
      recentOrders,
      allOrders: formattedOrders,
    });
  } catch (error) {
    console.error("Error loading edit customer:", error);

    req.session.error = "Unable to load customer";
    return res.redirect("/admin/customer/customers");
  }
};

const editCustomer = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!mongoose.isValidObjectId(userId)) {
      req.session.error = "Invalid customer ID";
      return res.redirect("/admin/customer/customers");
    }

    const { name, email, phone, removePhoto } = req.body;

    const image = req.file;

    const fullname = name?.trim();
    const editEmail = email?.trim();
    const editPhone = phone?.trim();

    const user = await User.findById(userId);

    if (!user) {
      if (req.cleanupUploadedFiles) await req.cleanupUploadedFiles();
      req.session.error = "User not found";
      return res.redirect("/admin/customer/customers");
    }

    const updateData = {
      name: fullname,
      email: editEmail,
      phone: editPhone,
    };

    // ==============================
    // REMOVE PHOTO
    // ==============================
    if (removePhoto === "true") {
      updateData.profileImage = null;
    }

    // ==============================
    // CHANGE PHOTO
    // ==============================
    else if (image) {
      updateData.profileImage = image.path;
    }


    await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    });

    req.session.success = `User ${user.name} Edited Successfull`

    res.redirect("/admin/customer/customers");
  } catch (error) {
    if (req.cleanupUploadedFiles) await req.cleanupUploadedFiles();
    console.error("Error editing customer:", error);

    return res.status(500).render("admin/edit-customer", {
      error: "Internal Server Error",
    });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const customerId = req.params.id;

    if (!mongoose.isValidObjectId(customerId)) {
      if (req.xhr || req.headers["accept"]?.includes("application/json")) {
        return res.status(400).json({ success: false, message: "Invalid customer ID" });
      }
      req.session.error = "Invalid customer ID";
      return res.redirect("/admin/customer/customers");
    }

    const customer = await User.findById(customerId);
    if (!customer) {
      if (req.xhr || req.headers["accept"]?.includes("application/json")) {
        return res.status(404).json({ success: false, message: "Customer not found" });
      }
      req.session.error = "Customer not found";
      return res.redirect("/admin/customer/customers");
    }

    const customerName = customer.name || customer.username || "Customer";

    await User.findByIdAndDelete(customerId);
    await Address.deleteMany({ user_id: customerId });
    await Wallet.deleteOne({ user_id: customerId });

    if (req.xhr || req.headers["accept"]?.includes("application/json")) {
      return res.status(200).json({
        success: true,
        message: `Account for ${customerName} has been permanently deleted`,
        redirectUrl: "/admin/customer/customers",
      });
    }

    req.session.success = `Account for ${customerName} has been permanently deleted`;
    return res.redirect("/admin/customer/customers");
  } catch (error) {
    console.error("Error deleting customer:", error);
    if (req.xhr || req.headers["accept"]?.includes("application/json")) {
      return res.status(500).json({ success: false, message: "Failed to delete customer" });
    }
    req.session.error = "Failed to delete customer";
    return res.redirect("/admin/customer/customers");
  }
};

export default {
  customerInfo,
  customerBlocked,
  customerUnBlocked,
  loadEditCustomer,
  editCustomer,
  deleteCustomer,
};
