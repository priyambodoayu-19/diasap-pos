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
        this.storageKeyRawMaterials = 'diasap_raw_materials_cache';
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
                       cogs::numeric as "cogs",
                       COALESCE(stock_type, 'unlimited') as "stockType",
                       COALESCE(raw_material_id, '') as "rawMaterialId",
                       COALESCE(raw_material_amount, 0)::numeric as "rawMaterialAmount",
                       COALESCE(direct_stock, 0)::numeric as "directStock",
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
                    pricePromo: Number(r.pricePromo),
                    cogs: Number(r.cogs) || 0,
                    stockType: r.stockType || 'unlimited',
                    rawMaterialId: r.rawMaterialId || '',
                    rawMaterialAmount: Number(r.rawMaterialAmount) || 0,
                    directStock: Number(r.directStock) || 0
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
                INSERT INTO products (id, name, description, category, price_normal, price_promo, cogs, stock_type, raw_material_id, raw_material_amount, direct_stock, image_emoji, sort_order, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    category = EXCLUDED.category,
                    price_normal = EXCLUDED.price_normal,
                    price_promo = EXCLUDED.price_promo,
                    cogs = EXCLUDED.cogs,
                    stock_type = EXCLUDED.stock_type,
                    raw_material_id = EXCLUDED.raw_material_id,
                    raw_material_amount = EXCLUDED.raw_material_amount,
                    direct_stock = EXCLUDED.direct_stock,
                    image_emoji = EXCLUDED.image_emoji,
                    is_active = TRUE;
            `, [
                product.id,
                product.name,
                product.desc || '',
                product.category || 'makanan',
                product.priceNormal,
                product.pricePromo,
                product.cogs || 0,
                product.stockType || 'unlimited',
                product.rawMaterialId || '',
                product.rawMaterialAmount || 0,
                product.directStock || 0,
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

    // Hapus Produk (Database Cloud & Cache Lokal)
    async deleteProduct(productId) {
        // 1. Hapus atau nonaktifkan di Neon PostgreSQL
        try {
            await this.query(`DELETE FROM products WHERE id = $1;`, [productId]);
        } catch (err) {
            console.warn('Gagal hard delete di Neon, mencoba soft delete:', err);
            try {
                await this.query(`UPDATE products SET is_active = FALSE WHERE id = $1;`, [productId]);
            } catch (softErr) {
                console.warn('Gagal soft delete di Neon:', softErr);
            }
        }

        // 2. Hapus dari cache lokal
        try {
            const cached = localStorage.getItem(this.storageKeyProducts);
            if (cached) {
                let list = JSON.parse(cached);
                list = list.filter(p => p.id !== productId);
                localStorage.setItem(this.storageKeyProducts, JSON.stringify(list));
            }
        } catch (e) {
            console.error('Gagal menghapus produk dari cache lokal:', e);
        }

        return true;
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
                        INSERT INTO order_items (order_id, product_id, product_name, price_locked, is_promo, quantity, item_total, cogs_locked)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
                    `, [
                        newOrderId,
                        item.id,
                        item.name,
                        item.priceLocked,
                        item.isPromo || false,
                        item.qty,
                        item.priceLocked * item.qty,
                        item.cogsLocked || item.cogs || 0
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
                                   'id', oi.product_id,
                                   'name', oi.product_name,
                                   'qty', oi.quantity,
                                   'priceLocked', oi.price_locked,
                                   'isPromo', oi.is_promo,
                                   'cogsLocked', COALESCE(oi.cogs_locked, 0)
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

    // ================= MANAJEMEN BAHAN BAKU MASTER (RAW MATERIALS) =================

    // Mengambil daftar Bahan Baku Master (Neon DB / Cache Lokal)
    async getRawMaterials() {
        try {
            const rows = await this.query(`
                SELECT id, name, stock::numeric as "stock", unit, min_stock::numeric as "minStock"
                FROM raw_materials
                ORDER BY name ASC;
            `);

            if (rows && rows.length > 0) {
                const formatted = rows.map(r => ({
                    ...r,
                    stock: Number(r.stock) || 0,
                    minStock: Number(r.minStock) || 0
                }));
                localStorage.setItem(this.storageKeyRawMaterials, JSON.stringify(formatted));
                return formatted;
            }
        } catch (e) {
            console.warn('Gagal memuat raw_materials dari Neon, memuat dari cache:', e);
        }

        const cached = localStorage.getItem(this.storageKeyRawMaterials);
        if (cached) {
            try {
                return JSON.parse(cached);
            } catch (e) {
                console.error(e);
            }
        }

        localStorage.setItem(this.storageKeyRawMaterials, JSON.stringify(CONFIG.DEFAULT_RAW_MATERIALS));
        return CONFIG.DEFAULT_RAW_MATERIALS;
    }

    // Simpan / Perbarui Bahan Baku Master
    async saveRawMaterial(material) {
        try {
            await this.query(`
                INSERT INTO raw_materials (id, name, stock, unit, min_stock)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    stock = EXCLUDED.stock,
                    unit = EXCLUDED.unit,
                    min_stock = EXCLUDED.min_stock;
            `, [
                material.id,
                material.name,
                material.stock || 0,
                material.unit || 'gr',
                material.minStock || 0
            ]);
        } catch (err) {
            console.warn('Gagal menyimpan raw material ke Neon, disimpan lokal:', err);
        }

        const list = await this.getRawMaterials();
        const idx = list.findIndex(m => m.id === material.id);
        if (idx >= 0) {
            list[idx] = { ...list[idx], ...material };
        } else {
            list.push(material);
        }
        localStorage.setItem(this.storageKeyRawMaterials, JSON.stringify(list));
        return material;
    }

    // Hapus Bahan Baku
    async deleteRawMaterial(id) {
        try {
            await this.query(`DELETE FROM raw_materials WHERE id = $1;`, [id]);
        } catch (err) {
            console.warn('Gagal hapus raw material di Neon:', err);
        }

        try {
            let list = await this.getRawMaterials();
            list = list.filter(m => m.id !== id);
            localStorage.setItem(this.storageKeyRawMaterials, JSON.stringify(list));
        } catch (e) {
            console.error(e);
        }
        return true;
    }

    // Deduct stock saat transaksi kasir selesai
    async deductStockForOrder(items) {
        if (!items || items.length === 0) return;

        const products = await this.getProducts();
        const rawMaterials = await this.getRawMaterials();

        const rawDeductions = {};
        const directDeductions = {};

        for (const item of items) {
            const prod = products.find(p => p.id === item.id);
            if (!prod) continue;

            const qty = Number(item.qty) || 1;

            if (prod.stockType === 'raw_material' && prod.rawMaterialId) {
                const amountNeeded = (Number(prod.rawMaterialAmount) || 0) * qty;
                rawDeductions[prod.rawMaterialId] = (rawDeductions[prod.rawMaterialId] || 0) + amountNeeded;
            } else if (prod.stockType === 'direct') {
                directDeductions[prod.id] = (directDeductions[prod.id] || 0) + qty;
            }
        }

        // 1. Potong Bahan Baku
        for (const rawId of Object.keys(rawDeductions)) {
            const toDeduct = rawDeductions[rawId];
            const mat = rawMaterials.find(m => m.id === rawId);
            if (mat) {
                mat.stock = Math.max(0, mat.stock - toDeduct);
                try {
                    await this.query(`UPDATE raw_materials SET stock = $1 WHERE id = $2;`, [mat.stock, rawId]);
                } catch (e) {
                    console.warn(`Gagal update stok bahan ${rawId} di Neon:`, e);
                }
            }
        }
        localStorage.setItem(this.storageKeyRawMaterials, JSON.stringify(rawMaterials));

        // 2. Potong Barang Jadi
        for (const prodId of Object.keys(directDeductions)) {
            const toDeduct = directDeductions[prodId];
            const prod = products.find(p => p.id === prodId);
            if (prod) {
                prod.directStock = Math.max(0, prod.directStock - toDeduct);
                try {
                    await this.query(`UPDATE products SET direct_stock = $1 WHERE id = $2;`, [prod.directStock, prodId]);
                } catch (e) {
                    console.warn(`Gagal update direct_stock produk ${prodId} di Neon:`, e);
                }
            }
        }
        localStorage.setItem(this.storageKeyProducts, JSON.stringify(products));
    }
}

const db = new DatabaseService();
