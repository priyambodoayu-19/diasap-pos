/**
 * DIASAP POS - Product Management & Rendering
 * Menangani pemuatan produk, filter kategori, pencarian, dan rendering kartu menu
 */

class ProductManager {
    constructor() {
        this.products = [];
        this.currentCategory = 'all';
        this.searchQuery = '';
        this.isPromoMode = false;
    }

    async loadProducts() {
        this.products = await db.getProducts();
        this.render();
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
                    <div style="font-size: 40px; margin-bottom: 10px;">🔍</div>
                    <div style="font-weight: bold; font-size: 16px;">Menu tidak ditemukan</div>
                    <div style="color: #7f8c8d; font-size: 13px;">Coba gunakan kata kunci pencarian atau kategori lain.</div>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(product => {
            const currentPrice = this.isPromoMode ? product.pricePromo : product.priceNormal;
            const savings = product.priceNormal - product.pricePromo;
            const isDiscounted = this.isPromoMode && savings > 0;

            const portions = (typeof inventoryManager !== 'undefined')
                ? inventoryManager.getPortionsAvailable(product)
                : Infinity;
            const isOutOfStock = portions === 0;

            let stockBadge = '';
            if (isOutOfStock) {
                stockBadge = `<span class="stock-pill stock-pill-out">❌ Habis</span>`;
            } else if (portions <= 5 && portions > 0) {
                stockBadge = `<span class="stock-pill stock-pill-low">Sisa ${portions}</span>`;
            } else if (portions !== Infinity) {
                stockBadge = `<span class="stock-pill stock-pill-avail">Sisa ${portions}</span>`;
            }

            const emojiDisplay = (typeof getValidProductEmoji === 'function') 
                ? getValidProductEmoji(product.emoji, product.category, product.id)
                : (product.emoji || '🍗');

            return `
                <div class="product-card ${this.isPromoMode ? 'is-promo-active' : ''} ${isOutOfStock ? 'is-out-of-stock' : ''}" 
                     onclick="${isOutOfStock ? `alert('Maaf, stok menu ini habis / bahan baku tidak mencukupi!')` : `cartManager.addItem('${product.id}')`}" 
                     title="${isOutOfStock ? 'Menu habis' : 'Klik untuk menambah ke keranjang'}">
                    <div class="card-top">
                        <span class="product-emoji">${emojiDisplay}</span>
                        <div style="display: flex; gap: 4px; align-items: center;">
                            ${stockBadge}
                            <span class="category-badge cat-${product.category}">${product.category.toUpperCase()}</span>
                        </div>
                    </div>

                    <div class="product-name">${product.name}</div>
                    <div class="product-desc">${product.desc || '-'}</div>

                    <div class="price-container">
                        ${isDiscounted ? `
                            <div class="price-row-promo">
                                <span class="old-price">${formatRupiah(product.priceNormal)}</span>
                                <span class="savings-tag">Hemat ${formatRupiah(savings)}</span>
                            </div>
                        ` : ''}
                        <div class="product-price ${this.isPromoMode ? 'promo-text' : ''}">
                            ${formatRupiah(currentPrice)}
                        </div>
                    </div>

                    <button class="quick-add-btn ${isOutOfStock ? 'btn-disabled' : ''}" type="button" aria-label="Tambah item" ${isOutOfStock ? 'disabled' : ''}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>${isOutOfStock ? 'Habis' : 'Tambah'}</span>
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
