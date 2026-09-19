# 🔥 DIASAP POS - Sistem Kasir & Manajemen Penjualan

Aplikasi Point of Sale (POS) modern untuk restoran **DIASAP (Smoked Meat & Kitchen)**, dibuat berdasarkan referensi prototipe HTML dan telah terintegrasi langsung dengan database cloud **Neon PostgreSQL**.

---

## 🚀 Cara Menjalankan Aplikasi

Aplikasi ini dibuat dengan arsitektur web modern tanpa ketergantungan (*zero-dependency*). Anda **tidak perlu menginstal Node.js atau Python**.

1. Buka folder `d:\_DOCUMENTS\diasap` di File Explorer.
2. Klik dua kali pada file **`index.html`** untuk membukanya di browser apa pun (Google Chrome, Microsoft Edge, Mozilla Firefox, Safari).
3. Sistem POS langsung siap digunakan!

---

## ✨ Fitur-Fitur Utama

### 1. Katalog Menu & Mode Promo Dinamis
- **Menu Utama**: Paket A, Paket B, Paket C (Dobel), Paket D (Dobel), Minuman (Es Teh, Air Mineral), dan Tambahan (Nasi Putih, Sambal Ekstra).
- **Mode Harga Promo Switch**:
  - Saat switch **Mode Promo** diaktifkan, menu akan menampilkan harga diskon dan label hemat biaya.
  - **Sistem Kunci Harga (*Price Locking*)**: Item yang sudah masuk ke keranjang sebelum switch diubah akan tetap mempertahankan harga saat dimasukkan (tidak berubah otomatis). Kasir dapat memasukkan item yang sama dengan harga berbeda (misal 1 Paket A Normal dan 1 Paket A Promo).
- **Filter & Pencarian**: Filter kategori (Makanan, Minuman, Tambahan) dan kotak pencarian menu langsung.

### 2. Manajemen Keranjang Kasir
- Pengaturan tipe layanan: **Dine In (Makan di Tempat)** atau **Take Away (Bungkus)**.
- Input nama pelanggan / nomor meja dan catatan khusus (misal: "tidak pedas").
- Penyesuaian kuantitas mudah (`+`, `-`, atau hapus).
- Tombol **Kosongkan Keranjang** cepat.

### 3. Pembayaran & Kembalian
- **Pilihan Metode**:
  - 💵 **Tunai (Cash)**: Input nominal uang tunai, kalkulasi kembalian otomatis secara *real-time*, peringatan jika uang kurang.
  - ⚡ **Tombol Uang Pas & Cepat**: Tombol *Uang Pas*, *Rp 50.000*, *Rp 100.000*, dan *Rp 200.000*.
  - 📱 **QRIS**: Tampilan simulasi QRIS dengan nominal otomatis sesuai total belanja.
  - 🏦 **Transfer Bank**: Pilihan bayar non-tunai.

### 4. Cetak Struk Thermal Kasir
- Format struk standar kasir thermal (58mm / 80mm).
- Menampilkan rincian invoice, tanggal/jam, nama kasir & pelanggan, daftar belanja, status promo, dan kembalian.
- Terintegrasi langsung dengan fitur cetak printer thermal via dialog cetak browser (`Ctrl+P` / tombol Cetak Struk).

### 5. Rekap Penjualan & Riwayat Transaksi
- Tekan tombol **Rekap Penjualan** (atau shortcut `F8`) untuk melihat ringkasan performa penjualan:
  - Total omset pendapatan
  - Jumlah transaksi yang sukses
  - Rata-rata nilai per transaksi
  - Rincian penerimaan Tunai vs QRIS
  - Tabel riwayat transaksi lengkap
- **Ekspor CSV**: Tombol unduh laporan ke format `.csv` yang kompatibel dengan Microsoft Excel dan Google Sheets.

### 6. Integrasi Database Cloud Neon PostgreSQL
- Menggunakan endpoint HTTPS Serverless langsung ke Neon PostgreSQL (`ep-dark-union-azehy8cg-pooler...`).
- **Tabel yang Tersedia**:
  - `products`: Master data menu dan harga.
  - `orders`: Data kepala transaksi.
  - `order_items`: Rincian item pesanan dengan riwayat harga terkunci.
- **Offline-First Resilience**: Jika koneksi internet kasir mengalami gangguan, aplikasi otomatis beralih ke cache lokal (*LocalStorage*) dan menyinkronkannya kembali saat online. Indikator status koneksi terlihat jelas di bilah navigasi atas (🟢 Online / 🟡 Mode Lokal).

### 7. Kelola & Tambah Menu Baru
- Tambah menu baru langsung dari aplikasi kasir melalui modal **Tambah Menu**.
- Data otomatis tersimpan ke Neon PostgreSQL dan cache lokal.

---

## ⌨️ Shortcut Keyboard Kasir

| Tombol | Fungsi |
|---|---|
| **F2** | Toggle Mode Harga Normal / PROMO |
| **F4** | Kosongkan Keranjang Belanja |
| **F8** | Buka Rekap Penjualan & Riwayat Transaksi |
| **Enter** | Selesaikan Transaksi (saat di kolom uang tunai) |

---

## 📁 Struktur File

```
d:\_DOCUMENTS\diasap\
├── index.html              # Antarmuka utama aplikasi POS
├── css\
│   └── style.css           # Styling modern POS, warna DIASAP, & print struk
├── js\
│   ├── config.js           # Konfigurasi database Neon & konstanta toko
│   ├── sound.js            # Efek suara kasir (Web Audio API)
│   ├── db.js               # Service database Neon PostgreSQL + LocalStorage
│   ├── products.js         # Pengelolaan katalog produk & render menu
│   ├── cart.js             # Pengelolaan keranjang & penguncian harga promo
│   ├── payment.js          # Hitung pembayaran, kembalian, & cetak struk
│   └── app.js              # Integrasi sistem, event listener, & reporting
├── .env                    # Connection string database Neon
└── README.md               # Dokumentasi petunjuk aplikasi
```
