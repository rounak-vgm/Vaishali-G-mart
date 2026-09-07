const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Set up uploads directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' });

// Database Connection
const dbPath = path.join(__dirname, 'store.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database connection error:", err);
    } else {
        console.log("Connected to SQLite Database.");
    }
});

// Create Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        mrp REAL,
        selling_price REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        phone TEXT,
        address TEXT,
        items TEXT,
        total_amount REAL,
        status TEXT DEFAULT 'Pending',
        cancel_reason TEXT
    )`);

    db.run(`ALTER TABLE orders ADD COLUMN cancel_reason TEXT`, (err) => {
        // Safe to ignore if column exists
    });
});

// ================= API ROUTES =================

// 1. Fetch All Products
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. Upload Excel & Sync Products (Flexible Column Matching)
app.post('/api/upload-excel', upload.single('excelFile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'Excel sheet is empty!' });
        }

        let insertedCount = 0;

        db.serialize(() => {
            db.run('DELETE FROM products');
            const stmt = db.prepare('INSERT INTO products (name, mrp, selling_price) VALUES (?, ?, ?)');

            data.forEach(row => {
                const keys = Object.keys(row);
                
                // Flexible Regex matching for Excel Headers
                const nameKey = keys.find(k => /name|item|product|description|particulars|title|goods/i.test(k));
                const mrpKey = keys.find(k => /mrp|m\.r\.p|market|original|list/i.test(k));
                const priceKey = keys.find(k => /selling|sale|rate|price|offer|final|net/i.test(k));

                // Fallback: Agar header detect na ho, to first column ko Name, second ko Price maan lein
                const name = nameKey ? String(row[nameKey]).trim() : (row[keys[0]] ? String(row[keys[0]]).trim() : '');
                const mrp = mrpKey ? parseFloat(row[mrpKey]) || 0 : 0;
                let sellingPrice = priceKey ? parseFloat(row[priceKey]) || 0 : (mrp > 0 ? mrp : (parseFloat(row[keys[1]]) || 0));

                if (name) {
                    stmt.run(name, mrp, sellingPrice);
                    insertedCount++;
                }
            });
            stmt.finalize();
        });

        res.json({ success: true, message: `${insertedCount} Products imported successfully!` });
    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Place New Order
app.post('/api/place-order', (req, res) => {
    const { name, phone, address, items, total } = req.body;
    const itemsJson = JSON.stringify(items || []);

    const stmt = db.prepare("INSERT INTO orders (customer_name, phone, address, items, total_amount) VALUES (?, ?, ?, ?, ?)");
    stmt.run(name, phone, address, itemsJson, total, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, orderId: this.lastID });
    });
    stmt.finalize();
});

// 4. Track Orders by Phone Number
app.get('/api/track-order/:phone', (req, res) => {
    const phone = req.params.phone;
    db.all("SELECT * FROM orders WHERE phone = ? AND status != 'Cancelled' ORDER BY id DESC", [phone], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. Cancel Order
app.post('/api/cancel-order', (req, res) => {
    const { orderId, reason } = req.body;
    if (!orderId) return res.status(400).json({ error: "Order ID missing" });

    const stmt = db.prepare("UPDATE orders SET status = 'Cancelled', cancel_reason = ? WHERE id = ?");
    stmt.run(reason, orderId, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
    stmt.finalize();
});

// 6. Get All Orders for Admin Panel
app.get('/api/admin/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 7. Admin Update Order Status
app.post('/api/admin/update-status', (req, res) => {
    const { orderId, status } = req.body;
    const stmt = db.prepare("UPDATE orders SET status = ? WHERE id = ?");
    stmt.run(status, orderId, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
    stmt.finalize();
});

// ================= FRONTEND SERVE =================

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});