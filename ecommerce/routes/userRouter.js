const express = require("express");
const router = express.Router()
const userContoller = require("../controllers/user/userContoller")


// Load HomePage
router.get("/", userContoller.loadHomepage);
// Load Login page
router.get("/login",userContoller.loadLoginpage)
// Load SignUp page
router.get("/signup",userContoller.loadsignuppage)
//Load Products
router.get("/products",userContoller.loadProducts)
//Load product detail
router.get("/productdetail",userContoller.loadProductdetail)
//Load About us
router.get("/about",userContoller.loadAbout)
//Load contact
router.get("/contact",userContoller.loadcontact)
//Load cart
router.get("/cart",userContoller.loadcart)
//Load orders
router.get("/orders",userContoller.loadorders)



module.exports = router