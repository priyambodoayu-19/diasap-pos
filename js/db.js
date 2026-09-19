/**
 * DIASAP POS - Database Service
 * Menangani koneksi ke Neon PostgreSQL melalui HTTP Serverless Endpoint
 * Dilengkapi sistem fallback LocalStorage otomatis saat offline
 */

class DatabaseService {
    constructor() {
        this.isOnline = false;
        this.statusListeners = [];
        this.storageKeyProducts = 'diasap_products_cache';
        this.storageKeyOrders = 'diasap_orders_cache';
    }

    // Daftarkan listener status koneksi
    onStatusChange(callback) {
        this.statusListeners.push(callback);
    }

    updateStatus(online, message = '') {
        this.isOnline = online;
        this.statusListeners.forEach(cb => cb(online, message));
    }

    // Eksekusi SQL Query ke Neon PostgreSQL
    async query(sql, params = []) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.NEON.TIMEOUT_MS);

        try {
            const response = await fetch(CONFIG.NEON.ENDPOINT, {
                method: 'POST',
                headers: {
                    'Neon-Connection-String': CONFIG.NEON.CONNECTION_STRING
                },
                body: JSON.stringify({
                    query: sql,
                    params: params
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Database error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            this.updateStatus(true, 'Terhubung ke Neon PostgreSQL Cloud');
            return data.rows || [];
        } catch (err) {
            clearTimeout(timeoutId);
            console.warn('Neon DB query failed, using offline fallback:', err);
            this.updateStatus(false, 'Mode Offline (Menggunakan Cache Lokal)');
            throw err;
        }
    }

    // Tes koneksi ke Neon
    async checkConnection() {
        try {
            await this.query('SELECT 1 as ping;');
            return true;
        } catch {
            return false;
        }
    }

    // Mengambil daftar produk (Prioritas Neon DB, Fallback Cache)
    async getProducts() {
        try {
            const rows = await this.query(`
                SELECT id, name, description as "desc", category, 
                       price_normal::numeric as "priceNormal", 
                       price_promo::numeric as "pricePromo", 
                       image_emoji as "emoji"
                FROM products 
                WHERE is_active = TRUE 
                ORDER BY sort_order ASC, id ASC;
            `);

            if (rows && rows.length > 0) {
                // Simpan ke cache lokal
                const formatted = rows.map(r => ({
                    ...r,
                    priceNormal: Number(r.priceNormal),
                    pricePromo: Number(r.pricePromo)
                }));
                localStorage.setItem(this.storageKeyProducts, JSON.stringify(formatted));
                return formatted;
            }
        } catch (e) {
            console.warn('Gagal memuat produk dari database, memuat dari lokal storage:', e);
        }

        // Fallback: baca dari cache lokal atau default config
        const cached = localStorage.getItem(this.storageKeyProducts);
        if (cached) {
            try {
                return JSON.parse(cached);
            } catch (e) {
                console.error(e);
            }
        }

        // Simpan default ke cache
        localStorage.setItem(this.storageKeyProducts, JSON.stringify(CONFIG.DEFAULT_PRODUCTS));
        return CONFIG.DEFAULT_PRODUCTS;
    }

    // Simpan atau Perbarui Produk
    async saveProduct(product) {
        // Update di Neon jika online
        try {
            await this.query(`
                INSERT INTO products (id, name, description, category, price_normal, price_promo, image_emoji, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    category = EXCLUDED.category,
                    price_normal = EXCLUDED.price_normal,
                    price_promo = EXCLUDED.price_promo,
                    image_emoji = EXCLUDED.image_emoji;
            `, [
                product.id,
                product.name,
                product.desc || '',
                product.category || 'makanan',
                product.priceNormal,
                product.pricePromo,
                product.emoji || '🍗',
                product.sortOrder || 10
            ]);
        } catch (err) {
            console.warn('Gagal menyimpan produk ke Neon, disimpan lokal:', err);
        }

        // Update di cache lokal
        const products = await this.getProducts();
        const idx = products.findIndex(p => p.id === product.id);
        if (idx >= 0) {
            products[idx] = { ...products[idx], ...product };
        } else {
            products.push(product);
        }
        localStorage.setItem(this.storageKeyProducts, JSON.stringify(products));
        return product;
    }

    // Simpan Transaksi Baru
    async saveOrder(orderData, items) {
        // 1. Simpan ke Local Storage terlebih dahulu untuk kecepatan & jaminan data
        let orders = this.getLocalOrders();
        const localOrderRecord = {
            ...orderData,
            items: items,
            synced: false
        };
        orders.unshift(localOrderRecord);
        localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));

        // 2. Simpan ke Neon PostgreSQL
        try {
            const orderRes = await this.query(`
                INSERT INTO orders (invoice_no, customer_name, order_type, payment_method, total_amount, cash_received, change_amount, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id;
            `, [
                orderData.invoiceNo,
                orderData.customerName || 'Pelanggan',
                orderData.orderType || 'dine_in',
                orderData.paymentMethod || 'cash',
                orderData.totalAmount,
                orderData.cashReceived || 0,
                orderData.changeAmount || 0,
                orderData.notes || ''
            ]);

            const newOrderId = orderRes[0]?.id;

            if (newOrderId && items && items.length > 0) {
                // Simpan item-item transaksi
                for (const item of items) {
                    await this.query(`
                        INSERT INTO order_items (order_id, product_id, product_name, price_locked, is_promo, quantity, item_total)
                        VALUES ($1, $2, $3, $4, $5, $6, $7);
                    `, [
                        newOrderId,
                        item.id,
                        item.name,
                        item.priceLocked,
                        item.isPromo || false,
                        item.qty,
                        item.priceLocked * item.qty
                    ]);
                }
            }

            // Tandai sudah tersinkronisasi di lokal
            localOrderRecord.synced = true;
            localOrderRecord.dbId = newOrderId;
            localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));
        } catch (err) {
            console.warn('Transaksi disimpan di cache lokal dan akan disinkronkan kemudian:', err);
        }

        return localOrderRecord;
    }

    // Ambil order dari cache lokal
    getLocalOrders() {
        const raw = localStorage.getItem(this.storageKeyOrders);
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    // Ambil Riwayat Transaksi (dari Neon atau cache)
    async getOrdersHistory(limit = 100) {
        try {
            const rows = await this.query(`
                SELECT o.id, o.invoice_no as "invoiceNo", o.customer_name as "customerName",
                       o.order_type as "orderType", o.payment_method as "paymentMethod",
                       o.total_amount::numeric as "totalAmount", 
                       o.cash_received::numeric as "cashReceived", 
                       o.change_amount::numeric as "changeAmount",
                       o.notes, o.created_at as "createdAt",
                       COALESCE(
                           json_agg(
                               json_build_object(
                                   'name', oi.product_name,
                                   'qty', oi.quantity,
                                   'priceLocked', oi.price_locked,
                                   'isPromo', oi.is_promo
                               )
                           ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json
                       ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.id = oi.order_id
                GROUP BY o.id
                ORDER BY o.created_at DESC
                LIMIT $1;
            `, [limit]);

            if (rows && rows.length > 0) {
                return rows.map(r => ({
                    ...r,
                    totalAmount: Number(r.totalAmount),
                    cashReceived: Number(r.cashReceived),
                    changeAmount: Number(r.changeAmount),
                    items: Array.isArray(r.items) ? r.items : (typeof r.items === 'string' ? JSON.parse(r.items) : [])
                }));
            }
        } catch (e) {
            console.warn('Gagal memuat history dari Neon, menggunakan cache:', e);
        }

        return this.getLocalOrders();
    }
}

const db = new DatabaseService();
