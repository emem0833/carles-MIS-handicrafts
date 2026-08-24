const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 5002;

app.use(cors());
app.use(express.json());

// Database connection
const db = mysql.createPool({
    host: 'carles-handicraft-db-carlesmis.d.aivencloud.com',
    user: 'avnadmin',
    password: 'AVNS_I5p64fuZi6dx3nTUv9G',  // ← Must have your real password
    database: 'defaultdb',
    port: 10346,
    waitForConnections: true,
    connectionLimit: 10,
    ssl: {
        rejectUnauthorized: true
    }
});

const promiseDb = db.promise();

// ============ AUTH MIDDLEWARE ============
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    jwt.verify(token, 'carles-secret-key-2024', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// ============ LOGIN ============
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [users] = await promiseDb.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = users[0];
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username, role: user.role },
            'carles-secret-key-2024',
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ MATERIALS ============
app.get('/api/materials', async (req, res) => {
    try {
        const [materials] = await promiseDb.query('SELECT * FROM materials ORDER BY id');
        for (let material of materials) {
            const [locations] = await promiseDb.query(
                'SELECT * FROM material_locations WHERE material_id = ?',
                [material.id]
            );
            material.locations = locations;
        }
        res.json(materials);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/materials', authenticateToken, async (req, res) => {
    const { name, origin, image_url, sustainability, locations } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Material name is required' });
    }
    
    try {
        const [result] = await promiseDb.query(
            'INSERT INTO materials (name, origin, image_url, sustainability) VALUES (?, ?, ?, ?)',
            [name, origin || null, image_url || null, sustainability || null]
        );
        
        const materialId = result.insertId;
        
        if (locations && locations.length > 0) {
            for (const loc of locations) {
                if (loc.name && loc.lat && loc.lng) {
                    await promiseDb.query(
                        'INSERT INTO material_locations (material_id, location_name, latitude, longitude, address) VALUES (?, ?, ?, ?, ?)',
                        [materialId, loc.name, loc.lat, loc.lng, loc.address || '']
                    );
                }
            }
        }
        
        res.json({ id: materialId, message: 'Material added successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});
app.put('/api/admin/materials/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, origin, image_url, sustainability } = req.body;
    if (!name) return res.status(400).json({ error: 'Material name is required' });
    try {
        await promiseDb.query('UPDATE materials SET name=?, origin=?, image_url=?, sustainability=? WHERE id=?', [name, origin || null, image_url || null, sustainability || null, id]);
        res.json({ message: 'Material updated' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/materials/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await promiseDb.query('DELETE FROM craft_gallery WHERE craft_id IN (SELECT id FROM crafts WHERE material_id = ?)', [id]);
        await promiseDb.query('DELETE FROM crafts WHERE material_id = ?', [id]);
        await promiseDb.query('DELETE FROM material_locations WHERE material_id = ?', [id]);
        await promiseDb.query('DELETE FROM materials WHERE id = ?', [id]);
        res.json({ message: 'Material deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ CRAFTS ============
app.get('/api/crafts', async (req, res) => {
    try {
        const [crafts] = await promiseDb.query(`
            SELECT c.*, m.name as material_name, u.username as creator_name
            FROM crafts c 
            LEFT JOIN materials m ON c.material_id = m.id
            LEFT JOIN users u ON c.user_id = u.id
            ORDER BY c.id DESC
        `);
        for (let craft of crafts) {
            const [gallery] = await promiseDb.query('SELECT image_url FROM craft_gallery WHERE craft_id = ?', [craft.id]);
            craft.gallery_images = gallery.map(g => g.image_url);
        }
        res.json(crafts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/crafts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [crafts] = await promiseDb.query(`
            SELECT c.*, m.name as material_name, u.username as creator_name
            FROM crafts c 
            LEFT JOIN materials m ON c.material_id = m.id
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.id = ?
        `, [id]);
        
        if (crafts.length === 0) return res.status(404).json({ error: 'Craft not found' });
        
        const craft = crafts[0];
        const [gallery] = await promiseDb.query('SELECT * FROM craft_gallery WHERE craft_id = ? ORDER BY display_order', [id]);
        const [reviews] = await promiseDb.query('SELECT * FROM reviews WHERE craft_id = ? ORDER BY created_at DESC', [id]);
        
        craft.gallery = gallery;
        craft.reviews = reviews;
        
        res.json(craft);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/crafts', authenticateToken, async (req, res) => {
    const { title, material_id, seller_name, seller_contact, seller_barangay, main_image, description, cultural_note, gallery_images } = req.body;
    
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    try {
        const [result] = await promiseDb.query(
            'INSERT INTO crafts (title, material_id, user_id, seller_name, seller_contact, seller_barangay, main_image, description, cultural_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [title, material_id || null, req.user.id, seller_name || null, seller_contact || null, seller_barangay || null, main_image || null, description || null, cultural_note || null]
        );
        
        const craftId = result.insertId;
        
        if (gallery_images && gallery_images.length > 0) {
            for (let i = 0; i < gallery_images.length; i++) {
                await promiseDb.query(
                    'INSERT INTO craft_gallery (craft_id, image_url, display_order) VALUES (?, ?, ?)',
                    [craftId, gallery_images[i], i]
                );
            }
        }
        
        res.json({ id: craftId, message: 'Craft added successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});
app.put('/api/admin/crafts/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { title, material_id, seller_name, seller_contact, seller_barangay, main_image, description, cultural_note } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    try {
        await promiseDb.query('UPDATE crafts SET title=?, material_id=?, seller_name=?, seller_contact=?, seller_barangay=?, main_image=?, description=?, cultural_note=? WHERE id=?', [title, material_id || null, seller_name || null, seller_contact || null, seller_barangay || null, main_image || null, description || null, cultural_note || null, id]);
        res.json({ message: 'Craft updated' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/crafts/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await promiseDb.query('DELETE FROM craft_gallery WHERE craft_id = ?', [id]);
        await promiseDb.query('DELETE FROM crafts WHERE id = ?', [id]);
        res.json({ message: 'Craft deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ============ SELLERS ============
app.get('/api/sellers', async (req, res) => {
    try {
        const [sellers] = await promiseDb.query('SELECT * FROM sellers ORDER BY id');
        res.json(sellers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sellers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [sellers] = await promiseDb.query('SELECT * FROM sellers WHERE id = ?', [id]);
        if (sellers.length === 0) return res.status(404).json({ error: 'Seller not found' });
        res.json(sellers[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/sellers', authenticateToken, async (req, res) => {
    const { name, contact_number, barangay, address, crafts_produced, latitude, longitude } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Seller name is required' });
    }
    
    try {
        const [result] = await promiseDb.query(
            'INSERT INTO sellers (name, contact_number, barangay, address, crafts_produced, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, contact_number || null, barangay || null, address || null, crafts_produced || null, latitude || null, longitude || null]
        );
        res.json({ id: result.insertId, message: 'Seller added successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/sellers/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, contact_number, barangay, address, crafts_produced, latitude, longitude } = req.body;
    
    try {
        await promiseDb.query(
            'UPDATE sellers SET name = ?, contact_number = ?, barangay = ?, address = ?, crafts_produced = ?, latitude = ?, longitude = ? WHERE id = ?',
            [name, contact_number, barangay, address, crafts_produced, latitude, longitude, id]
        );
        res.json({ message: 'Seller updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/sellers/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await promiseDb.query('DELETE FROM sellers WHERE id = ?', [id]);
        res.json({ message: 'Seller deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ REVIEWS ============
// ============ REVIEWS ============
app.get('/api/reviews', async (req, res) => {
    try {
        const [reviews] = await promiseDb.query(`
            SELECT r.*, c.title as craft_title 
            FROM reviews r 
            LEFT JOIN crafts c ON r.craft_id = c.id 
            ORDER BY r.created_at DESC
        `);
        const [stats] = await promiseDb.query('SELECT AVG(rating) as avg, COUNT(*) as total FROM reviews');
        res.json({ 
            reviews, 
            stats: { average_rating: stats[0].avg || 0, total_reviews: stats[0].total || 0 } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reviews/:craft_id', async (req, res) => {
    const { craft_id } = req.params;
    try {
        const [reviews] = await promiseDb.query(
            'SELECT * FROM reviews WHERE craft_id = ? ORDER BY created_at DESC',
            [craft_id]
        );
        res.json(reviews);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reviews', async (req, res) => {
    const { craft_id, reviewer_name, rating, comment } = req.body;
    if (!craft_id) {
        return res.status(400).json({ error: 'craft_id is required' });
    }
    try {
        const [result] = await promiseDb.query(
            'INSERT INTO reviews (craft_id, reviewer_name, rating, comment) VALUES (?, ?, ?, ?)',
            [craft_id, reviewer_name, rating, comment]
        );
        res.json({ id: result.insertId, message: 'Review added' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/reviews/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await promiseDb.query('DELETE FROM reviews WHERE id = ?', [id]);
        res.json({ message: 'Review deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/reviews', authenticateToken, async (req, res) => {
    try {
        await promiseDb.query('DELETE FROM reviews');
        res.json({ message: 'All reviews deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ STATS ============
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        const [craftCount] = await promiseDb.query('SELECT COUNT(*) as count FROM crafts');
        const [reviewCount] = await promiseDb.query('SELECT COUNT(*) as count FROM reviews');
        const [avgRating] = await promiseDb.query('SELECT AVG(rating) as avg FROM reviews');
        const [materialCount] = await promiseDb.query('SELECT COUNT(*) as count FROM materials');
        const [sellerCount] = await promiseDb.query('SELECT COUNT(*) as count FROM sellers');
        res.json({
            total_crafts: craftCount[0].count,
            total_reviews: reviewCount[0].count,
            total_materials: materialCount[0].count,
            total_sellers: sellerCount[0].count,
            average_rating: avgRating[0].avg || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TEST ============
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'connected', 
        database: 'carles_handicraft_system', 
        message: 'API is working!', 
        port: PORT 
    });
});

app.listen(PORT, () => {
    console.log(`\n✅ Server running on http://localhost:${PORT}`);
    console.log(`📡 Test API: http://localhost:${PORT}/api/test\n`);
});
// ============ REPORTS ============

// Get all reports (admin only)
app.get('/api/admin/reports', authenticateToken, async (req, res) => {
    try {
        const [reports] = await promiseDb.query(`
            SELECT r.*, c.title as craft_title, 
                   c.main_image as craft_image,
                   c.seller_name as craft_seller
            FROM reports r 
            LEFT JOIN crafts c ON r.craft_id = c.id 
            ORDER BY 
                CASE r.status 
                    WHEN 'pending' THEN 1 
                    WHEN 'reviewed' THEN 2 
                    WHEN 'action_taken' THEN 3 
                    WHEN 'dismissed' THEN 4 
                END,
                r.created_at DESC
        `);
        res.json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get report stats (admin only)
app.get('/api/admin/reports/stats', authenticateToken, async (req, res) => {
    try {
        const [pending] = await promiseDb.query("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'");
        const [reviewed] = await promiseDb.query("SELECT COUNT(*) as count FROM reports WHERE status = 'reviewed'");
        const [dismissed] = await promiseDb.query("SELECT COUNT(*) as count FROM reports WHERE status = 'dismissed'");
        const [actionTaken] = await promiseDb.query("SELECT COUNT(*) as count FROM reports WHERE status = 'action_taken'");
        const [total] = await promiseDb.query("SELECT COUNT(*) as count FROM reports");
        
        res.json({
            pending: pending[0].count,
            reviewed: reviewed[0].count,
            dismissed: dismissed[0].count,
            action_taken: actionTaken[0].count,
            total: total[0].count
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Submit a report (public)
app.post('/api/reports', async (req, res) => {
    const { craft_id, reporter_name, reporter_email, reason, description } = req.body;
    
    if (!craft_id) {
        return res.status(400).json({ error: 'craft_id is required' });
    }
    if (!reason) {
        return res.status(400).json({ error: 'Reason is required' });
    }
    
    try {
        const [crafts] = await promiseDb.query('SELECT id FROM crafts WHERE id = ?', [craft_id]);
        if (crafts.length === 0) {
            return res.status(404).json({ error: 'Craft not found' });
        }
        
        const [result] = await promiseDb.query(
            `INSERT INTO reports (craft_id, reporter_name, reporter_email, reason, description) 
             VALUES (?, ?, ?, ?, ?)`,
            [craft_id, reporter_name || 'Anonymous', reporter_email || null, reason, description || null]
        );
        
        await promiseDb.query(
            'UPDATE crafts SET report_count = report_count + 1 WHERE id = ?',
            [craft_id]
        );
        
        res.json({ 
            id: result.insertId, 
            message: 'Report submitted successfully' 
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update report status (admin only)
app.put('/api/admin/reports/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    
    if (!status) {
        return res.status(400).json({ error: 'Status is required' });
    }
    
    const validStatuses = ['pending', 'reviewed', 'dismissed', 'action_taken'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    
    try {
        await promiseDb.query(
            'UPDATE reports SET status = ?, admin_notes = ? WHERE id = ?',
            [status, admin_notes || null, id]
        );
        res.json({ message: 'Report updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a report (admin only)
app.delete('/api/admin/reports/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const [reports] = await promiseDb.query('SELECT craft_id FROM reports WHERE id = ?', [id]);
        if (reports.length > 0 && reports[0].craft_id) {
            await promiseDb.query(
                'UPDATE crafts SET report_count = GREATEST(report_count - 1, 0) WHERE id = ?',
                [reports[0].craft_id]
            );
        }
        await promiseDb.query('DELETE FROM reports WHERE id = ?', [id]);
        res.json({ message: 'Report deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete all reports (admin only)
app.delete('/api/admin/reports/all', authenticateToken, async (req, res) => {
    try {
        await promiseDb.query('UPDATE crafts SET report_count = 0');
        await promiseDb.query('DELETE FROM reports');
        res.json({ message: 'All reports deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
