const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
    secret: 'vaishali_g_mart_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Production (HTTPS) mein true karein
        maxAge: 24 * 60 * 60 * 1000 // 24 Hours
    }
}));

// Serve Static Frontend Files (Ek folder bahar `frontend` directory se)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Database Connection
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
    if (err) {
        console.error("Database connection error:", err.message);
    } else {
        console.log("Connected to SQLite Database.");
    }
});

// Database Initialization (Tables Creation)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        mrp REAL NOT NULL,
        selling_price REAL NOT NULL,
        stock INTEGER NOT NULL,
        image_url TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        total_price REAL NOT NULL,
        items TEXT NOT NULL,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Admin Auth Guard Middleware
function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized access" });
    }
}

// ================= PUBLIC API ROUTES =================

// 1. Get All Products
app.get('/api/products', (req, res) => {
    db.all(`SELECT * FROM products`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. Place Order (Server-Side Price Verification)
app.post('/api/place-order', (req, res) => {
    const { customer_name, phone, address, cart } = req.body;

    if (!customer_name || !phone || !address || !cart || cart.length === 0) {
        return res.status(400).json({ error: "All fields and cart items are required." });
    }

    const productIds = cart.map(item => item.id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT id, selling_price FROM products WHERE id IN (${placeholders})`, productIds, (err, products) => {
        if (err) return res.status(500).json({ error: err.message });

        let calculatedTotal = 0;
        const verifiedItems = [];

        for (const item of cart) {
            const dbProduct = products.find(p => p.id === item.id);
            if (dbProduct) {
                calculatedTotal += dbProduct.selling_price * item.quantity;
                verifiedItems.push({
                    id: dbProduct.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: dbProduct.selling_price
                });
            }
        }

        const itemsJSON = JSON.stringify(verifiedItems);

        db.run(
            `INSERT INTO orders (customer_name, phone, address, total_price, items) VALUES (?, ?, ?, ?, ?)`,
            [customer_name, phone, address, calculatedTotal, itemsJSON],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Order placed successfully!", orderId: this.lastID });
            }
        );
    });
});

// 3. Track Order by Phone
app.get('/api/track-order/:phone', (req, res) => {
    db.all(`SELECT * FROM orders WHERE phone = ? ORDER BY id DESC`, [req.params.phone], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ================= ADMIN AUTH ROUTES =================

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'VaishaliG@2026') {
        req.session.isAdmin = true;
        res.json({ message: "Login successful" });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// Check Admin Authentication Status
app.get('/api/admin/check-auth', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: "Could not log out" });
        res.clearCookie('connect.sid');
        res.json({ message: "Logged out successfully" });
    });
});

// ================= PROTECTED ADMIN APIS =================

// Get All Orders
app.get('/api/admin/orders', checkAdminAuth, (req, res) => {
    db.all(`SELECT * FROM orders ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add New Product
app.post('/api/admin/add-product', checkAdminAuth, (req, res) => {
    const { name, category, mrp, selling_price, stock, image_url } = req.body;
    db.run(
        `INSERT INTO products (name, category, mrp, selling_price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, category, mrp, selling_price, stock, image_url],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Product added successfully!", productId: this.lastID });
        }
    );
});

// Delete Product
app.delete('/api/admin/delete-product/:id', checkAdminAuth, (req, res) => {
    db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Product deleted successfully!" });
    });
});

// Update Order Status
app.post('/api/admin/update-order-status', checkAdminAuth, (req, res) => {
    const { order_id, status } = req.body;
    db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, order_id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Order status updated!" });
    });
});

// ================= FRONTEND CATCH-ALL ROUTING =================
// Express 5 compatible catch-all router
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});