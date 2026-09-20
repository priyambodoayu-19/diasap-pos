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
        this.poPickupDate = '';
        this.poPickupTime = '';
        this.poPickupMethod = 'self_pickup'; // 'self_pickup', 'ojol', 'delivery'
        this.poPickupAddress = '';
        this.deliveryFee = 0;
        this.editingPendingInvoiceNo = null;
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
        const normalPrice = Number(product.priceNormal) + extraPrice;
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
                imageUrl: product.imageUrl || '',
                priceLocked: priceLocked,
                priceNormal: normalPrice,
                normalPriceLocked: normalPrice,
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
        this.editingPendingInvoiceNo = null;
        this.resetFinalDiscount();
        
        const custInput = document.getElementById('customerNameInput');
        if (custInput) custInput.value = '';
        
        const noteInput = document.getElementById('orderNotesInput');
        if (noteInput) noteInput.value = '';

        // Reset input PO & Ongkir
        const dateInput = document.getElementById('poPickupDate');
        if (dateInput) dateInput.value = '';
        const timeInput = document.getElementById('poPickupTime');
        if (timeInput) timeInput.value = '';
        const addrInput = document.getElementById('poPickupAddress');
        if (addrInput) addrInput.value = '';
        const feeInput = document.getElementById('poDeliveryFee');
        if (feeInput) feeInput.value = '';
        this.deliveryFee = 0;
        this.setPoPickupMethod('self_pickup');
        this.renderEditBanner();

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

        // Tampilkan/sembunyikan form jadwal PO jika Take Away
        const poBox = document.getElementById('poPickupDetailsBox');
        if (poBox) {
            poBox.style.display = (type === 'take_away') ? 'block' : 'none';
        }

        if (type === 'take_away') {
            const dateInput = document.getElementById('poPickupDate');
            const timeInput = document.getElementById('poPickupTime');
            if (dateInput && !dateInput.value) {
                const today = new Date().toISOString().split('T')[0];
                dateInput.value = today;
                this.poPickupDate = today;
            }
            if (timeInput && !timeInput.value) {
                const now = new Date();
                now.setHours(now.getHours() + 1);
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:00`;
                timeInput.value = timeStr;
                this.poPickupTime = timeStr;
            }
        } else {
            // Dine In: reset ongkir
            this.deliveryFee = 0;
            const feeInput = document.getElementById('poDeliveryFee');
            if (feeInput) feeInput.value = '';
            const feeWrapper = document.getElementById('poDeliveryFeeWrapper');
            if (feeWrapper) feeWrapper.style.display = 'none';
        }

        this.renderDiscountUI();
        if (typeof paymentManager !== 'undefined') {
            paymentManager.calculate();
        }
    }

    // Set metode pickup PO (Ambil di Toko / Ojol / Antar ke Lokasi)
    setPoPickupMethod(method) {
        this.poPickupMethod = method;
        document.querySelectorAll('.po-method-btn').forEach(btn => {
            if (btn.dataset.method === method) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const addressWrapper = document.getElementById('poAddressWrapper');
        const addressInput = document.getElementById('poPickupAddress');
        const feeWrapper = document.getElementById('poDeliveryFeeWrapper');
        const feeInput = document.getElementById('poDeliveryFee');

        if (addressWrapper) {
            if (method === 'self_pickup') {
                addressWrapper.style.display = 'none';
                if (feeWrapper) feeWrapper.style.display = 'none';
                this.deliveryFee = 0;
                if (feeInput) feeInput.value = '';
            } else if (method === 'ojol') {
                addressWrapper.style.display = 'block';
                if (addressInput) addressInput.placeholder = 'Info Ojol / Kurir (misal: Paxel / GoSend, Plat / Driver)';
                if (feeWrapper) feeWrapper.style.display = 'block';
            } else if (method === 'delivery') {
                addressWrapper.style.display = 'block';
                if (addressInput) addressInput.placeholder = 'Alamat Pengantaran Lengkap & No. HP Penerima';
                if (feeWrapper) feeWrapper.style.display = 'block';
            }
        }

        this.renderDiscountUI();
        if (typeof paymentManager !== 'undefined') {
            paymentManager.calculate();
        }
    }

    // Set Biaya Kurir / Antar (Rp)
    setDeliveryFee(fee) {
        this.deliveryFee = Math.max(0, parseInt(fee, 10) || 0);
        this.renderDiscountUI();
        if (typeof paymentManager !== 'undefined') {
            paymentManager.calculate();
        }
    }

    // Ambil data PO saat checkout / cetak bill
    getPoDetails() {
        if (this.orderType !== 'take_away') {
            return {
                pickupDate: '',
                pickupTime: '',
                pickupMethod: 'self_pickup',
                pickupAddress: '',
                deliveryFee: 0
            };
        }

        const dateInput = document.getElementById('poPickupDate');
        const timeInput = document.getElementById('poPickupTime');
        const addrInput = document.getElementById('poPickupAddress');

        return {
            pickupDate: dateInput ? dateInput.value : this.poPickupDate,
            pickupTime: timeInput ? timeInput.value : this.poPickupTime,
            pickupMethod: this.poPickupMethod || 'self_pickup',
            pickupAddress: addrInput ? addrInput.value.trim() : (this.poPickupAddress || ''),
            deliveryFee: this.deliveryFee || 0
        };
    }

    // Muat pesanan (misal tagihan sementara / open bill) kembali ke keranjang kasir
    loadOrderToCart(order) {
        if (!order) return;
        this.editingPendingInvoiceNo = order.invoiceNo;
        this.cart = (order.items || []).map(i => ({ ...i }));
        this.setOrderType(order.orderType || 'dine_in');

        const custInput = document.getElementById('customerNameInput');
        if (custInput) custInput.value = order.customerName || '';

        const noteInput = document.getElementById('orderNotesInput');
        if (noteInput) noteInput.value = order.notes || '';

        if (order.orderType === 'take_away') {
            const dateInput = document.getElementById('poPickupDate');
            if (dateInput && order.pickupDate) dateInput.value = order.pickupDate;

            const timeInput = document.getElementById('poPickupTime');
            if (timeInput && order.pickupTime) timeInput.value = order.pickupTime;

            if (order.pickupMethod) {
                this.setPoPickupMethod(order.pickupMethod);
            }
            const addrInput = document.getElementById('poPickupAddress');
            if (addrInput && order.pickupAddress) addrInput.value = order.pickupAddress;

            this.deliveryFee = Number(order.deliveryFee || 0);
            const feeInput = document.getElementById('poDeliveryFee');
            if (feeInput) feeInput.value = this.deliveryFee > 0 ? this.deliveryFee : '';
            const feeWrapper = document.getElementById('poDeliveryFeeWrapper');
            if (feeWrapper) {
                feeWrapper.style.display = (order.pickupMethod !== 'self_pickup') ? 'block' : 'none';
            }
        } else {
            this.deliveryFee = 0;
            const feeInput = document.getElementById('poDeliveryFee');
            if (feeInput) feeInput.value = '';
        }

        if (order.finalDiscountAmount > 0) {
            this.setFinalDiscount('nominal', order.finalDiscountAmount, order.finalDiscountNote || '');
        } else {
            this.resetFinalDiscount();
        }

        this.renderEditBanner();
        this.render();
        paymentManager.calculate();

        // Scroll ke keranjang
        const cartEl = document.querySelector('.cart-container');
        if (cartEl) cartEl.scrollIntoView({ behavior: 'smooth' });
    }

    // Render banner penanda kasir sedang mengedit tagihan sementara
    renderEditBanner() {
        let banner = document.getElementById('cartEditingBanner');
        if (!banner) {
            const header = document.querySelector('.cart-header-row');
            if (header) {
                banner = document.createElement('div');
                banner.id = 'cartEditingBanner';
                banner.className = 'cart-editing-banner';
                header.parentNode.insertBefore(banner, header.nextSibling);
            }
        }
        if (banner) {
            if (this.editingPendingInvoiceNo) {
                banner.innerHTML = `
                    <div class="edit-banner-content">
                        <span>✏️ Mengedit Tagihan: <strong>${this.editingPendingInvoiceNo}</strong></span>
                        <button type="button" class="btn-cancel-edit-banner" onclick="cartManager.cancelEditingPendingOrder()" title="Batal edit, kembali ke transaksi baru">✕ Batal</button>
                    </div>
                `;
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
        }
    }

    // Batal edit tagihan sementara
    cancelEditingPendingOrder() {
        if (confirm('Batalkan mode edit tagihan ini? (Tagihan tetap tersimpan aman di sistem)')) {
            this.clearCart(true);
        }
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

    // Hitung Grand Total (setelah diskon final + ongkir jika ada)
    getGrandTotal() {
        const subtotal = this.getSubtotal();
        const disc = this.getFinalDiscountAmount();
        const base = Math.max(0, subtotal - disc);
        return base + (Number(this.deliveryFee) || 0);
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

        // Update Floating Cart Bar untuk tampilan Mobile dengan deteksi posisi akurat
        this.updateFloatingBarVisibility();

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
            const normalPrice = item.normalPriceLocked || item.priceNormal || item.priceLocked;
            const hasPromoDiscount = item.isPromo && normalPrice > item.priceLocked;
            const totalItemSavings = (normalPrice - item.priceLocked) * item.qty;

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
                            <div class="item-price-calc-wrap">
                                ${hasPromoDiscount ? `
                                    <span class="cart-item-old-price"><del>${formatRupiah(normalPrice)}</del></span>
                                    <span class="cart-item-promo-price">@${formatRupiah(item.priceLocked)}</span>
                                    <span class="cart-item-saving-pill">Hemat ${formatRupiah(totalItemSavings)}</span>
                                ` : `
                                    <span>@${formatRupiah(item.priceLocked)}</span>
                                `}
                            </div>
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
        const promoRow = document.getElementById('cartPromoDiscountRow');
        const promoDisplay = document.getElementById('cartPromoDiscountDisplay');
        const discRow = document.getElementById('cartDiscountRow');
        const discAmountEl = document.getElementById('cartDiscountAmountDisplay');
        const grandTotalEl = document.getElementById('grandTotal');

        const subtotal = this.getSubtotal();
        const discAmount = this.getFinalDiscountAmount();
        const grandTotal = this.getGrandTotal();

        // Hitung total penghematan promo otomatis
        const totalPromoSavings = this.cart.reduce((sum, item) => {
            const normal = item.normalPriceLocked || item.priceNormal || item.priceLocked;
            return sum + (item.isPromo && normal > item.priceLocked ? (normal - item.priceLocked) * item.qty : 0);
        }, 0);

        if (subtotalEl) subtotalEl.textContent = formatRupiah(subtotal);
        if (grandTotalEl) grandTotalEl.textContent = formatRupiah(grandTotal);

        if (promoRow && promoDisplay) {
            if (totalPromoSavings > 0) {
                promoRow.style.display = 'flex';
                promoDisplay.textContent = `- ${formatRupiah(totalPromoSavings)}`;
            } else {
                promoRow.style.display = 'none';
            }
        }

        if (discRow && discAmountEl) {
            if (discAmount > 0) {
                discRow.style.display = 'flex';
                discAmountEl.textContent = `- ${formatRupiah(discAmount)}`;
            } else {
                discRow.style.display = 'none';
            }
        }

        const deliveryRow = document.getElementById('cartDeliveryFeeRow');
        const deliveryDisplay = document.getElementById('cartDeliveryFeeDisplay');
        if (deliveryRow && deliveryDisplay) {
            if (this.deliveryFee > 0) {
                deliveryRow.style.display = 'flex';
                deliveryDisplay.textContent = `+ ${formatRupiah(this.deliveryFee)}`;
            } else {
                deliveryRow.style.display = 'none';
            }
        }
    }

    init() {
        // Event scroll window & document untuk mendeteksi posisi keranjang secara real-time
        window.addEventListener('scroll', () => {
            this.updateFloatingBarVisibility();
        }, { passive: true });

        // Event resize layar
        window.addEventListener('resize', () => {
            this.updateFloatingBarVisibility();
        });

        // Pengecekan visibilitas awal
        this.updateFloatingBarVisibility();
    }

    updateFloatingBarVisibility() {
        const mFloatingBar = document.getElementById('mobileFloatingCartBar');
        if (!mFloatingBar) return;

        // 1. Desktop (> 860px) atau keranjang kosong: SELALU sembunyikan
        if (window.innerWidth > 860 || !this.cart || this.cart.length === 0) {
            mFloatingBar.style.display = 'none';
            return;
        }

        // 2. Mobile (<= 860px): Cek posisi cart container (.cart-container)
        const cartEl = document.querySelector('.cart-container');
        if (cartEl) {
            const rect = cartEl.getBoundingClientRect();
            // Jika area keranjang sudah mulai terlihat di layar (mendekati viewport), sembunyikan floating bar seketika!
            if (rect.top < window.innerHeight - 40) {
                mFloatingBar.style.display = 'none';
                return;
            }
        }

        // 3. Pengguna masih berada di atas melihat daftar menu: tampilkan floating bar
        const totalQty = this.getTotalItemsCount();
        const mCount = document.getElementById('mCartItemCount');
        const mTotal = document.getElementById('mCartGrandTotal');
        if (mCount) mCount.textContent = totalQty;
        if (mTotal) mTotal.textContent = formatRupiah(this.getGrandTotal());
        mFloatingBar.style.display = 'flex';
    }

    // Scroll otomatis ke keranjang di perangkat mobile
    scrollToCart() {
        const mFloatingBar = document.getElementById('mobileFloatingCartBar');
        if (mFloatingBar) {
            mFloatingBar.style.display = 'none';
        }
        const cart = document.querySelector('.cart-container');
        if (cart) {
            cart.scrollIntoView({ behavior: 'smooth' });
        }
    }
}

const cartManager = new CartManager();
