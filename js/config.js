/**
 * DIASAP POS - Configuration & Constants
 * Konfigurasi database Neon PostgreSQL dan konstanta sistem
 */

const CONFIG = {
    APP_NAME: "DIASAP POS",
    STORE_NAME: "DIASAP RESTO & SMOKEHOUSE",
    STORE_ADDRESS: "Jl. Kuliner Lezat No. 88, Kota Rasa",
    STORE_PHONE: "0812-3456-7890",
    FOOTER_RECEIPT_NOTE: "Terima Kasih Atas Kunjungan Anda!\nNikmati Sensasi Daging Asap Khas Kami.",
    
    // Neon PostgreSQL Cloud Endpoint (Langsung via HTTPS REST / SQL Serverless)
    NEON: {
        ENDPOINT: "https://ep-dark-union-azehy8cg-pooler.c-3.ap-southeast-1.aws.neon.tech/sql",
        CONNECTION_STRING: "postgresql://neondb_owner:npg_0HB8JREwnsVk@ep-dark-union-azehy8cg-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
        TIMEOUT_MS: 8000
    },

    // Nilai default jika database offline / pertama kali load
    DEFAULT_PRODUCTS: [
        { id: 'A', name: 'PAKET A', desc: 'Daging Ayam + Sayur + Sambal', category: 'makanan', priceNormal: 30000, pricePromo: 25000, emoji: '🍗' },
        { id: 'B', name: 'PAKET B', desc: 'Daging Ayam + Nasi + Sayur', category: 'makanan', priceNormal: 35000, pricePromo: 30000, emoji: '🍱' },
        { id: 'C', name: 'PAKET C (Dobel)', desc: 'Daging Dobel + Nasi + Sayur', category: 'makanan', priceNormal: 55000, pricePromo: 50000, emoji: '🍖' },
        { id: 'D', name: 'PAKET D (Dobel)', desc: 'Daging Ayam Dobel + Sayur + Sambal', category: 'makanan', priceNormal: 50000, pricePromo: 45000, emoji: '🔥' },
        { id: 'M1', name: 'Es Teh Manis', desc: 'Teh melati dingin segar manis', category: 'minuman', priceNormal: 5000, pricePromo: 5000, emoji: '🍹' },
        { id: 'M2', name: 'Air Mineral', desc: 'Air mineral kemasan botol 600ml', category: 'minuman', priceNormal: 4000, pricePromo: 4000, emoji: '💧' },
        { id: 'T1', name: 'Nasi Putih Ekstra', desc: 'Porsi nasi pulen hangat', category: 'tambahan', priceNormal: 6000, pricePromo: 5000, emoji: '🍚' },
        { id: 'T2', name: 'Sambal Ekstra', desc: 'Sambal khas diasap super pedas', category: 'tambahan', priceNormal: 4000, pricePromo: 3000, emoji: '🌶️' }
    ]
};

// Helper Format Rupiah
function formatRupiah(angka) {
    const num = Math.round(Number(angka) || 0);
    return 'Rp ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Helper Format Tanggal & Jam Indonesia
function formatDateTime(date = new Date()) {
    const d = new Date(date);
    return d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Generate Nomor Invoice Unik
function generateInvoiceNumber() {
    const now = new Date();
    const y = now.getFullYear().toString().slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const rand = Math.floor(100 + Math.random() * 900);
    return `DSP-${y}${m}${d}-${time}-${rand}`;
}
