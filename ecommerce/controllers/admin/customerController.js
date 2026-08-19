import User from "../../models/userSchema.js";
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
                        $options: "i"
                    }
                },
                {
                    email: {
                        $regex: search,
                        $options: "i"
                    }
                }
            ]
        };

        // Get customers
        const userData = await User.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();


        // Format created date
        userData.forEach(user => {

            user.formattedDate = new Date(
                user.createdAt
            ).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });

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
            search
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
      return res.status(404).render("admin/customer/customers", {
        error: "User not found",
      });
    }

    return res.redirect("/admin/customer/customers");
  } catch (error) {
    console.error("Error blocking customer:", error);

    return res.status(500).render("admin/customer/customers", {
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
      return res.status(404).render("admin/customer/customers", {
        error: "User not found",
      });
    }

    return res.redirect("/admin/customer/customers");
  } catch (error) {
    console.error("Error unblocking customer:", error);

    return res.status(500).render("admin/customer/customers", {
      error: "Internal Server Error",
    });
  }
};

export {
  customerInfo,
  customerBlocked,
  customerUnBlocked,
};

export default {
  customerInfo,
  customerBlocked,
  customerUnBlocked,
};
