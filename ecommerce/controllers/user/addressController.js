import User from "../../models/userSchema.js";
import Address from "../../models/addressSchema.js";
import jwt from "jsonwebtoken";

const loadAddress = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userData = await User.findById(decoded.userId).lean();

    if (!userData) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    if (userData.isBlocked) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const address = await Address.find({
      user_id: userData._id,
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    console.log("User ID:", userData._id);
    console.log("Addresses:", address);

    return res.render("user/all-address", {
      address,
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

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userData = await User.findOne({
      _id: decoded.userId,
      isBlocked: false,
    }).lean();

    if (!userData) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    return res.render("user/add-address");
  } catch (error) {
    console.error("Load add address page error:", error);

    res.clearCookie("token");
    return res.redirect("/login");
  }
};

const addAddressPost = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const user = await User.findOne({
      _id: userId,
      isBlocked: false,
    }).lean();

    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

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
      isDefault,
    } = req.body;

    // =========================
    // TRIM VALUES
    // =========================

    fullName = fullName?.trim();
    phone = phone?.trim();
    street = street?.trim();
    suite = suite?.trim() || "";
    city = city?.trim();
    state = state?.trim();
    zip = zip?.trim();
    country = country?.trim();
    addressLabel = addressLabel?.trim() || "Home";

    const defaultAddress = isDefault === "true";

    // Data to send back to HBS if validation fails
    const address = {
      fullName,
      phone,
      street,
      suite,
      city,
      state,
      zip,
      country,
      addressLabel,
      isDefault: defaultAddress,
    };

    // =========================
    // VALIDATION
    // =========================

    // Full Name
    const nameRegex = /^[A-Za-z\s]{3,50}$/;

    if (!nameRegex.test(fullName || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "Full name must contain only letters and spaces.",
      });
    }

    // Phone
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "Phone number must be a valid 10-digit number.",
      });
    }

    // Street
    const streetRegex = /^[A-Za-z0-9\s,.-]{5,150}$/;

    if (!streetRegex.test(street || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "Street address must be between 5 and 150 characters.",
      });
    }

    // Suite - Optional
    const suiteRegex = /^[A-Za-z0-9\s,.-]{0,50}$/;

    if (!suiteRegex.test(suite)) {
      return res.status(400).render("user/add-address", {
        address,
        error: "Suite must not exceed 50 characters.",
      });
    }

    // City
    const cityRegex = /^[A-Za-z\s]{2,50}$/;

    if (!cityRegex.test(city || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "City must contain only letters and spaces.",
      });
    }

    // State
    const stateRegex = /^[A-Za-z\s]{2,50}$/;

    if (!stateRegex.test(state || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "State must contain only letters and spaces.",
      });
    }

    // ZIP
    const zipRegex = /^\d{6}$/;

    if (!zipRegex.test(zip || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "ZIP code must be exactly 6 digits.",
      });
    }

    // Country
    const countryRegex = /^[A-Za-z\s]{2,50}$/;

    if (!countryRegex.test(country || "")) {
      return res.status(400).render("user/add-address", {
        address,
        error: "Country must contain only letters and spaces.",
      });
    }

    // =========================
    // DEFAULT ADDRESS
    // =========================

    if (defaultAddress) {
      await Address.updateMany(
        {
          user_id: userId,
          isDefault: true,
        },
        {
          $set: {
            isDefault: false,
          },
        }
      );
    }

    // =========================
    // CREATE ADDRESS
    // =========================

    await Address.create({
      user_id: userId,
      fullName,
      phone,
      street,
      suite,
      city,
      state,
      zip,
      country,
      addressLabel,
      isDefault: defaultAddress,
    });

    req.session.success = "Address created successfully.";

    return res.redirect("/profile/address");

  } catch (error) {
    console.error("Add address POST error:", error);

    return res.status(500).render("user/add-address", {
      address: req.body,
      error: "Something went wrong. Please try again.",
    });
  }
};

const makePrimary = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { addressId } = req.params;

    const user = await User.findOne({
      _id: userId,
      isBlocked: false,
    });

    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const address = await Address.findOne({
      _id: addressId,
      user_id: userId,
    });

    if (!address) {
      req.session.error = "Address not found.";
      return res.redirect("/profile/address");
    }

    await Address.updateMany(
      {
        user_id: userId,
      },
      {
        $set: {
          isDefault: false,
        },
      },
    );

    await Address.findOneAndUpdate(
      {
        _id: addressId,
        user_id: userId,
      },
      {
        $set: {
          isDefault: true,
        },
      },
    );

    req.session.success = "Primary address updated successfully.";

    return res.redirect("/profile/address");
  } catch (error) {
    console.error("Make address primary error:", error);

    req.session.error = "Unable to update primary address.";

    return res.redirect("/profile/address");
  }
};

const deleteAddress = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { addressId } = req.params;

    // Check user
    const user = await User.findOne({
      _id: userId,
      isBlocked: false,
    });

    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const addressToDelete = await Address.findOne({
      _id: addressId,
      user_id: userId,
    });

    if (!addressToDelete) {
      req.session.error = "Address not found.";
      return res.redirect("/profile/address");
    }

    const wasDefault = addressToDelete.isDefault;

    // Delete address
    await Address.findOneAndDelete({
      _id: addressId,
      user_id: userId,
    });


    if (wasDefault) {
      const nextAddress = await Address.findOne({
        user_id: userId,
      }).sort({ createdAt: -1 });

      if (nextAddress) {
        await Address.findOneAndUpdate(
          {
            _id: nextAddress._id,
            user_id: userId,
          },
          {
            $set: {
              isDefault: true,
            },
          }
        );
      }
    }

    req.session.success = "Address deleted successfully.";

    return res.redirect("/profile/address");

  } catch (error) {
    console.error("Delete address error:", error);

    req.session.error = "Unable to delete address.";

    return res.redirect("/profile/address");
  }
};

const editAddress = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { addressId } = req.params;

    const user = await User.findOne({
      _id: userId,
      isBlocked: false,
    }).lean();

    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const address = await Address.findOne({
      _id: addressId,
      user_id: userId,
    }).lean();

    if (!address) {
      req.session.error = "Address not found.";
      return res.redirect("/profile/address");
    }

    return res.render("user/edit-address", {
      address,
    });

  } catch (error) {
    console.error("Load edit address page error:", error);

    res.clearCookie("token");

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
      isDefault,
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

    const user = await User.findOne({
      _id: userId,
      isBlocked: false,
    });

    if (!user) {
      return res.redirect("/login");
    }


const address = await Address.findOne({
  user_id:userId,
  _id:addressId
})

    if (!address) {
      req.session.error = "Address not found.";
      return res.redirect("/profile/address");
    }

    // Full Name
    const nameRegex = /^[A-Za-z\s]{3,50}$/;

    if (!nameRegex.test(fullName)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Full name must contain only letters and spaces.",
      });
    }

    // Phone
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Phone number must be a valid 10-digit number.",
      });
    }

    // Street
    const streetRegex = /^[A-Za-z0-9\s,.-]{5,150}$/;

    if (!streetRegex.test(street)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Street address must be between 5 and 150 characters.",
      });
    }

    // Suite - Optional
    const suiteRegex = /^[A-Za-z0-9\s,.-]{0,50}$/;

    if (!suiteRegex.test(suite || "")) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Suite must not exceed 50 characters.",
      });
    }

    // City
    const cityRegex = /^[A-Za-z\s]{2,50}$/;

    if (!cityRegex.test(city)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "City must contain only letters and spaces.",
      });
    }

    // State
    const stateRegex = /^[A-Za-z\s]{2,50}$/;

    if (!stateRegex.test(state)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "State must contain only letters and spaces.",
      });
    }

    // ZIP
    const zipRegex = /^\d{6}$/;

    if (!zipRegex.test(zip)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "ZIP code must be exactly 6 digits.",
      });
    }

    // Country
    const countryRegex = /^[A-Za-z\s]{2,50}$/;

    if (!countryRegex.test(country)) {
      return res.status(400).render("user/edit-address", {
        userData: user,
        address: req.body,
        error: "Country must contain only letters and spaces.",
      });
    }


if(defaultAddress){
  await Address.updateMany({
    user_id:userId,
    _id: { $ne: addressId },
    isDefault:true
  },{
    $set:{
      isDefault:false
    }
  })
}



    const updatedAddress = await Address.findOneAndUpdate(
      {
        _id: addressId,
        user_id: userId,
      },
      {
        $set: {
          fullName,
          phone,
          street,
          suite,
          city,
          state,
          zip,
          country,
          addressLabel,
          isDefault: defaultAddress,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedAddress) {
      req.session.error = "Unable to update address.";
      return res.redirect("/profile/address");
    }

req.session.success = "Address Editted Successfully"

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
  editAddressPost,
};
