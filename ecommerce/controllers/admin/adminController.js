import User from "../../models/userSchema.js";
import { verifyPassword } from "../../utils/password.js";
import { generateToken } from "../../utils/token.js";

const loadLogin = async (req, res) => {
  try {
    return res.render("admin/login");
  } catch (error) {
    console.error("Error loading admin login:", error);

    return res.status(500).send("Internal Server Error");
  }
};

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate fields
    if (!email || !password) {
      return res.status(400).render("admin/login", {
        error: "Both fields are required",
      });
    }

    // Find admin
    const admin = await User.findOne({ email, isAdmin: true });

    if (!admin) {
      return res.status(404).render("admin/login", {
        error: "Admin not found",
      });
    }

    // Check password
    const matchPassword = await verifyPassword(password, admin.password);

    if (!matchPassword) {
      return res.status(400).render("admin/login", {
        error: "Incorrect password",
      });
    }

    // Create JWT
    const token = generateToken({
      adminId: admin._id,
      isAdmin: true,
    });

    // Store JWT in cookie
    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Redirect to dashboard
    return res.redirect("/admin");
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).render("admin/login", {
      error: "Something went wrong. Please try again.",
    });
  }
};

const loadAdminDashboard = async (req, res) => {
  try {
    return res.render("admin/dashboard");
  } catch (error) {
    console.error("Error loading admin dashboard:", error);

    return res.status(500).send("Internal Server Error");
  }
};

const logout = async (req, res) => {
  try {
    res.clearCookie("adminToken");

    return res.redirect("/admin/login");
  } catch (error) {
    console.error("Admin logout error:", error);

    return res.status(500).send("Internal Server Error");
  }
};


export default {
  loadLogin,
  adminLogin,
  loadAdminDashboard,
  logout,
};
