/**
 * DIASAP POS - Payment & Checkout Manager
 * Menangani kalkulasi pembayaran, uang pas, kembalian, QRIS/Transfer,
 * pencetakan struk termal, simpan struk sebagai gambar PNG / dokumen PDF,
 * dan fitur bagikan (share) struk ke perangkat / WhatsApp
 */

class PaymentManager {
    constructor() {
        this.paymentMethod = 'cash'; // 'cash', 'qris', 'transfer'
        this.cashAmount = 0;
        this.lastCompletedOrder = null;
        this.currentViewingOrder = null;
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
        const transferInfo = document.getElementById('transferInfoGroup');

        if (method === 'cash') {
            if (cashGroup) cashGroup.style.display = 'block';
            if (quickCash) quickCash.style.display = 'flex';
            if (qrisInfo) qrisInfo.style.display = 'none';
            if (transferInfo) transferInfo.style.display = 'none';
        } else if (method === 'qris') {
            if (cashGroup) cashGroup.style.display = 'none';
            if (quickCash) quickCash.style.display = 'none';
            if (transferInfo) transferInfo.style.display = 'none';
            if (qrisInfo) {
                qrisInfo.style.display = 'block';
                const grandTotal = cartManager.getGrandTotal();
                const qrisTotalEl = document.getElementById('qrisTotalDisplay');
                if (qrisTotalEl) qrisTotalEl.textContent = formatRupiah(grandTotal);
            }
        } else { // transfer
            if (cashGroup) cashGroup.style.display = 'none';
            if (quickCash) quickCash.style.display = 'none';
            if (qrisInfo) qrisInfo.style.display = 'none';
            if (transferInfo) transferInfo.style.display = 'block';
        }

        this.calculate();
    }

    setQuickCash(amount) {
        const total = cartManager.getGrandTotal();
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
        const grandTotal = cartManager.getGrandTotal();
        const grandTotalEl = document.getElementById('grandTotal');
        const checkoutBtn = document.getElementById('checkoutBtn');
        const changeDisplay = document.getElementById('changeDisplay');
        const cashInput = document.getElementById('cashInput');

        if (grandTotalEl) {
            grandTotalEl.textContent = formatRupiah(grandTotal);
        }

        const qrisTotalEl = document.getElementById('qrisTotalDisplay');
        if (qrisTotalEl) {
            qrisTotalEl.textContent = formatRupiah(grandTotal);
        }
        const qrisZoomTotalEl = document.getElementById('qrisZoomModalTotal');
        if (qrisZoomTotalEl) {
            qrisZoomTotalEl.textContent = formatRupiah(grandTotal);
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
            const change = this.cashAmount - grandTotal;

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
        const subtotal = cartManager.getSubtotal();
        const grandTotal = cartManager.getGrandTotal();
        const finalDiscountAmount = cartManager.getFinalDiscountAmount();
        const finalDiscountNote = cartManager.finalDiscount.note || '';

        if (grandTotal < 0 || cartManager.cart.length === 0) {
            alert('Keranjang belanja masih kosong!');
            return;
        }

        let cashReceived = this.cashAmount;
        let changeAmount = 0;

        if (this.paymentMethod === 'cash') {
            if (cashReceived > 0 && cashReceived < grandTotal) {
                sounds.playWarning();
                alert('Uang pembayaran tunai masih kurang!');
                return;
            }
            if (cashReceived === 0) {
                // Jika input tunai kosong, anggap uang pas
                cashReceived = grandTotal;
            }
            changeAmount = Math.max(0, cashReceived - grandTotal);
        } else {
            cashReceived = grandTotal;
            changeAmount = 0;
        }

        const customerName = (document.getElementById('customerNameInput')?.value || '').trim() || 'Pelanggan';
        const notes = (document.getElementById('orderNotesInput')?.value || '').trim();
        const invoiceNo = generateInvoiceNumber();
        const activeCashier = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';

        const orderData = {
            invoiceNo: invoiceNo,
            customerName: customerName,
            orderType: cartManager.orderType,
            paymentMethod: this.paymentMethod,
            subtotalAmount: subtotal,
            finalDiscountAmount: finalDiscountAmount,
            finalDiscountNote: finalDiscountNote,
            totalAmount: grandTotal,
            cashReceived: cashReceived,
            changeAmount: changeAmount,
            notes: notes,
            cashierName: activeCashier,
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
            this.showReceiptModal(savedOrder, false);

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

    showReceiptModal(order, isReprint = false) {
        this.currentViewingOrder = order;
        const modal = document.getElementById('receiptModal');
        const content = document.getElementById('receiptPrintArea');
        if (!modal || !content) return;

        const settings = (typeof settingsManager !== 'undefined' && settingsManager.settings)
            ? settingsManager.settings
            : CONFIG;

        const storeName = settings.storeName || CONFIG.STORE_NAME || 'DIASAP RESTO';
        const storeTagline = settings.storeTagline || 'Smoked Meat & Kitchen';
        const storeAddress = settings.storeAddress || CONFIG.STORE_ADDRESS || '';
        const storePhone = settings.storePhone || CONFIG.STORE_PHONE || '';
        const footerNote = settings.receiptFooter || CONFIG.FOOTER_RECEIPT_NOTE || 'Terima Kasih Atas Kunjungan Anda!';

        const orderTypeLabel = order.orderType === 'dine_in' ? 'Dine In (Makan di Tempat)' : 'Take Away (Bungkus)';
        const paymentLabel = (order.paymentMethod || 'cash').toUpperCase();
        const cashierName = order.cashierName || 'Kasir';

        const subtotal = Number(order.subtotalAmount) || Number(order.totalAmount);
        const finalDiscount = Number(order.finalDiscountAmount) || 0;
        const finalDiscountNote = order.finalDiscountNote ? ` (${order.finalDiscountNote})` : '';

        content.innerHTML = `
            <div class="receipt-paper" id="thermalReceiptPaper">
                ${isReprint ? `
                    <div class="reprint-watermark-banner">
                        ⚠️ STRUK SALINAN (CETAK ULANG)
                    </div>
                ` : ''}

                <div class="receipt-header">
                    <div class="receipt-logo">🔥 DIASAP 🔥</div>
                    <div class="receipt-store">${storeName}</div>
                    ${storeTagline ? `<div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 2px;">${storeTagline}</div>` : ''}
                    ${storeAddress ? `<div class="receipt-meta">${storeAddress}</div>` : ''}
                    ${storePhone ? `<div class="receipt-meta">Telp: ${storePhone}</div>` : ''}
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
                    <span>Kasir:</span>
                    <span><strong>${cashierName}</strong></span>
                </div>
                <div class="receipt-info-row">
                    <span>Pelanggan:</span>
                    <span>${order.customerName || 'Pelanggan'}</span>
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
                    ${(order.items || []).map(item => `
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

                ${finalDiscount > 0 ? `
                    <div class="receipt-info-row" style="font-size: 12px; margin-bottom: 3px;">
                        <span>Subtotal:</span>
                        <span>${formatRupiah(subtotal)}</span>
                    </div>
                    <div class="receipt-info-row" style="font-size: 12px; color: #C0392B; margin-bottom: 3px;">
                        <span>Diskon Tambahan${finalDiscountNote}:</span>
                        <span>-${formatRupiah(finalDiscount)}</span>
                    </div>
                ` : ''}

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
                    <p style="white-space: pre-line;">${footerNote}</p>
                    <small>Sistem Kasir DIASAP POS Cloud v2.0</small>
                </div>
            </div>
        `;

        modal.classList.add('active');
    }

    printReceipt() {
        window.print();
    }

    // Simpan struk sebagai gambar PNG
    async saveReceiptAsImage() {
        const receiptEl = document.getElementById('thermalReceiptPaper');
        if (!receiptEl) return;

        const order = this.currentViewingOrder;
        const filename = `Struk_DIASAP_${order?.invoiceNo || 'transaksi'}.png`;

        if (typeof html2canvas === 'undefined') {
            alert('Pustaka html2canvas sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        try {
            const canvas = await html2canvas(receiptEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true
            });

            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            if (typeof adminManager !== 'undefined' && adminManager.showToast) {
                adminManager.showToast('Gambar struk berhasil diunduh!');
            }
        } catch (err) {
            console.error('Gagal simpan gambar struk:', err);
            alert('Gagal menyimpan gambar struk: ' + err.message);
        }
    }

    // Simpan struk sebagai file PDF
    async saveReceiptAsPDF() {
        const receiptEl = document.getElementById('thermalReceiptPaper');
        if (!receiptEl) return;

        const order = this.currentViewingOrder;
        const filename = `Struk_DIASAP_${order?.invoiceNo || 'transaksi'}.pdf`;

        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
            alert('Fitur PDF sedang dimuat, silakan gunakan tombol Cetak (Print to PDF) sebagai alternatif.');
            window.print();
            return;
        }

        try {
            const canvas = await html2canvas(receiptEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true
            });

            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;

            // Ukuran kertas struk 80mm
            const imgWidth = 80;
            const pageHeight = (canvas.height * imgWidth) / canvas.width;

            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [imgWidth, Math.max(100, pageHeight + 10)]
            });

            pdf.addImage(imgData, 'PNG', 0, 5, imgWidth, pageHeight);
            pdf.save(filename);

            if (typeof adminManager !== 'undefined' && adminManager.showToast) {
                adminManager.showToast('File PDF struk berhasil diunduh!');
            }
        } catch (err) {
            console.error('Gagal generate PDF:', err);
            // Fallback: cetak biasa
            window.print();
        }
    }

    // Bagikan struk (Native Web Share Sheet untuk HP/WA)
    async shareReceipt() {
        const receiptEl = document.getElementById('thermalReceiptPaper');
        if (!receiptEl) return;

        const order = this.currentViewingOrder;
        const filename = `Struk_DIASAP_${order?.invoiceNo || 'transaksi'}.png`;

        if (typeof html2canvas === 'undefined') {
            alert('Pustaka renderer sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        try {
            const canvas = await html2canvas(receiptEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true
            });

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    this.saveReceiptAsImage();
                    return;
                }

                const file = new File([blob], filename, { type: 'image/png' });

                // Cek apakah browser mendukung Web Share API dengan file (misal di Chrome Android / Safari iOS)
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `Struk DIASAP - ${order?.invoiceNo || ''}`,
                            text: `Struk pembayaran ${order?.invoiceNo || ''} sebesar ${formatRupiah(order?.totalAmount || 0)}`,
                            files: [file]
                        });
                        return;
                    } catch (shareErr) {
                        if (shareErr.name === 'AbortError') return; // User cancel share
                    }
                }

                // Fallback: unduh gambar langsung dan beri notifikasi
                const link = document.createElement('a');
                link.download = filename;
                link.href = URL.createObjectURL(blob);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                alert('Gambar struk telah diunduh ke perangkat Anda. Anda dapat langsung mengirimkannya lewat WhatsApp atau aplikasi lainnya.');
            }, 'image/png');
        } catch (err) {
            console.error('Gagal share struk:', err);
            this.saveReceiptAsImage();
        }
    }

    closeReceiptModal() {
        const modal = document.getElementById('receiptModal');
        if (modal) modal.classList.remove('active');
        this.currentViewingOrder = null;
    }

    // ================= MODAL BILL / TAGIHAN SEMENTARA (LANGKAH 1 RESTORAN) =================

    showBillModal() {
        if (!cartManager || cartManager.cart.length === 0) {
            sounds.playWarning();
            alert('Keranjang pesanan masih kosong! Silakan pilih menu terlebih dahulu sebelum mencetak bill.');
            return;
        }

        const modal = document.getElementById('billModal');
        const content = document.getElementById('billPrintArea');
        if (!modal || !content) return;

        const settings = (typeof settingsManager !== 'undefined' && settingsManager.settings)
            ? settingsManager.settings
            : CONFIG;

        const storeName = settings.storeName || CONFIG.STORE_NAME || 'DIASAP RESTO';
        const storeTagline = settings.storeTagline || 'Smoked Meat & Kitchen';
        const storeAddress = settings.storeAddress || CONFIG.STORE_ADDRESS || '';
        const storePhone = settings.storePhone || CONFIG.STORE_PHONE || '';
        const activeCashier = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
        const customerName = (document.getElementById('customerNameInput')?.value || '').trim() || 'Pelanggan / Meja';
        const notes = (document.getElementById('orderNotesInput')?.value || '').trim();
        const orderTypeLabel = cartManager.orderType === 'dine_in' ? 'Dine In (Makan di Tempat)' : 'Take Away (Bungkus)';

        const subtotal = cartManager.getSubtotal();
        const finalDiscount = cartManager.getFinalDiscountAmount();
        const finalDiscountNote = cartManager.finalDiscount.note ? ` (${cartManager.finalDiscount.note})` : '';
        const grandTotal = cartManager.getGrandTotal();
        const billNo = 'BILL-' + Date.now().toString().slice(-6);

        // Data Pembayaran Toko: Bank & QRIS
        const rawBankName = (settings.bankName || CONFIG.DEFAULT_SETTINGS?.bankName || '').trim();
        const rawBankAccountNo = (settings.bankAccountNo || settings.bankAccount || CONFIG.DEFAULT_SETTINGS?.bankAccountNo || '').trim();
        const rawBankAccountHolder = (settings.bankAccountHolder || settings.bankHolder || CONFIG.DEFAULT_SETTINGS?.bankAccountHolder || '').trim();
        const hasValidBank = rawBankAccountNo !== '' && rawBankAccountNo !== '-' && rawBankName !== '' && rawBankName !== '-';
        const bankName = hasValidBank ? rawBankName : '';
        const bankAccountNo = hasValidBank ? rawBankAccountNo : '';
        const bankAccountHolder = hasValidBank ? rawBankAccountHolder : '';
        const qrisImage = (settings.qrisImage || '').trim();

        content.innerHTML = `
            <div class="receipt-paper bill-paper" id="thermalBillPaper">
                <div class="bill-watermark-banner">
                    TAGIHAN SEMENTARA - BELUM LUNAS
                </div>

                <div class="receipt-header">
                    <div class="receipt-store">${storeName.toUpperCase()}</div>
                    ${storeTagline ? `<div class="receipt-meta" style="font-weight: bold;">${storeTagline}</div>` : ''}
                    ${storeAddress ? `<div class="receipt-meta">${storeAddress}</div>` : ''}
                    ${storePhone ? `<div class="receipt-meta">Telp: ${storePhone}</div>` : ''}
                </div>

                <div class="receipt-divider">================================</div>

                <div class="receipt-info-row">
                    <span>No. Bill:</span>
                    <span><strong>${billNo}</strong></span>
                </div>
                <div class="receipt-info-row">
                    <span>Waktu:</span>
                    <span>${formatDateTime(new Date().toISOString())}</span>
                </div>
                <div class="receipt-info-row">
                    <span>Kasir:</span>
                    <span><strong>${activeCashier}</strong></span>
                </div>
                <div class="receipt-info-row">
                    <span>Meja / Pelanggan:</span>
                    <span><strong>${customerName}</strong></span>
                </div>
                <div class="receipt-info-row">
                    <span>Layanan:</span>
                    <span>${orderTypeLabel}</span>
                </div>
                ${notes ? `
                    <div class="receipt-info-row">
                        <span>Catatan:</span>
                        <span>${notes}</span>
                    </div>
                ` : ''}

                <div class="receipt-divider">--------------------------------</div>

                <div class="receipt-items">
                    ${cartManager.cart.map(item => `
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

                ${finalDiscount > 0 ? `
                    <div class="receipt-info-row" style="margin-bottom: 3px;">
                        <span>Subtotal:</span>
                        <span>${formatRupiah(subtotal)}</span>
                    </div>
                    <div class="receipt-info-row" style="margin-bottom: 3px;">
                        <span>Diskon Tambahan${finalDiscountNote}:</span>
                        <span>-${formatRupiah(finalDiscount)}</span>
                    </div>
                ` : ''}

                <div class="receipt-calc-row">
                    <span>TOTAL TAGIHAN:</span>
                    <span class="total-highlight">${formatRupiah(grandTotal)}</span>
                </div>
                <div class="receipt-calc-row">
                    <span>STATUS:</span>
                    <strong>BELUM DIBAYAR</strong>
                </div>

                <div class="receipt-divider">================================</div>

                <!-- Bagian Pembayaran QRIS & Transfer Bank (Format Label Printer) -->
                <div class="bill-payment-section">
                    <div class="bill-pay-title">SCAN QRIS UNTUK BAYAR</div>

                    <!-- Tampilan QRIS Ukuran Penuh (Maksimal, Tanpa Frame Tebal) -->
                    ${qrisImage ? `
                        <div class="bill-qris-fullwrap">
                            <img src="${qrisImage}" alt="QRIS ${storeName}" class="bill-qris-full-img" crossorigin="anonymous">
                        </div>
                    ` : `
                        <div class="bill-qris-placeholder-box">
                            <div class="qris-code-mock" style="width: 140px; height: 140px; margin: 0 auto;"></div>
                            <div style="font-weight: bold; margin-top: 4px;">SCAN QRIS PEMBAYARAN</div>
                            <div>(Unggah QRIS di Pengaturan Toko)</div>
                        </div>
                    `}

                    <!-- Tampilan Info Transfer Rekening Bank (Jika diisi) -->
                    ${hasValidBank ? `
                        <div class="bill-transfer-card">
                            <div class="bill-transfer-header">ATAU TRANSFER BANK:</div>
                            <div class="bill-transfer-bank">BANK ${bankName.toUpperCase()}</div>
                            <div class="bill-transfer-acc">${bankAccountNo}</div>
                            ${bankAccountHolder && bankAccountHolder !== '-' ? `<div class="bill-transfer-holder">a.n. ${bankAccountHolder}</div>` : ''}
                        </div>
                    ` : ''}

                    <div class="bill-confirm-note">
                        * Konfirmasi bukti transfer / pembayaran<br>
                        ke kasir / WA resto.
                    </div>
                </div>

                <div class="receipt-divider">--------------------------------</div>

                <div class="receipt-footer">
                    <p style="margin: 2px 0;">
                        * Mohon periksa kembali pesanan Anda.<br>
                        Pembayaran dapat dilakukan ke kasir / staf bertugas.
                    </p>
                    <div style="margin-top: 4px; font-weight: bold;">Sistem Kasir DIASAP POS</div>
                </div>
            </div>
        `;

        modal.classList.add('active');
    }

    closeBillModal() {
        const modal = document.getElementById('billModal');
        if (modal) modal.classList.remove('active');
    }

    printBill() {
        window.print();
    }

    proceedToPayment() {
        this.closeBillModal();
        const paymentTabs = document.querySelector('.payment-methods-tabs');
        if (paymentTabs) {
            paymentTabs.scrollIntoView({ behavior: 'smooth' });
        }
        const cashInput = document.getElementById('cashInput');
        if (cashInput && this.paymentMethod === 'cash') {
            setTimeout(() => cashInput.focus(), 200);
        }
    }

    async saveBillAsImage() {
        const billEl = document.getElementById('thermalBillPaper');
        if (!billEl) return;

        const filename = `Bill_DIASAP_${Date.now().toString().slice(-6)}.png`;

        if (typeof html2canvas === 'undefined') {
            alert('Pustaka renderer sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        try {
            const canvas = await html2canvas(billEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                allowTaint: true
            });

            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            if (typeof adminManager !== 'undefined' && adminManager.showToast) {
                adminManager.showToast('Gambar bill berhasil disimpan!');
            }
        } catch (err) {
            console.error('Gagal simpan gambar bill:', err);
            alert('Gagal menyimpan gambar bill: ' + err.message);
        }
    }

    async shareBill() {
        const billEl = document.getElementById('thermalBillPaper');
        if (!billEl) return;

        const filename = `Bill_DIASAP_${Date.now().toString().slice(-6)}.png`;

        if (typeof html2canvas === 'undefined') {
            alert('Pustaka renderer sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        try {
            const canvas = await html2canvas(billEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                allowTaint: true
            });

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    this.saveBillAsImage();
                    return;
                }

                const file = new File([blob], filename, { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            title: `Bill Tagihan DIASAP`,
                            text: `Lembar tagihan pesanan DIASAP sebesar ${formatRupiah(cartManager?.getGrandTotal() || 0)}`,
                            files: [file]
                        });
                        return;
                    } catch (shareErr) {
                        if (shareErr.name === 'AbortError') return;
                    }
                }

                const link = document.createElement('a');
                link.download = filename;
                link.href = URL.createObjectURL(blob);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                alert('Gambar bill telah diunduh ke perangkat Anda. Anda dapat langsung mengirimkannya lewat WhatsApp ke pelanggan.');
            }, 'image/png');
        } catch (err) {
            console.error('Gagal share bill:', err);
            this.saveBillAsImage();
        }
    }
}

const paymentManager = new PaymentManager();
