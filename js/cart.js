/**
 * DIASAP POS - Cart Manager
 * Menangani keranjang belanja, penguncian harga (price locking) saat promo,
 * varian menu dengan multi-bahan baku, diskon final transaksi, dan kalkulasi total
 */

class CartManager {
    constructor() {
        this.cart = [];
        this.customerName = '';
        this.orderType = 'dine_in'; // 'dine_in' atau 'take_away'
        this.notes = '';
        this.finalDiscount = {
            type: 'nominal', // 'nominal' | 'percent'
            value: 0,
            amount: 0,
            note: ''
        };
    }

    // Menambahkan item ke keranjang belanja
    addItem(productId, variant = null, qty = 1) {
        const product = productManager.getProductById(productId);
        if (!product) return;

        // Jika produk memiliki varian dan belum dipilih spesifik, buka modal pemilihan varian
        if (!variant && product.variants && product.variants.length > 0) {
            if (typeof variantSelectManager !== 'undefined') {
                variantSelectManager.open(productId);
            }
            return;
        }

        const variantId = variant ? (variant.id || '') : '';
        const variantName = variant ? (variant.name || '') : '';
        const ingredients = variant ? (variant.ingredients || []) : [];
        const extraPrice = variant ? (Number(variant.priceExtra) || 0) : 0;
        const extraCogs = variant ? (Number(variant.cogsExtra) || 0) : 0;

        // Kunci harga saat item ditambahkan
        const isPromoActive = productManager.isPromoMode;
        const basePrice = isPromoActive ? Number(product.pricePromo) : Number(product.priceNormal);
        const priceLocked = basePrice + extraPrice;
        const cogsLocked = (Number(product.cogs) || 0) + extraCogs;
        const displayName = variantName ? `${product.name} (${variantName})` : product.name;

        // Cek ketersediaan stok
        let available = Infinity;
        if (typeof inventoryManager !== 'undefined') {
            if (ingredients && ingredients.length > 0) {
                // Hitung ketersediaan berdasarkan bahan baku varian
                available = this.getVariantAvailablePortions(ingredients);
            } else {
                available = inventoryManager.getPortionsAvailable(product);
            }
        }

        const currentInCart = this.cart
            .filter(item => item.id === productId && (item.variantId || '') === variantId)
            .reduce((sum, item) => sum + item.qty, 0);

        if (available !== Infinity && (currentInCart + qty) > available) {
            sounds.playWarning();
            alert(`Stok tidak mencukupi! Hanya tersedia ${available} porsi/unit untuk menu/varian ini.`);
            return;
        }

        // Cari item di keranjang dengan id, varian, dan harga terkunci yang sama
        const existingItem = this.cart.find(
            item => item.id === productId && 
                    (item.variantId || '') === variantId && 
                    item.priceLocked === priceLocked && 
                    item.isPromo === isPromoActive
        );

        if (existingItem) {
            existingItem.qty += qty;
        } else {
            this.cart.push({
                id: product.id,
                name: displayName,
                baseName: product.name,
                variantId: variantId,
                variantName: variantName,
                ingredients: ingredients,
                emoji: product.emoji || '🍗',
                priceLocked: priceLocked,
                cogsLocked: cogsLocked,
                isPromo: isPromoActive,
                qty: qty
            });
        }

        sounds.playBeep();
        this.render();
        paymentManager.calculate();
    }

    // Hitung porsi tersedia untuk varian berdasarkan bahan baku master
    getVariantAvailablePortions(ingredients) {
        if (!ingredients || ingredients.length === 0) return Infinity;
        if (typeof inventoryManager === 'undefined') return Infinity;

        let minPortions = Infinity;
        for (const ing of ingredients) {
            if (!ing.rawMaterialId || Number(ing.amount) <= 0) continue;
            const mat = inventoryManager.getRawMaterialById(ing.rawMaterialId);
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

    // Ubah kuantitas item
    changeQty(productId, variantId, priceLocked, isPromo, delta) {
        const item = this.cart.find(
            i => i.id === productId && 
                 (i.variantId || '') === (variantId || '') && 
                 i.priceLocked === priceLocked && 
                 i.isPromo === isPromo
        );

        if (item) {
            if (delta > 0) {
                let available = Infinity;
                if (typeof inventoryManager !== 'undefined') {
                    if (item.ingredients && item.ingredients.length > 0) {
                        available = this.getVariantAvailablePortions(item.ingredients);
                    } else {
                        const product = productManager.getProductById(productId);
                        available = product ? inventoryManager.getPortionsAvailable(product) : Infinity;
                    }
                }

                const currentInCart = this.cart
                    .filter(i => i.id === productId && (i.variantId || '') === (variantId || ''))
                    .reduce((sum, i) => sum + i.qty, 0);

                if (available !== Infinity && currentInCart + delta > available) {
                    sounds.playWarning();
                    alert(`Stok tidak mencukupi! Hanya tersedia ${available} porsi/unit.`);
                    return;
                }
            }

            item.qty += delta;
            if (item.qty <= 0) {
                this.removeItem(productId, variantId, priceLocked, isPromo);
                return;
            }
            sounds.playBeep();
        }

        this.render();
        paymentManager.calculate();
    }

    // Hapus item dari keranjang
    removeItem(productId, variantId, priceLocked, isPromo) {
        this.cart = this.cart.filter(
            i => !(i.id === productId && 
                   (i.variantId || '') === (variantId || '') && 
                   i.priceLocked === priceLocked && 
                   i.isPromo === isPromo)
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
        this.resetFinalDiscount();
        
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

    // ================= DISKON FINAL TRANSAKSI =================

    setFinalDiscount(type, value, note = '') {
        this.finalDiscount.type = type; // 'nominal' | 'percent'
        this.finalDiscount.value = parseFloat(value) || 0;
        this.finalDiscount.note = note || '';
        this.recalculateDiscount();
        paymentManager.calculate();
        this.renderDiscountUI();
    }

    recalculateDiscount() {
        const subtotal = this.getSubtotal();
        if (this.finalDiscount.type === 'percent') {
            const pct = Math.min(100, Math.max(0, this.finalDiscount.value));
            this.finalDiscount.amount = Math.round(subtotal * (pct / 100));
        } else {
            this.finalDiscount.amount = Math.min(subtotal, Math.max(0, this.finalDiscount.value));
        }
    }

    resetFinalDiscount() {
        this.finalDiscount = {
            type: 'nominal',
            value: 0,
            amount: 0,
            note: ''
        };
        const valInput = document.getElementById('finalDiscountValue');
        const noteInput = document.getElementById('finalDiscountNote');
        if (valInput) valInput.value = '';
        if (noteInput) noteInput.value = '';
        this.renderDiscountUI();
    }

    getFinalDiscountAmount() {
        this.recalculateDiscount();
        return this.finalDiscount.amount || 0;
    }

    // Hitung Subtotal Keranjang (sebelum diskon final)
    getSubtotal() {
        return this.cart.reduce((sum, item) => sum + (item.priceLocked * item.qty), 0);
    }

    // Hitung Grand Total (setelah diskon final)
    getGrandTotal() {
        const subtotal = this.getSubtotal();
        const disc = this.getFinalDiscountAmount();
        return Math.max(0, subtotal - disc);
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
                if (mTotal) mTotal.textContent = formatRupiah(this.getGrandTotal());
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
            this.renderDiscountUI();
            return;
        }

        cartList.innerHTML = this.cart.map(item => {
            const itemTotal = item.priceLocked * item.qty;
            const promoBadge = item.isPromo 
                ? `<span class="cart-promo-badge">PROMO</span>` 
                : `<span class="cart-normal-badge">NORMAL</span>`;

            const variantBadge = item.variantName 
                ? `<span class="cart-variant-tag">✨ ${item.variantName}</span>` 
                : '';

            const safeVariantId = item.variantId || '';

            return `
                <div class="cart-item">
                    <div class="item-main">
                        <div class="item-title-row">
                            <span class="item-emoji">${item.emoji}</span>
                            <span class="item-name">${item.name}</span>
                            ${promoBadge}
                        </div>
                        ${variantBadge ? `<div style="margin-top: 2px;">${variantBadge}</div>` : ''}
                        <div class="item-price-meta">
                            <span>@${formatRupiah(item.priceLocked)}</span>
                            <span class="item-subtotal-meta">Total: <strong>${formatRupiah(itemTotal)}</strong></span>
                        </div>
                    </div>

                    <div class="item-controls">
                        <div class="qty-stepper">
                            <button type="button" class="qty-btn" onclick="cartManager.changeQty('${item.id}', '${safeVariantId}', ${item.priceLocked}, ${item.isPromo}, -1)" title="Kurangi">-</button>
                            <span class="qty-display">${item.qty}</span>
                            <button type="button" class="qty-btn" onclick="cartManager.changeQty('${item.id}', '${safeVariantId}', ${item.priceLocked}, ${item.isPromo}, 1)" title="Tambah">+</button>
                        </div>
                        <button type="button" class="remove-btn" onclick="cartManager.removeItem('${item.id}', '${safeVariantId}', ${item.priceLocked}, ${item.isPromo})" title="Hapus dari pesanan">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.renderDiscountUI();
    }

    renderDiscountUI() {
        const subtotalEl = document.getElementById('cartSubtotalDisplay');
        const discRow = document.getElementById('cartDiscountRow');
        const discAmountEl = document.getElementById('cartDiscountAmountDisplay');
        const grandTotalEl = document.getElementById('grandTotal');

        const subtotal = this.getSubtotal();
        const discAmount = this.getFinalDiscountAmount();
        const grandTotal = this.getGrandTotal();

        if (subtotalEl) subtotalEl.textContent = formatRupiah(subtotal);
        if (grandTotalEl) grandTotalEl.textContent = formatRupiah(grandTotal);

        if (discRow && discAmountEl) {
            if (discAmount > 0) {
                discRow.style.display = 'flex';
                discAmountEl.textContent = `- ${formatRupiah(discAmount)}`;
            } else {
                discRow.style.display = 'none';
            }
        }
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
