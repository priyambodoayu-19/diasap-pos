function getValidProductEmoji(emoji, category = 'makanan', id = '') {
    if (emoji && !emoji.includes('?') && emoji.trim() !== '') {
        return emoji;
    }
    const map = {
        'A': '🍗', 'B': '🍱', 'C': '🍖', 'D': '🔥',
        'M1': '🍹', 'M2': '💧', 'T1': '🍚', 'T2': '🌶️'
    };
    if (id && map[id]) return map[id];
    if (category === 'minuman') return '🍹';
    if (category === 'tambahan') return '🍚';
    return '🍗';
}

class AdminManager {
    constructor() {
        this.currentCategory = 'all';
        this.searchQuery = '';
        this.editingProductId = null;
        this.currentVariants = [];
    }

    init() {
        this.setupEventListeners();
        this.setupDiscountCalculator();
    }

    setupEventListeners() {
        // Search di Admin Panel
        const searchInput = document.getElementById('adminSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase().trim();
                this.renderTable();
            });
        }

        // Filter Kategori di Admin Panel
        const catButtons = document.querySelectorAll('.admin-cat-btn');
        catButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                catButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentCategory = btn.dataset.category;
                this.renderTable();
            });
        });

        // Form Submit
        const form = document.getElementById('adminProductForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSaveProduct(e));
        }

        // Tipe Kontrol Stok di Form Produk
        const stockTypeSelect = document.getElementById('adminProdStockType');
        if (stockTypeSelect) {
            stockTypeSelect.addEventListener('change', () => {
                this.updateStockFormVisibility();
                this.updateStockPortionPreview();
            });
        }

        const rawMatSelect = document.getElementById('adminProdRawMaterialId');
        if (rawMatSelect) {
            rawMatSelect.addEventListener('change', () => this.updateStockPortionPreview());
        }

        const rawAmountInput = document.getElementById('adminProdRawMaterialAmount');
        if (rawAmountInput) {
            rawAmountInput.addEventListener('input', () => this.updateStockPortionPreview());
        }

        const directStockInput = document.getElementById('adminProdDirectStock');
        if (directStockInput) {
            directStockInput.addEventListener('input', () => this.updateStockPortionPreview());
        }

        const hasVariantsCheckbox = document.getElementById('adminProdHasVariants');
        if (hasVariantsCheckbox) {
            hasVariantsCheckbox.addEventListener('change', (e) => {
                this.toggleVariantsSection(e.target.checked);
            });
        }
    }

    updateStockFormVisibility() {
        const type = document.getElementById('adminProdStockType')?.value || 'unlimited';
        const rawGroup = document.getElementById('stockGroupRawMaterial');
        const directGroup = document.getElementById('stockGroupDirect');

        if (rawGroup) rawGroup.style.display = (type === 'raw_material') ? 'block' : 'none';
        if (directGroup) directGroup.style.display = (type === 'direct') ? 'block' : 'none';
    }

    populateRawMaterialsSelect(selectedId = '') {
        const select = document.getElementById('adminProdRawMaterialId');
        if (!select) return;

        const rawMaterials = (typeof inventoryManager !== 'undefined') ? inventoryManager.rawMaterials : [];
        select.innerHTML = `
            <option value="">-- Pilih Bahan Baku Master --</option>
            ${rawMaterials.map(m => `
                <option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>
                    ${m.name} (Stok: ${Number(m.stock).toLocaleString('id-ID')} ${m.unit})
                </option>
            `).join('')}
        `;
    }

    updateStockPortionPreview() {
        const previewEl = document.getElementById('adminStockPortionPreview');
        if (!previewEl) return;

        const type = document.getElementById('adminProdStockType')?.value || 'unlimited';

        if (type === 'raw_material') {
            const rawId = document.getElementById('adminProdRawMaterialId')?.value;
            const amount = parseFloat(document.getElementById('adminProdRawMaterialAmount')?.value) || 0;
            const mat = (typeof inventoryManager !== 'undefined') ? inventoryManager.getRawMaterialById(rawId) : null;

            if (mat && amount > 0) {
                const portions = Math.floor((Number(mat.stock) || 0) / amount);
                previewEl.innerHTML = `
                    <div class="cogs-preview-card ${portions === 0 ? 'profit-loss-alert' : ''}">
                        <span>🌾 Bahan: <strong>${mat.name}</strong> (Sisa stok: <strong>${Number(mat.stock).toLocaleString('id-ID')} ${mat.unit}</strong>)</span><br>
                        <span>Estimasi Porsi Tersedia: <strong class="${portions === 0 ? 'text-danger' : 'text-success'}">${portions} Porsi</strong> (kebutuhan ${amount} ${mat.unit}/porsi)</span>
                    </div>
                `;
            } else {
                previewEl.innerHTML = `
                    <div class="cogs-preview-card">
                        <span style="color: #64748B;">Pilih bahan baku dan masukkan takaran per porsi (contoh: 75 gr).</span>
                    </div>
                `;
            }
        } else if (type === 'direct') {
            const stock = parseFloat(document.getElementById('adminProdDirectStock')?.value) || 0;
            previewEl.innerHTML = `
                <div class="cogs-preview-card">
                    <span>📦 Stok fisik siap jual: <strong class="${stock === 0 ? 'text-danger' : 'text-success'}">${stock} unit / botol</strong></span>
                </div>
            `;
        } else {
            previewEl.innerHTML = `
                <div class="cogs-preview-card">
                    <span style="color: #64748B;">Menu ini selalu tersedia tanpa pengurangan stok otomatis.</span>
                </div>
            `;
        }
    }

    // ================= MODAL ADMIN PANEL =================

    async openAdminModal() {
        const modal = document.getElementById('adminModal');
        if (!modal) return;

        modal.classList.add('active');
        await this.render();
    }

    closeAdminModal() {
        const modal = document.getElementById('adminModal');
        if (modal) modal.classList.remove('active');
    }

    async render() {
        await productManager.loadProducts();
        this.renderStats();
        this.renderTable();
    }

    async moveProduct(productId, direction) {
        const products = [...(productManager.products || [])];
        const idx = products.findIndex(p => p.id === productId);
        if (idx < 0) return;

        if (direction === 'up' && idx > 0) {
            const temp = products[idx];
            products[idx] = products[idx - 1];
            products[idx - 1] = temp;
        } else if (direction === 'down' && idx < products.length - 1) {
            const temp = products[idx];
            products[idx] = products[idx + 1];
            products[idx + 1] = temp;
        } else {
            return;
        }

        try {
            await db.updateProductsSortOrder(products);
            await productManager.loadProducts();
            this.renderTable();
            this.showToast('Urutan menu berhasil diubah.');
        } catch (err) {
            console.error(err);
            alert('Gagal mengubah urutan: ' + err.message);
        }
    }

    renderStats() {
        const products = productManager.products || [];
        const total = products.length;
        const promoCount = products.filter(p => Number(p.pricePromo) < Number(p.priceNormal)).length;
        const foodCount = products.filter(p => p.category === 'makanan').length;
        const drinkCount = products.filter(p => p.category === 'minuman').length;

        const totalEl = document.getElementById('adminStatTotal');
        const promoEl = document.getElementById('adminStatPromo');
        const foodEl = document.getElementById('adminStatFood');
        const drinkEl = document.getElementById('adminStatDrink');

        if (totalEl) totalEl.textContent = `${total} Menu`;
        if (promoEl) promoEl.textContent = `${promoCount} Menu Promo`;
        if (foodEl) foodEl.textContent = `${foodCount} Makanan`;
        if (drinkEl) drinkEl.textContent = `${drinkCount} Minuman`;
    }

    renderTable() {
        const tbody = document.getElementById('adminTableBody');
        if (!tbody) return;

        const products = productManager.products || [];
        const filtered = products.filter(p => {
            const matchesCat = this.currentCategory === 'all' || p.category === this.currentCategory;
            const matchesSearch = !this.searchQuery ||
                p.id.toLowerCase().includes(this.searchQuery) ||
                p.name.toLowerCase().includes(this.searchQuery) ||
                (p.desc && p.desc.toLowerCase().includes(this.searchQuery));
            return matchesCat && matchesSearch;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 36px 20px; color: #94A3B8;">
                        <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
                        <div style="font-weight: 700; font-size: 15px; color: #64748B;">Tidak ada menu yang sesuai</div>
                        <div style="font-size: 13px;">Coba ubah kata kunci pencarian atau kategori filter.</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtered.map((p, idx) => {
            const priceNormal = Number(p.priceNormal) || 0;
            const pricePromo = Number(p.pricePromo) || priceNormal;
            const cogs = Number(p.cogs) || 0;
            const savings = priceNormal - pricePromo;
            const hasDiscount = savings > 0;
            const discountPct = (hasDiscount && priceNormal > 0) ? Math.round((savings / priceNormal) * 100) : 0;

            const profitNormal = priceNormal - cogs;
            const profitPromo = pricePromo - cogs;
            const currentProfit = hasDiscount ? profitPromo : profitNormal;
            const currentPrice = hasDiscount ? pricePromo : priceNormal;
            const currentMargin = currentPrice > 0 ? Math.round((currentProfit / currentPrice) * 100) : 0;

            let catLabel = 'Makanan';
            let catBadgeClass = 'cat-makanan';
            if (p.category === 'minuman') {
                catLabel = 'Minuman';
                catBadgeClass = 'cat-minuman';
            } else if (p.category === 'tambahan') {
                catLabel = 'Tambahan';
                catBadgeClass = 'cat-tambahan';
            }

            const hasVariants = p.variants && Array.isArray(p.variants) && p.variants.length > 0;
            const variantsBadge = hasVariants 
                ? `<span class="badge-has-variants" title="Varian: ${p.variants.map(v => v.name).join(', ')}">✨ ${p.variants.length} Varian</span>` 
                : '';

            return `
                <tr>
                    <td style="text-align: center; vertical-align: middle;">
                        <div class="admin-reorder-wrap">
                            <button type="button" class="btn-reorder-action" onclick="adminManager.moveProduct('${p.id}', 'up')" ${idx === 0 ? 'disabled' : ''} title="Geser Urutan Naik">▲</button>
                            <span class="admin-order-num">${idx + 1}</span>
                            <button type="button" class="btn-reorder-action" onclick="adminManager.moveProduct('${p.id}', 'down')" ${idx === filtered.length - 1 ? 'disabled' : ''} title="Geser Urutan Turun">▼</button>
                        </div>
                    </td>
                    <td>
                        <div class="admin-prod-identity">
                            <span class="admin-prod-emoji">${getValidProductEmoji(p.emoji, p.category, p.id)}</span>
                            <div>
                                <div class="admin-prod-name">
                                    ${p.name}
                                    ${variantsBadge}
                                </div>
                                <div class="admin-prod-code">Kode: <strong>${p.id}</strong> &bull; <span class="category-badge ${catBadgeClass}">${catLabel}</span></div>
                                ${p.desc ? `<div class="admin-prod-desc-inline">${p.desc}</div>` : ''}
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="admin-cogs-cell">${formatRupiah(cogs)}</div>
                    </td>
                    <td>
                        <div class="admin-price-normal">${formatRupiah(priceNormal)}</div>
                    </td>
                    <td>
                        <div class="admin-price-promo-wrap">
                            <span class="admin-price-promo ${hasDiscount ? 'has-discount' : ''}">${formatRupiah(pricePromo)}</span>
                            ${hasDiscount ? `
                                <div class="admin-discount-badge">
                                    <span class="badge-pct">-${discountPct}%</span>
                                    <span class="badge-saving">Hemat ${formatRupiah(savings)}</span>
                                </div>
                            ` : `
                                <span class="admin-no-discount-tag">Normal (Tanpa Diskon)</span>
                            `}
                        </div>
                    </td>
                    <td>
                        <div class="admin-profit-wrap">
                            <span class="admin-profit-val ${currentProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                                ${currentProfit >= 0 ? '+' : ''}${formatRupiah(currentProfit)}
                            </span>
                            <span class="admin-margin-badge ${currentMargin >= 30 ? 'margin-good' : (currentMargin >= 0 ? 'margin-ok' : 'margin-loss')}">
                                ${currentMargin}%
                            </span>
                            ${hasDiscount ? `
                                <div style="font-size: 10px; color: #94A3B8; margin-top: 2px;">(Normal: +${formatRupiah(profitNormal)})</div>
                            ` : ''}
                        </div>
                    </td>
                    <td class="col-desc">
                        <div class="admin-prod-desc-cell" title="${p.desc || '-'}">${p.desc || '-'}</div>
                    </td>
                    <td class="col-actions" style="text-align: right;">
                        <div class="admin-action-btns">
                            <button type="button" class="btn-admin-action btn-admin-edit" onclick="adminManager.openEditModal('${p.id}')" title="Ubah Harga, Diskon & Info Produk">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                                <span>Edit</span>
                            </button>
                            <button type="button" class="btn-admin-action btn-admin-delete" onclick="adminManager.handleDeleteProduct('${p.id}')" title="Hapus Menu Ini">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                                <span>Hapus</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ================= KALKULATOR DISKON & MARGIN INTERAKTIF =================

    setupDiscountCalculator() {
        const priceNormalInput = document.getElementById('adminProdPriceNormal');
        const pricePromoInput = document.getElementById('adminProdPricePromo');
        const cogsInput = document.getElementById('adminProdCogs');
        const discountNominalInput = document.getElementById('adminProdDiscountNominal');
        const discountPercentInput = document.getElementById('adminProdDiscountPercent');

        if (!priceNormalInput || !pricePromoInput || !discountNominalInput || !discountPercentInput) return;

        // 0. Saat Harga Modal (COGS) Diubah
        if (cogsInput) {
            cogsInput.addEventListener('input', () => {
                this.updateDiscountPreview();
            });
        }

        // 1. Saat Harga Normal Diubah
        priceNormalInput.addEventListener('input', () => {
            const normal = parseFloat(priceNormalInput.value) || 0;
            const pct = parseFloat(discountPercentInput.value) || 0;

            if (pct > 0 && normal > 0) {
                const nominal = Math.round(normal * (pct / 100));
                discountNominalInput.value = nominal;
                pricePromoInput.value = Math.max(0, normal - nominal);
            } else if (pricePromoInput.value) {
                const promo = parseFloat(pricePromoInput.value) || normal;
                const nominal = Math.max(0, normal - promo);
                discountNominalInput.value = nominal;
                discountPercentInput.value = normal > 0 ? parseFloat(((nominal / normal) * 100).toFixed(2)) : 0;
            } else {
                pricePromoInput.value = normal;
                discountNominalInput.value = 0;
                discountPercentInput.value = 0;
            }
            this.updateDiscountPreview();
        });

        // 2. Saat Nominal Diskon (Rp) Diubah
        discountNominalInput.addEventListener('input', () => {
            const normal = parseFloat(priceNormalInput.value) || 0;
            const nominal = parseFloat(discountNominalInput.value) || 0;

            const promo = Math.max(0, normal - nominal);
            pricePromoInput.value = promo;

            const pct = (normal > 0 && nominal > 0) ? parseFloat(((nominal / normal) * 100).toFixed(2)) : 0;
            discountPercentInput.value = pct;

            this.updateDiscountPreview();
        });

        // 3. Saat Persentase Diskon (%) Diubah
        discountPercentInput.addEventListener('input', () => {
            const normal = parseFloat(priceNormalInput.value) || 0;
            const pct = parseFloat(discountPercentInput.value) || 0;

            const nominal = Math.round(normal * (pct / 100));
            discountNominalInput.value = nominal;

            const promo = Math.max(0, normal - nominal);
            pricePromoInput.value = promo;

            this.updateDiscountPreview();
        });

        // 4. Saat Harga Promo Langsung Diubah
        pricePromoInput.addEventListener('input', () => {
            const normal = parseFloat(priceNormalInput.value) || 0;
            const promo = parseFloat(pricePromoInput.value) || 0;

            const nominal = Math.max(0, normal - promo);
            discountNominalInput.value = nominal;

            const pct = (normal > 0 && nominal > 0) ? parseFloat(((nominal / normal) * 100).toFixed(2)) : 0;
            discountPercentInput.value = pct;

            this.updateDiscountPreview();
        });
    }

    updateDiscountPreview() {
        const previewEl = document.getElementById('adminDiscountPreview');
        const normal = parseFloat(document.getElementById('adminProdPriceNormal')?.value) || 0;
        const promo = parseFloat(document.getElementById('adminProdPricePromo')?.value) || normal;
        const cogs = parseFloat(document.getElementById('adminProdCogs')?.value) || 0;

        if (!previewEl) return;

        const saving = normal - promo;
        const profitNormal = normal - cogs;
        const marginNormal = normal > 0 ? parseFloat(((profitNormal / normal) * 100).toFixed(2)) : 0;
        const profitPromo = promo - cogs;
        const marginPromo = promo > 0 ? parseFloat(((profitPromo / promo) * 100).toFixed(2)) : 0;

        let discountHtml = '';
        if (normal > 0 && saving > 0) {
            const pct = parseFloat(((saving / normal) * 100).toFixed(2));
            discountHtml = `
                <div class="discount-preview-card active-discount">
                    <span class="preview-tag">🔥 Diskon Aktif</span>
                    <span class="preview-text">Pelanggan hemat <strong>${formatRupiah(saving)}</strong> (Potongan <strong>${pct}%</strong>)</span>
                </div>
            `;
        } else if (normal > 0 && saving === 0) {
            discountHtml = `
                <div class="discount-preview-card no-discount">
                    <span class="preview-tag">Normal</span>
                    <span class="preview-text">Harga Promo sama dengan Harga Normal (Tidak ada potongan diskon).</span>
                </div>
            `;
        } else if (promo > normal) {
            discountHtml = `
                <div class="discount-preview-card invalid-discount">
                    <span class="preview-tag">⚠️ Perhatian</span>
                    <span class="preview-text">Harga Promo lebih tinggi dari Harga Normal!</span>
                </div>
            `;
        }

        // Tampilan Margin & Profit COGS
        let profitHtml = '';
        if (cogs > 0 || normal > 0) {
            const isLossNormal = profitNormal < 0;
            const isLossPromo = profitPromo < 0;

            profitHtml = `
                <div class="cogs-preview-card ${isLossPromo ? 'profit-loss-alert' : ''}">
                    <div class="cogs-preview-row">
                        <span class="cogs-prev-item">
                            Modal (HPP): <strong>${formatRupiah(cogs)}</strong>
                        </span>
                        <span class="cogs-prev-item">
                            Untung Normal: <strong class="${isLossNormal ? 'text-danger' : 'text-success'}">${profitNormal >= 0 ? '+' : ''}${formatRupiah(profitNormal)} (${marginNormal}%)</strong>
                        </span>
                        ${saving > 0 ? `
                        <span class="cogs-prev-item">
                            Untung Promo: <strong class="${isLossPromo ? 'text-danger' : 'text-success'}">${profitPromo >= 0 ? '+' : ''}${formatRupiah(profitPromo)} (${marginPromo}%)</strong>
                        </span>
                        ` : ''}
                    </div>
                    ${isLossPromo ? `
                        <div class="loss-warning-tag">⚠️ Peringatan: Harga promo di bawah modal (Rugi ${formatRupiah(Math.abs(profitPromo))}/porsi)!</div>
                    ` : ''}
                </div>
            `;
        }

        previewEl.innerHTML = discountHtml + profitHtml;
    }

    // ================= MODAL TAMBAH & EDIT PRODUK =================

    openAddModal() {
        this.editingProductId = null;
        const modal = document.getElementById('adminProductModal');
        const title = document.getElementById('adminProductModalTitle');
        const form = document.getElementById('adminProductForm');
        const idInput = document.getElementById('adminProdId');
        const cogsInput = document.getElementById('adminProdCogs');

        if (form) form.reset();
        if (title) title.textContent = '➕ Tambah Menu Produk Baru';
        if (idInput) {
            idInput.disabled = false;
            idInput.focus();
        }
        if (cogsInput) cogsInput.value = 0;

        // Reset pengaturan stok
        this.populateRawMaterialsSelect('');
        const stockTypeInput = document.getElementById('adminProdStockType');
        if (stockTypeInput) stockTypeInput.value = 'unlimited';
        const rawAmountInput = document.getElementById('adminProdRawMaterialAmount');
        if (rawAmountInput) rawAmountInput.value = 0;
        const directStockInput = document.getElementById('adminProdDirectStock');
        if (directStockInput) directStockInput.value = 0;
        this.updateStockFormVisibility();
        this.updateStockPortionPreview();

        // Reset urutan & varian
        const sortOrderInput = document.getElementById('adminProdSortOrder');
        if (sortOrderInput) sortOrderInput.value = ((productManager.products || []).length + 1) * 10;

        this.currentVariants = [];
        const hasVariantsCheckbox = document.getElementById('adminProdHasVariants');
        if (hasVariantsCheckbox) hasVariantsCheckbox.checked = false;
        this.toggleVariantsSection(false);

        // Sembunyikan tombol hapus saat mode tambah
        const deleteBtn = document.getElementById('adminBtnDeleteProduct');
        if (deleteBtn) deleteBtn.style.display = 'none';

        // Set default emoji
        this.setEmojiValue('🍗');
        this.updateDiscountPreview();

        if (modal) modal.classList.add('active');
    }

    openEditModal(productId) {
        const product = productManager.getProductById(productId);
        if (!product) {
            alert('Produk tidak ditemukan!');
            return;
        }

        this.editingProductId = productId;
        const modal = document.getElementById('adminProductModal');
        const title = document.getElementById('adminProductModalTitle');
        const idInput = document.getElementById('adminProdId');
        const nameInput = document.getElementById('adminProdName');
        const catSelect = document.getElementById('adminProdCategory');
        const emojiInput = document.getElementById('adminProdEmoji');
        const descInput = document.getElementById('adminProdDesc');
        const cogsInput = document.getElementById('adminProdCogs');
        const priceNormalInput = document.getElementById('adminProdPriceNormal');
        const pricePromoInput = document.getElementById('adminProdPricePromo');
        const nominalInput = document.getElementById('adminProdDiscountNominal');
        const percentInput = document.getElementById('adminProdDiscountPercent');
        const deleteBtn = document.getElementById('adminBtnDeleteProduct');
        const sortOrderInput = document.getElementById('adminProdSortOrder');

        if (title) title.textContent = `✏️ Edit Menu: ${product.name}`;
        if (idInput) {
            idInput.value = product.id;
            idInput.disabled = false; // SKU / Kode Menu kini dapat diedit
        }
        if (nameInput) nameInput.value = product.name;
        if (catSelect) catSelect.value = product.category || 'makanan';
        if (emojiInput) emojiInput.value = getValidProductEmoji(product.emoji, product.category, product.id);
        if (descInput) descInput.value = product.desc || '';
        if (sortOrderInput) sortOrderInput.value = product.sortOrder || 10;

        // Tampilkan tombol hapus saat mode edit
        if (deleteBtn) {
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.title = `Hapus menu ${product.name}`;
        }

        const normal = Number(product.priceNormal) || 0;
        const promo = Number(product.pricePromo) || normal;
        const cogs = Number(product.cogs) || 0;
        const saving = Math.max(0, normal - promo);
        const pct = (normal > 0 && saving > 0) ? parseFloat(((saving / normal) * 100).toFixed(2)) : 0;

        if (cogsInput) cogsInput.value = cogs;
        if (priceNormalInput) priceNormalInput.value = normal;
        if (pricePromoInput) pricePromoInput.value = promo;
        if (nominalInput) nominalInput.value = saving;
        if (percentInput) percentInput.value = pct;

        // Prefill pengaturan stok
        this.populateRawMaterialsSelect(product.rawMaterialId || '');
        const stockTypeInput = document.getElementById('adminProdStockType');
        if (stockTypeInput) stockTypeInput.value = product.stockType || 'unlimited';
        const rawAmountInput = document.getElementById('adminProdRawMaterialAmount');
        if (rawAmountInput) rawAmountInput.value = product.rawMaterialAmount || 0;
        const directStockInput = document.getElementById('adminProdDirectStock');
        if (directStockInput) directStockInput.value = product.directStock || 0;
        this.updateStockFormVisibility();
        this.updateStockPortionPreview();

        // Prefill Varian Menu
        this.currentVariants = (product.variants && Array.isArray(product.variants))
            ? JSON.parse(JSON.stringify(product.variants))
            : [];
        const hasVariantsCheckbox = document.getElementById('adminProdHasVariants');
        const hasVariants = this.currentVariants.length > 0;
        if (hasVariantsCheckbox) hasVariantsCheckbox.checked = hasVariants;
        this.toggleVariantsSection(hasVariants);

        this.updateDiscountPreview();

        if (modal) modal.classList.add('active');
        if (priceNormalInput) {
            setTimeout(() => priceNormalInput.focus(), 150);
        }
    }

    // ================= MANAJEMEN VARIAN MENU =================

    toggleVariantsSection(enable) {
        const section = document.getElementById('adminVariantsSection');
        if (section) section.style.display = enable ? 'block' : 'none';

        // Kontrol binding stok: jika varian aktif, sembunyikan kontrol stok tunggal & tampilkan notifikasi binding
        const singleStockFields = document.getElementById('stockSingleControlFields');
        const variantNotice = document.getElementById('stockVariantBindingNotice');

        if (singleStockFields) {
            singleStockFields.style.display = enable ? 'none' : 'block';
        }
        if (variantNotice) {
            variantNotice.style.display = enable ? 'flex' : 'none';
        }

        if (enable && (!this.currentVariants || this.currentVariants.length === 0)) {
            this.currentVariants = [
                {
                    id: 'var_' + Date.now(),
                    name: 'Paha',
                    priceExtra: 0,
                    cogsExtra: 0,
                    ingredients: [{ rawMaterialId: '', amount: 0 }]
                }
            ];
        } else if (!enable) {
            this.updateStockPortionPreview();
        }
        this.renderVariantsUI();
    }

    renderVariantsUI() {
        const container = document.getElementById('adminVariantsListContainer');
        if (!container) return;

        const rawMaterials = (typeof inventoryManager !== 'undefined') ? inventoryManager.rawMaterials : [];

        if (!this.currentVariants || this.currentVariants.length === 0) {
            container.innerHTML = `<div style="color: #94A3B8; font-size: 13px; font-style: italic; padding: 10px 0;">Belum ada varian menu. Klik "+ Tambah Varian" di bawah.</div>`;
            return;
        }

        container.innerHTML = this.currentVariants.map((v, vIdx) => {
            const ingredients = v.ingredients || [];

            return `
                <div class="variant-builder-card" data-vidx="${vIdx}">
                    <div class="variant-builder-header">
                        <span class="variant-num-badge">Varian #${vIdx + 1}</span>
                        <button type="button" class="btn-del-variant-row" onclick="adminManager.removeVariantRow(${vIdx})" title="Hapus varian ini">
                            &times; Hapus Varian
                        </button>
                    </div>

                    <div class="variant-builder-fields">
                        <div class="variant-field-group">
                            <label>Nama Varian (Contoh: Paha, Dada, Campur):</label>
                            <input type="text" class="variant-input variant-name-input" value="${v.name || ''}" placeholder="Nama varian..." oninput="adminManager.updateVariantField(${vIdx}, 'name', this.value)" required>
                        </div>
                        <div class="variant-field-group" style="max-width: 170px;">
                            <label>Tambahan Harga (Rp):</label>
                            <input type="number" class="variant-input variant-price-input" value="${v.priceExtra || 0}" min="0" placeholder="0" oninput="adminManager.updateVariantField(${vIdx}, 'priceExtra', this.value)">
                        </div>
                    </div>

                    <!-- Resep Bahan Baku Master untuk Varian Ini (Bisa > 1 bahan) -->
                    <div class="variant-ingredients-box">
                        <div class="variant-ing-header">
                            <span>🌾 Resep Bahan Baku Master (Bisa pilih lebih dari 1 bahan):</span>
                            <button type="button" class="btn-add-ing-row" onclick="adminManager.addVariantIngredient(${vIdx})">
                                + Tambah Bahan
                            </button>
                        </div>

                        <div class="variant-ing-list">
                            ${ingredients.length === 0 ? `
                                <div style="color: #94A3B8; font-size: 12px; font-style: italic;">Belum ada resep bahan master untuk varian ini.</div>
                            ` : ingredients.map((ing, ingIdx) => `
                                <div class="variant-ing-row">
                                    <select class="variant-select-mat" onchange="adminManager.updateVariantIngredient(${vIdx}, ${ingIdx}, 'rawMaterialId', this.value)">
                                        <option value="">-- Pilih Bahan Baku Master --</option>
                                        ${rawMaterials.map(m => `
                                            <option value="${m.id}" ${m.id === ing.rawMaterialId ? 'selected' : ''}>
                                                ${m.name} (Stok: ${Number(m.stock).toLocaleString('id-ID')} ${m.unit})
                                            </option>
                                        `).join('')}
                                    </select>
                                    <div class="variant-ing-amount-wrap">
                                        <input type="number" step="0.01" class="variant-input-amount" value="${ing.amount || 0}" placeholder="Takaran" oninput="adminManager.updateVariantIngredient(${vIdx}, ${ingIdx}, 'amount', this.value)">
                                        <span class="unit-label">gr / unit</span>
                                    </div>
                                    <button type="button" class="btn-del-ing-row" onclick="adminManager.removeVariantIngredient(${vIdx}, ${ingIdx})" title="Hapus bahan ini">
                                        &times;
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateVariantField(vIdx, field, val) {
        if (!this.currentVariants[vIdx]) return;
        if (field === 'priceExtra' || field === 'cogsExtra') {
            this.currentVariants[vIdx][field] = parseFloat(val) || 0;
        } else {
            this.currentVariants[vIdx][field] = val;
        }
    }

    addVariantRow() {
        if (!this.currentVariants) this.currentVariants = [];
        this.currentVariants.push({
            id: 'var_' + Date.now() + '_' + Math.floor(Math.random() * 100),
            name: '',
            priceExtra: 0,
            cogsExtra: 0,
            ingredients: [{ rawMaterialId: '', amount: 0 }]
        });
        this.renderVariantsUI();
    }

    removeVariantRow(vIdx) {
        if (!this.currentVariants || !this.currentVariants[vIdx]) return;
        this.currentVariants.splice(vIdx, 1);
        this.renderVariantsUI();
    }

    addVariantIngredient(vIdx) {
        if (!this.currentVariants || !this.currentVariants[vIdx]) return;
        if (!this.currentVariants[vIdx].ingredients) this.currentVariants[vIdx].ingredients = [];
        this.currentVariants[vIdx].ingredients.push({ rawMaterialId: '', amount: 0 });
        this.renderVariantsUI();
    }

    removeVariantIngredient(vIdx, ingIdx) {
        if (!this.currentVariants || !this.currentVariants[vIdx] || !this.currentVariants[vIdx].ingredients) return;
        this.currentVariants[vIdx].ingredients.splice(ingIdx, 1);
        this.renderVariantsUI();
    }

    updateVariantIngredient(vIdx, ingIdx, key, val) {
        if (!this.currentVariants[vIdx] || !this.currentVariants[vIdx].ingredients || !this.currentVariants[vIdx].ingredients[ingIdx]) return;
        if (key === 'amount') {
            this.currentVariants[vIdx].ingredients[ingIdx].amount = parseFloat(val) || 0;
        } else {
            this.currentVariants[vIdx].ingredients[ingIdx].rawMaterialId = val;
        }
    }

    collectVariantsFromUI() {
        const cards = document.querySelectorAll('.variant-builder-card');
        cards.forEach((card, vIdx) => {
            if (!this.currentVariants[vIdx]) return;
            const nameInput = card.querySelector('.variant-name-input');
            const priceInput = card.querySelector('.variant-price-input');
            if (nameInput) this.currentVariants[vIdx].name = nameInput.value.trim();
            if (priceInput) this.currentVariants[vIdx].priceExtra = parseFloat(priceInput.value) || 0;
        });
    }

    // Berpindah dari form produk ke tabel admin panel utama
    switchToAdminTable() {
        this.closeProductModal();
        this.openAdminModal();
    }

    // Hapus produk yang sedang diedit di form
    async handleDeleteCurrentProduct() {
        if (!this.editingProductId) return;
        const prodId = this.editingProductId;
        this.closeProductModal();
        await this.handleDeleteProduct(prodId);
    }

    closeProductModal() {
        const modal = document.getElementById('adminProductModal');
        if (modal) modal.classList.remove('active');
        this.editingProductId = null;
    }

    setEmojiValue(emoji) {
        const input = document.getElementById('adminProdEmoji');
        if (input) input.value = emoji;
    }

    // ================= SIMPAN & HAPUS PRODUK =================

    async handleSaveProduct(e) {
        e.preventDefault();

        const id = document.getElementById('adminProdId').value.trim().toUpperCase();
        const name = document.getElementById('adminProdName').value.trim();
        const category = document.getElementById('adminProdCategory').value;
        const emoji = document.getElementById('adminProdEmoji').value.trim() || '🍗';
        const desc = document.getElementById('adminProdDesc').value.trim();
        const cogs = parseFloat(document.getElementById('adminProdCogs').value) || 0;
        const priceNormal = parseFloat(document.getElementById('adminProdPriceNormal').value) || 0;
        let pricePromo = parseFloat(document.getElementById('adminProdPricePromo').value);

        const rawStockType = document.getElementById('adminProdStockType')?.value || 'unlimited';
        const rawMaterialId = document.getElementById('adminProdRawMaterialId')?.value || '';
        const rawMaterialAmount = parseFloat(document.getElementById('adminProdRawMaterialAmount')?.value) || 0;
        const directStock = parseFloat(document.getElementById('adminProdDirectStock')?.value) || 0;

        // Validasi dan pengumpulan Varian Menu
        const hasVariants = document.getElementById('adminProdHasVariants')?.checked;
        let variants = [];
        let finalStockType = rawStockType;
        let finalRawMaterialId = rawMaterialId;
        let finalRawMaterialAmount = rawMaterialAmount;
        let finalDirectStock = directStock;

        if (hasVariants) {
            // Saat varian aktif, kontrol stok otomatis terikat ke varian menu di bawah
            finalStockType = 'variant';
            finalRawMaterialId = '';
            finalRawMaterialAmount = 0;
            finalDirectStock = 0;

            this.collectVariantsFromUI();
            if (!this.currentVariants || this.currentVariants.length === 0) {
                alert('Opsi Varian Menu diaktifkan tetapi belum ada varian yang ditambahkan!');
                return;
            }

            for (let i = 0; i < this.currentVariants.length; i++) {
                const v = this.currentVariants[i];
                const vName = (v.name || '').trim();
                if (!vName) {
                    alert(`Varian #${i + 1} wajib memiliki nama (misal: Paha, Dada, Campur)!`);
                    return;
                }

                variants.push({
                    id: v.id || ('var_' + Date.now() + '_' + i),
                    name: vName,
                    priceExtra: parseFloat(v.priceExtra) || 0,
                    cogsExtra: parseFloat(v.cogsExtra) || 0,
                    ingredients: (v.ingredients || []).filter(ing => ing.rawMaterialId && Number(ing.amount) > 0)
                });
            }
        } else {
            // Jika bukan varian, jalankan validasi stok tunggal
            if (finalStockType === 'raw_material') {
                if (!finalRawMaterialId) {
                    alert('Mohon pilih Bahan Baku Master untuk menu dengan tipe Resep Bahan!');
                    return;
                }
                if (finalRawMaterialAmount <= 0) {
                    alert('Takaran bahan baku per porsi harus lebih besar dari 0!');
                    return;
                }
            }
        }

        if (isNaN(pricePromo) || pricePromo <= 0) {
            pricePromo = priceNormal;
        }

        if (!id) {
            alert('Kode Menu (ID) wajib diisi!');
            return;
        }

        if (!name) {
            alert('Nama Menu wajib diisi!');
            return;
        }

        if (priceNormal <= 0) {
            alert('Harga Normal harus lebih besar dari 0!');
            return;
        }

        if (pricePromo > priceNormal) {
            if (!confirm('Harga Promo lebih besar daripada Harga Normal. Apakah Anda yakin ingin melanjutkan?')) {
                return;
            }
        }

        const oldId = this.editingProductId;

        // Cek ID / SKU duplikat
        if (oldId && oldId !== id) {
            const existing = productManager.getProductById(id);
            if (existing && existing.id !== oldId) {
                alert(`Kode Menu / SKU "${id}" sudah digunakan oleh menu "${existing.name}". Silakan gunakan kode lain.`);
                return;
            }
        } else if (!oldId) {
            const existing = productManager.getProductById(id);
            if (existing) {
                alert(`Kode Menu / SKU "${id}" sudah digunakan oleh produk "${existing.name}". Silakan gunakan kode lain.`);
                return;
            }
        }

        const sortOrderInput = document.getElementById('adminProdSortOrder');
        const sortOrder = sortOrderInput ? (parseInt(sortOrderInput.value) || 10) : 10;

        const product = {
            id,
            name,
            category,
            emoji,
            desc,
            cogs,
            priceNormal,
            pricePromo,
            stockType: finalStockType,
            rawMaterialId: finalRawMaterialId,
            rawMaterialAmount: finalRawMaterialAmount,
            directStock: finalDirectStock,
            sortOrder,
            variants
        };

        const submitBtn = document.getElementById('adminBtnSaveProduct');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan ke Cloud...';
        }

        try {
            await db.saveProduct(product, oldId);
            await productManager.loadProducts();

            // Refresh keranjang jika ada item bersangkutan
            if (typeof cartManager !== 'undefined') {
                cartManager.render();
            }

            sounds.playSuccess();
            this.render();
            this.closeProductModal();

            // Toast feedback
            this.showToast(`Menu "${name}" berhasil disimpan!`);
        } catch (err) {
            sounds.playWarning();
            alert('Gagal menyimpan menu: ' + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Simpan Produk';
            }
        }
    }

    async handleDeleteProduct(productId) {
        const product = productManager.getProductById(productId);
        if (!product) return;

        const confirmMsg = `Yakin ingin menghapus menu "${product.name}" (${product.id})?\n\nMenu akan dihapus dari daftar kasir & database cloud Neon.`;
        if (!confirm(confirmMsg)) return;

        try {
            await db.deleteProduct(productId);
            await productManager.loadProducts();

            // Jika item yang dihapus ada di keranjang, hapus dari keranjang
            if (typeof cartManager !== 'undefined') {
                cartManager.removeItem(productId);
            }

            sounds.playSuccess();
            this.render();
            this.showToast(`Menu "${product.name}" berhasil dihapus.`);
        } catch (err) {
            sounds.playWarning();
            alert('Gagal menghapus menu: ' + err.message);
        }
    }

    showToast(message) {
        let toast = document.getElementById('adminToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'adminToast';
            toast.className = 'admin-toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

const adminManager = new AdminManager();
