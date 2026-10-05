import Address from "../../models/addressSchema.js";

const loadCheckout = async (req, res) => {
  try {
    const userId = req.user._id;

    const addresses = await Address.find({ user_id: userId })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    const selectedAddress =
      addresses.find((addr) => addr.isDefault) || addresses[0] || null;

    res.render("user/checkout", {
      addresses,
      selectedAddress,
    });
  } catch (error) {
    console.error("Load checkout error:", error);
    res.status(500).render("user/checkout", {
      addresses: [],
      selectedAddress: null,
      error: "Failed to load checkout details",
    });
  }
};

const getUserAddresses = async (req, res) => {
  try {
    const userId = req.user._id;
    const addresses = await Address.find({ user_id: userId })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      addresses,
    });
  } catch (error) {
    console.error("Get addresses error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch addresses",
    });
  }
};

export default {
  loadCheckout,
  getUserAddresses,
};

