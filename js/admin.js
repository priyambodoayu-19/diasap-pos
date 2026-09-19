/**
 * DIASAP POS - Admin Panel Manager
 * Mengelola katalog produk: Ubah Harga, Edit Diskon, Tambah & Hapus Produk
 */

class AdminManager {
    constructor() {
        this.currentCategory = 'all';
        this.searchQuery = '';
        this.editingProductId = null;
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
                    <td colspan="6" style="text-align: center; padding: 36px 20px; color: #94A3B8;">
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
            const savings = priceNormal - pricePromo;
            const hasDiscount = savings > 0;
            const discountPct = (hasDiscount && priceNormal > 0) ? Math.round((savings / priceNormal) * 100) : 0;

            let catLabel = 'Makanan';
            let catBadgeClass = 'cat-makanan';
            if (p.category === 'minuman') {
                catLabel = 'Minuman';
                catBadgeClass = 'cat-minuman';
            } else if (p.category === 'tambahan') {
                catLabel = 'Tambahan';
                catBadgeClass = 'cat-tambahan';
            }

            return `
                <tr>
                    <td style="text-align: center; font-weight: 700; color: #64748B;">${idx + 1}</td>
                    <td>
                        <div class="admin-prod-identity">
                            <span class="admin-prod-emoji">${p.emoji || '🍗'}</span>
                            <div>
                                <div class="admin-prod-name">${p.name}</div>
                                <div class="admin-prod-code">Kode: <strong>${p.id}</strong> &bull; <span class="category-badge ${catBadgeClass}">${catLabel}</span></div>
                            </div>
                        </div>
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
                        <div class="admin-prod-desc-cell" title="${p.desc || '-'}">${p.desc || '-'}</div>
                    </td>
                    <td style="text-align: right;">
                        <div class="admin-action-btns">
                            <button type="button" class="btn-admin-action btn-admin-edit" onclick="adminManager.openEditModal('${p.id}')" title="Ubah Harga, Diskon & Info Produk">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                                <span>Edit / Diskon</span>
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

    // ================= KALKULATOR DISKON INTERAKTIF =================

    setupDiscountCalculator() {
        const priceNormalInput = document.getElementById('adminProdPriceNormal');
        const pricePromoInput = document.getElementById('adminProdPricePromo');
        const discountNominalInput = document.getElementById('adminProdDiscountNominal');
        const discountPercentInput = document.getElementById('adminProdDiscountPercent');

        if (!priceNormalInput || !pricePromoInput || !discountNominalInput || !discountPercentInput) return;

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
                discountPercentInput.value = normal > 0 ? (nominal / normal * 100).toFixed(1).replace(/\.0$/, '') : 0;
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

            const pct = (normal > 0 && nominal > 0) ? ((nominal / normal) * 100).toFixed(1).replace(/\.0$/, '') : 0;
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

            const pct = (normal > 0 && nominal > 0) ? ((nominal / normal) * 100).toFixed(1).replace(/\.0$/, '') : 0;
            discountPercentInput.value = pct;

            this.updateDiscountPreview();
        });
    }

    updateDiscountPreview() {
        const previewEl = document.getElementById('adminDiscountPreview');
        const normal = parseFloat(document.getElementById('adminProdPriceNormal')?.value) || 0;
        const promo = parseFloat(document.getElementById('adminProdPricePromo')?.value) || normal;

        if (!previewEl) return;

        const saving = normal - promo;
        if (normal > 0 && saving > 0) {
            const pct = ((saving / normal) * 100).toFixed(1).replace(/\.0$/, '');
            previewEl.innerHTML = `
                <div class="discount-preview-card active-discount">
                    <span class="preview-tag">🔥 Diskon Aktif</span>
                    <span class="preview-text">Pelanggan hemat <strong>${formatRupiah(saving)}</strong> (Potongan <strong>${pct}%</strong>)</span>
                </div>
            `;
        } else if (normal > 0 && saving === 0) {
            previewEl.innerHTML = `
                <div class="discount-preview-card no-discount">
                    <span class="preview-tag">Normal</span>
                    <span class="preview-text">Harga Promo sama dengan Harga Normal (Tidak ada diskon khusus).</span>
                </div>
            `;
        } else if (promo > normal) {
            previewEl.innerHTML = `
                <div class="discount-preview-card invalid-discount">
                    <span class="preview-tag">⚠️ Perhatian</span>
                    <span class="preview-text">Harga Promo lebih tinggi dari Harga Normal!</span>
                </div>
            `;
        } else {
            previewEl.innerHTML = '';
        }
    }

    // ================= MODAL TAMBAH & EDIT PRODUK =================

    openAddModal() {
        this.editingProductId = null;
        const modal = document.getElementById('adminProductModal');
        const title = document.getElementById('adminProductModalTitle');
        const form = document.getElementById('adminProductForm');
        const idInput = document.getElementById('adminProdId');

        if (form) form.reset();
        if (title) title.textContent = '➕ Tambah Menu Produk Baru';
        if (idInput) {
            idInput.disabled = false;
            idInput.focus();
        }

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
        const priceNormalInput = document.getElementById('adminProdPriceNormal');
        const pricePromoInput = document.getElementById('adminProdPricePromo');
        const nominalInput = document.getElementById('adminProdDiscountNominal');
        const percentInput = document.getElementById('adminProdDiscountPercent');

        if (title) title.textContent = `✏️ Edit Menu: ${product.name}`;
        if (idInput) {
            idInput.value = product.id;
            idInput.disabled = true; // Jangan ubah ID produk saat edit
        }
        if (nameInput) nameInput.value = product.name;
        if (catSelect) catSelect.value = product.category || 'makanan';
        if (emojiInput) emojiInput.value = product.emoji || '🍗';
        if (descInput) descInput.value = product.desc || '';

        const normal = Number(product.priceNormal) || 0;
        const promo = Number(product.pricePromo) || normal;
        const saving = Math.max(0, normal - promo);
        const pct = (normal > 0 && saving > 0) ? ((saving / normal) * 100).toFixed(1).replace(/\.0$/, '') : 0;

        if (priceNormalInput) priceNormalInput.value = normal;
        if (pricePromoInput) pricePromoInput.value = promo;
        if (nominalInput) nominalInput.value = saving;
        if (percentInput) percentInput.value = pct;

        this.updateDiscountPreview();

        if (modal) modal.classList.add('active');
        if (priceNormalInput) {
            setTimeout(() => priceNormalInput.focus(), 150);
        }
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
        const priceNormal = parseFloat(document.getElementById('adminProdPriceNormal').value) || 0;
        let pricePromo = parseFloat(document.getElementById('adminProdPricePromo').value);

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

        // Cek ID duplikat saat mode tambah
        if (!this.editingProductId) {
            const existing = productManager.getProductById(id);
            if (existing) {
                alert(`Kode Menu "${id}" sudah digunakan oleh produk "${existing.name}". Silakan gunakan kode lain.`);
                return;
            }
        }

        const product = {
            id,
            name,
            category,
            emoji,
            desc,
            priceNormal,
            pricePromo
        };

        const submitBtn = document.getElementById('adminBtnSaveProduct');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan ke Cloud...';
        }

        try {
            await db.saveProduct(product);
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
