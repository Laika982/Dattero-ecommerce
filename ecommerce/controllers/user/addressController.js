import User from "../../models/userSchema.js";
import jwt from "jsonwebtoken";

const loadAddress = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    return res.render("user/all-address", {
      userData
    });
  } catch (error) {
    console.error("Load saved addresses error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const addAddress = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      return res.redirect("/login");
    }

    return res.render("user/add-address", {
      userData
    });
  } catch (error) {
    console.error("Load add address page error:", error);
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const addAddressPost = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    let {
      fullName,
      phone,
      street,
      suite,
      city,
      state,
      zip,
      country,
      addressLabel,
      isDefault
    } = req.body;

    fullName = fullName?.trim();
    phone = phone?.trim();
    street = street?.trim();
    suite = suite?.trim();
    city = city?.trim();
    state = state?.trim();
    zip = zip?.trim();
    country = country?.trim();
    addressLabel = addressLabel?.trim() || "Home";

    const defaultAddress = isDefault === "true";

    // =========================
    // VALIDATION
    // =========================

    // Full Name
    const nameRegex = /^[A-Za-z\s]{3,50}$/;

    if (!nameRegex.test(fullName)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "Full name must contain only letters and spaces."
      });
    }

    // Phone
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "Phone number must be a valid 10-digit number."
      });
    }

    // Street
    const streetRegex = /^[A-Za-z0-9\s,.-]{5,150}$/;

    if (!streetRegex.test(street)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "Street address must be between 5 and 150 characters."
      });
    }

    // Suite - optional
    const suiteRegex = /^[A-Za-z0-9\s,.-]{0,50}$/;

    if (!suiteRegex.test(suite || "")) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "Suite must not exceed 50 characters."
      });
    }

    // City
    const cityRegex = /^[A-Za-z\s]{2,50}$/;

    if (!cityRegex.test(city)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "City must contain only letters and spaces."
      });
    }

    // State
    const stateRegex = /^[A-Za-z\s]{2,50}$/;

    if (!stateRegex.test(state)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "State must contain only letters and spaces."
      });
    }

    // ZIP
    const zipRegex = /^\d{6}$/;

    if (!zipRegex.test(zip)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "ZIP code must be exactly 6 digits."
      });
    }

    // Country
    const countryRegex = /^[A-Za-z\s]{2,50}$/;

    if (!countryRegex.test(country)) {
      const userData = await User.findById(userId).lean();

      return res.status(400).render("user/add-address", {
        userData,
        error: "Country must contain only letters and spaces."
      });
    }

    // =========================
    // FIND USER
    // =========================

    const user = await User.findById(userId);

    if (!user) {
      return res.redirect("/login");
    }

    // =========================
    // DEFAULT ADDRESS
    // =========================

    if (defaultAddress) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    // =========================
    // ADD ADDRESS
    // =========================

    user.addresses.push({
      fullName,
      phone,
      street,
      suite,
      city,
      state,
      zip,
      country,
      addressLabel,
      isDefault: defaultAddress
    });

    await user.save();

    return res.redirect("/profile/address");

  } catch (error) {
    console.error("Add address POST error:", error);
    return res.redirect("/profile/address");
  }
};

const makePrimary = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const { addressId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect("/login");
    }

    user.addresses.forEach(addr => {
      if (String(addr._id) === String(addressId)) {
        addr.isDefault = true;
      } else {
        addr.isDefault = false;
      }
    });

    await user.save();

    return res.redirect("/profile/address");
  } catch (error) {
    console.error("Make address primary error:", error);
    return res.redirect("/profile/address");
  }
};

const deleteAddress = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const { addressId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect("/login");
    }

    const addressIndex = user.addresses.findIndex(addr => String(addr._id) === String(addressId));
    if (addressIndex !== -1) {
      const wasDefault = user.addresses[addressIndex].isDefault;
      user.addresses.splice(addressIndex, 1);
      

      if (wasDefault && user.addresses.length > 0) {
        user.addresses[0].isDefault = true;
      }
      
      await user.save();
    }

    return res.redirect("/profile/address");
  } catch (error) {
    console.error("Delete address error:", error);
    return res.redirect("/profile/address");
  }
};

const editAddress = async (req, res) => {
  try {
    const token = req.cookies.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const { addressId } = req.params;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.redirect("/login");
    }

    const address = user.addresses?.find(addr => String(addr._id) === String(addressId));
    if (!address) {
      return res.redirect("/profile/address");
    }

    return res.render("user/edit-address", {
      userData: user,
      address
    });
  } catch (error) {
    console.error("Load edit address page error:", error);
    return res.redirect("/profile/address");
  }
};

const editAddressPost = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { addressId } = req.params;

    let {
      fullName,
      phone,
      street,
      suite,
      city,
      state,
      zip,
      country,
      addressLabel,
      isDefault
    } = req.body;

    // Trim values
    fullName = fullName?.trim();
    phone = phone?.trim();
    street = street?.trim();
    suite = suite?.trim();
    city = city?.trim();
    state = state?.trim();
    zip = zip?.trim();
    country = country?.trim();
    addressLabel = addressLabel?.trim() || "Home";

    const defaultAddress = isDefault === "true";

    // =========================
    // FIND USER
    // =========================

    const user = await User.findById(userId);

    if (!user) {
      return res.redirect("/login");
    }

    // =========================
    // FIND ADDRESS
    // =========================

    const addressIndex = user.addresses.findIndex(
      (addr) => String(addr._id) === String(addressId)
    );

    if (addressIndex === -1) {
      return res.redirect("/profile/address");
    }

    // =========================
    // VALIDATION
    // =========================

    // Full Name
    const nameRegex = /^[A-Za-z\s]{3,50}$/;

    if (!nameRegex.test(fullName)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Full name must contain only letters and spaces."
      });
    }

    // Phone
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Phone number must be a valid 10-digit number."
      });
    }

    // Street
    const streetRegex = /^[A-Za-z0-9\s,.-]{5,150}$/;

    if (!streetRegex.test(street)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Street address must be between 5 and 150 characters."
      });
    }

    // Suite - Optional
    const suiteRegex = /^[A-Za-z0-9\s,.-]{0,50}$/;

    if (!suiteRegex.test(suite || "")) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Suite must not exceed 50 characters."
      });
    }

    // City
    const cityRegex = /^[A-Za-z\s]{2,50}$/;

    if (!cityRegex.test(city)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "City must contain only letters and spaces."
      });
    }

    // State
    const stateRegex = /^[A-Za-z\s]{2,50}$/;

    if (!stateRegex.test(state)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "State must contain only letters and spaces."
      });
    }

    // ZIP
    const zipRegex = /^\d{6}$/;

    if (!zipRegex.test(zip)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "ZIP code must be exactly 6 digits."
      });
    }

    // Country
    const countryRegex = /^[A-Za-z\s]{2,50}$/;

    if (!countryRegex.test(country)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Country must contain only letters and spaces."
      });
    }

    // =========================
    // DEFAULT ADDRESS
    // =========================

    if (defaultAddress) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    // =========================
    // UPDATE ADDRESS
    // =========================

    user.addresses[addressIndex] = {
      _id: addressId,
      fullName,
      phone,
      street,
      suite,
      city,
      state,
      zip,
      country,
      addressLabel,
      isDefault: defaultAddress
    };

    await user.save();

    return res.redirect("/profile/address");

  } catch (error) {
    console.error("Edit address POST error:", error);

    return res.redirect("/profile/address");
  }
};


export default {
  loadAddress,
  addAddress,
  addAddressPost,
  makePrimary,
  deleteAddress,
  editAddress,
  editAddressPost
};
