/**
 * DIASAP POS - Inventory & Raw Material Stock Manager
 * Mengelola stok bahan baku master (gramasi resep) dan stok langsung barang jadi
 */

class InventoryManager {
    constructor() {
        this.rawMaterials = [];
        this.transitDemand = {};
        this.activePoDemand = {};
        this.activeTab = 'raw'; // 'raw' | 'direct' | 'menu'
    }

    async init() {
        await this.loadRawMaterials();
        await this.calculateStockDemands();
    }

    async calculateStockDemands() {
        try {
            const activeOrders = await db.getActiveOrders();
            const products = (typeof productManager !== 'undefined' && productManager.products && productManager.products.length > 0)
                ? productManager.products
                : await db.getProducts();

            const transit = {};
            const activePo = {};

            for (const order of activeOrders) {
                if (order.isVoid) continue;
                const isUnpaid = order.status === 'unpaid';
                const isPaidPo = order.orderType === 'take_away' && order.status !== 'unpaid' && !order.pickedUpAt;

                if (!isUnpaid && !isPaidPo) continue;
                const targetDemand = isUnpaid ? transit : activePo;

                const items = order.items || [];
                for (const item of items) {
                    const qty = Number(item.qty) || 1;
                    const prod = products.find(p => p.id === item.id);

                    if (item.ingredients && Array.isArray(item.ingredients) && item.ingredients.length > 0) {
                        for (const ing of item.ingredients) {
                            if (ing.rawMaterialId && Number(ing.amount) > 0) {
                                const amt = Number(ing.amount) * qty;
                                targetDemand[ing.rawMaterialId] = (targetDemand[ing.rawMaterialId] || 0) + amt;
                            }
                        }
                    } else if (prod && prod.variants && Array.isArray(prod.variants) && item.variantId) {
                        const variant = prod.variants.find(v => v.id === item.variantId);
                        if (variant && variant.ingredients) {
                            for (const ing of variant.ingredients) {
                                if (ing.rawMaterialId && Number(ing.amount) > 0) {
                                    const amt = Number(ing.amount) * qty;
                                    targetDemand[ing.rawMaterialId] = (targetDemand[ing.rawMaterialId] || 0) + amt;
                                }
                            }
                        }
                    } else if (prod && prod.stockType === 'raw_material' && prod.rawMaterialId) {
                        const amt = (Number(prod.rawMaterialAmount) || 0) * qty;
                        targetDemand[prod.rawMaterialId] = (targetDemand[prod.rawMaterialId] || 0) + amt;
                    }
                }
            }

            this.transitDemand = transit;
            this.activePoDemand = activePo;
            return { transitDemand: transit, activePoDemand: activePo };
        } catch (e) {
            console.warn('Gagal menghitung demand stok bahan:', e);
            this.transitDemand = {};
            this.activePoDemand = {};
            return { transitDemand: {}, activePoDemand: {} };
        }
    }

    copyShoppingList() {
        const lines = [
            '📋 DAFTAR BELANJA & KEBUTUHAN ASAP - DIASAP',
            `Waktu Rekap: ${new Date().toLocaleString('id-ID')}`,
            '==========================================='
        ];

        const SHRINKAGE_RATE = 0.30; // Susut 30% dari mentah ke matang (faktor 0.70)
        const needs = this.rawMaterials.filter(m => (Number(m.stock) || 0) < 0);
        if (needs.length > 0) {
            lines.push('🛒 ESTIMASI DAGING MENTAH HARUS DIBELI (SUSUT 30%):');
            needs.forEach(m => {
                const deficit = Math.abs(Number(m.stock));
                const rawGrams = Math.ceil(deficit / (1 - SHRINKAGE_RATE));
                const rawKg = (rawGrams / 1000).toFixed(2);
                lines.push(`• ${m.name} Mentah: ~${rawKg} kg (${rawGrams.toLocaleString('id-ID')} gr) -> target matang: ${deficit.toLocaleString('id-ID')} gr`);
            });
            lines.push('');
            lines.push('🔥 TARGET HASIL ASAP (DEFISIT PO LUNAS):');
            needs.forEach(m => {
                const deficit = Math.abs(Number(m.stock));
                lines.push(`• ${m.name}: ${deficit.toLocaleString('id-ID')} ${m.unit} (${(deficit / 1000).toFixed(2)} kg matang)`);
            });
        } else {
            lines.push('🔥 DAGING HARUS DIASAP: (Nihil / 0 gr - Stok Ready Cukup)');
        }

        const transitItems = this.rawMaterials.filter(m => ((this.transitDemand && this.transitDemand[m.id]) || 0) > 0);
        if (transitItems.length > 0) {
            lines.push('');
            lines.push('🕒 STOK TRANSIT (TAGIHAN SEMENTARA BELUM BAYAR):');
            transitItems.forEach(m => {
                const tr = this.transitDemand[m.id];
                const rawTrGrams = Math.ceil(tr / (1 - SHRINKAGE_RATE));
                const rawTrKg = (rawTrGrams / 1000).toFixed(2);
                lines.push(`• ${m.name}: ${tr.toLocaleString('id-ID')} ${m.unit} (${(tr / 1000).toFixed(2)} kg matang | Beli mentah jika lunas: ~${rawTrKg} kg)`);
            });
        }

        lines.push('');
        lines.push('📦 STOK FISIK READY SAAT INI:');
        this.rawMaterials.forEach(m => {
            const ready = Math.max(0, Number(m.stock) || 0);
            lines.push(`• ${m.name}: ${ready.toLocaleString('id-ID')} ${m.unit}`);
        });

        lines.push('===========================================');
        lines.push('DIASAP Smokehouse POS System');

        const text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                if (typeof sounds !== 'undefined') sounds.playSuccess();
                alert('📋 Rincian kebutuhan daging berhasil disalin ke clipboard!\nSilakan paste ke WhatsApp tim belanja / dapur.');
            }).catch(() => {
                prompt('Salin teks kebutuhan belanja daging berikut:', text);
            });
        } else {
            prompt('Salin teks kebutuhan belanja daging berikut:', text);
        }
    }

    async loadRawMaterials() {
        this.rawMaterials = await db.getRawMaterials();
        return this.rawMaterials;
    }

    getRawMaterialById(id) {
        return this.rawMaterials.find(m => m.id === id);
    }

    /**
     * Hitung sisa porsi menu yang dapat dibuat berdasarkan stok bahan baku atau barang jadi
     * @param {Object} product 
     * @returns {number} Jumlah porsi tersedia (atau Infinity jika unlimited)
     */
    getPortionsAvailable(product) {
        if (!product) return Infinity;

        // Jika produk memiliki varian menu aktif
        if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
            let totalVariantPortions = 0;
            let hasAnyUnlimited = false;

            for (const v of product.variants) {
                const portions = this.getVariantPortions(v);
                if (portions === Infinity) {
                    hasAnyUnlimited = true;
                } else {
                    totalVariantPortions += portions;
                }
            }
            if (hasAnyUnlimited && totalVariantPortions === 0) return Infinity;
            return totalVariantPortions;
        }

        if (product.stockType === 'raw_material') {
            if (!product.rawMaterialId || !product.rawMaterialAmount || Number(product.rawMaterialAmount) <= 0) {
                return Infinity;
            }
            const mat = this.getRawMaterialById(product.rawMaterialId);
            if (!mat) return 0;
            const stock = Number(mat.stock) || 0;
            const needed = Number(product.rawMaterialAmount);
            return Math.max(0, Math.floor(stock / needed));
        }

        if (product.stockType === 'direct') {
            return Math.max(0, Number(product.directStock) || 0);
        }

        return Infinity;
    }

    /**
     * Hitung porsi tersedia untuk varian spesifik berdasarkan bahan baku masternya
     * @param {Object} variant
     * @returns {number} Jumlah porsi tersedia (atau Infinity jika resep kosong)
     */
    getVariantPortions(variant) {
        if (!variant || !variant.ingredients || !Array.isArray(variant.ingredients) || variant.ingredients.length === 0) {
            return Infinity;
        }
        let minPortions = Infinity;
        for (const ing of variant.ingredients) {
            if (!ing.rawMaterialId || Number(ing.amount) <= 0) continue;
            const mat = this.getRawMaterialById(ing.rawMaterialId);
            if (!mat) {
                return 0;
            }
            const stock = Number(mat.stock) || 0;
            const needed = Number(ing.amount);
            const portions = Math.floor(stock / needed);
            if (portions < minPortions) {
                minPortions = portions;
            }
        }
        return minPortions === Infinity ? Infinity : Math.max(0, minPortions);
    }

    // ================= MODAL KELOLA STOCK =================

    async openStockModal() {
        const modal = document.getElementById('stockModal');
        if (!modal) return;

        await this.loadRawMaterials();
        await productManager.loadProducts();
        await this.calculateStockDemands();

        this.renderStockModal();
        modal.classList.add('active');
    }

    closeStockModal() {
        const modal = document.getElementById('stockModal');
        if (modal) modal.classList.remove('active');
    }

    async setTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll('.stock-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        if (tab === 'raw') {
            await this.calculateStockDemands();
        }
        this.renderTabContent();
    }

    renderStockModal() {
        this.renderTabContent();
    }

    renderTabContent() {
        const contentEl = document.getElementById('stockModalTabContent');
        if (!contentEl) return;

        if (this.activeTab === 'raw') {
            this.renderRawMaterialsTab(contentEl);
        } else if (this.activeTab === 'direct') {
            this.renderDirectStockTab(contentEl);
        } else {
            this.renderMenuAvailabilityTab(contentEl);
        }
    }

    // Tab 1: Bahan Baku Master (Gramasi & Manajemen PO Smokehouse)
    renderRawMaterialsTab(container) {
        const products = productManager.products || [];
        const itemsNeedSmoking = this.rawMaterials.filter(m => (Number(m.stock) || 0) < 0);
        const itemsInTransit = this.rawMaterials.filter(m => ((this.transitDemand && this.transitDemand[m.id]) || 0) > 0);

        container.innerHTML = `
            <div class="stock-tab-header">
                <div>
                    <h4 style="font-size: 15px; font-weight: 800; color: var(--secondary); margin-bottom: 2px;">
                        🌾 Manajemen Stok & PO Smokehouse
                    </h4>
                    <p style="font-size: 12px; color: #64748B;">
                        Pantau stok ready di toko, stok transit (tagihan sementara), dan defisit daging yang harus segera dibelanjakan & diasap.
                    </p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button type="button" class="btn-copy-shopping-list" onclick="inventoryManager.copyShoppingList()">
                        📋 Salin Rekap Belanja Daging
                    </button>
                    <button type="button" class="btn-admin-add-new" style="padding: 7px 14px; font-size: 13px;" onclick="inventoryManager.openAddRawMaterialModal()">
                        + Tambah Bahan Baku
                    </button>
                </div>
            </div>

            ${(itemsNeedSmoking.length > 0 || itemsInTransit.length > 0) ? `
                <div class="production-summary-banner">
                    <div class="prod-banner-header">
                        <div class="prod-banner-title">
                            <span class="prod-fire-icon">🔥</span>
                            <div>
                                <strong style="font-size: 14px;">Rekap Kebutuhan Daging & Produksi Asap</strong>
                                <div style="font-size: 11px; opacity: 0.85;">Kalkulasi otomatis dari pesanan PO lunas & tagihan sementara</div>
                            </div>
                        </div>
                        <button type="button" class="btn-banner-copy-mini" onclick="inventoryManager.copyShoppingList()">
                            📋 Salin Untuk WhatsApp
                        </button>
                    </div>
                    <div class="prod-banner-body">
                        ${itemsNeedSmoking.length > 0 ? `
                            <div class="prod-banner-row">
                                <span class="prod-banner-tag tag-deficit">🔥 HASIL ASAP DIBUTUHKAN:</span>
                                <div class="prod-pills-list">
                                    ${itemsNeedSmoking.map(m => `
                                        <span class="prod-pill pill-deficit">
                                            <strong>${m.name}:</strong> ${Math.abs(Number(m.stock)).toLocaleString('id-ID')} ${m.unit} (${(Math.abs(Number(m.stock)) / 1000).toFixed(2)} kg matang)
                                        </span>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="prod-banner-row" style="margin-top: 6px;">
                                <span class="prod-banner-tag tag-raw">🛒 ESTIMASI BELANJA MENTAH (SUSUT ~30%):</span>
                                <div class="prod-pills-list">
                                    ${itemsNeedSmoking.map(m => {
                                        const deficitGrams = Math.abs(Number(m.stock));
                                        const rawGrams = Math.ceil(deficitGrams / 0.70);
                                        const rawKg = (rawGrams / 1000).toFixed(2);
                                        return `
                                            <span class="prod-pill pill-raw">
                                                <strong>${m.name} Mentah:</strong> ~${rawKg} kg <span style="font-size: 11px; opacity: 0.85;">(${rawGrams.toLocaleString('id-ID')} gr)</span>
                                            </span>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        ` : `
                            <div class="prod-banner-row">
                                <span class="prod-banner-tag tag-safe">✅ STOK READY AMAN:</span>
                                <span style="font-size: 12px; color: #166534; font-weight: 600;">Semua pesanan lunas saat ini terpenuhi oleh stok ready di toko.</span>
                            </div>
                        `}
                        ${itemsInTransit.length > 0 ? `
                            <div class="prod-banner-row" style="margin-top: 6px;">
                                <span class="prod-banner-tag tag-transit">🕒 STOK TRANSIT (BELUM BAYAR):</span>
                                <div class="prod-pills-list">
                                    ${itemsInTransit.map(m => {
                                        const tr = (this.transitDemand[m.id] || 0);
                                        const rawTrGrams = Math.ceil(tr / 0.70);
                                        const rawTrKg = (rawTrGrams / 1000).toFixed(2);
                                        return `
                                            <span class="prod-pill pill-transit">
                                                <strong>${m.name}:</strong> ${tr.toLocaleString('id-ID')} ${m.unit} <span style="font-size: 11px; opacity: 0.85;">(Beli mentah jika lunas: ~${rawTrKg} kg)</span>
                                            </span>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            <div class="raw-materials-grid">
                ${this.rawMaterials.map(mat => {
                    const netStock = Number(mat.stock) || 0;
                    const readyStock = Math.max(0, netStock);
                    const harusDiasap = Math.abs(Math.min(0, netStock));
                    const transit = (this.transitDemand && this.transitDemand[mat.id]) || 0;
                    const minStock = Number(mat.minStock) || 0;

                    // Cari seluruh pemakaian bahan baku ini (baik menu resep tunggal maupun varian menu)
                    const usages = [];
                    products.forEach(p => {
                        const hasVariants = p.variants && Array.isArray(p.variants) && p.variants.length > 0;
                        if (hasVariants) {
                            p.variants.forEach(v => {
                                const ing = (v.ingredients || []).find(i => i.rawMaterialId === mat.id);
                                if (ing && Number(ing.amount) > 0) {
                                    usages.push({
                                        productId: p.id,
                                        productName: p.name,
                                        variantName: v.name,
                                        amount: Number(ing.amount)
                                    });
                                }
                            });
                        } else if (p.stockType === 'raw_material' && p.rawMaterialId === mat.id) {
                            usages.push({
                                productId: p.id,
                                productName: p.name,
                                variantName: null,
                                amount: Number(p.rawMaterialAmount) || 0
                            });
                        }
                    });

                    let statusClass = 'status-safe';
                    let statusLabel = '✅ Stok Ready Aman';
                    if (harusDiasap > 0) {
                        statusClass = 'status-deficit';
                        statusLabel = `🔥 Harus Diasap (${harusDiasap.toLocaleString('id-ID')} ${mat.unit})`;
                    } else if (readyStock <= 0) {
                        statusClass = 'status-out';
                        statusLabel = '❌ Stok Ready Habis';
                    } else if (readyStock <= minStock) {
                        statusClass = 'status-low';
                        statusLabel = '⚠️ Stok Menipis';
                    }

                    return `
                        <div class="raw-material-card ${statusClass}">
                            <div class="raw-mat-top">
                                <div>
                                    <div class="raw-mat-name">${mat.name}</div>
                                    <span class="raw-mat-id">ID: ${mat.id}</span>
                                </div>
                                <span class="stock-status-pill ${statusClass}">${statusLabel}</span>
                            </div>

                            <!-- 3 METRIC TILES: READY, TRANSIT, HARUS DIASAP -->
                            <div class="stock-metrics-grid">
                                <div class="stock-metric-card metric-ready">
                                    <span class="stock-metric-label">Stok Ready</span>
                                    <div class="stock-metric-val">
                                        <span class="stock-val-num">${readyStock.toLocaleString('id-ID')}</span>
                                        <span class="stock-val-unit">${mat.unit}</span>
                                    </div>
                                    <span class="stock-metric-sub">Siap di Toko</span>
                                </div>

                                <div class="stock-metric-card metric-transit ${transit > 0 ? 'has-transit' : ''}">
                                    <span class="stock-metric-label">Stok Transit</span>
                                    <div class="stock-metric-val">
                                        <span class="stock-val-num">${transit.toLocaleString('id-ID')}</span>
                                        <span class="stock-val-unit">${mat.unit}</span>
                                    </div>
                                    <span class="stock-metric-sub">🕒 Belum Bayar</span>
                                </div>

                                <div class="stock-metric-card metric-deficit ${harusDiasap > 0 ? 'has-deficit' : ''}">
                                    <span class="stock-metric-label">🔥 Harus Diasap</span>
                                    <div class="stock-metric-val">
                                        <span class="stock-val-num">${harusDiasap.toLocaleString('id-ID')}</span>
                                        <span class="stock-val-unit">${mat.unit}</span>
                                    </div>
                                    <span class="stock-metric-sub">${harusDiasap > 0 ? `🛒 Beli: ~${(Math.ceil(harusDiasap / 0.70) / 1000).toFixed(2)} kg mentah` : 'Aman (0 gr)'}</span>
                                </div>
                            </div>

                            <div class="raw-mat-portions-box">
                                <div class="portions-box-title">Estimasi Porsi Menu (Dari Stok Ready):</div>
                                ${usages.length > 0 ? usages.map(u => {
                                    const portions = u.amount > 0 ? Math.floor(readyStock / u.amount) : 0;
                                    return `
                                        <div class="portion-row">
                                            <div class="portion-name-wrap" title="${u.productName}${u.variantName ? ' (' + u.variantName + ')' : ''} - ${u.amount} ${mat.unit}">
                                                <strong class="portion-name-text">${u.productName}</strong>
                                                ${u.variantName ? `<span class="badge-var-mini">${u.variantName}</span>` : ''} 
                                                <span class="portion-amount-text" style="color: #64748B; font-size: 11px;">(${u.amount} ${mat.unit}):</span>
                                            </div>
                                            <span class="portion-count ${portions === 0 ? 'text-danger' : 'text-success'}">
                                                <strong>${portions}</strong> porsi
                                            </span>
                                        </div>
                                    `;
                                }).join('') : '<div style="font-size: 11px; color: #94A3B8; font-style: italic;">Belum ada menu yang dihubungkan ke bahan ini.</div>'}
                            </div>

                            <div class="raw-mat-actions">
                                <div class="quick-restock-group">
                                    <span style="font-size: 11px; color: #64748B; font-weight: 700; width: 100%; margin-bottom: 2px;">+ Tambah Daging Matang:</span>
                                    <button type="button" class="btn-restock-pill" onclick="inventoryManager.quickAdjustStock('${mat.id}', 500)">+500 ${mat.unit}</button>
                                    <button type="button" class="btn-restock-pill" onclick="inventoryManager.quickAdjustStock('${mat.id}', 1000)">+1.000 ${mat.unit}</button>
                                    <button type="button" class="btn-restock-pill" onclick="inventoryManager.quickAdjustStock('${mat.id}', 2000)">+2.000 ${mat.unit}</button>
                                </div>
                                <div class="raw-mat-btn-row">
                                    <button type="button" class="btn-stock-custom-adjust" onclick="inventoryManager.openCustomAdjustModal('${mat.id}')">
                                        ✏️ Atur / Masuk Stok
                                    </button>
                                    <button type="button" class="btn-stock-delete" onclick="inventoryManager.handleDeleteRawMaterial('${mat.id}')" title="Hapus bahan baku">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // Tab 2: Stok Langsung (Barang Jadi)
    renderDirectStockTab(container) {
        const products = productManager.products || [];
        const directProducts = products.filter(p => p.stockType === 'direct');

        container.innerHTML = `
            <div class="stock-tab-header">
                <div>
                    <h4 style="font-size: 15px; font-weight: 800; color: var(--secondary); margin-bottom: 2px;">
                        📦 Stok Barang Jadi (Direct Stock)
                    </h4>
                    <p style="font-size: 12px; color: #64748B;">
                        Stok untuk produk kemasan/barang jadi yang dibeli per pcs/unit (contoh: Air Mineral botol).
                    </p>
                </div>
            </div>

            ${directProducts.length === 0 ? `
                <div style="text-align: center; padding: 40px; color: #94A3B8;">
                    <div style="font-size: 32px; margin-bottom: 8px;">🥤</div>
                    <div style="font-weight: 700;">Belum ada menu dengan tipe "Stok Barang Jadi"</div>
                    <div style="font-size: 12px; margin-top: 4px;">Anda dapat mengatur tipe stok produk melalui menu <strong>Kelola Menu</strong>.</div>
                </div>
            ` : `
                <div class="history-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th style="width: 45px; text-align: center;">#</th>
                                <th>Nama Menu / Produk</th>
                                <th style="width: 120px;">Kategori</th>
                                <th style="width: 130px;">Sisa Stok Saat Ini</th>
                                <th style="width: 260px;">Update Cepat Stok</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${directProducts.map((p, idx) => {
                                const stock = Number(p.directStock) || 0;
                                const isOut = stock <= 0;
                                const isLow = stock <= 5 && stock > 0;

                                let badgeClass = 'status-safe';
                                let badgeText = `${stock} unit`;
                                if (isOut) {
                                    badgeClass = 'status-out';
                                    badgeText = 'Habis (0)';
                                } else if (isLow) {
                                    badgeClass = 'status-low';
                                    badgeText = `${stock} unit (Menipis)`;
                                }

                                return `
                                    <tr>
                                        <td style="text-align: center; font-weight: 700; color: #64748B;">${idx + 1}</td>
                                        <td>
                                            <div class="admin-prod-identity">
                                                <span class="admin-prod-emoji">${p.emoji || '🥤'}</span>
                                                <div>
                                                    <div class="admin-prod-name">${p.name}</div>
                                                    <div class="admin-prod-code">Kode: <strong>${p.id}</strong></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span class="category-badge cat-${p.category}">${p.category}</span>
                                        </td>
                                        <td>
                                            <span class="stock-status-pill ${badgeClass}">${badgeText}</span>
                                        </td>
                                        <td>
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                <button type="button" class="btn-restock-pill" onclick="inventoryManager.adjustDirectStock('${p.id}', 6)">+6</button>
                                                <button type="button" class="btn-restock-pill" onclick="inventoryManager.adjustDirectStock('${p.id}', 12)">+12</button>
                                                <button type="button" class="btn-restock-pill" onclick="inventoryManager.adjustDirectStock('${p.id}', 24)">+24</button>
                                                <button type="button" class="btn-admin-action" style="padding: 4px 8px; font-size: 11px;" onclick="inventoryManager.promptSetDirectStock('${p.id}', ${stock})">Set Nilai</button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `}
        `;
    }

    // Tab 3: Ketersediaan Menu Keseluruhan
    renderMenuAvailabilityTab(container) {
        const products = productManager.products || [];

        container.innerHTML = `
            <div class="stock-tab-header">
                <div>
                    <h4 style="font-size: 15px; font-weight: 800; color: var(--secondary); margin-bottom: 2px;">
                        📋 Tinjauan Kesiapan Jual Seluruh Menu
                    </h4>
                    <p style="font-size: 12px; color: #64748B;">
                        Status ketersediaan porsi menu kasir dihitung secara otomatis berdasarkan sisa bahan baku atau stok langsung.
                    </p>
                </div>
            </div>

            <div class="history-table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th style="width: 45px; text-align: center;">#</th>
                            <th>Menu</th>
                            <th style="width: 140px;">Tipe Kontrol Stok</th>
                            <th style="width: 220px;">Sumber Bahan / Takaran</th>
                            <th style="width: 160px;">Porsi Siap Jual</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${products.map((p, idx) => {
                            const hasVariants = p.variants && Array.isArray(p.variants) && p.variants.length > 0;
                            const portions = this.getPortionsAvailable(p);
                            const stockType = p.stockType || 'unlimited';

                            let typeBadge = '<span class="badge-stock-type type-unlimited">Tanpa Batas</span>';
                            let detailText = 'Selalu tersedia';
                            let portionDisplay = '<span class="text-success font-bold">Tersedia (Bebas)</span>';

                            if (hasVariants) {
                                typeBadge = '<span class="badge-stock-type type-variant">✨ Multi-Varian</span>';
                                const varBreakdown = p.variants.map(v => {
                                    const vPortions = this.getVariantPortions(v);
                                    const ingTexts = (v.ingredients || []).map(ing => {
                                        const mat = this.getRawMaterialById(ing.rawMaterialId);
                                        return mat ? `${mat.name} (${ing.amount} ${mat.unit})` : '';
                                    }).filter(Boolean).join(' + ');

                                    let vBadge = '';
                                    if (vPortions === 0) {
                                        vBadge = '<strong class="text-danger">Habis (0)</strong>';
                                    } else if (vPortions === Infinity) {
                                        vBadge = '<strong class="text-success">Bebas</strong>';
                                    } else {
                                        vBadge = `<strong class="text-success">${vPortions} porsi</strong>`;
                                    }

                                    return `<div class="variant-avail-row">• <strong>${v.name}</strong>: ${vBadge} ${ingTexts ? `<span class="variant-avail-ing">(${ingTexts})</span>` : ''}</div>`;
                                }).join('');

                                detailText = `<div class="variant-avail-list">${varBreakdown}</div>`;

                                if (portions === 0) {
                                    portionDisplay = '<span class="stock-status-pill status-out">❌ Semua Habis</span>';
                                } else if (portions <= 5) {
                                    portionDisplay = `<span class="stock-status-pill status-low">⚠️ Sisa <strong>${portions}</strong> porsi total</span>`;
                                } else {
                                    portionDisplay = `<span class="stock-status-pill status-safe">✅ <strong>${portions}</strong> porsi total</span>`;
                                }
                            } else if (stockType === 'raw_material') {
                                const mat = this.getRawMaterialById(p.rawMaterialId);
                                const matName = mat ? mat.name : p.rawMaterialId;
                                const matStock = mat ? mat.stock : 0;
                                const unit = mat ? mat.unit : 'gr';
                                typeBadge = '<span class="badge-stock-type type-raw">Resep Bahan</span>';
                                detailText = `Bahan: <strong>${matName}</strong> (${p.rawMaterialAmount} ${unit}/porsi)<br><span style="font-size: 11px; color: #64748B;">Sisa bahan: ${matStock.toLocaleString('id-ID')} ${unit}</span>`;

                                if (portions === 0) {
                                    portionDisplay = '<span class="stock-status-pill status-out">❌ Habis (0 porsi)</span>';
                                } else if (portions <= 5) {
                                    portionDisplay = `<span class="stock-status-pill status-low">⚠️ Sisa <strong>${portions}</strong> porsi</span>`;
                                } else {
                                    portionDisplay = `<span class="stock-status-pill status-safe">✅ Sisa <strong>${portions}</strong> porsi</span>`;
                                }
                            } else if (stockType === 'direct') {
                                typeBadge = '<span class="badge-stock-type type-direct">Barang Jadi</span>';
                                detailText = `Stok fisik unit produk`;
                                if (portions === 0) {
                                    portionDisplay = '<span class="stock-status-pill status-out">❌ Habis (0 unit)</span>';
                                } else if (portions <= 5) {
                                    portionDisplay = `<span class="stock-status-pill status-low">⚠️ Sisa <strong>${portions}</strong> unit</span>`;
                                } else {
                                    portionDisplay = `<span class="stock-status-pill status-safe">✅ Sisa <strong>${portions}</strong> unit</span>`;
                                }
                            }

                            return `
                                <tr>
                                    <td style="text-align: center; font-weight: 700; color: #64748B;">${idx + 1}</td>
                                    <td>
                                        <div class="admin-prod-identity">
                                            <span class="admin-prod-emoji">${p.emoji || '🍗'}</span>
                                            <div>
                                                <div class="admin-prod-name">${p.name}</div>
                                                <div class="admin-prod-code">Kode: <strong>${p.id}</strong></div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>${typeBadge}</td>
                                    <td style="font-size: 12px;">${detailText}</td>
                                    <td>${portionDisplay}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // ================= AKSI RESTOCK & UPDATE =================

    async quickAdjustStock(rawMaterialId, addAmount) {
        const mat = this.getRawMaterialById(rawMaterialId);
        if (!mat) return;

        const prevStock = Number(mat.stock) || 0;
        const newStock = prevStock + Number(addAmount);
        mat.stock = newStock;

        try {
            await db.saveRawMaterial(mat);
            sounds.playSuccess();
            await this.calculateStockDemands();
            this.renderTabContent();
            if (typeof productManager !== 'undefined') {
                productManager.render();
            }
        } catch (e) {
            alert('Gagal menambah stok: ' + e.message);
        }
    }

    async adjustDirectStock(productId, addAmount) {
        const prod = productManager.getProductById(productId);
        if (!prod) return;

        prod.directStock = (Number(prod.directStock) || 0) + Number(addAmount);

        try {
            await db.saveProduct(prod);
            sounds.playSuccess();
            this.renderTabContent();
            productManager.render();
        } catch (e) {
            alert('Gagal update stok barang jadi: ' + e.message);
        }
    }

    async promptSetDirectStock(productId, currentStock) {
        const prod = productManager.getProductById(productId);
        if (!prod) return;

        const input = prompt(`Masukkan jumlah stok fisik untuk "${prod.name}":`, currentStock);
        if (input === null) return;

        const val = parseInt(input, 10);
        if (isNaN(val) || val < 0) {
            alert('Jumlah stok harus berupa angka positif!');
            return;
        }

        prod.directStock = val;
        try {
            await db.saveProduct(prod);
            sounds.playSuccess();
            this.renderTabContent();
            productManager.render();
        } catch (e) {
            alert('Gagal update stok: ' + e.message);
        }
    }

    openCustomAdjustModal(rawMaterialId) {
        const mat = this.getRawMaterialById(rawMaterialId);
        if (!mat) return;

        const modal = document.getElementById('rawMaterialAdjustModal');
        const title = document.getElementById('rawAdjustTitle');
        const idInput = document.getElementById('rawAdjustId');
        const nameInput = document.getElementById('rawAdjustName');
        const stockInput = document.getElementById('rawAdjustStock');
        const unitDisplay = document.getElementById('rawAdjustUnit');
        const minStockInput = document.getElementById('rawAdjustMinStock');

        const netStock = Number(mat.stock) || 0;
        const readyStock = Math.max(0, netStock);
        const harusDiasap = Math.abs(Math.min(0, netStock));
        const transit = (this.transitDemand && this.transitDemand[mat.id]) || 0;

        if (title) title.textContent = `Atur Stok: ${mat.name}`;
        if (idInput) idInput.value = mat.id;
        if (nameInput) nameInput.value = mat.name;
        if (stockInput) stockInput.value = netStock;
        if (unitDisplay) unitDisplay.textContent = mat.unit;
        if (minStockInput) minStockInput.value = mat.minStock || 0;

        let infoBox = document.getElementById('rawAdjustMetricsInfo');
        if (!infoBox && stockInput && stockInput.parentElement) {
            infoBox = document.createElement('div');
            infoBox.id = 'rawAdjustMetricsInfo';
            stockInput.parentElement.insertBefore(infoBox, stockInput);
        }
        if (infoBox) {
            infoBox.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; font-size: 11px;">
                    <div style="background: #F0FDF4; border: 1px solid #BBF7D0; padding: 6px 8px; border-radius: 6px; text-align: center;">
                        <div style="color: #166534; font-weight: 700;">Ready</div>
                        <div style="font-weight: 800; font-size: 13px; color: #15803D;">${readyStock.toLocaleString('id-ID')} ${mat.unit}</div>
                    </div>
                    <div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 6px 8px; border-radius: 6px; text-align: center;">
                        <div style="color: #92400E; font-weight: 700;">Transit</div>
                        <div style="font-weight: 800; font-size: 13px; color: #B45309;">${transit.toLocaleString('id-ID')} ${mat.unit}</div>
                    </div>
                    <div style="background: ${harusDiasap > 0 ? '#FEF2F2' : '#F8FAFC'}; border: 1px solid ${harusDiasap > 0 ? '#FECACA' : '#E2E8F0'}; padding: 6px 8px; border-radius: 6px; text-align: center;">
                        <div style="color: ${harusDiasap > 0 ? '#991B1B' : '#64748B'}; font-weight: 700;">🔥 Harus Diasap</div>
                        <div style="font-weight: 800; font-size: 13px; color: ${harusDiasap > 0 ? '#DC2626' : '#64748B'};">${harusDiasap.toLocaleString('id-ID')} ${mat.unit}</div>
                    </div>
                </div>
            `;
        }

        if (modal) modal.classList.add('active');
    }

    closeCustomAdjustModal() {
        const modal = document.getElementById('rawMaterialAdjustModal');
        if (modal) modal.classList.remove('active');
    }

    async handleSaveCustomAdjust(e) {
        e.preventDefault();
        const id = document.getElementById('rawAdjustId').value;
        const name = document.getElementById('rawAdjustName').value.trim();
        const stock = parseFloat(document.getElementById('rawAdjustStock').value) || 0;
        const minStock = parseFloat(document.getElementById('rawAdjustMinStock').value) || 0;

        const mat = this.getRawMaterialById(id);
        if (!mat) return;

        mat.name = name;
        mat.stock = stock;
        mat.minStock = minStock;

        try {
            await db.saveRawMaterial(mat);
            sounds.playSuccess();
            this.closeCustomAdjustModal();
            await this.calculateStockDemands();
            this.renderTabContent();
            if (typeof productManager !== 'undefined') {
                productManager.render();
            }
        } catch (err) {
            alert('Gagal menyimpan: ' + err.message);
        }
    }

    // Modal Tambah Bahan Baku Baru
    openAddRawMaterialModal() {
        const modal = document.getElementById('rawMaterialAddModal');
        const form = document.getElementById('formAddRawMaterial');
        if (form) form.reset();
        if (modal) modal.classList.add('active');
    }

    closeAddRawMaterialModal() {
        const modal = document.getElementById('rawMaterialAddModal');
        if (modal) modal.classList.remove('active');
    }

    async handleSaveNewRawMaterial(e) {
        e.preventDefault();
        const id = document.getElementById('newRawId').value.trim().toUpperCase();
        const name = document.getElementById('newRawName').value.trim();
        const stock = parseFloat(document.getElementById('newRawStock').value) || 0;
        const unit = document.getElementById('newRawUnit').value.trim() || 'gr';
        const minStock = parseFloat(document.getElementById('newRawMinStock').value) || 0;

        if (!id || !name) {
            alert('ID dan Nama Bahan Baku wajib diisi!');
            return;
        }

        const existing = this.getRawMaterialById(id);
        if (existing) {
            alert(`ID "${id}" sudah digunakan oleh "${existing.name}". Silakan gunakan ID lain.`);
            return;
        }

        const newMat = {
            id,
            name,
            stock,
            unit,
            minStock
        };

        try {
            await db.saveRawMaterial(newMat);
            await this.loadRawMaterials();
            sounds.playSuccess();
            this.closeAddRawMaterialModal();
            this.renderTabContent();
        } catch (err) {
            alert('Gagal menambah bahan baku: ' + err.message);
        }
    }

    async handleDeleteRawMaterial(id) {
        const mat = this.getRawMaterialById(id);
        if (!mat) return;

        // Cek apakah ada menu yang memakai bahan ini
        const products = productManager.products || [];
        const inUse = products.filter(p => p.stockType === 'raw_material' && p.rawMaterialId === id);

        if (inUse.length > 0) {
            const menuNames = inUse.map(p => p.name).join(', ');
            alert(`Bahan baku "${mat.name}" tidak dapat dihapus karena sedang digunakan oleh menu: ${menuNames}. Silakan ubah pengaturan stok menu tersebut terlebih dahulu.`);
            return;
        }

        if (!confirm(`Yakin ingin menghapus bahan baku master "${mat.name}"?`)) return;

        try {
            await db.deleteRawMaterial(id);
            await this.loadRawMaterials();
            sounds.playSuccess();
            this.renderTabContent();
        } catch (err) {
            alert('Gagal menghapus bahan baku: ' + err.message);
        }
    }

    // Dipanggil saat transaksi kasir selesai
    async deductOrderStock(items) {
        try {
            await db.deductStockForOrder(items);
            await this.loadRawMaterials();
            await this.calculateStockDemands();
            await productManager.loadProducts();
            productManager.render();
        } catch (e) {
            console.warn('Gagal memotong stok:', e);
        }
    }
}

const inventoryManager = new InventoryManager();
