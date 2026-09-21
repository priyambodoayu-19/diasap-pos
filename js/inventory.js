/**
 * DIASAP POS - Inventory & Raw Material Stock Manager
 * Mengelola stok bahan baku master (gramasi resep) dan stok langsung barang jadi
 */

class InventoryManager {
    constructor() {
        this.rawMaterials = [];
        this.transitDemand = {};
        this.activePoDemand = {};
        this.activeTab = 'raw'; // 'raw' | 'direct' | 'menu' | 'history'
        this.cachedStockLogs = [];
        this.historyFilterMaterial = 'all';
        this.historyFilterType = 'all';
        this.historyFilterAuthor = 'all';
        this.historySearchTerm = '';
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

    findMatchingRaw(cookedMat) {
        if (!cookedMat || !cookedMat.name) return null;
        const cName = cookedMat.name.toLowerCase();
        return this.rawMaterials.find(rm => {
            const rName = (rm.name || '').toLowerCase();
            if (!rName.includes('mentah')) return false;
            if (cName.includes('dada') && rName.includes('dada')) return true;
            if (cName.includes('paha') && rName.includes('paha')) return true;
            if (cName.includes('sapi') && rName.includes('sapi')) return true;
            return false;
        });
    }

    findMatchingCooked(rawMat) {
        if (!rawMat || !rawMat.name) return null;
        const rName = rawMat.name.toLowerCase();
        return this.rawMaterials.find(cm => {
            const cName = (cm.name || '').toLowerCase();
            if (cName.includes('mentah')) return false;
            if (rName.includes('dada') && cName.includes('dada')) return true;
            if (rName.includes('paha') && cName.includes('paha')) return true;
            if (rName.includes('sapi') && cName.includes('sapi')) return true;
            return false;
        });
    }

    async quickAdjustStock(rawMaterialId, deltaGrams) {
        const mat = this.getRawMaterialById(rawMaterialId);
        if (!mat) return;
        const current = Number(mat.stock) || 0;
        mat.stock = current + Number(deltaGrams);
        try {
            await db.saveRawMaterial(mat);

            // Catat riwayat perubahan stok
            const author = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
            const diff = Number(deltaGrams);
            const changeType = diff >= 0 ? 'add' : 'reduce';
            const actionText = diff >= 0 ? 'Penambahan cepat' : 'Pengurangan cepat';
            await db.addStockLog({
                materialId: mat.id,
                materialName: mat.name,
                itemType: 'raw_material',
                changeType: changeType,
                amount: diff,
                unit: mat.unit || 'gr',
                stockBefore: current,
                stockAfter: mat.stock,
                author: author,
                notes: `${actionText} (${diff > 0 ? '+' : ''}${diff.toLocaleString('id-ID')} ${mat.unit || 'gr'})`
            }).catch(err => console.warn('Gagal catat stock log:', err));

            if (typeof sounds !== 'undefined') sounds.playSuccess();
            await this.calculateStockDemands();
            this.renderTabContent();
            if (typeof productManager !== 'undefined') {
                productManager.render();
            }
        } catch (e) {
            alert('Gagal mengubah stok: ' + e.message);
        }
    }

    async quickAdjustStockWithConfirm(rawMaterialId, deltaGrams) {
        const mat = this.getRawMaterialById(rawMaterialId);
        if (!mat) return;
        const unit = mat.unit || 'gr';
        const absVal = Math.abs(deltaGrams);
        const displayVal = (unit === 'gr' && absVal >= 1000) 
            ? `${(absVal / 1000).toFixed(1)} kg (${absVal.toLocaleString('id-ID')} gr)`
            : `${absVal.toLocaleString('id-ID')} ${unit}`;
        
        if (confirm(`Yakin ingin MENGURANGI stok ${mat.name} sebesar ${displayVal}?`)) {
            await this.quickAdjustStock(rawMaterialId, deltaGrams);
        }
    }

    copyShoppingList() {
        const SHRINKAGE_RATE = 0.30; // Susut 30% dari mentah ke matang (faktor 0.70)
        const cookedItems = this.rawMaterials.filter(m => !(m.name || '').toLowerCase().includes('mentah'));
        const rawFreezerItems = this.rawMaterials.filter(m => (m.name || '').toLowerCase().includes('mentah'));
        const needs = cookedItems.filter(m => (Number(m.stock) || 0) < 0);

        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

        const lines = [
            '📋 REKAP BELANJA & ASAP - DIASAP',
            `⏰ ${dateStr}, ${timeStr}`,
            ''
        ];

        // 1. BELI KE PASAR (Mentah)
        lines.push('🛒 1. BELI KE PASAR (Mentah):');
        if (needs.length > 0) {
            needs.forEach(m => {
                const deficit = Math.abs(Number(m.stock));
                const rawGrams = Math.ceil(deficit / (1 - SHRINKAGE_RATE));
                const rawMatch = this.findMatchingRaw(m);
                const freezerStock = rawMatch ? Math.max(0, Number(rawMatch.stock) || 0) : 0;
                const stillNeedGrams = Math.max(0, rawGrams - freezerStock);
                const stillNeedKg = (stillNeedGrams / 1000).toFixed(1);
                const itemName = rawMatch ? rawMatch.name : (m.name + ' Mentah');

                if (stillNeedGrams <= 0) {
                    lines.push(`• ${itemName}: ✅ CUKUP (Tidak perlu beli)`);
                } else {
                    lines.push(`• ${itemName}: ~${stillNeedKg} kg (${stillNeedGrams.toLocaleString('id-ID')} gr)`);
                }
            });
        } else {
            lines.push('• ✅ Aman (Semua kebutuhan terpenuhi)');
        }

        // 2. KEBUTUHAN ASAP DAPUR
        lines.push('');
        lines.push('🔥 2. KEBUTUHAN ASAP DAPUR:');
        if (needs.length > 0) {
            needs.forEach(m => {
                const deficit = Math.abs(Number(m.stock));
                const rawGrams = Math.ceil(deficit / (1 - SHRINKAGE_RATE));
                const rawKg = (rawGrams / 1000).toFixed(1);
                const deficitKg = (deficit / 1000).toFixed(1);
                
                let shortName = m.name.replace(/ayam\s*asap\s*/i, '').replace(/daging\s*/i, '').trim();
                shortName = shortName.charAt(0).toUpperCase() + shortName.slice(1);

                lines.push(`• ${shortName} : ${rawKg} kg mentah ➔ target ${deficitKg} kg matang`);
            });
        } else {
            lines.push('• Nihil (Stok matang ready cukup)');
        }

        // 3. SISA FREEZER SAAT INI
        lines.push('');
        lines.push('🧊 3. SISA FREEZER SAAT INI:');
        if (rawFreezerItems.length > 0) {
            rawFreezerItems.forEach(m => {
                const stock = Math.max(0, Number(m.stock) || 0);
                const stockKg = (stock / 1000).toFixed(1);
                let shortName = m.name.replace(/ayam\s*/i, '').replace(/\s*mentah/i, '').replace(/daging\s*/i, '').trim();
                shortName = shortName.charAt(0).toUpperCase() + shortName.slice(1);
                lines.push(`• ${shortName} : ${stockKg} kg`);
            });
        } else {
            lines.push('• (Belum ada catatan stok mentah)');
        }

        // Info jika ada tagihan sementara belum bayar (transit)
        const transitItems = cookedItems.filter(m => ((this.transitDemand && this.transitDemand[m.id]) || 0) > 0);
        if (transitItems.length > 0) {
            lines.push('');
            const transitTexts = transitItems.map(m => {
                const tr = this.transitDemand[m.id];
                const rawTrGrams = Math.ceil(tr / (1 - SHRINKAGE_RATE));
                const rawTrKg = (rawTrGrams / 1000).toFixed(1);
                let shortName = m.name.replace(/ayam\s*asap\s*/i, '').replace(/daging\s*/i, '').trim().toLowerCase();
                return `${shortName} +${rawTrKg} kg`;
            });
            lines.push(`*(Info: Ada pending belum lunas ${transitTexts.join(', ')})*`);
        }

        const text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                if (typeof sounds !== 'undefined') sounds.playSuccess();
                alert('📋 Rekap belanja & asap ringkas berhasil disalin!\nSilakan paste ke WhatsApp.');
            }).catch(() => {
                prompt('Salin teks rekap berikut:', text);
            });
        } else {
            prompt('Salin teks rekap berikut:', text);
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
        } else if (tab === 'history') {
            try {
                this.cachedStockLogs = await db.getStockLogs(300);
            } catch (e) {
                console.warn('Gagal memuat stock logs:', e);
            }
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
        } else if (this.activeTab === 'menu') {
            this.renderMenuAvailabilityTab(contentEl);
        } else if (this.activeTab === 'history') {
            this.renderStockHistoryTab(contentEl);
        }
    }

    async openHistoryForMaterial(materialId) {
        this.historyFilterMaterial = materialId || 'all';
        this.historyFilterType = 'all';
        this.historyFilterAuthor = 'all';
        this.historySearchTerm = '';
        await this.setTab('history');
    }

    // Tab 1: Bahan Baku Master (Gramasi & Manajemen PO Smokehouse)
    renderRawMaterialsTab(container) {
        const products = productManager.products || [];
        const cookedMaterials = this.rawMaterials.filter(m => !(m.name || '').toLowerCase().includes('mentah'));
        const rawFreezerMaterials = this.rawMaterials.filter(m => (m.name || '').toLowerCase().includes('mentah'));

        const itemsNeedSmoking = cookedMaterials.filter(m => (Number(m.stock) || 0) < 0);
        const itemsInTransit = cookedMaterials.filter(m => ((this.transitDemand && this.transitDemand[m.id]) || 0) > 0);

        container.innerHTML = `
            <div class="stock-tab-header">
                <div>
                    <h4 style="font-size: 15px; font-weight: 800; color: var(--secondary); margin-bottom: 2px;">
                        🌾 Manajemen Stok & PO Smokehouse
                    </h4>
                    <p style="font-size: 12px; color: #64748B;">
                        Pantau stok daging matang di toko, stok transit (tagihan sementara), serta persediaan daging mentah di freezer.
                    </p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button type="button" class="btn-stock-history-nav" onclick="inventoryManager.setTab('history')">
                        📜 Lihat Riwayat Stok
                    </button>
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
                                <span class="prod-banner-tag tag-raw">🛒 ESTIMASI MENTAH (SUSUT ~30%) & CEK FREEZER:</span>
                                <div class="prod-pills-list">
                                    ${itemsNeedSmoking.map(m => {
                                        const deficitGrams = Math.abs(Number(m.stock));
                                        const rawGrams = Math.ceil(deficitGrams / 0.70);
                                        const rawKg = (rawGrams / 1000).toFixed(2);
                                        
                                        const rawMatch = this.findMatchingRaw(m);
                                        const freezerStock = rawMatch ? Math.max(0, Number(rawMatch.stock) || 0) : 0;
                                        const stillNeedGrams = Math.max(0, rawGrams - freezerStock);
                                        const stillNeedKg = (stillNeedGrams / 1000).toFixed(2);

                                        if (freezerStock >= rawGrams) {
                                            return `
                                                <span class="prod-pill pill-safe">
                                                    <strong>${rawMatch ? rawMatch.name : m.name + ' Mentah'}:</strong> ✅ Cukup di Freezer! (Ada ${(freezerStock / 1000).toFixed(2)} kg, butuh ~${rawKg} kg)
                                                </span>
                                            `;
                                        } else if (freezerStock > 0) {
                                            return `
                                                <span class="prod-pill pill-warning">
                                                    <strong>${rawMatch ? rawMatch.name : m.name + ' Mentah'}:</strong> ⚠️ Ada ${(freezerStock / 1000).toFixed(2)} kg di freezer -> Beli ~${stillNeedKg} kg lagi
                                                </span>
                                            `;
                                        } else {
                                            return `
                                                <span class="prod-pill pill-raw">
                                                    <strong>${rawMatch ? rawMatch.name : m.name + ' Mentah'}:</strong> 🛒 Beli ~${rawKg} kg (${rawGrams.toLocaleString('id-ID')} gr)
                                                </span>
                                            `;
                                        }
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

            <!-- SECTION 1: DAGING ASAP MATANG -->
            <div class="stock-section-title-wrap">
                <h5 class="stock-section-title">🔥 Daging Asap Matang (Siap Saji / Resep Menu Kasir)</h5>
                <span class="stock-section-desc">Stok daging matang yang siap dipotong untuk pesanan pelanggan. Mengalami defisit jika ada PO masuk.</span>
            </div>

            <div class="raw-materials-grid">
                ${cookedMaterials.map(mat => {
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
                                    <span class="raw-mat-id">ID: ${mat.id} • Daging Matang</span>
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
                                    <span style="font-size: 11px; color: #166534; font-weight: 800; width: 100%; margin-bottom: 2px;">➕ Tambah Daging Matang (Asap):</span>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 500)">+500 ${mat.unit}</button>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 1000)">+1.000 ${mat.unit}</button>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 2000)">+2.000 ${mat.unit}</button>
                                </div>
                                <div class="quick-restock-group" style="margin-top: 4px;">
                                    <span style="font-size: 11px; color: #991B1B; font-weight: 800; width: 100%; margin-bottom: 2px;">➖ Kurangi Daging Matang:</span>
                                    <button type="button" class="btn-restock-pill btn-pill-reduce" onclick="inventoryManager.quickAdjustStockWithConfirm('${mat.id}', -250)">-250 ${mat.unit}</button>
                                    <button type="button" class="btn-restock-pill btn-pill-reduce" onclick="inventoryManager.quickAdjustStockWithConfirm('${mat.id}', -500)">-500 ${mat.unit}</button>
                                    <button type="button" class="btn-restock-pill btn-pill-reduce" onclick="inventoryManager.quickAdjustStockWithConfirm('${mat.id}', -1000)">-1.000 ${mat.unit}</button>
                                </div>
                                <div class="raw-mat-btn-row" style="margin-top: 6px;">
                                    <button type="button" class="btn-stock-custom-adjust" onclick="inventoryManager.openCustomAdjustModal('${mat.id}')">
                                        ✏️ Atur / Masuk Stok (+ / -)
                                    </button>
                                    <button type="button" class="btn-stock-history-mini" onclick="inventoryManager.openHistoryForMaterial('${mat.id}')" title="Lihat riwayat mutasi stok ${mat.name}">
                                        📜 Riwayat
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

            <!-- SECTION 2: DAGING MENTAH FREEZER -->
            <div class="stock-section-title-wrap" style="margin-top: 24px;">
                <h5 class="stock-section-title">🥩 Persediaan Daging Mentah (Freezer / Chiller)</h5>
                <span class="stock-section-desc">Catatan persediaan fisik daging mentah di freezer. Tambah stok saat belanja dari pasar / supplier.</span>
            </div>

            <div class="raw-materials-grid">
                ${rawFreezerMaterials.map(mat => {
                    const freezerStock = Math.max(0, Number(mat.stock) || 0);
                    const minStock = Number(mat.minStock) || 0;
                    
                    const cookedMatch = this.findMatchingCooked(mat);
                    const harusDiasap = cookedMatch ? Math.abs(Math.min(0, Number(cookedMatch.stock) || 0)) : 0;
                    const rawNeededGrams = Math.ceil(harusDiasap / 0.70);
                    
                    let shoppingStatusText = '✅ Stok Aman';
                    let shoppingStatusClass = 'metric-safe';
                    let shoppingSubText = 'Tidak ada defisit PO';
                    
                    if (harusDiasap > 0) {
                        if (freezerStock >= rawNeededGrams) {
                            shoppingStatusText = '✅ Cukup di Freezer';
                            shoppingStatusClass = 'metric-safe';
                            shoppingSubText = `Sisa ~${((freezerStock - rawNeededGrams) / 1000).toFixed(2)} kg di freezer`;
                        } else {
                            const stillNeed = rawNeededGrams - freezerStock;
                            shoppingStatusText = `🛒 Beli ~${(stillNeed / 1000).toFixed(2)} kg`;
                            shoppingStatusClass = 'metric-deficit has-deficit';
                            shoppingSubText = freezerStock > 0 ? `Ada ${(freezerStock / 1000).toFixed(2)} kg di freezer` : 'Freezer kosong';
                        }
                    }

                    return `
                        <div class="raw-material-card card-raw-meat">
                            <div class="raw-mat-top">
                                <div>
                                    <div class="raw-mat-name" style="color: #0369A1;">🥩 ${mat.name}</div>
                                    <span class="raw-mat-id">ID: ${mat.id} • Daging Mentah Freezer</span>
                                </div>
                                <span class="stock-status-pill ${freezerStock <= 0 ? 'status-out' : (freezerStock <= minStock ? 'status-low' : 'status-safe')}">
                                    ${freezerStock <= 0 ? '❌ Kosong' : (freezerStock <= minStock ? '⚠️ Menipis' : '✅ Ada di Freezer')}
                                </span>
                            </div>

                            <div class="stock-metrics-grid">
                                <div class="stock-metric-card metric-ready" style="background: #F0F9FF; border-color: #BAE6FD;">
                                    <span class="stock-metric-label" style="color: #0369A1;">Stok di Freezer</span>
                                    <div class="stock-metric-val">
                                        <span class="stock-val-num" style="color: #0284C7;">${(freezerStock / 1000).toFixed(2)}</span>
                                        <span class="stock-val-unit">kg</span>
                                    </div>
                                    <span class="stock-metric-sub">${freezerStock.toLocaleString('id-ID')} gr fisik</span>
                                </div>

                                <div class="stock-metric-card" style="background: #FFFBEB; border-color: #FDE68A;">
                                    <span class="stock-metric-label" style="color: #92400E;">Butuh Diasap</span>
                                    <div class="stock-metric-val">
                                        <span class="stock-val-num" style="color: #B45309;">~${(rawNeededGrams / 1000).toFixed(2)}</span>
                                        <span class="stock-val-unit">kg</span>
                                    </div>
                                    <span class="stock-metric-sub">${harusDiasap > 0 ? `Penuhi ${harusDiasap.toLocaleString('id-ID')} gr matang` : '0 gr (Stok Cukup)'}</span>
                                </div>

                                <div class="stock-metric-card ${shoppingStatusClass}">
                                    <span class="stock-metric-label">Status Belanja Pasar</span>
                                    <div class="stock-metric-val" style="font-size: 14px; font-weight: 800;">
                                        ${shoppingStatusText}
                                    </div>
                                    <span class="stock-metric-sub">${shoppingSubText}</span>
                                </div>
                            </div>

                            <div class="raw-mat-actions" style="margin-top: 14px;">
                                <div class="quick-restock-group">
                                    <span style="font-size: 11px; color: #0369A1; font-weight: 800; width: 100%; margin-bottom: 2px;">➕ Tambah Belanja Mentah:</span>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 1000)">+1 kg</button>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 2000)">+2 kg</button>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 5000)">+5 kg</button>
                                    <button type="button" class="btn-restock-pill btn-pill-add" onclick="inventoryManager.quickAdjustStock('${mat.id}', 10000)">+10 kg</button>
                                </div>
                                <div class="quick-restock-group" style="margin-top: 4px;">
                                    <span style="font-size: 11px; color: #991B1B; font-weight: 800; width: 100%; margin-bottom: 2px;">➖ Kurangi Mentah (Ambil / Susut):</span>
                                    <button type="button" class="btn-restock-pill btn-pill-reduce" onclick="inventoryManager.quickAdjustStockWithConfirm('${mat.id}', -1000)">-1 kg</button>
                                    <button type="button" class="btn-restock-pill btn-pill-reduce" onclick="inventoryManager.quickAdjustStockWithConfirm('${mat.id}', -2000)">-2 kg</button>
                                    <button type="button" class="btn-restock-pill btn-pill-reduce" onclick="inventoryManager.quickAdjustStockWithConfirm('${mat.id}', -5000)">-5 kg</button>
                                </div>
                                <div class="raw-mat-btn-row" style="margin-top: 6px;">
                                    <button type="button" class="btn-stock-custom-adjust" onclick="inventoryManager.openCustomAdjustModal('${mat.id}')">
                                        ✏️ Atur / Opname Mentah (+ / -)
                                    </button>
                                    <button type="button" class="btn-stock-history-mini" onclick="inventoryManager.openHistoryForMaterial('${mat.id}')" title="Lihat riwayat mutasi stok ${mat.name}">
                                        📜 Riwayat
                                    </button>
                                    <button type="button" class="btn-stock-delete" onclick="inventoryManager.handleDeleteRawMaterial('${mat.id}')" title="Hapus bahan mentah">
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
                                                <button type="button" class="btn-stock-history-mini" style="padding: 4px 8px; font-size: 11px;" onclick="inventoryManager.openHistoryForMaterial('${p.id}')" title="Lihat riwayat stok ${p.name}">📜 Riwayat</button>
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

        const prev = Number(prod.directStock) || 0;
        prod.directStock = prev + Number(addAmount);

        try {
            await db.saveProduct(prod);

            const author = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
            const num = Number(addAmount);
            await db.addStockLog({
                materialId: prod.id,
                materialName: prod.name,
                itemType: 'direct_product',
                changeType: num >= 0 ? 'add' : 'reduce',
                amount: num,
                unit: 'pcs',
                stockBefore: prev,
                stockAfter: prod.directStock,
                author: author,
                notes: `Restock barang jadi (${num >= 0 ? '+' : ''}${num} pcs)`
            }).catch(err => console.warn('Gagal catat stock log:', err));

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

        const prev = Number(prod.directStock) || 0;
        prod.directStock = val;
        try {
            await db.saveProduct(prod);

            const author = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
            await db.addStockLog({
                materialId: prod.id,
                materialName: prod.name,
                itemType: 'direct_product',
                changeType: 'set',
                amount: val - prev,
                unit: 'pcs',
                stockBefore: prev,
                stockAfter: val,
                author: author,
                notes: 'Set manual stok barang jadi'
            }).catch(err => console.warn('Gagal catat stock log:', err));

            sounds.playSuccess();
            this.renderTabContent();
            productManager.render();
        } catch (e) {
            alert('Gagal update stok: ' + e.message);
        }
    }

    openCustomAdjustModal(rawMaterialId, defaultMode = 'add') {
        const mat = this.getRawMaterialById(rawMaterialId);
        if (!mat) return;

        const modal = document.getElementById('rawMaterialAdjustModal');
        const title = document.getElementById('rawAdjustTitle');
        const idInput = document.getElementById('rawAdjustId');
        const nameInput = document.getElementById('rawAdjustName');
        const minStockInput = document.getElementById('rawAdjustMinStock');
        const amountInput = document.getElementById('rawAdjustAmountInput');

        const netStock = Number(mat.stock) || 0;
        const readyStock = Math.max(0, netStock);
        const harusDiasap = Math.abs(Math.min(0, netStock));
        const transit = (this.transitDemand && this.transitDemand[mat.id]) || 0;
        const unit = mat.unit || 'gr';

        this.adjustModalState = {
            materialId: mat.id,
            mode: defaultMode,
            currentStock: netStock,
            unit: unit
        };

        if (title) title.textContent = `Atur Stok: ${mat.name}`;
        if (idInput) idInput.value = mat.id;
        if (nameInput) nameInput.value = mat.name;
        if (minStockInput) minStockInput.value = mat.minStock || 0;
        if (amountInput) amountInput.value = '';

        const authorInput = document.getElementById('rawAdjustAuthor');
        const notesInput = document.getElementById('rawAdjustNotes');
        if (authorInput) {
            authorInput.value = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
        }
        if (notesInput) {
            notesInput.value = '';
        }

        document.querySelectorAll('.raw-unit-label').forEach(el => el.textContent = unit);
        const badgeEl = document.getElementById('rawAdjustInputUnitBadge');
        if (badgeEl) badgeEl.textContent = unit;

        const infoBox = document.getElementById('rawAdjustMetricsInfo');
        if (infoBox) {
            const isMentah = (mat.name || '').toLowerCase().includes('mentah');
            if (isMentah) {
                const cookedMatch = this.findMatchingCooked(mat);
                const matangDefisit = cookedMatch ? Math.abs(Math.min(0, Number(cookedMatch.stock) || 0)) : 0;
                const butuhMentah = Math.ceil(matangDefisit / 0.70);
                infoBox.innerHTML = `
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 12px; font-size: 11px;">
                        <div style="background: #F0F9FF; border: 1px solid #BAE6FD; padding: 6px 8px; border-radius: 6px; text-align: center;">
                            <div style="color: #0369A1; font-weight: 700;">🧊 Di Freezer</div>
                            <div style="font-weight: 800; font-size: 13px; color: #0284C7;">${readyStock.toLocaleString('id-ID')} ${unit}</div>
                        </div>
                        <div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 6px 8px; border-radius: 6px; text-align: center;">
                            <div style="color: #92400E; font-weight: 700;">Butuh Diasap</div>
                            <div style="font-weight: 800; font-size: 13px; color: #B45309;">~${butuhMentah.toLocaleString('id-ID')} ${unit}</div>
                        </div>
                    </div>
                `;
            } else {
                infoBox.innerHTML = `
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; font-size: 11px;">
                        <div style="background: #F0FDF4; border: 1px solid #BBF7D0; padding: 6px 8px; border-radius: 6px; text-align: center;">
                            <div style="color: #166534; font-weight: 700;">Ready</div>
                            <div style="font-weight: 800; font-size: 13px; color: #15803D;">${readyStock.toLocaleString('id-ID')} ${unit}</div>
                        </div>
                        <div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 6px 8px; border-radius: 6px; text-align: center;">
                            <div style="color: #92400E; font-weight: 700;">Transit</div>
                            <div style="font-weight: 800; font-size: 13px; color: #B45309;">${transit.toLocaleString('id-ID')} ${unit}</div>
                        </div>
                        <div style="background: ${harusDiasap > 0 ? '#FEF2F2' : '#F8FAFC'}; border: 1px solid ${harusDiasap > 0 ? '#FECACA' : '#E2E8F0'}; padding: 6px 8px; border-radius: 6px; text-align: center;">
                            <div style="color: ${harusDiasap > 0 ? '#991B1B' : '#64748B'}; font-weight: 700;">🔥 Harus Diasap</div>
                            <div style="font-weight: 800; font-size: 13px; color: ${harusDiasap > 0 ? '#DC2626' : '#64748B'};">${harusDiasap.toLocaleString('id-ID')} ${unit}</div>
                        </div>
                    </div>
                `;
            }
        }

        this.setAdjustMode(defaultMode);

        if (modal) modal.classList.add('active');
        setTimeout(() => {
            if (amountInput) amountInput.focus();
        }, 150);
    }

    closeCustomAdjustModal() {
        const modal = document.getElementById('rawMaterialAdjustModal');
        if (modal) modal.classList.remove('active');
    }

    setAdjustMode(mode) {
        if (!this.adjustModalState) return;
        this.adjustModalState.mode = mode;
        const unit = this.adjustModalState.unit || 'gr';

        const btnAdd = document.getElementById('btnModeAdd');
        const btnReduce = document.getElementById('btnModeReduce');
        const btnSet = document.getElementById('btnModeSet');
        if (btnAdd) btnAdd.classList.toggle('active', mode === 'add');
        if (btnReduce) btnReduce.classList.toggle('active', mode === 'reduce');
        if (btnSet) btnSet.classList.toggle('active', mode === 'set');

        const inputLabel = document.getElementById('rawAdjustInputLabel');
        const helpText = document.getElementById('rawAdjustHelpText');
        const submitBtn = document.getElementById('btnSubmitAdjust');
        const presetsLabel = document.getElementById('rawAdjustPresetsLabel');
        const presetsContainer = document.getElementById('rawAdjustPresetsContainer');
        const amountInput = document.getElementById('rawAdjustAmountInput');

        let presets = [];
        if (mode === 'add') {
            if (inputLabel) inputLabel.innerHTML = `Jumlah Penambahan (<span class="raw-unit-label">${unit}</span>) <span class="text-danger">*</span>`;
            if (helpText) helpText.textContent = 'Masukkan jumlah hasil smoke matang atau daging belanja masuk.';
            if (submitBtn) submitBtn.textContent = '➕ Simpan Penambahan (+)';
            if (presetsLabel) presetsLabel.textContent = 'Pilihan Cepat Tambah (+):';
            
            if (unit === 'gr') {
                presets = [
                    { label: '+250 gr', val: 250 },
                    { label: '+500 gr', val: 500 },
                    { label: '+1.000 gr', val: 1000 },
                    { label: '+2.000 gr', val: 2000 },
                    { label: '+5.000 gr', val: 5000 }
                ];
            } else if (unit === 'kg') {
                presets = [
                    { label: '+0.5 kg', val: 0.5 },
                    { label: '+1 kg', val: 1 },
                    { label: '+2 kg', val: 2 },
                    { label: '+5 kg', val: 5 },
                    { label: '+10 kg', val: 10 }
                ];
            } else {
                presets = [
                    { label: '+1', val: 1 },
                    { label: '+5', val: 5 },
                    { label: '+10', val: 10 },
                    { label: '+20', val: 20 }
                ];
            }
        } else if (mode === 'reduce') {
            if (inputLabel) inputLabel.innerHTML = `Jumlah Pengurangan (<span class="raw-unit-label">${unit}</span>) <span class="text-danger">*</span>`;
            if (helpText) helpText.textContent = 'Masukkan jumlah daging susut, rusak, sample, atau koreksi berkurang.';
            if (submitBtn) submitBtn.textContent = '➖ Simpan Pengurangan (-)';
            if (presetsLabel) presetsLabel.textContent = 'Pilihan Cepat Kurang (-):';
            
            if (unit === 'gr') {
                presets = [
                    { label: '-100 gr', val: 100 },
                    { label: '-250 gr', val: 250 },
                    { label: '-500 gr', val: 500 },
                    { label: '-1.000 gr', val: 1000 }
                ];
            } else if (unit === 'kg') {
                presets = [
                    { label: '-0.5 kg', val: 0.5 },
                    { label: '-1 kg', val: 1 },
                    { label: '-2 kg', val: 2 },
                    { label: '-5 kg', val: 5 }
                ];
            } else {
                presets = [
                    { label: '-1', val: 1 },
                    { label: '-5', val: 5 },
                    { label: '-10', val: 10 }
                ];
            }
        } else {
            // mode === 'set'
            if (inputLabel) inputLabel.innerHTML = `Jumlah Total Stok Fisik Baru (<span class="raw-unit-label">${unit}</span>) <span class="text-danger">*</span>`;
            if (helpText) helpText.textContent = 'Set nilai fisik langsung (hasil stok opname total di toko).';
            if (submitBtn) submitBtn.textContent = '📝 Simpan Stok Total';
            if (presetsLabel) presetsLabel.textContent = 'Pilihan Cepat:';
            presets = [
                { label: '0 (Kosongkan)', val: 0 },
                { label: `Stok Saat Ini (${this.adjustModalState.currentStock.toLocaleString('id-ID')})`, val: this.adjustModalState.currentStock }
            ];
        }

        if (presetsContainer) {
            presetsContainer.innerHTML = presets.map(p => `
                <button type="button" class="btn-modal-preset-pill ${mode === 'add' ? 'preset-add' : (mode === 'reduce' ? 'preset-reduce' : '')}" onclick="inventoryManager.applyAdjustPreset(${p.val})">
                    ${p.label}
                </button>
            `).join('');
        }

        this.handleAdjustAmountChange();
    }

    applyAdjustPreset(amount) {
        const input = document.getElementById('rawAdjustAmountInput');
        if (input) {
            input.value = amount;
            this.handleAdjustAmountChange();
            input.focus();
        }
    }

    handleAdjustAmountChange() {
        if (!this.adjustModalState) return;
        const current = this.adjustModalState.currentStock;
        const mode = this.adjustModalState.mode;
        const unit = this.adjustModalState.unit;

        const input = document.getElementById('rawAdjustAmountInput');
        const rawVal = input ? parseFloat(input.value) : 0;
        const val = isNaN(rawVal) ? 0 : rawVal;

        const calcCurrent = document.getElementById('calcCurrentStock');
        const calcDeltaLabel = document.getElementById('calcDeltaLabel');
        const calcDeltaVal = document.getElementById('calcDeltaVal');
        const calcNewStock = document.getElementById('calcNewStock');

        if (calcCurrent) calcCurrent.textContent = `${current.toLocaleString('id-ID')} ${unit}`;

        let newStock = current;
        if (mode === 'add') {
            newStock = current + Math.abs(val);
            if (calcDeltaLabel) calcDeltaLabel.textContent = 'Penambahan:';
            if (calcDeltaVal) {
                calcDeltaVal.textContent = `+${Math.abs(val).toLocaleString('id-ID')} ${unit}`;
                calcDeltaVal.style.color = '#16A34A';
            }
        } else if (mode === 'reduce') {
            newStock = current - Math.abs(val);
            if (calcDeltaLabel) calcDeltaLabel.textContent = 'Pengurangan:';
            if (calcDeltaVal) {
                calcDeltaVal.textContent = `-${Math.abs(val).toLocaleString('id-ID')} ${unit}`;
                calcDeltaVal.style.color = '#DC2626';
            }
        } else {
            newStock = val;
            const diff = newStock - current;
            if (calcDeltaLabel) calcDeltaLabel.textContent = 'Perubahan:';
            if (calcDeltaVal) {
                calcDeltaVal.textContent = `${diff >= 0 ? '+' : ''}${diff.toLocaleString('id-ID')} ${unit}`;
                calcDeltaVal.style.color = diff >= 0 ? '#16A34A' : '#DC2626';
            }
        }

        if (calcNewStock) {
            if (newStock < 0) {
                calcNewStock.innerHTML = `<span style="color: #DC2626;">${newStock.toLocaleString('id-ID')} ${unit} (🔥 Defisit / Butuh Diasap)</span>`;
            } else {
                calcNewStock.innerHTML = `<span style="color: #16A34A;">${newStock.toLocaleString('id-ID')} ${unit} (✅ Stok Ready Aman)</span>`;
            }
        }
    }

    async handleSaveCustomAdjust(e) {
        e.preventDefault();
        const id = document.getElementById('rawAdjustId').value;
        const name = document.getElementById('rawAdjustName').value.trim();
        const minStock = parseFloat(document.getElementById('rawAdjustMinStock').value) || 0;
        const inputAmount = parseFloat(document.getElementById('rawAdjustAmountInput').value);
        const author = document.getElementById('rawAdjustAuthor')?.value.trim() || ((typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir');
        const notes = document.getElementById('rawAdjustNotes')?.value.trim() || '';

        if (isNaN(inputAmount)) {
            alert('Silakan masukkan jumlah stok yang valid!');
            return;
        }

        const mat = this.getRawMaterialById(id);
        if (!mat) return;

        const current = Number(mat.stock) || 0;
        const mode = (this.adjustModalState && this.adjustModalState.mode) || 'add';

        let finalStock = current;
        if (mode === 'add') {
            finalStock = current + Math.abs(inputAmount);
        } else if (mode === 'reduce') {
            finalStock = current - Math.abs(inputAmount);
        } else {
            finalStock = inputAmount;
        }

        mat.name = name;
        mat.stock = finalStock;
        mat.minStock = minStock;

        try {
            await db.saveRawMaterial(mat);

            // Simpan ke log perubahan stok
            const diff = finalStock - current;
            await db.addStockLog({
                materialId: mat.id,
                materialName: mat.name,
                itemType: 'raw_material',
                changeType: mode,
                amount: diff,
                unit: mat.unit || 'gr',
                stockBefore: current,
                stockAfter: finalStock,
                author: author,
                notes: notes || (mode === 'add' ? 'Tambah stok' : (mode === 'reduce' ? 'Kurang stok' : 'Set total / Opname'))
            }).catch(err => console.warn('Gagal catat stock log:', err));

            sounds.playSuccess();
            this.closeCustomAdjustModal();
            await this.calculateStockDemands();
            this.renderTabContent();
            if (typeof productManager !== 'undefined') {
                productManager.render();
            }
            if (typeof showPosToast === 'function') {
                const sign = diff >= 0 ? '+' : '';
                showPosToast(`✅ Stok ${mat.name} berhasil diperbarui: ${finalStock.toLocaleString('id-ID')} ${mat.unit} (${sign}${diff.toLocaleString('id-ID')})`, 3000);
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

            if (stock > 0) {
                const author = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
                await db.addStockLog({
                    materialId: newMat.id,
                    materialName: newMat.name,
                    itemType: 'raw_material',
                    changeType: 'add',
                    amount: stock,
                    unit: newMat.unit,
                    stockBefore: 0,
                    stockAfter: stock,
                    author: author,
                    notes: 'Stok awal bahan baru'
                }).catch(err => console.warn('Gagal catat stock log:', err));
            }

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
    async deductOrderStock(items, orderInfo = null) {
        try {
            await db.deductStockForOrder(items, orderInfo);
            await this.loadRawMaterials();
            await this.calculateStockDemands();
            await productManager.loadProducts();
            productManager.render();
        } catch (e) {
            console.warn('Gagal memotong stok:', e);
        }
    }

    // ================= TAB 4: RIWAYAT PERUBAHAN STOK =================
    async renderStockHistoryTab(container) {
        if (!container) return;

        // Ambil daftar unik author / kasir untuk filter
        const logs = Array.isArray(this.cachedStockLogs) ? this.cachedStockLogs : [];
        const authorSet = new Set();
        logs.forEach(l => {
            if (l.author) authorSet.add(l.author.trim());
        });
        const authors = Array.from(authorSet).sort();

        // Kumpulkan opsi bahan baku & barang jadi untuk filter
        const products = (typeof productManager !== 'undefined' && productManager.products) ? productManager.products : [];
        const directProducts = products.filter(p => p.stockType === 'direct');

        // Ringkasan Cepat
        const totalLogs = logs.length;
        const lastAdd = logs.find(l => l.changeType === 'add' || Number(l.amount) > 0);
        const lastReduce = logs.find(l => l.changeType === 'reduce' || Number(l.amount) < 0 || l.changeType === 'order_deduct');

        container.innerHTML = `
            <div class="stock-tab-header">
                <div>
                    <h4 style="font-size: 15px; font-weight: 800; color: var(--secondary); margin-bottom: 2px;">
                        📜 Riwayat Perubahan & Mutasi Stok
                    </h4>
                    <p style="font-size: 12px; color: #64748B;">
                        Catatan audit transparan: siapa yang menginput stok, kapan, berapa banyak penambahan/pengurangan, dan stok akhir.
                    </p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button type="button" class="btn-stock-history-nav" onclick="inventoryManager.refreshStockHistory()">
                        🔄 Segarkan Data
                    </button>
                </div>
            </div>

            <!-- Kartu Ringkasan Riwayat -->
            <div class="stock-history-summary-cards">
                <div class="stock-history-card">
                    <div class="stock-hist-card-label">📊 Total Catatan Mutasi</div>
                    <div class="stock-hist-card-val">${totalLogs} Log</div>
                    <div class="stock-hist-card-sub">Tersinkronisasi otomatis dengan database</div>
                </div>

                <div class="stock-history-card card-hist-add">
                    <div class="stock-hist-card-label" style="color: #166534;">➕ Terakhir Ditambah / Restock</div>
                    <div class="stock-hist-card-val" style="color: #15803D;">
                        ${lastAdd ? `+${Number(lastAdd.amount).toLocaleString('id-ID')} ${lastAdd.unit || 'gr'}` : '-'}
                    </div>
                    <div class="stock-hist-card-sub">
                        ${lastAdd ? `<strong>${lastAdd.materialName}</strong> • Oleh: <em>${lastAdd.author || 'Kasir'}</em>` : 'Belum ada data masuk'}
                    </div>
                </div>

                <div class="stock-history-card card-hist-reduce">
                    <div class="stock-hist-card-label" style="color: #991B1B;">➖ Terakhir Berkurang / Terjual</div>
                    <div class="stock-hist-card-val" style="color: #DC2626;">
                        ${lastReduce ? `${Number(lastReduce.amount).toLocaleString('id-ID')} ${lastReduce.unit || 'gr'}` : '-'}
                    </div>
                    <div class="stock-hist-card-sub">
                        ${lastReduce ? `<strong>${lastReduce.materialName}</strong> • Oleh: <em>${lastReduce.author || 'Kasir'}</em>` : 'Belum ada data keluar'}
                    </div>
                </div>
            </div>

            <!-- Toolbar Pencarian & Filter -->
            <div class="stock-history-toolbar">
                <div class="stock-hist-tool-left">
                    <div class="stock-hist-search-wrap">
                        <input type="text" id="stockHistSearchInput" class="stock-hist-search-input" 
                            placeholder="🔍 Cari nama bahan / kasir / catatan..." 
                            value="${this.historySearchTerm || ''}"
                            oninput="inventoryManager.handleHistorySearchInput(this.value)">
                    </div>

                    <div class="stock-hist-select-wrap">
                        <select id="stockHistFilterMat" class="stock-hist-filter-select" onchange="inventoryManager.handleHistoryFilterMaterial(this.value)">
                            <option value="all">🌾 Semua Bahan & Produk</option>
                            <optgroup label="🌾 Bahan Baku Utama (Resep Master)">
                                ${this.rawMaterials.map(m => `
                                    <option value="${m.id}" ${this.historyFilterMaterial === m.id ? 'selected' : ''}>
                                        ${m.name} (${m.unit})
                                    </option>
                                `).join('')}
                            </optgroup>
                            ${directProducts.length > 0 ? `
                                <optgroup label="🥤 Stok Barang Jadi (Fisik)">
                                    ${directProducts.map(p => `
                                        <option value="${p.id}" ${this.historyFilterMaterial === p.id ? 'selected' : ''}>
                                            ${p.name} (pcs)
                                        </option>
                                    `).join('')}
                                </optgroup>
                            ` : ''}
                        </select>
                    </div>

                    <div class="stock-hist-select-wrap">
                        <select id="stockHistFilterType" class="stock-hist-filter-select" onchange="inventoryManager.handleHistoryFilterType(this.value)">
                            <option value="all" ${this.historyFilterType === 'all' ? 'selected' : ''}>📋 Semua Operasi</option>
                            <option value="add" ${this.historyFilterType === 'add' ? 'selected' : ''}>➕ Tambah Stok (Add / Restock)</option>
                            <option value="reduce" ${this.historyFilterType === 'reduce' ? 'selected' : ''}>➖ Kurangi Stok (Manual)</option>
                            <option value="set" ${this.historyFilterType === 'set' ? 'selected' : ''}>📝 Set Total (Opname)</option>
                            <option value="order_deduct" ${this.historyFilterType === 'order_deduct' ? 'selected' : ''}>🛒 Penjualan Kasir (Order Deduct)</option>
                            <option value="void_restore" ${this.historyFilterType === 'void_restore' ? 'selected' : ''}>↩️ Pengembalian Void</option>
                        </select>
                    </div>

                    <div class="stock-hist-select-wrap">
                        <select id="stockHistFilterAuthor" class="stock-hist-filter-select" onchange="inventoryManager.handleHistoryFilterAuthor(this.value)">
                            <option value="all" ${this.historyFilterAuthor === 'all' ? 'selected' : ''}>👤 Semua Petugas / Kasir</option>
                            ${authors.map(a => `
                                <option value="${a}" ${this.historyFilterAuthor.toLowerCase() === a.toLowerCase() ? 'selected' : ''}>
                                    👤 ${a}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div class="stock-hist-tool-right">
                    <span class="stock-hist-badge-count" id="stockHistRowCount">0 riwayat</span>
                </div>
            </div>

            <!-- Tabel Riwayat -->
            <div class="stock-history-table-container">
                <table class="stock-history-table">
                    <thead>
                        <tr>
                            <th style="width: 40px; text-align: center;">#</th>
                            <th style="width: 140px; white-space: nowrap;">Waktu & Tanggal</th>
                            <th style="width: 130px; white-space: nowrap;">Petugas / Kasir</th>
                            <th>Nama Bahan / Barang</th>
                            <th style="width: 130px; text-align: center;">Jenis Perubahan</th>
                            <th style="width: 120px; text-align: right; white-space: nowrap;">Perubahan (±)</th>
                            <th style="width: 170px; text-align: right; white-space: nowrap;">Stok (Sebelum ➔ Sesudah)</th>
                            <th style="min-width: 180px;">Catatan / Keterangan</th>
                        </tr>
                    </thead>
                    <tbody id="stockHistoryTableBody">
                        <!-- Diisi oleh renderStockHistoryTable() -->
                    </tbody>
                </table>
            </div>
        `;

        this.renderStockHistoryTable();
    }

    renderStockHistoryTable() {
        const tbody = document.getElementById('stockHistoryTableBody');
        const countBadge = document.getElementById('stockHistRowCount');
        if (!tbody) return;

        const filtered = this.getFilteredStockLogs();
        if (countBadge) {
            countBadge.textContent = `${filtered.length} riwayat ditemukan`;
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px 20px; color: #64748B;">
                        <div style="font-size: 28px; margin-bottom: 8px;">📭</div>
                        <div style="font-weight: 700; font-size: 14px; color: #334155;">Belum Ada Riwayat Perubahan Stok Sesuai Filter</div>
                        <div style="font-size: 12px; margin-top: 4px;">Setiap kali Anda menambah, mengurangi, atau menjual porsi menu, riwayatnya akan otomatis tercatat di sini.</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map((log, idx) => {
            const dateObj = new Date(log.createdAt || Date.now());
            const dateFormatted = !isNaN(dateObj.getTime())
                ? dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
                  dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':')
                : '-';

            const unit = log.unit || 'gr';
            const amt = Number(log.amount) || 0;
            const sign = amt > 0 ? '+' : '';
            const amtFormatted = `${sign}${amt.toLocaleString('id-ID')} ${unit}`;

            const beforeVal = Number(log.stockBefore) || 0;
            const afterVal = Number(log.stockAfter) || 0;
            const beforeAfterText = `${beforeVal.toLocaleString('id-ID')} ➔ <strong>${afterVal.toLocaleString('id-ID')}</strong> <small>${unit}</small>`;

            let typeBadge = '';
            switch (log.changeType) {
                case 'add':
                    typeBadge = `<span class="badge-stock-type badge-stock-add">➕ Tambah</span>`;
                    break;
                case 'reduce':
                    typeBadge = `<span class="badge-stock-type badge-stock-reduce">➖ Kurang</span>`;
                    break;
                case 'set':
                    typeBadge = `<span class="badge-stock-type badge-stock-set">📝 Set Opname</span>`;
                    break;
                case 'order_deduct':
                    typeBadge = `<span class="badge-stock-type badge-stock-order">🛒 Kasir / PO</span>`;
                    break;
                case 'void_restore':
                    typeBadge = `<span class="badge-stock-type badge-stock-restore">↩️ Void Batal</span>`;
                    break;
                default:
                    typeBadge = `<span class="badge-stock-type">${log.changeType || 'Update'}</span>`;
            }

            const isPositive = amt > 0;
            const amtColor = isPositive ? '#16A34A' : (amt < 0 ? '#DC2626' : '#475569');

            const itemTypeLabel = log.itemType === 'direct_product' ? '🥤 Barang Jadi' : '🌾 Bahan Baku';

            return `
                <tr>
                    <td style="text-align: center; color: #94A3B8; font-weight: 700; font-size: 11px;">${idx + 1}</td>
                    <td style="white-space: nowrap; font-size: 12px; color: #475569;">
                        <div>${dateFormatted}</div>
                    </td>
                    <td style="white-space: nowrap;">
                        <span class="stock-hist-author-pill">
                            👤 <strong>${log.author || 'Kasir'}</strong>
                        </span>
                    </td>
                    <td>
                        <div style="font-weight: 700; color: #1E293B; font-size: 13px;">${log.materialName || 'Item'}</div>
                        <div style="font-size: 11px; color: #64748B;">${itemTypeLabel} • ID: ${log.materialId || '-'}</div>
                    </td>
                    <td style="text-align: center;">
                        ${typeBadge}
                    </td>
                    <td style="text-align: right; font-weight: 800; font-size: 13px; color: ${amtColor}; white-space: nowrap;">
                        ${amtFormatted}
                    </td>
                    <td style="text-align: right; font-size: 12px; color: #334155; white-space: nowrap;">
                        ${beforeAfterText}
                    </td>
                    <td style="font-size: 12px; color: #475569;">
                        ${log.notes ? `<span>${log.notes}</span>` : '<span style="color: #94A3B8; font-style: italic;">-</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    getFilteredStockLogs() {
        let list = Array.isArray(this.cachedStockLogs) ? [...this.cachedStockLogs] : [];

        // Filter material
        if (this.historyFilterMaterial && this.historyFilterMaterial !== 'all') {
            list = list.filter(l => l.materialId === this.historyFilterMaterial);
        }

        // Filter type
        if (this.historyFilterType && this.historyFilterType !== 'all') {
            list = list.filter(l => l.changeType === this.historyFilterType);
        }

        // Filter author
        if (this.historyFilterAuthor && this.historyFilterAuthor !== 'all') {
            list = list.filter(l => (l.author || '').toLowerCase() === this.historyFilterAuthor.toLowerCase());
        }

        // Search term
        if (this.historySearchTerm) {
            const q = this.historySearchTerm;
            list = list.filter(l => 
                (l.materialName || '').toLowerCase().includes(q) ||
                (l.author || '').toLowerCase().includes(q) ||
                (l.notes || '').toLowerCase().includes(q) ||
                (l.materialId || '').toLowerCase().includes(q)
            );
        }

        return list;
    }

    handleHistorySearchInput(val) {
        this.historySearchTerm = (val || '').toLowerCase().trim();
        this.renderStockHistoryTable();
    }

    handleHistoryFilterMaterial(val) {
        this.historyFilterMaterial = val;
        this.renderStockHistoryTable();
    }

    handleHistoryFilterType(val) {
        this.historyFilterType = val;
        this.renderStockHistoryTable();
    }

    handleHistoryFilterAuthor(val) {
        this.historyFilterAuthor = val;
        this.renderStockHistoryTable();
    }

    async refreshStockHistory() {
        try {
            this.cachedStockLogs = await db.getStockLogs(300);
            const contentEl = document.getElementById('stockModalTabContent');
            if (contentEl && this.activeTab === 'history') {
                this.renderStockHistoryTab(contentEl);
            }
            if (typeof showPosToast === 'function') {
                showPosToast('🔄 Riwayat stok berhasil diperbarui', 2000);
            }
        } catch (e) {
            alert('Gagal merefresh riwayat stok: ' + e.message);
        }
    }
}

const inventoryManager = new InventoryManager();
