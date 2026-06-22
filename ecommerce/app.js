const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Uploads static directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Basic routes placeholder
app.get('/', (req, res) => {
    res.render('user/index', { title: 'Welcome to Dattero E-commerce' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
