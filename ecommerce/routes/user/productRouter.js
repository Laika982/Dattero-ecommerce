import express from "express"
const router = express.Router();


import productContoller from "../../controllers/user/productController.js"


router.get("/",productContoller.loadProducts)

router.get("/:id",productContoller.loadProduct)


export default  router