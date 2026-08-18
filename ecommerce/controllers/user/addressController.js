const User = require("../../models/userSchema");
const jwt = require("jsonwebtoken");

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

    let { fullName, phone, street, suite, city, state, zip, country, addressLabel, isDefault } = req.body;
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

    if (!fullName || !phone || !street || !city || !state || !zip || !country) {
      const userData = await User.findById(userId).lean();
      return res.status(400).render("user/add-address", {
        userData,
        error: "All required fields must be filled out"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect("/login");
    }

    if (defaultAddress) {
      user.addresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

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
      
      // If we deleted the default address, make the first remaining address default
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const { addressId } = req.params;

    let { fullName, phone, street, suite, city, state, zip, country, addressLabel, isDefault } = req.body;
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

    if (!fullName || !phone || !street || !city || !state || !zip || !country) {
      const user = await User.findById(userId).lean();
      const address = user.addresses?.find(addr => String(addr._id) === String(addressId));
      return res.status(400).render("user/edit-address", {
        userData: user,
        address,
        error: "All required fields must be filled out"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect("/login");
    }

    const addressIndex = user.addresses.findIndex(addr => String(addr._id) === String(addressId));
    if (addressIndex === -1) {
      return res.redirect("/profile/address");
    }

    if (defaultAddress) {
      user.addresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

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

module.exports = {
  loadAddress,
  addAddress,
  addAddressPost,
  makePrimary,
  deleteAddress,
  editAddress,
  editAddressPost
};
