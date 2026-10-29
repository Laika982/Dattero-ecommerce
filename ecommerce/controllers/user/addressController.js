import User from "../../models/userSchema.js";
import Address from "../../models/addressSchema.js";
import jwt from "jsonwebtoken";
import { isAjaxRequest } from "../../utils/isAjax.js";

const sendAddressResponse = (req, res, { isSuccess, message, redirectUrl, statusCode = 200, renderView = null, renderData = {} }) => {
  if (isSuccess) {
    req.session.success = message;
  } else {
    req.session.error = message;
  }

  if (isAjaxRequest(req)) {
    return res.status(statusCode).json({
      success: isSuccess,
      message,
      redirectTo: redirectUrl,
    });
  }

  if (renderView) {
    return res.status(statusCode).render(renderView, {
      ...renderData,
      error: message,
    });
  }

  return res.redirect(redirectUrl);
};

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
      delete req.cookies.token;
      req.session.error = "Your account has been blocked.";
      return res.redirect("/login?blocked=true");
    }

    const address = await Address.find({
      user_id: userData._id,
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

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
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Full name must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // Phone
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Phone number must be a valid 10-digit number.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // Street
    const streetRegex = /^[A-Za-z0-9\s,.-]{5,150}$/;

    if (!streetRegex.test(street || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Street address must be between 5 and 150 characters.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // Suite - Optional
    const suiteRegex = /^[A-Za-z0-9\s,.-]{0,50}$/;

    if (!suiteRegex.test(suite)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Suite must not exceed 50 characters.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // City
    const cityRegex = /^[A-Za-z\s]{2,50}$/;

    if (!cityRegex.test(city || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "City must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // State
    const stateRegex = /^[A-Za-z\s]{2,50}$/;

    if (!stateRegex.test(state || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "State must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // ZIP
    const zipRegex = /^\d{6}$/;

    if (!zipRegex.test(zip || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "ZIP code must be exactly 6 digits.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
      });
    }

    // Country
    const countryRegex = /^[A-Za-z\s]{2,50}$/;

    if (!countryRegex.test(country || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Country must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/add-address",
        renderData: { address },
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

    return sendAddressResponse(req, res, {
      isSuccess: true,
      message: "Address created successfully.",
      redirectUrl: "/profile/address",
      statusCode: 200,
    });
  } catch (error) {
    console.error("Add address POST error:", error);

    return sendAddressResponse(req, res, {
      isSuccess: false,
      message: "Something went wrong. Please try again.",
      statusCode: 500,
      renderView: "user/add-address",
      renderData: { address: req.body },
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
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Address not found.",
        redirectUrl: "/profile/address",
        statusCode: 404,
      });
    }

    await Address.updateMany(
      {
        user_id: userId,
      },
      {
        $set: {
          isDefault: false,
        },
      }
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
      }
    );

    return sendAddressResponse(req, res, {
      isSuccess: true,
      message: "Primary address updated successfully.",
      redirectUrl: "/profile/address",
      statusCode: 200,
    });
  } catch (error) {
    console.error("Make address primary error:", error);

    return sendAddressResponse(req, res, {
      isSuccess: false,
      message: "Unable to update primary address.",
      redirectUrl: "/profile/address",
      statusCode: 500,
    });
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
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Address not found.",
        redirectUrl: "/profile/address",
        statusCode: 404,
      });
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

    return sendAddressResponse(req, res, {
      isSuccess: true,
      message: "Address deleted successfully.",
      redirectUrl: "/profile/address",
      statusCode: 200,
    });
  } catch (error) {
    console.error("Delete address error:", error);

    return sendAddressResponse(req, res, {
      isSuccess: false,
      message: "Unable to delete address.",
      redirectUrl: "/profile/address",
      statusCode: 500,
    });
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
      user_id: userId,
      _id: addressId,
    });

    if (!address) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Address not found.",
        redirectUrl: "/profile/address",
        statusCode: 404,
      });
    }

    const addressData = {
      ...req.body,
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
      isDefault: defaultAddress,
    };

    // Full Name
    const nameRegex = /^[A-Za-z\s]{3,50}$/;

    if (!nameRegex.test(fullName)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Full name must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // Phone
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Phone number must be a valid 10-digit number.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // Street
    const streetRegex = /^[A-Za-z0-9\s,.-]{5,150}$/;

    if (!streetRegex.test(street)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Street address must be between 5 and 150 characters.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // Suite - Optional
    const suiteRegex = /^[A-Za-z0-9\s,.-]{0,50}$/;

    if (!suiteRegex.test(suite || "")) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Suite must not exceed 50 characters.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // City
    const cityRegex = /^[A-Za-z\s]{2,50}$/;

    if (!cityRegex.test(city)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "City must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // State
    const stateRegex = /^[A-Za-z\s]{2,50}$/;

    if (!stateRegex.test(state)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "State must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // ZIP
    const zipRegex = /^\d{6}$/;

    if (!zipRegex.test(zip)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "ZIP code must be exactly 6 digits.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    // Country
    const countryRegex = /^[A-Za-z\s]{2,50}$/;

    if (!countryRegex.test(country)) {
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Country must contain only letters and spaces.",
        statusCode: 400,
        renderView: "user/edit-address",
        renderData: { userData: user, address: addressData },
      });
    }

    if (defaultAddress) {
      await Address.updateMany(
        {
          user_id: userId,
          _id: { $ne: addressId },
          isDefault: true,
        },
        {
          $set: {
            isDefault: false,
          },
        }
      );
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
      return sendAddressResponse(req, res, {
        isSuccess: false,
        message: "Unable to update address.",
        redirectUrl: "/profile/address",
        statusCode: 500,
      });
    }

    return sendAddressResponse(req, res, {
      isSuccess: true,
      message: "Address Editted Successfully",
      redirectUrl: "/profile/address",
      statusCode: 200,
    });
  } catch (error) {
    console.error("Edit address POST error:", error);

    return sendAddressResponse(req, res, {
      isSuccess: false,
      message: "Unable to update address.",
      redirectUrl: "/profile/address",
      statusCode: 500,
    });
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
