const User = require("../../models/userSchema");
const { options } = require("../../routes/adminRouter");

const customerInfo = async (req, res) => {
  try {
    let search = req.query.search || "";

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

    const userData = await User.find(query)
      .limit(limit)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await User.countDocuments({isAdmin:false});

    const totalPages = Math.ceil(count / limit);

    const pages = [];

    for (let i = 1; i <= totalPages; i++) {
      pages.push({
        page: i,
        active: i === page,
      });
    }

    return res.render("admin/customers", {
      data: userData,
      totalPages: totalPages,
      currentPage: page,
      pages: pages,
      count: count,
      search: search,
    });
  } catch (error) {
    console.error("Error loading customers:", error);

    return res.status(500).send("Internal Server Error");
  }
};

const customerBlocked = async (req, res) => {
  try {
    const id = req.query.id;

    const user = await User.findByIdAndUpdate(id, { isBlocked: true });

    if (!user) {
      return res.status(404).render("admin/customers", {
        error: "User not found",
      });
    }

    return res.redirect("/admin/customers");
  } catch (error) {
    console.error("Error blocking customer:", error);

    return res.status(500).render("admin/customers", {
      error: "Internal Server Error",
    });
  }
};

const customerUnBlocked = async (req, res) => {
  try {
    const id = req.query.id;

    const user = await User.findByIdAndUpdate(
      id,
      { isBlocked: false },
      { new: true },
    );

    if (!user) {
      return res.status(404).render("admin/customers", {
        error: "User not found",
      });
    }

    return res.redirect("/admin/customers");
  } catch (error) {
    console.error("Error unblocking customer:", error);

    return res.status(500).render("admin/customers", {
      error: "Internal Server Error",
    });
  }
};

module.exports = {
  customerInfo,
  customerBlocked,
  customerUnBlocked,
};
