/**
 * DIASAP POS - Payment & Checkout Manager
 * Menangani kalkulasi pembayaran, uang pas, kembalian, QRIS/Transfer, dan pencetakan struk
 */

class PaymentManager {
    constructor() {
        this.paymentMethod = 'cash'; // 'cash', 'qris', 'transfer'
        this.cashAmount = 0;
        this.lastCompletedOrder = null;
    }

    setPaymentMethod(method) {
        this.paymentMethod = method;
        document.querySelectorAll('.pay-method-btn').forEach(btn => {
            if (btn.dataset.method === method) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const cashGroup = document.getElementById('cashInputGroup');
        const quickCash = document.getElementById('quickCashGroup');
        const qrisInfo = document.getElementById('qrisInfoGroup');

        if (method === 'cash') {
            if (cashGroup) cashGroup.style.display = 'block';
            if (quickCash) quickCash.style.display = 'flex';
            if (qrisInfo) qrisInfo.style.display = 'none';
        } else if (method === 'qris') {
            if (cashGroup) cashGroup.style.display = 'none';
            if (quickCash) quickCash.style.display = 'none';
            if (qrisInfo) {
                qrisInfo.style.display = 'block';
                const total = cartManager.getSubtotal();
                document.getElementById('qrisTotalDisplay').textContent = formatRupiah(total);
            }
        } else { // transfer
            if (cashGroup) cashGroup.style.display = 'none';
            if (quickCash) quickCash.style.display = 'none';
            if (qrisInfo) qrisInfo.style.display = 'none';
        }

        this.calculate();
    }

    setQuickCash(amount) {
        const total = cartManager.getSubtotal();
        let targetAmount = amount;

        if (amount === 'exact') {
            targetAmount = total;
        }

        const input = document.getElementById('cashInput');
        if (input) {
            input.value = targetAmount;
            this.calculate();
        }
    }

    calculate() {
        const total = cartManager.getSubtotal();
        const grandTotalEl = document.getElementById('grandTotal');
        const checkoutBtn = document.getElementById('checkoutBtn');
        const changeDisplay = document.getElementById('changeDisplay');
        const cashInput = document.getElementById('cashInput');

        if (grandTotalEl) {
            grandTotalEl.textContent = formatRupiah(total);
        }

        // Jika keranjang kosong
        if (cartManager.cart.length === 0) {
            if (changeDisplay) changeDisplay.innerHTML = `Kembalian: <span class="text-muted">Rp 0</span>`;
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        if (this.paymentMethod === 'cash') {
            const rawVal = cashInput ? cashInput.value.replace(/\D/g, '') : '0';
            this.cashAmount = parseFloat(rawVal) || 0;
            const change = this.cashAmount - total;

            if (this.cashAmount === 0) {
                changeDisplay.innerHTML = `Kembalian: <span class="text-muted">Rp 0</span>`;
                checkoutBtn.disabled = false; // Memungkinkan kasir menyelesaikan jika bayar pas nanti
            } else if (change >= 0) {
                changeDisplay.innerHTML = `Kembalian: <span class="change-positive">${formatRupiah(change)}</span>`;
                checkoutBtn.disabled = false;
            } else {
                changeDisplay.innerHTML = `Kurang: <span class="change-negative">${formatRupiah(Math.abs(change))}</span>`;
                checkoutBtn.disabled = true;
            }
        } else {
            // QRIS atau Transfer: Pembayaran dianggap pas
            changeDisplay.innerHTML = `Metode: <strong style="text-transform: uppercase;">${this.paymentMethod}</strong> (Non-Tunai)`;
            checkoutBtn.disabled = false;
        }
    }

    async processCheckout() {
        const total = cartManager.getSubtotal();
        if (total <= 0 || cartManager.cart.length === 0) {
            alert('Keranjang belanja masih kosong!');
            return;
        }

        let cashReceived = this.cashAmount;
        let changeAmount = 0;

        if (this.paymentMethod === 'cash') {
            if (cashReceived > 0 && cashReceived < total) {
                sounds.playWarning();
                alert('Uang pembayaran tunai masih kurang!');
                return;
            }
            if (cashReceived === 0) {
                // Jika input tunai kosong, anggap uang pas
                cashReceived = total;
            }
            changeAmount = Math.max(0, cashReceived - total);
        } else {
            cashReceived = total;
            changeAmount = 0;
        }

        const customerName = (document.getElementById('customerNameInput')?.value || '').trim() || 'Pelanggan';
        const notes = (document.getElementById('orderNotesInput')?.value || '').trim();
        const invoiceNo = generateInvoiceNumber();

        const orderData = {
            invoiceNo: invoiceNo,
            customerName: customerName,
            orderType: cartManager.orderType,
            paymentMethod: this.paymentMethod,
            totalAmount: total,
            cashReceived: cashReceived,
            changeAmount: changeAmount,
            notes: notes,
            createdAt: new Date().toISOString()
        };

        const items = cartManager.cart.map(item => ({ ...item }));

        // Disable checkout button sementara proses
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (checkoutBtn) {
            checkoutBtn.disabled = true;
            checkoutBtn.textContent = 'Memproses...';
        }

        try {
            // Simpan ke database (Neon / LocalStorage)
            const savedOrder = await db.saveOrder(orderData, items);
            this.lastCompletedOrder = savedOrder;

            // Potong stok bahan baku master & barang jadi
            if (typeof inventoryManager !== 'undefined') {
                await inventoryManager.deductOrderStock(items);
            }

            // Efek suara sukses kasir
            sounds.playSuccess();

            // Tampilkan Struk Pembayaran
            this.showReceiptModal(savedOrder);

            // Bersihkan Keranjang & Form
            cartManager.clearCart(true);
            if (document.getElementById('cashInput')) document.getElementById('cashInput').value = '';
            this.calculate();
        } catch (err) {
            console.error('Error saat checkout:', err);
            alert('Terjadi kesalahan saat memproses transaksi: ' + err.message);
        } finally {
            if (checkoutBtn) {
                checkoutBtn.disabled = false;
                checkoutBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>SELESAI TRANSAKSI</span>
                `;
            }
        }
    }

    showReceiptModal(order) {
        const modal = document.getElementById('receiptModal');
        const content = document.getElementById('receiptPrintArea');
        if (!modal || !content) return;

        const orderTypeLabel = order.orderType === 'dine_in' ? 'Dine In (Makan di Tempat)' : 'Take Away (Bungkus)';
        const paymentLabel = order.paymentMethod.toUpperCase();

        content.innerHTML = `
            <div class="receipt-paper">
                <div class="receipt-header">
                    <div class="receipt-logo">🔥 DIASAP 🔥</div>
                    <div class="receipt-store">${CONFIG.STORE_NAME}</div>
                    <div class="receipt-meta">${CONFIG.STORE_ADDRESS}</div>
                    <div class="receipt-meta">Telp: ${CONFIG.STORE_PHONE}</div>
                </div>

                <div class="receipt-divider">================================</div>

                <div class="receipt-info-row">
                    <span>No. Invoice:</span>
                    <span><strong>${order.invoiceNo}</strong></span>
                </div>
                <div class="receipt-info-row">
                    <span>Waktu:</span>
                    <span>${formatDateTime(order.createdAt)}</span>
                </div>
                <div class="receipt-info-row">
                    <span>Pelanggan:</span>
                    <span>${order.customerName}</span>
                </div>
                <div class="receipt-info-row">
                    <span>Layanan:</span>
                    <span>${orderTypeLabel}</span>
                </div>
                ${order.notes ? `
                    <div class="receipt-info-row">
                        <span>Catatan:</span>
                        <span>${order.notes}</span>
                    </div>
                ` : ''}

                <div class="receipt-divider">--------------------------------</div>

                <div class="receipt-items">
                    ${order.items.map(item => `
                        <div class="receipt-item-row">
                            <div class="item-name-line">
                                <strong>${item.name}</strong> ${item.isPromo ? '(PROMO)' : ''}
                            </div>
                            <div class="item-calc-line">
                                <span>${item.qty} x ${formatRupiah(item.priceLocked)}</span>
                                <span><strong>${formatRupiah(item.qty * item.priceLocked)}</strong></span>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="receipt-divider">================================</div>

                <div class="receipt-calc-row">
                    <span>TOTAL:</span>
                    <span class="total-highlight">${formatRupiah(order.totalAmount)}</span>
                </div>
                <div class="receipt-calc-row">
                    <span>Metode Bayar:</span>
                    <span>${paymentLabel}</span>
                </div>
                <div class="receipt-calc-row">
                    <span>Bayar (Diterima):</span>
                    <span>${formatRupiah(order.cashReceived)}</span>
                </div>
                <div class="receipt-calc-row">
                    <span>Kembalian:</span>
                    <span><strong>${formatRupiah(order.changeAmount)}</strong></span>
                </div>

                <div class="receipt-divider">--------------------------------</div>

                <div class="receipt-footer">
                    <p style="white-space: pre-line;">${CONFIG.FOOTER_RECEIPT_NOTE}</p>
                    <small>Sistem Kasir DIASAP POS Cloud v2.0</small>
                </div>
            </div>
        `;

        modal.classList.add('active');
    }

    printReceipt() {
        window.print();
    }

    closeReceiptModal() {
        const modal = document.getElementById('receiptModal');
        if (modal) modal.classList.remove('active');
    }
}

const paymentManager = new PaymentManager();
