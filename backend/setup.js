const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Menentukan lokasi database agar tetap di folder backend
const dbPath = path.resolve(__dirname, 'perpustakaan.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("--- Memulai Proses Setup Database ---");

    // 1. Hapus tabel lama jika ada (Reset Total)
    db.run("DROP TABLE IF EXISTS pengembalian");
    db.run("DROP TABLE IF EXISTS peminjaman");
    db.run("DROP TABLE IF EXISTS anggota");
    db.run("DROP TABLE IF EXISTS anggota_login");
    db.run("DROP TABLE IF EXISTS buku");
    console.log("1. Database lama telah dibersihkan.");

    // 2. Membuat Tabel Buku
    db.run(`CREATE TABLE buku (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        judul TEXT NOT NULL,
        stok INTEGER DEFAULT 0
    )`);

    // 3. Membuat Tabel Anggota (Ditambah Alamat & Telepon sesuai Frontend)
    db.run(`CREATE TABLE anggota (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama TEXT NOT NULL,
        alamat TEXT,
        telepon TEXT
    )`);

    // 4. Membuat Tabel Peminjaman
    db.run(`CREATE TABLE peminjaman (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_buku INTEGER,
        id_anggota INTEGER,
        tanggal_pinjam TEXT,
        status TEXT DEFAULT 'Dipinjam',
        FOREIGN KEY (id_buku) REFERENCES buku(id),
        FOREIGN KEY (id_anggota) REFERENCES anggota(id)
    )`);

    // 5. Membuat Tabel Pengembalian (Penting untuk Data Layer)
    db.run(`CREATE TABLE pengembalian (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_peminjaman INTEGER,
        tanggal_kembali TEXT,
        denda INTEGER DEFAULT 0,
        FOREIGN KEY (id_peminjaman) REFERENCES peminjaman(id)
    )`);

// 6. Membuat Tabel Anggota Login (Akun untuk User/Anggota)
    // Tabel ini menghubungkan kredensial login dengan profil di tabel anggota
    db.run(`CREATE TABLE anggota_login (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        api_key TEXT,
        id_anggota INTEGER,
        FOREIGN KEY (id_anggota) REFERENCES anggota(id)
    )`);



    console.log("2. Semua tabel (6) berhasil dibuat dengan struktur terbaru!");
    console.log("   - Tabel Bisnis: buku, anggota, peminjaman, pengembalian");
    console.log("   - Tabel Auth: petugas, anggota_login");
});

db.close((err) => {
    if (err) console.error(err.message);
    console.log("--- Setup Selesai. Silakan jalankan 'node server.js' ---");
});