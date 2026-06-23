const User = require("../../models/userSchema");
require("dotenv").config({ path: require('path').join(__dirname, '..', '..', '.env') });
const bcrypt = require("bcrypt");

const loadHomepage = async (req, res) => {
    try {
        res.render("user/home");
    } catch (error) {
        console.log("load home page error ", error);
    }
}

const loadLoginpage = async (req, res) => {
    try {
        res.render("user/login");
    } catch (error) {
        console.log("login load error", error);
    }
}

const loadsignuppage = async (req, res) => {
    try {
        res.render("user/signup");
    } catch (error) {
        console.log("signup load error", error);
    }
}

const loadProducts = async (req, res) => {
    try {
        res.render("user/product");
    } catch (error) {
        console.log("products load error ", error);
    }
}

const loadProductdetail = async (req, res) => {
    try {
        res.render("user/productDetails");
    } catch (error) {
        console.log("product detail load error ", error);
    }
}

const loadAbout = async (req, res) => {
    try {
        res.render("user/aboutUs");
    } catch (error) {
        console.log("about page load error", error);
    }
}

const loadcontact = async (req, res) => {
    try {
        res.render("user/contact");
    } catch (error) {
        console.log("contact load error", error);
    }
}

const loadcart = async (req, res) => {
    try {
        res.render("user/cart");
    } catch (error) {
        console.log("cart load error", error);
    }
}

const loadorders = async (req, res) => {
    try {
        res.render("user/orders");
    } catch (error) {
        console.log("orders load error", error);
    }
}

module.exports = {
    loadHomepage,
    loadLoginpage,
    loadsignuppage,
    loadProducts,
    loadProductdetail,
    loadAbout,
    loadcontact,
    loadcart,
    loadorders
}