/**
 * DIASAP POS - Cart Manager
 * Menangani keranjang belanja, penguncian harga (price locking) saat promo,
 * pengaturan kuantitas, dan tipe pesanan
 */

class CartManager {
    constructor() {
        this.cart = [];
        this.customerName = '';
        this.orderType = 'dine_in'; // 'dine_in' atau 'take_away'
        this.notes = '';
    }

    // Menambahkan item ke keranjang belanja dengan penguncian harga
    addItem(productId) {
        const product = productManager.getProductById(productId);
        if (!product) return;

        // Kunci harga saat item ditambahkan sesuai mode promo yang sedang aktif
        const isPromoActive = productManager.isPromoMode;
        const priceLocked = isPromoActive ? product.pricePromo : product.priceNormal;

        // Cari item di keranjang dengan id dan harga terkunci yang sama
        const existingItem = this.cart.find(
            item => item.id === productId && item.priceLocked === priceLocked && item.isPromo === isPromoActive
        );

        if (existingItem) {
            existingItem.qty++;
        } else {
            this.cart.push({
                id: product.id,
                name: product.name,
                emoji: product.emoji || '🍗',
                priceLocked: priceLocked,
                cogsLocked: Number(product.cogs) || 0,
                isPromo: isPromoActive,
                qty: 1
            });
        }

        sounds.playBeep();
        this.render();
        paymentManager.calculate();
    }

    // Ubah kuantitas item
    changeQty(productId, priceLocked, isPromo, delta) {
        const item = this.cart.find(
            i => i.id === productId && i.priceLocked === priceLocked && i.isPromo === isPromo
        );

        if (item) {
            item.qty += delta;
            if (item.qty <= 0) {
                this.removeItem(productId, priceLocked, isPromo);
                return;
            }
            sounds.playBeep();
        }

        this.render();
        paymentManager.calculate();
    }

    // Hapus item dari keranjang
    removeItem(productId, priceLocked, isPromo) {
        this.cart = this.cart.filter(
            i => !(i.id === productId && i.priceLocked === priceLocked && i.isPromo === isPromo)
        );
        this.render();
        paymentManager.calculate();
    }

    // Kosongkan keranjang belanja
    clearCart(silent = false) {
        if (!silent && this.cart.length > 0) {
            if (!confirm('Apakah Anda yakin ingin mengosongkan keranjang belanja?')) {
                return;
            }
        }
        this.cart = [];
        this.customerName = '';
        this.notes = '';
        
        const custInput = document.getElementById('customerNameInput');
        if (custInput) custInput.value = '';
        
        const noteInput = document.getElementById('orderNotesInput');
        if (noteInput) noteInput.value = '';

        this.render();
        paymentManager.calculate();
    }

    // Set tipe pesanan (Dine In / Take Away)
    setOrderType(type) {
        this.orderType = type;
        document.querySelectorAll('.order-type-btn').forEach(btn => {
            if (btn.dataset.type === type) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // Hitung Subtotal Keranjang
    getSubtotal() {
        return this.cart.reduce((sum, item) => sum + (item.priceLocked * item.qty), 0);
    }

    // Hitung Total Item
    getTotalItemsCount() {
        return this.cart.reduce((sum, item) => sum + item.qty, 0);
    }

    // Render Tampilan Keranjang
    render() {
        const cartList = document.getElementById('cartItemsList');
        const countBadge = document.getElementById('cartItemCount');
        const clearBtn = document.getElementById('clearCartBtn');

        if (!cartList) return;

        const totalQty = this.getTotalItemsCount();
        if (countBadge) countBadge.textContent = `${totalQty} item`;
        if (clearBtn) clearBtn.style.display = this.cart.length > 0 ? 'inline-flex' : 'none';

        // Update Floating Cart Bar untuk tampilan Mobile
        const mFloatingBar = document.getElementById('mobileFloatingCartBar');
        const mCount = document.getElementById('mCartItemCount');
        const mTotal = document.getElementById('mCartGrandTotal');
        if (mFloatingBar) {
            if (this.cart.length > 0) {
                mFloatingBar.style.display = 'flex';
                if (mCount) mCount.textContent = totalQty;
                if (mTotal) mTotal.textContent = formatRupiah(this.getSubtotal());
            } else {
                mFloatingBar.style.display = 'none';
            }
        }

        if (this.cart.length === 0) {
            cartList.innerHTML = `
                <div class="empty-cart-state">
                    <div style="font-size: 48px; margin-bottom: 12px; opacity: 0.6;">🛒</div>
                    <div style="font-weight: 600; font-size: 16px; color: #7f8c8d;">Keranjang Masih Kosong</div>
                    <div style="font-size: 12px; color: #95a5a6; margin-top: 4px;">Klik menu di sebelah kiri untuk menambahkan pesanan</div>
                </div>
            `;
            return;
        }

        cartList.innerHTML = this.cart.map(item => {
            const itemTotal = item.priceLocked * item.qty;
            const promoBadge = item.isPromo 
                ? `<span class="cart-promo-badge">PROMO</span>` 
                : `<span class="cart-normal-badge">NORMAL</span>`;

            return `
                <div class="cart-item">
                    <div class="item-main">
                        <div class="item-title-row">
                            <span class="item-emoji">${item.emoji}</span>
                            <span class="item-name">${item.name}</span>
                            ${promoBadge}
                        </div>
                        <div class="item-price-meta">
                            <span>@${formatRupiah(item.priceLocked)}</span>
                            <span class="item-subtotal-meta">Total: <strong>${formatRupiah(itemTotal)}</strong></span>
                        </div>
                    </div>

                    <div class="item-controls">
                        <div class="qty-stepper">
                            <button type="button" class="qty-btn" onclick="cartManager.changeQty('${item.id}', ${item.priceLocked}, ${item.isPromo}, -1)" title="Kurangi">-</button>
                            <span class="qty-display">${item.qty}</span>
                            <button type="button" class="qty-btn" onclick="cartManager.changeQty('${item.id}', ${item.priceLocked}, ${item.isPromo}, 1)" title="Tambah">+</button>
                        </div>
                        <button type="button" class="remove-btn" onclick="cartManager.removeItem('${item.id}', ${item.priceLocked}, ${item.isPromo})" title="Hapus dari pesanan">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Scroll otomatis ke keranjang di perangkat mobile
    scrollToCart() {
        const cart = document.querySelector('.cart-container');
        if (cart) {
            cart.scrollIntoView({ behavior: 'smooth' });
        }
    }
}

const cartManager = new CartManager();
