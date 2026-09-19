/**
 * DIASAP POS - Inventory & Raw Material Stock Manager
 * Mengelola stok bahan baku master (gramasi resep) dan stok langsung barang jadi
 */

class InventoryManager {
    constructor() {
        this.rawMaterials = [];
        this.activeTab = 'raw'; // 'raw' | 'direct' | 'menu'
    }

    async init() {
        await this.loadRawMaterials();
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

        this.renderStockModal();
        modal.classList.add('active');
    }

    closeStockModal() {
        const modal = document.getElementById('stockModal');
        if (modal) modal.classList.remove('active');
    }

    setTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll('.stock-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
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

    // Tab 1: Bahan Baku Master (Gramasi)
    renderRawMaterialsTab(container) {
        const products = productManager.products || [];

        container.innerHTML = `
            <div class="stock-tab-header">
                <div>
                    <h4 style="font-size: 15px; font-weight: 800; color: var(--secondary); margin-bottom: 2px;">
                        🌾 Bahan Baku Utama (Resep Master)
                    </h4>
                    <p style="font-size: 12px; color: #64748B;">
                        Stok bahan baku ini digunakan bersama oleh berbagai menu (contoh: Ayam Asap 300g cukup untuk 4 porsi Paket A 75g).
                    </p>
                </div>
                <button type="button" class="btn-admin-add-new" style="padding: 7px 14px; font-size: 13px;" onclick="inventoryManager.openAddRawMaterialModal()">
                    + Tambah Bahan Baku
                </button>
            </div>

            <div class="raw-materials-grid">
                ${this.rawMaterials.map(mat => {
                    const stock = Number(mat.stock) || 0;
                    const minStock = Number(mat.minStock) || 0;
                    const isLow = stock <= minStock && stock > 0;
                    const isOut = stock <= 0;

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
                    let statusLabel = '✅ Stok Aman';
                    if (isOut) {
                        statusClass = 'status-out';
                        statusLabel = '❌ Habis';
                    } else if (isLow) {
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

                            <div class="raw-mat-stock-display">
                                <span class="raw-mat-stock-val">${stock.toLocaleString('id-ID')}</span>
                                <span class="raw-mat-unit">${mat.unit}</span>
                            </div>

                            <div class="raw-mat-portions-box">
                                <div class="portions-box-title">Estimasi Porsi Menu Terkait:</div>
                                ${usages.length > 0 ? usages.map(u => {
                                    const portions = u.amount > 0 ? Math.floor(stock / u.amount) : 0;
                                    return `
                                        <div class="portion-row">
                                            <span>
                                                <strong>${u.productName}</strong>
                                                ${u.variantName ? `<span class="badge-var-mini">[Varian: ${u.variantName}]</span>` : ''} 
                                                (${u.amount} ${mat.unit}):
                                            </span>
                                            <span class="portion-count ${portions === 0 ? 'text-danger' : 'text-success'}">
                                                <strong>${portions}</strong> porsi
                                            </span>
                                        </div>
                                    `;
                                }).join('') : '<div style="font-size: 11px; color: #94A3B8; font-style: italic;">Belum ada menu yang dihubungkan ke bahan ini.</div>'}
                            </div>

                            <div class="raw-mat-actions">
                                <div class="quick-restock-group">
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

        const newStock = (Number(mat.stock) || 0) + Number(addAmount);
        mat.stock = newStock;

        try {
            await db.saveRawMaterial(mat);
            sounds.playSuccess();
            this.renderTabContent();
            productManager.render();
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

        if (title) title.textContent = `Atur Stok: ${mat.name}`;
        if (idInput) idInput.value = mat.id;
        if (nameInput) nameInput.value = mat.name;
        if (stockInput) stockInput.value = mat.stock;
        if (unitDisplay) unitDisplay.textContent = mat.unit;
        if (minStockInput) minStockInput.value = mat.minStock || 0;

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
            this.renderTabContent();
            productManager.render();
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
            await productManager.loadProducts();
            productManager.render();
        } catch (e) {
            console.warn('Gagal memotong stok:', e);
        }
    }
}

const inventoryManager = new InventoryManager();
