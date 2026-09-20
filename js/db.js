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
        this.storageKeySettings = 'diasap_store_settings_cache';
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
            await this.ensureSchema();
            return true;
        } catch {
            return false;
        }
    }

    // Pastikan kolom baru (status, pickup_date, dll) tersedia di tabel orders Neon
    async ensureSchema() {
        try {
            await this.query(`
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'completed';
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_date VARCHAR(20);
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_time VARCHAR(10);
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_method VARCHAR(30) DEFAULT 'self_pickup';
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_address TEXT;
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP;
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;
            `);
        } catch (e) {
            console.warn('ensureSchema check (aman jika offline / kolom sudah ada):', e);
        }
    }

    // ================= MANAJEMEN PENGATURAN TOKO (STORE SETTINGS) =================

    // Ambil pengaturan toko (Prioritas Neon DB, Fallback Cache)
    async getStoreSettings() {
        try {
            const rows = await this.query(`SELECT key, value FROM store_settings;`);
            if (rows && rows.length > 0) {
                const settings = { ...CONFIG.DEFAULT_SETTINGS };
                rows.forEach(r => {
                    try {
                        settings[r.key] = JSON.parse(r.value);
                    } catch {
                        settings[r.key] = r.value;
                    }
                });
                localStorage.setItem(this.storageKeySettings, JSON.stringify(settings));
                return settings;
            }
        } catch (e) {
            console.warn('Gagal memuat store_settings dari Neon, menggunakan cache lokal:', e);
        }

        const cached = localStorage.getItem(this.storageKeySettings);
        if (cached) {
            try {
                return { ...CONFIG.DEFAULT_SETTINGS, ...JSON.parse(cached) };
            } catch (e) {}
        }

        localStorage.setItem(this.storageKeySettings, JSON.stringify(CONFIG.DEFAULT_SETTINGS));
        return CONFIG.DEFAULT_SETTINGS;
    }

    // Simpan pengaturan toko ke Neon PostgreSQL dan cache lokal
    async saveStoreSettings(settings) {
        try {
            for (const [key, val] of Object.entries(settings)) {
                const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
                await this.query(`
                    INSERT INTO store_settings (key, value, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                `, [key, valStr]);
            }
        } catch (err) {
            console.warn('Gagal menyimpan store_settings ke Neon, disimpan lokal:', err);
        }

        localStorage.setItem(this.storageKeySettings, JSON.stringify(settings));
        return settings;
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
                       image_emoji as "emoji",
                       COALESCE(image_url, '') as "imageUrl",
                       COALESCE(sort_order, 10)::integer as "sortOrder",
                       COALESCE(variants, '[]'::jsonb) as "variants"
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
                    directStock: Number(r.directStock) || 0,
                    imageUrl: r.imageUrl || '',
                    sortOrder: Number(r.sortOrder) || 10,
                    variants: Array.isArray(r.variants) ? r.variants : (typeof r.variants === 'string' ? JSON.parse(r.variants) : [])
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
    async saveProduct(product, oldId = null) {
        // 0. Jika Kode Menu (ID / SKU) diubah oleh pengguna, update ID di Neon dan cache lokal terlebih dahulu
        if (oldId && oldId !== product.id) {
            try {
                await this.query(`UPDATE products SET id = $1 WHERE id = $2;`, [product.id, oldId]);
            } catch (err) {
                console.warn('Gagal update ID produk di Neon:', err);
            }

            // Update di cache lokal
            try {
                const cached = localStorage.getItem(this.storageKeyProducts);
                if (cached) {
                    let list = JSON.parse(cached);
                    const oldIdx = list.findIndex(p => p.id === oldId);
                    if (oldIdx >= 0) {
                        list[oldIdx].id = product.id;
                        localStorage.setItem(this.storageKeyProducts, JSON.stringify(list));
                    }
                }
            } catch (e) {}

            // Update di keranjang belanja jika item dengan oldId sedang dipilih kasir
            if (typeof cartManager !== 'undefined' && cartManager.items) {
                const cartItem = cartManager.items.find(i => i.id === oldId);
                if (cartItem) cartItem.id = product.id;
            }
        }

        // 1. Simpan ke Neon PostgreSQL Cloud
        try {
            await this.query(`
                INSERT INTO products (id, name, description, category, price_normal, price_promo, cogs, stock_type, raw_material_id, raw_material_amount, direct_stock, image_emoji, image_url, sort_order, variants, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, TRUE)
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
                    image_url = EXCLUDED.image_url,
                    sort_order = EXCLUDED.sort_order,
                    variants = EXCLUDED.variants,
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
                product.imageUrl || '',
                product.sortOrder || 10,
                JSON.stringify(product.variants || [])
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

    // Perbarui urutan seluruh produk (Sort Order)
    async updateProductsSortOrder(orderedProducts) {
        for (let i = 0; i < orderedProducts.length; i++) {
            const p = orderedProducts[i];
            const newOrder = i + 1;
            p.sortOrder = newOrder;
            try {
                await this.query(`UPDATE products SET sort_order = $1 WHERE id = $2;`, [newOrder, p.id]);
            } catch (err) {
                console.warn(`Gagal update sort_order produk ${p.id}:`, err);
            }
        }
        localStorage.setItem(this.storageKeyProducts, JSON.stringify(orderedProducts));
        return orderedProducts;
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

    // Simpan Transaksi Baru atau Perbarui Transaksi Pending
    async saveOrder(orderData, items) {
        // 1. Simpan ke Local Storage terlebih dahulu untuk kecepatan & jaminan data
        let orders = this.getLocalOrders();
        const existingIdx = orders.findIndex(o => o.invoiceNo === orderData.invoiceNo);
        
        const defaultStatus = orderData.orderType === 'dine_in' ? 'completed' : 'paid';
        const targetStatus = orderData.status || (existingIdx >= 0 && orders[existingIdx].status ? orders[existingIdx].status : defaultStatus);

        const localOrderRecord = {
            ...(existingIdx >= 0 ? orders[existingIdx] : {}),
            ...orderData,
            status: targetStatus,
            pickupDate: orderData.pickupDate || (existingIdx >= 0 ? orders[existingIdx].pickupDate : '') || '',
            pickupTime: orderData.pickupTime || (existingIdx >= 0 ? orders[existingIdx].pickupTime : '') || '',
            pickupMethod: orderData.pickupMethod || (existingIdx >= 0 ? orders[existingIdx].pickupMethod : '') || 'self_pickup',
            pickupAddress: orderData.pickupAddress || (existingIdx >= 0 ? orders[existingIdx].pickupAddress : '') || '',
            deliveryFee: Number(orderData.deliveryFee !== undefined ? orderData.deliveryFee : (existingIdx >= 0 ? orders[existingIdx].deliveryFee : 0)) || 0,
            pickedUpAt: orderData.pickedUpAt || (existingIdx >= 0 ? orders[existingIdx].pickedUpAt : null) || null,
            items: items,
            synced: false
        };

        if (existingIdx >= 0) {
            orders[existingIdx] = localOrderRecord;
        } else {
            orders.unshift(localOrderRecord);
        }
        localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));

        // 2. Simpan / Perbarui ke Neon PostgreSQL
        try {
            const existingInDb = await this.query(`SELECT id FROM orders WHERE invoice_no = $1 LIMIT 1;`, [orderData.invoiceNo]);
            let targetOrderId = null;

            if (existingInDb && existingInDb.length > 0) {
                targetOrderId = existingInDb[0].id;
                await this.query(`
                    UPDATE orders SET
                        customer_name = $1, order_type = $2, payment_method = $3,
                        total_amount = $4, cash_received = $5, change_amount = $6,
                        notes = $7, cashier_name = $8, subtotal_amount = $9,
                        final_discount_amount = $10, final_discount_note = $11,
                        status = $12, pickup_date = $13, pickup_time = $14,
                        pickup_method = $15, pickup_address = $16, picked_up_at = $17,
                        delivery_fee = $18
                    WHERE id = $19;
                `, [
                    orderData.customerName || 'Pelanggan',
                    orderData.orderType || 'dine_in',
                    orderData.paymentMethod || 'cash',
                    orderData.totalAmount,
                    orderData.cashReceived || 0,
                    orderData.changeAmount || 0,
                    orderData.notes || '',
                    orderData.cashierName || 'Kasir',
                    orderData.subtotalAmount || orderData.totalAmount,
                    orderData.finalDiscountAmount || 0,
                    orderData.finalDiscountNote || '',
                    localOrderRecord.status,
                    localOrderRecord.pickupDate || null,
                    localOrderRecord.pickupTime || null,
                    localOrderRecord.pickupMethod || 'self_pickup',
                    localOrderRecord.pickupAddress || '',
                    localOrderRecord.pickedUpAt || null,
                    localOrderRecord.deliveryFee || 0,
                    targetOrderId
                ]);
            } else {
                const orderRes = await this.query(`
                    INSERT INTO orders (
                        invoice_no, customer_name, order_type, payment_method, 
                        total_amount, cash_received, change_amount, notes, 
                        cashier_name, subtotal_amount, final_discount_amount, final_discount_note,
                        status, pickup_date, pickup_time, pickup_method, pickup_address, picked_up_at,
                        delivery_fee
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                    RETURNING id;
                `, [
                    orderData.invoiceNo,
                    orderData.customerName || 'Pelanggan',
                    orderData.orderType || 'dine_in',
                    orderData.paymentMethod || 'cash',
                    orderData.totalAmount,
                    orderData.cashReceived || 0,
                    orderData.changeAmount || 0,
                    orderData.notes || '',
                    orderData.cashierName || 'Kasir',
                    orderData.subtotalAmount || orderData.totalAmount,
                    orderData.finalDiscountAmount || 0,
                    orderData.finalDiscountNote || '',
                    localOrderRecord.status,
                    localOrderRecord.pickupDate || null,
                    localOrderRecord.pickupTime || null,
                    localOrderRecord.pickupMethod || 'self_pickup',
                    localOrderRecord.pickupAddress || '',
                    localOrderRecord.pickedUpAt || null,
                    localOrderRecord.deliveryFee || 0
                ]);
                targetOrderId = orderRes[0]?.id;
            }

            if (targetOrderId && items && items.length > 0) {
                // Refresh items
                try {
                    await this.query(`DELETE FROM order_items WHERE order_id = $1;`, [targetOrderId]);
                } catch (e) {}

                for (const item of items) {
                    const priceNormalVal = Number(item.normalPriceLocked || item.priceNormal || item.priceLocked) || 0;
                    await this.query(`
                        INSERT INTO order_items (order_id, product_id, product_name, price_locked, price_normal, is_promo, quantity, item_total, cogs_locked, variant_id, variant_name, ingredients_snapshot)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
                    `, [
                        targetOrderId,
                        item.id,
                        item.name,
                        item.priceLocked,
                        priceNormalVal,
                        item.isPromo || false,
                        item.qty,
                        item.priceLocked * item.qty,
                        item.cogsLocked || item.cogs || 0,
                        item.variantId || '',
                        item.variantName || '',
                        JSON.stringify(item.ingredients || [])
                    ]);
                }
            }

            // Tandai sudah tersinkronisasi di lokal
            localOrderRecord.synced = true;
            localOrderRecord.dbId = targetOrderId;
            localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));
        } catch (err) {
            console.warn('Transaksi disimpan di cache lokal dan akan disinkronkan kemudian:', err);
        }

        return localOrderRecord;
    }

    // Perbarui status pesanan (unpaid -> paid -> completed)
    async updateOrderStatus(invoiceNo, newStatus, extraData = {}) {
        let orders = this.getLocalOrders();
        const order = orders.find(o => o.invoiceNo === invoiceNo);
        if (order) {
            order.status = newStatus;
            if (newStatus === 'completed' && !order.pickedUpAt) {
                order.pickedUpAt = new Date().toISOString();
            }
            Object.assign(order, extraData);
            localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));
        }

        try {
            const pickedUpVal = (newStatus === 'completed') ? (extraData.pickedUpAt || new Date().toISOString()) : null;
            if (pickedUpVal) {
                await this.query(`UPDATE orders SET status = $1, picked_up_at = $2 WHERE invoice_no = $3;`, [newStatus, pickedUpVal, invoiceNo]);
            } else {
                await this.query(`UPDATE orders SET status = $1 WHERE invoice_no = $2;`, [newStatus, invoiceNo]);
            }
        } catch (e) {
            console.warn('Gagal update status order di Neon:', e);
        }

        return true;
    }

    // Hapus pesanan pending yang belum dibayar jika dibatalkan pelanggan
    async deletePendingOrder(invoiceNo) {
        let orders = this.getLocalOrders();
        const order = orders.find(o => o.invoiceNo === invoiceNo);
        if (order) {
            orders = orders.filter(o => o.invoiceNo !== invoiceNo);
            localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));

            try {
                const row = await this.query(`SELECT id FROM orders WHERE invoice_no = $1;`, [invoiceNo]);
                if (row && row.length > 0) {
                    const orderId = row[0].id;
                    await this.query(`DELETE FROM order_items WHERE order_id = $1;`, [orderId]);
                    await this.query(`DELETE FROM orders WHERE id = $1;`, [orderId]);
                }
            } catch (e) {
                console.warn('Gagal hapus pending order di Neon:', e);
            }
            return true;
        }
        return false;
    }

    // Ambil daftar transaksi aktif (tagihan sementara & PO menunggu diambil)
    async getActiveOrders() {
        const allOrders = await this.getOrdersHistory(300);
        return allOrders.filter(o => !o.isVoid && (o.status === 'unpaid' || (o.orderType === 'take_away' && o.status === 'paid')));
    }

    // Ambil order dari cache lokal
    getLocalOrders() {
        const raw = localStorage.getItem(this.storageKeyOrders);
        if (!raw) return [];
        try {
            const list = JSON.parse(raw);
            return list.map(o => ({
                ...o,
                status: o.status || (o.isVoid ? 'void' : (o.orderType === 'dine_in' ? 'completed' : 'paid')),
                pickupDate: o.pickupDate || '',
                pickupTime: o.pickupTime || '',
                pickupMethod: o.pickupMethod || 'self_pickup',
                pickupAddress: o.pickupAddress || '',
                deliveryFee: Number(o.deliveryFee || 0),
                pickedUpAt: o.pickedUpAt || null
            }));
        } catch {
            return [];
        }
    }

    // Ambil Riwayat Transaksi (dari Neon atau cache)
    async getOrdersHistory(limit = 200) {
        try {
            const rows = await this.query(`
                SELECT o.id, o.invoice_no as "invoiceNo", o.customer_name as "customerName",
                       o.order_type as "orderType", o.payment_method as "paymentMethod",
                       o.total_amount::numeric as "totalAmount", 
                       o.cash_received::numeric as "cashReceived", 
                       o.change_amount::numeric as "changeAmount",
                       o.notes, o.created_at as "createdAt",
                       COALESCE(o.is_void, FALSE) as "isVoid",
                       COALESCE(o.void_reason, '') as "voidReason",
                       COALESCE(o.void_by, '') as "voidBy",
                       o.void_at as "voidAt",
                       COALESCE(o.cashier_name, 'Kasir') as "cashierName",
                       COALESCE(o.subtotal_amount, o.total_amount)::numeric as "subtotalAmount",
                       COALESCE(o.final_discount_amount, 0)::numeric as "finalDiscountAmount",
                       COALESCE(o.final_discount_note, '') as "finalDiscountNote",
                       COALESCE(o.status, 'completed') as "status",
                       COALESCE(o.pickup_date, '') as "pickupDate",
                       COALESCE(o.pickup_time, '') as "pickupTime",
                       COALESCE(o.pickup_method, 'self_pickup') as "pickupMethod",
                       COALESCE(o.pickup_address, '') as "pickupAddress",
                       COALESCE(o.delivery_fee, 0)::numeric as "deliveryFee",
                       o.picked_up_at as "pickedUpAt",
                       COALESCE(
                           json_agg(
                                json_build_object(
                                    'id', oi.product_id,
                                    'name', oi.product_name,
                                    'qty', oi.quantity,
                                    'priceLocked', oi.price_locked,
                                    'priceNormal', COALESCE(oi.price_normal, oi.price_locked),
                                    'isPromo', oi.is_promo,
                                    'cogsLocked', COALESCE(oi.cogs_locked, 0),
                                    'variantId', COALESCE(oi.variant_id, ''),
                                    'variantName', COALESCE(oi.variant_name, ''),
                                    'ingredients', COALESCE(oi.ingredients_snapshot, '[]'::jsonb)
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
                    subtotalAmount: Number(r.subtotalAmount) || Number(r.totalAmount),
                    finalDiscountAmount: Number(r.finalDiscountAmount) || 0,
                    finalDiscountNote: r.finalDiscountNote || '',
                    cashierName: r.cashierName || 'Kasir',
                    isVoid: Boolean(r.isVoid),
                    voidReason: r.voidReason || '',
                    voidBy: r.voidBy || '',
                    voidAt: r.voidAt || null,
                    status: r.status || (r.isVoid ? 'void' : (r.orderType === 'dine_in' ? 'completed' : 'paid')),
                    pickupDate: r.pickupDate || '',
                    pickupTime: r.pickupTime || '',
                    pickupMethod: r.pickupMethod || 'self_pickup',
                    pickupAddress: r.pickupAddress || '',
                    deliveryFee: Number(r.deliveryFee) || 0,
                    pickedUpAt: r.pickedUpAt || null,
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

            // Jika item memiliki bahan baku varian (1 atau lebih bahan baku master)
            if (item.ingredients && Array.isArray(item.ingredients) && item.ingredients.length > 0) {
                for (const ing of item.ingredients) {
                    if (ing.rawMaterialId && Number(ing.amount) > 0) {
                        const amountNeeded = Number(ing.amount) * qty;
                        rawDeductions[ing.rawMaterialId] = (rawDeductions[ing.rawMaterialId] || 0) + amountNeeded;
                    }
                }
            } else if (prod.stockType === 'raw_material' && prod.rawMaterialId) {
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

    // Kembalikan stok bahan & barang jadi saat transaksi di-void / dibatalkan
    async restoreStockForOrder(items) {
        if (!items || items.length === 0) return;

        const products = await this.getProducts();
        const rawMaterials = await this.getRawMaterials();

        const rawRestorations = {};
        const directRestorations = {};

        for (const item of items) {
            const prod = products.find(p => p.id === item.id);
            if (!prod) continue;

            const qty = Number(item.qty) || 1;

            if (item.ingredients && Array.isArray(item.ingredients) && item.ingredients.length > 0) {
                for (const ing of item.ingredients) {
                    if (ing.rawMaterialId && Number(ing.amount) > 0) {
                        const amount = Number(ing.amount) * qty;
                        rawRestorations[ing.rawMaterialId] = (rawRestorations[ing.rawMaterialId] || 0) + amount;
                    }
                }
            } else if (prod.stockType === 'raw_material' && prod.rawMaterialId) {
                const amount = (Number(prod.rawMaterialAmount) || 0) * qty;
                rawRestorations[prod.rawMaterialId] = (rawRestorations[prod.rawMaterialId] || 0) + amount;
            } else if (prod.stockType === 'direct') {
                directRestorations[prod.id] = (directRestorations[prod.id] || 0) + qty;
            }
        }

        // 1. Kembalikan Bahan Baku Master
        for (const rawId of Object.keys(rawRestorations)) {
            const toAdd = rawRestorations[rawId];
            const mat = rawMaterials.find(m => m.id === rawId);
            if (mat) {
                mat.stock = (Number(mat.stock) || 0) + toAdd;
                try {
                    await this.query(`UPDATE raw_materials SET stock = $1 WHERE id = $2;`, [mat.stock, rawId]);
                } catch (e) {
                    console.warn(`Gagal update pengembalian stok bahan ${rawId} di Neon:`, e);
                }
            }
        }
        localStorage.setItem(this.storageKeyRawMaterials, JSON.stringify(rawMaterials));

        // 2. Kembalikan Barang Jadi (Fisik)
        for (const prodId of Object.keys(directRestorations)) {
            const toAdd = directRestorations[prodId];
            const prod = products.find(p => p.id === prodId);
            if (prod) {
                prod.directStock = (Number(prod.directStock) || 0) + toAdd;
                try {
                    await this.query(`UPDATE products SET direct_stock = $1 WHERE id = $2;`, [prod.directStock, prodId]);
                } catch (e) {
                    console.warn(`Gagal update pengembalian direct_stock produk ${prodId} di Neon:`, e);
                }
            }
        }
        localStorage.setItem(this.storageKeyProducts, JSON.stringify(products));

        // Refresh state di memory
        if (typeof inventoryManager !== 'undefined') {
            await inventoryManager.loadRawMaterials();
        }
        if (typeof productManager !== 'undefined') {
            await productManager.loadProducts();
            productManager.render();
        }
    }

    // Void / Batalkan Transaksi
    async voidOrder(invoiceNo, voidBy, voidReason) {
        // 1. Update status di Neon PostgreSQL
        try {
            await this.query(`
                UPDATE orders 
                SET is_void = TRUE, void_reason = $1, void_by = $2, void_at = NOW()
                WHERE invoice_no = $3;
            `, [voidReason || 'Dibatalkan oleh kasir', voidBy || 'Kasir', invoiceNo]);
        } catch (err) {
            console.warn('Gagal menandai void transaksi di Neon:', err);
        }

        // 2. Update di cache lokal
        let orders = this.getLocalOrders();
        const order = orders.find(o => o.invoiceNo === invoiceNo);
        if (order) {
            order.isVoid = true;
            order.voidReason = voidReason || 'Dibatalkan oleh kasir';
            order.voidBy = voidBy || 'Kasir';
            order.voidAt = new Date().toISOString();
            localStorage.setItem(this.storageKeyOrders, JSON.stringify(orders));

            // 3. Kembalikan stok bahan & barang jadi yang sebelumnya terpotong
            if (order.items && order.items.length > 0) {
                await this.restoreStockForOrder(order.items);
            }
        }

        return true;
    }
}

const db = new DatabaseService();
