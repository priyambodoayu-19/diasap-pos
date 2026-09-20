/**
 * DIASAP POS - Product Management & Rendering
 * Menangani pemuatan produk, filter kategori, pencarian, rendering kartu menu,
 * dan modal pemilihan varian menu (Paha, Dada, Campur, dll)
 */

// Global toast notification helper for POS
function showPosToast(message, duration = 3500) {
    let toast = document.getElementById('posToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'posToast';
        toast.className = 'admin-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

class ProductManager {
    constructor() {
        this.products = [];
        this.currentCategory = 'all';
        this.searchQuery = '';
        this.isPromoMode = false;
    }

    async loadProducts() {
        this.products = await db.getProducts();
        this.updateCategoryCounts();
        this.render();
    }

    updateCategoryCounts() {
        if (!Array.isArray(this.products)) return;
        const total = this.products.length;
        const countMakanan = this.products.filter(p => p.category === 'makanan').length;
        const countMinuman = this.products.filter(p => p.category === 'minuman').length;
        const countTambahan = this.products.filter(p => p.category === 'tambahan').length;

        const elAll = document.getElementById('countCatAll');
        if (elAll) elAll.textContent = `${total} items`;
        const elMakanan = document.getElementById('countCatMakanan');
        if (elMakanan) elMakanan.textContent = `${countMakanan} items`;
        const elMinuman = document.getElementById('countCatMinuman');
        if (elMinuman) elMinuman.textContent = `${countMinuman} items`;
        const elTambahan = document.getElementById('countCatTambahan');
        if (elTambahan) elTambahan.textContent = `${countTambahan} items`;
    }

    setPromoMode(isPromo) {
        this.isPromoMode = isPromo;
        this.render();
    }

    setCategory(cat) {
        this.currentCategory = cat;
        this.render();
    }

    setSearch(query) {
        this.searchQuery = (query || '').toLowerCase().trim();
        this.render();
    }

    getFilteredProducts() {
        return this.products.filter(p => {
            const matchesCategory = this.currentCategory === 'all' || p.category === this.currentCategory;
            const matchesSearch = !this.searchQuery || 
                p.name.toLowerCase().includes(this.searchQuery) || 
                (p.desc && p.desc.toLowerCase().includes(this.searchQuery));
            return matchesCategory && matchesSearch;
        });
    }

    render() {
        const grid = document.getElementById('menuGrid');
        if (!grid) return;

        const filtered = this.getFilteredProducts();

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-menu-state">
                    <div style="font-size: 44px; margin-bottom: 12px;">🔍</div>
                    <div style="font-weight: 700; font-size: 17px; color: var(--secondary);">Menu tidak ditemukan</div>
                    <div style="color: var(--text-muted); font-size: 13px; margin-top: 4px;">Coba gunakan kata kunci pencarian atau kategori lain.</div>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(product => {
            const currentPrice = this.isPromoMode ? product.pricePromo : product.priceNormal;
            const savings = product.priceNormal - product.pricePromo;
            const isDiscounted = this.isPromoMode && savings > 0;
            const hasVariants = product.variants && product.variants.length > 0;

            let portions = Infinity;
            let stockBadge = '';

            if (hasVariants) {
                portions = (typeof inventoryManager !== 'undefined')
                    ? inventoryManager.getPortionsAvailable(product)
                    : Infinity;

                if (portions === 0) {
                    stockBadge = `<span class="stock-pill stock-pill-po" style="background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; font-weight: 700;">📦 Masuk PO (${product.variants.length} Var)</span>`;
                } else if (portions <= 5 && portions > 0) {
                    stockBadge = `<span class="stock-pill stock-pill-low">Sisa ${portions} (${product.variants.length} Var)</span>`;
                } else if (portions !== Infinity) {
                    stockBadge = `<span class="stock-pill stock-pill-avail" style="background: #EFF6FF; color: #1D4ED8; border-color: #BFDBFE;">✨ ${product.variants.length} Varian (${portions} porsi)</span>`;
                } else {
                    stockBadge = `<span class="stock-pill stock-pill-avail" style="background: #EFF6FF; color: #1D4ED8; border-color: #BFDBFE;">✨ ${product.variants.length} Varian</span>`;
                }
            } else {
                portions = (typeof inventoryManager !== 'undefined')
                    ? inventoryManager.getPortionsAvailable(product)
                    : Infinity;

                if (portions === 0) {
                    stockBadge = `<span class="stock-pill stock-pill-po" style="background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; font-weight: 700;">📦 Masuk PO</span>`;
                } else if (portions <= 5 && portions > 0) {
                    stockBadge = `<span class="stock-pill stock-pill-low">Sisa ${portions}</span>`;
                } else if (portions !== Infinity) {
                    stockBadge = `<span class="stock-pill stock-pill-avail">Sisa ${portions}</span>`;
                }
            }

            const isZeroStock = portions === 0;
            const emojiDisplay = (typeof getValidProductEmoji === 'function') 
                ? getValidProductEmoji(product.emoji, product.category, product.id)
                : (product.emoji || '🍗');

            return `
                <div class="product-card ${this.isPromoMode ? 'is-promo-active' : ''} ${isZeroStock ? 'is-po-card' : ''}" 
                     onclick="cartManager.addItem('${product.id}')" 
                     title="${hasVariants ? 'Pilih varian rasa/bagian' : (isZeroStock ? 'Stok ready habis - klik untuk pesan PO' : 'Klik untuk menambah ke keranjang')}">
                    
                    <div class="card-visual-wrapper">
                        ${stockBadge ? `<div class="card-stock-tag">${stockBadge}</div>` : ''}
                        ${product.imageUrl ? `
                            <img src="${product.imageUrl}" alt="${product.name}" class="product-card-img" loading="lazy">
                        ` : `
                            <div class="product-visual-circle">
                                <span class="product-emoji">${emojiDisplay}</span>
                            </div>
                        `}
                    </div>

                    <div class="card-body-content">
                        <div class="product-name" title="${product.name}">${product.name}</div>
                        <div class="product-desc">${product.desc || '-'}</div>

                        ${isDiscounted ? `
                            <div class="price-row-promo">
                                <span class="old-price">${formatRupiah(product.priceNormal)}</span>
                                <span class="savings-tag">Hemat ${formatRupiah(savings)}</span>
                            </div>
                        ` : ''}

                        <div class="card-footer-row">
                            <span class="category-badge cat-${product.category}">${product.category.toUpperCase()}</span>
                            <div class="product-price ${this.isPromoMode ? 'promo-text' : ''}">
                                ${formatRupiah(currentPrice)}
                            </div>
                        </div>
                    </div>

                    <button class="quick-add-btn ${isZeroStock ? 'btn-po-order' : ''}" type="button" aria-label="Tambah item">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>${hasVariants ? 'Pilih Varian' : (isZeroStock ? '+ Pesan PO' : 'Tambah')}</span>
                    </button>
                </div>
            `;
        }).join('');
    }

    getProductById(id) {
        return this.products.find(p => p.id === id);
    }
}

const productManager = new ProductManager();

// ================= MODAL PEMILIHAN VARIAN MENU =================

class VariantSelectManager {
    constructor() {
        this.currentProduct = null;
        this.selectedVariant = null;
        this.qty = 1;
    }

    open(productId) {
        const product = productManager.getProductById(productId);
        if (!product || !product.variants || product.variants.length === 0) return;

        this.currentProduct = product;
        this.selectedVariant = product.variants[0];
        this.qty = 1;

        const modal = document.getElementById('variantModal');
        const title = document.getElementById('variantModalTitle');
        const desc = document.getElementById('variantModalDesc');
        const qtyDisplay = document.getElementById('variantModalQty');

        if (title) title.textContent = product.name;
        if (desc) desc.textContent = product.desc || 'Pilih varian rasa / potongan sebelum dimasukkan ke pesanan.';
        if (qtyDisplay) qtyDisplay.textContent = '1';

        this.renderOptions();
        this.updatePoNotice();

        if (modal) modal.classList.add('active');
    }

    renderOptions() {
        const container = document.getElementById('variantOptionsList');
        if (!container || !this.currentProduct) return;

        const isPromo = productManager.isPromoMode;
        const basePrice = isPromo ? Number(this.currentProduct.pricePromo) : Number(this.currentProduct.priceNormal);
        const normalBase = Number(this.currentProduct.priceNormal);
        const isDiscounted = isPromo && normalBase > basePrice;

        container.innerHTML = this.currentProduct.variants.map((v, idx) => {
            const extra = Number(v.priceExtra) || 0;
            const finalPrice = basePrice + extra;
            const normalFinal = normalBase + extra;
            const isSelected = (this.selectedVariant && this.selectedVariant.id === v.id) || (!this.selectedVariant && idx === 0);

            // Cek ketersediaan bahan baku untuk varian ini
            let portions = Infinity;
            if (v.ingredients && v.ingredients.length > 0 && typeof cartManager !== 'undefined') {
                portions = cartManager.getVariantAvailablePortions(v.ingredients);
            }
            const isZeroStock = portions !== Infinity && portions <= 0;

            let ingredientsDesc = '';
            if (v.ingredients && v.ingredients.length > 0 && typeof inventoryManager !== 'undefined') {
                ingredientsDesc = v.ingredients.map(ing => {
                    const mat = inventoryManager.getRawMaterialById(ing.rawMaterialId);
                    return mat ? `${mat.name} (${ing.amount} ${mat.unit})` : '';
                }).filter(Boolean).join(' + ');
            }

            let badgeHtml = '';
            if (portions !== Infinity) {
                if (isZeroStock) {
                    badgeHtml = `<span class="stock-pill stock-pill-po" style="background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; font-weight: 700;">📦 Masuk PO</span>`;
                } else if (portions <= 5) {
                    badgeHtml = `<span class="stock-pill stock-pill-low">Sisa ${portions}</span>`;
                } else {
                    badgeHtml = `<span class="stock-pill stock-pill-avail">Sisa ${portions}</span>`;
                }
            }

            return `
                <div class="variant-option-card ${isSelected ? 'selected' : ''} ${isZeroStock ? 'is-po-option' : ''}"
                     onclick="variantSelectManager.selectVariant('${v.id}')">
                    <div class="variant-radio-wrap">
                        <input type="radio" name="variantOptionRadio" id="var_${v.id}" value="${v.id}" ${isSelected ? 'checked' : ''}>
                    </div>
                    <div class="variant-info">
                        <div class="variant-name-row">
                            <span class="variant-title">${v.name}</span>
                            ${badgeHtml}
                        </div>
                        ${ingredientsDesc ? `<div class="variant-ingredients-text">🌾 Resep: ${ingredientsDesc}</div>` : ''}
                    </div>
                    <div class="variant-price-col">
                        ${isDiscounted ? `
                            <span class="variant-old-price"><del>${formatRupiah(normalFinal)}</del></span>
                            <span class="variant-final-price promo-text">${formatRupiah(finalPrice)}</span>
                            <span class="variant-saving-badge">Hemat ${formatRupiah(normalBase - basePrice)}</span>
                        ` : `
                            <span class="variant-final-price">${formatRupiah(finalPrice)}</span>
                        `}
                        ${extra > 0 ? `<span class="variant-extra-tag">+${formatRupiah(extra)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    updatePoNotice() {
        const notice = document.getElementById('variantModalPoNotice');
        if (!notice) return;

        if (!this.selectedVariant) {
            notice.style.display = 'none';
            return;
        }

        let portions = Infinity;
        if (this.selectedVariant.ingredients && this.selectedVariant.ingredients.length > 0 && typeof cartManager !== 'undefined') {
            portions = cartManager.getVariantAvailablePortions(this.selectedVariant.ingredients);
        }

        if (portions !== Infinity && portions <= 0) {
            notice.style.display = 'flex';
        } else {
            notice.style.display = 'none';
        }
    }

    selectVariant(variantId) {
        if (!this.currentProduct) return;
        const v = this.currentProduct.variants.find(item => item.id === variantId);
        if (v) {
            this.selectedVariant = v;
            this.renderOptions();
            this.updatePoNotice();
        }
    }

    changeQty(delta) {
        this.qty = Math.max(1, this.qty + delta);
        const qtyEl = document.getElementById('variantModalQty');
        if (qtyEl) qtyEl.textContent = this.qty;
    }

    confirmAddToCart() {
        if (!this.currentProduct || !this.selectedVariant) return;

        let portions = Infinity;
        if (this.selectedVariant.ingredients && this.selectedVariant.ingredients.length > 0 && typeof cartManager !== 'undefined') {
            portions = cartManager.getVariantAvailablePortions(this.selectedVariant.ingredients);
        }

        const isPoItem = portions !== Infinity && (portions <= 0 || this.qty > portions);
        if (isPoItem && typeof cartManager !== 'undefined' && cartManager.orderType !== 'take_away') {
            cartManager.setOrderType('take_away');
            showPosToast(`📦 Pesanan beralih ke <strong>Pre-Order (PO)</strong>: Kebutuhan daging <strong>${this.currentProduct.name} (${this.selectedVariant.name})</strong> dicatat ke daftar <strong>Harus Diasap</strong>.`);
        } else if (isPoItem) {
            showPosToast(`📦 Item Pre-Order (PO) ditambahkan: Kebutuhan daging dicatat ke <strong>Harus Diasap</strong>.`);
        }

        cartManager.addItem(this.currentProduct.id, this.selectedVariant, this.qty);
        this.close();
    }

    close() {
        const modal = document.getElementById('variantModal');
        if (modal) modal.classList.remove('active');
        this.currentProduct = null;
        this.selectedVariant = null;
        this.qty = 1;
    }
}

const variantSelectManager = new VariantSelectManager();
