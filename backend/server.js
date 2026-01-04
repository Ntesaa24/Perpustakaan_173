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
});

// 2. AUTH MIDDLEWARE (API Key)
const API_KEY = process.env.API_KEY;
const authenticate = (req, res, next) => {
    if (req.headers['x-api-key'] === API_KEY) return next();
    res.status(401).json({ message: "Invalid API Key" });
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

app.listen(3000, () => console.log('Server Backend aktif di port 3000'));