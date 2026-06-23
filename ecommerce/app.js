const express = require('express');
const path = require('path');
require('dotenv').config();
const connectDB = require("./config/db");
connectDB()

const userRouter = require("./routes/userRouter");
const adminRouter = require("./routes/adminRouter")

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
const hbs = require('hbs');
hbs.registerPartials(path.join(__dirname, 'views', 'partials'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Uploads static directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// redirect routes placeholder
app.use("/", userRouter)
app.use("/admin", adminRouter)




// Start server
app.listen(PORT, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
