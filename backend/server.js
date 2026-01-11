const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Library untuk enkripsi password
const app = express();

require('dotenv').config()

app.use(express.json());
app.use(cors());

// 1. DATA LAYER (SQLite)
const db = new sqlite3.Database('./perpustakaan.db', (err) => {
    if (err) console.error("Koneksi gagal:", err.message);
    else console.log("Terhubung ke database perpustakaan.db");
});

// Inisialisasi semua tabel
db.serialize(() => {
    // Tabel Buku
    db.run(`CREATE TABLE IF NOT EXISTS buku (id INTEGER PRIMARY KEY AUTOINCREMENT, judul TEXT, stok INTEGER)`);
    
    // Tabel Anggota
    db.run(`CREATE TABLE IF NOT EXISTS anggota (id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT, alamat TEXT, telepon TEXT)`);
    
    // Tabel Petugas (Login/Register)
    db.run(`CREATE TABLE IF NOT EXISTS petugas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password TEXT
    )`);

    // Tabel Peminjaman
    db.run(`CREATE TABLE IF NOT EXISTS peminjaman (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        id_buku INTEGER, 
        id_anggota INTEGER, 
        tanggal_pinjam TEXT, 
        status TEXT DEFAULT 'Dipinjam',
        FOREIGN KEY(id_buku) REFERENCES buku(id),
        FOREIGN KEY(id_anggota) REFERENCES anggota(id)
    )`);

    // Tambahkan ini di dalam db.serialize()
    db.run(`CREATE TABLE IF NOT EXISTS anggota_login (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        api_key TEXT,
        id_anggota INTEGER,
        FOREIGN KEY(id_anggota) REFERENCES anggota(id)
    )`);
});

// 2. AUTH MIDDLEWARE (API Key)
// Update Middleware agar lebih fleksibel
const authenticate = (req, res, next) => {
    const clientKey = req.headers['x-api-key'];
    const masterKey = process.env.API_KEY || 'rahasia123';

    // 1. Cek jika menggunakan Master Key (Petugas)
    if (clientKey === masterKey) return next();

    // 2. Cek jika menggunakan User API Key (Anggota) dari database
    db.get("SELECT * FROM anggota_login WHERE api_key = ?", [clientKey], (err, row) => {
        if (!err && row) {
            return next();
        }
        res.status(401).json({ message: "Invalid API Key" });
    });
};

// 3. APPLICATION LAYER (Logic & CRUD)

// --- AUTHENTICATION (Login & Register) ---

app.post('/api/register', authenticate, (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if (!username || !password) return res.status(400).json({ message: "Data tidak lengkap" });

    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO petugas (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
        if (err) return res.status(400).json({ message: "Username sudah digunakan!" });
        res.status(201).json({ message: "Registrasi Berhasil" });
    });
});

app.post('/api/login', authenticate, (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM petugas WHERE username = ?", [username], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ message: "Username atau Password salah" });
        }
        res.json({ message: "Login Berhasil", user: { username: user.username } });
    });
});

// --- MANAJEMEN BUKU ---
app.get('/api/buku', authenticate, (req, res) => {
    db.all("SELECT * FROM buku ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/buku', authenticate, (req, res) => {
    const { judul, stok } = req.body;
    db.run("INSERT INTO buku (judul, stok) VALUES (?, ?)", [judul, stok], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, message: "Buku berhasil disimpan" });
    });
});

// --- MANAJEMEN ANGGOTA ---
app.get('/api/anggota', authenticate, (req, res) => {
    db.all("SELECT * FROM anggota ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/anggota', authenticate, (req, res) => {
    const { nama, alamat, telepon } = req.body;
    if (!nama || !telepon) return res.status(400).json({ message: "Nama dan Telepon wajib diisi!" });

    db.run("INSERT INTO anggota (nama, alamat, telepon) VALUES (?, ?, ?)", [nama, alamat, telepon], function(err) {
        if (err) return res.status(500).json({ error: "Gagal menyimpan ke database" });
        res.status(201).json({ id: this.lastID, message: "Anggota berhasil disimpan" });
    });
});

// --- PEMINJAMAN ---
app.post('/api/peminjaman', authenticate, (req, res) => {
    const { id_buku, id_anggota, tanggal_pinjam } = req.body;
    db.get("SELECT stok FROM buku WHERE id = ?", [id_buku], (err, row) => {
        if (row && row.stok > 0) {
            db.serialize(() => {
                db.run("INSERT INTO peminjaman (id_buku, id_anggota, tanggal_pinjam) VALUES (?, ?, ?)", [id_buku, id_anggota, tanggal_pinjam]);
                db.run("UPDATE buku SET stok = stok - 1 WHERE id = ?", [id_buku]);
                res.status(201).json({ message: "Peminjaman Berhasil" });
            });
        } else {
            res.status(400).json({ message: "Stok buku habis!" });
        }
    });
});

app.get('/api/peminjaman', authenticate, (req, res) => {
    const sql = `SELECT p.id, b.judul as judul_buku, a.nama as nama_anggota, p.tanggal_pinjam, p.status 
                 FROM peminjaman p 
                 JOIN buku b ON p.id_buku = b.id 
                 JOIN anggota a ON p.id_anggota = a.id`;
    db.all(sql, [], (err, rows) => res.json(rows));
});

// --- PENGEMBALIAN ---
app.post('/api/pengembalian', authenticate, (req, res) => {
    const { id_peminjaman } = req.body;
    db.get("SELECT id_buku FROM peminjaman WHERE id = ?", [id_peminjaman], (err, row) => {
        if (row) {
            db.serialize(() => {
                db.run("UPDATE peminjaman SET status = 'Dikembalikan' WHERE id = ?", [id_peminjaman]);
                db.run("UPDATE buku SET stok = stok + 1 WHERE id = ?", [row.id_buku]);
                res.json({ message: "Buku Berhasil Dikembalikan" });
            });
        }
    });
});


// --- REGISTER ANGGOTA BARU ---
app.post('/api/register-user',authenticate, (req, res) => {
    // Ambil data dari req.body (Pastikan nama variabel sesuai dengan payload HTML)
    const { nama, telepon, username, password, alamat } = req.body;

    // Validasi data minimal
    if (!nama || !username || !password) {
        return res.status(400).json({ message: "Nama, Username, dan Password wajib diisi!" });
    }

    db.serialize(() => {
        // 1. Simpan profil ke tabel 'anggota'
        // Gunakan alamat || "" agar tidak error jika alamat kosong di form
        db.run("INSERT INTO anggota (nama, alamat, telepon) VALUES (?, ?, ?)", [nama, alamat || "", telepon], function(err) {
            if (err) return res.status(500).json({ message: "Gagal menyimpan data anggota" });

            const idAnggota = this.lastID;
            const hashedPassword = bcrypt.hashSync(password, 10);
            const userApiKey = 'user-' + Math.random().toString(36).substr(2, 9).toUpperCase();

            // 2. Simpan kredensial ke tabel 'anggota_login'
            db.run("INSERT INTO anggota_login (username, password, api_key, id_anggota) VALUES (?, ?, ?, ?)", 
            [username, hashedPassword, userApiKey, idAnggota], function(err) {
                if (err) return res.status(400).json({ message: "Username sudah digunakan!" });
                
                res.status(201).json({ 
                    message: "Registrasi Berhasil", 
                    apiKey: userApiKey 
                });
            });
        });
    });
});


// --- TAMBAHKAN ENDPOINT loginUser ---
app.post('/api/login-user', authenticate, (req, res) => {
    const { username, password, newApiKey } = req.body;

    db.get("SELECT * FROM anggota_login WHERE username = ?", [username], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ message: "Username tidak ditemukan" });
        }

        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Password salah!" });

        // Gunakan key dari frontend jika ada, jika tidak buat baru
        const finalKey = newApiKey || 'user-' + Math.random().toString(36).substr(2, 9).toUpperCase();

        // Simpan key ke database
        db.run("UPDATE anggota_login SET api_key = ? WHERE username = ?", [finalKey, username], (updateErr) => {
            if (updateErr) return res.status(500).json({ message: "Gagal menyimpan API Key" });

            res.json({ 
                message: "Login Berhasil", 
                username: user.username,
                apiKey: finalKey 
            });
        });
    });
});

// Endpoint untuk mengambil data peminjaman milik user tertentu
// Endpoint untuk mengambil data peminjaman milik user tertentu
// Endpoint untuk mengambil data peminjaman milik user tertentu
// Endpoint untuk mengambil data peminjaman milik user tertentu
app.get('/api/dashboardUser', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const username = req.headers['user-session']; // ini sebenarnya nama lengkap dari frontend

    if (!apiKey || !username) {
        return res.status(401).json({ message: "Header x-api-key dan user-session wajib diisi!" });
    }

    // Cari id_anggota berdasarkan NAMA (karena frontend kirim nama lengkap sebagai 'user-session')
    db.get("SELECT id FROM anggota WHERE nama = ?", [username], (err, row) => {
        if (err || !row) {
            console.log("Nama tidak ditemukan:", username);
            return res.status(404).json({ message: "Nama anggota tidak ditemukan" });
        }

        const idAnggota = row.id;

        // Ambil data peminjaman
        const query = `
            SELECT 
                a.nama AS nama,
                b.judul AS judul,
                p.status AS status
            FROM peminjaman p
            JOIN buku b ON p.id_buku = b.id
            JOIN anggota a ON p.id_anggota = a.id
            WHERE p.id_anggota = ?`;

        db.all(query, [idAnggota], (err, rows) => {
            if (err) {
                console.error("Error:", err.message);
                return res.status(500).json({ message: "Gagal ambil data" });
            }
            res.json(rows);
        });
    });
});


// --- HAPUS BUKU ---
app.delete('/api/buku/:id', authenticate, (req, res) => {
    const id = req.params.id;

    // Cek apakah buku sedang dipinjam
    db.get("SELECT COUNT(*) as count FROM peminjaman WHERE id_buku = ? AND status = 'Dipinjam'", [id], (err, row) => {
        if (err) return res.status(500).json({ message: "Error saat mengecek peminjaman" });
        
        if (row.count > 0) {
            return res.status(400).json({ message: "Tidak bisa dihapus: buku sedang dipinjam!" });
        }

        // Hapus dari tabel buku
        db.run("DELETE FROM buku WHERE id = ?", [id], function(err) {
            if (err) return res.status(500).json({ message: "Gagal menghapus buku" });
            if (this.changes === 0) {
                return res.status(404).json({ message: "Buku tidak ditemukan" });
            }
            res.json({ message: "Buku berhasil dihapus" });
        });
    });
});

// --- HAPUS ANGGOTA ---
app.delete('/api/anggota/:id', authenticate, (req, res) => {
    const id = req.params.id;

    // Cek apakah anggota sedang meminjam buku
    db.get("SELECT COUNT(*) as count FROM peminjaman WHERE id_anggota = ? AND status = 'Dipinjam'", [id], (err, row) => {
        if (err) return res.status(500).json({ message: "Error saat mengecek peminjaman" });
        
        if (row.count > 0) {
            return res.status(400).json({ message: "Tidak bisa dihapus: anggota masih punya pinjaman aktif!" });
        }

        // Hapus dari tabel anggota
        db.run("DELETE FROM anggota WHERE id = ?", [id], function(err) {
            if (err) return res.status(500).json({ message: "Gagal menghapus anggota" });
            if (this.changes === 0) {
                return res.status(404).json({ message: "Anggota tidak ditemukan" });
            }
            res.json({ message: "Anggota berhasil dihapus" });
        });
    });
});

// --- HAPUS PEMINJAMAN ---
app.delete('/api/peminjaman/:id', authenticate, (req, res) => {
    const id = req.params.id;

    // Ambil data peminjaman untuk kembalikan stok jika perlu
    db.get("SELECT id_buku, status FROM peminjaman WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ message: "Error saat mengambil data peminjaman" });
        if (!row) return res.status(404).json({ message: "Peminjaman tidak ditemukan" });

        db.serialize(() => {
            // Jika status "Dipinjam", kembalikan stok buku
            if (row.status === 'Dipinjam') {
                db.run("UPDATE buku SET stok = stok + 1 WHERE id = ?", [row.id_buku]);
            }

            // Hapus transaksi peminjaman
            db.run("DELETE FROM peminjaman WHERE id = ?", [id], function(err) {
                if (err) return res.status(500).json({ message: "Gagal menghapus peminjaman" });
                res.json({ message: "Transaksi peminjaman berhasil dihapus" });
            });
        });
    });
});


app.listen(3000, () => console.log('Server Backend aktif di port 3000'));