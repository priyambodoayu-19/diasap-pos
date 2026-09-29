/**
 * DIASAP POS - Payment & Checkout Manager
 * Menangani kalkulasi pembayaran, uang pas, kembalian, QRIS/Transfer,
 * pencetakan struk termal, simpan struk sebagai gambar PNG / dokumen PDF,
 * dan fitur bagikan (share) struk ke perangkat / WhatsApp
 */

// Helper konversi Data URL (Base64) ke File secara sinkron (menjaga transient user activation di iOS Safari)
function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

class PaymentManager {
    constructor() {
        this.paymentMethod = 'cash'; // 'cash', 'qris', 'transfer'
        this.cashAmount = 0;
        this.lastCompletedOrder = null;
        this.currentViewingOrder = null;
        this.currentViewingBillOrder = null;
        this.galleryPreviewData = null;
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
        const changeDisplay = document.getElementById('changeDisplay');
        const qrisInfo = document.getElementById('qrisInfoGroup');
        const transferInfo = document.getElementById('transferInfoGroup');

        if (method === 'cash') {
            if (cashGroup) {
                cashGroup.style.display = 'block';
                cashGroup.classList.remove('hidden-by-method');
            }
            if (quickCash) {
                quickCash.style.display = 'grid';
                quickCash.classList.remove('hidden-by-method');
            }
            if (changeDisplay) {
                changeDisplay.style.display = 'flex';
                changeDisplay.classList.remove('hidden-by-method');
            }
            if (qrisInfo) qrisInfo.style.display = 'none';
            if (transferInfo) transferInfo.style.display = 'none';
        } else if (method === 'qris') {
            if (cashGroup) {
                cashGroup.style.display = 'none';
                cashGroup.classList.add('hidden-by-method');
            }
            if (quickCash) {
                quickCash.style.display = 'none';
                quickCash.classList.add('hidden-by-method');
            }
            if (changeDisplay) {
                changeDisplay.style.display = 'none';
                changeDisplay.classList.add('hidden-by-method');
            }
            if (transferInfo) transferInfo.style.display = 'none';
            if (qrisInfo) {
                qrisInfo.style.display = 'block';
                const grandTotal = cartManager.getGrandTotal();
                const qrisTotalEl = document.getElementById('qrisTotalDisplay');
                if (qrisTotalEl) qrisTotalEl.textContent = formatRupiah(grandTotal);
            }
        } else { // transfer
            if (cashGroup) {
                cashGroup.style.display = 'none';
                cashGroup.classList.add('hidden-by-method');
            }
            if (quickCash) {
                quickCash.style.display = 'none';
                quickCash.classList.add('hidden-by-method');
            }
            if (changeDisplay) {
                changeDisplay.style.display = 'none';
                changeDisplay.classList.add('hidden-by-method');
            }
            if (qrisInfo) qrisInfo.style.display = 'none';
            if (transferInfo) {
                transferInfo.style.display = 'block';
                const settings = (typeof settingsManager !== 'undefined' && settingsManager.settings) ? settingsManager.settings : CONFIG;
                const bankEl = document.getElementById('cartTransferBankName');
                const accEl = document.getElementById('cartTransferAccNo');
                const holderEl = document.getElementById('cartTransferAccHolder');
                if (bankEl) bankEl.textContent = `BANK ${(settings.bankName || CONFIG.BANK_NAME || 'BCA').toUpperCase()}`;
                if (accEl) accEl.textContent = settings.bankAccountNo || CONFIG.BANK_ACCOUNT_NO || '-';
                if (holderEl) holderEl.textContent = settings.bankAccountHolder ? `a.n. ${settings.bankAccountHolder}` : '';
            }
        }

        this.calculate();

        // Otomatis scroll sedikit ke tombol selesai agar kasir tidak terpotong tampilannya
        setTimeout(() => {
            const checkoutBtn = document.getElementById('checkoutBtn');
            if (checkoutBtn) {
                checkoutBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
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
        const poDetails = cartManager.getPoDetails();
        const invoiceNo = cartManager.editingPendingInvoiceNo || generateInvoiceNumber();
        const activeCashier = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';
        const targetStatus = cartManager.orderType === 'dine_in' ? 'completed' : 'paid';

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
            status: targetStatus,
            pickupDate: poDetails.pickupDate,
            pickupTime: poDetails.pickupTime,
            pickupMethod: poDetails.pickupMethod,
            pickupAddress: poDetails.pickupAddress,
            deliveryFee: poDetails.deliveryFee || 0,
            pickedUpAt: (targetStatus === 'completed') ? new Date().toISOString() : null,
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
                await inventoryManager.deductOrderStock(items, savedOrder || orderData);
            }

            // Efek suara sukses kasir
            sounds.playSuccess();

            // Tampilkan Struk Pembayaran
            this.showReceiptModal(savedOrder, false);

            // Bersihkan Keranjang & Form
            cartManager.clearCart(true);
            if (document.getElementById('cashInput')) document.getElementById('cashInput').value = '';
            this.calculate();

            // Perbarui badge transaksi diproses di navbar
            if (typeof activeOrdersManager !== 'undefined') {
                await activeOrdersManager.refreshBadge();
            }
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

    // Simpan pesanan ke daftar pesanan diproses dan langsung tampilkan/cetak bill sementara
    async saveAndPrintBill() {
        if (!cartManager || cartManager.cart.length === 0) {
            sounds.playWarning();
            alert('Keranjang pesanan masih kosong! Silakan pilih menu terlebih dahulu sebelum simpan & cetak bill.');
            return;
        }

        const subtotal = cartManager.getSubtotal();
        const grandTotal = cartManager.getGrandTotal();
        const finalDiscountAmount = cartManager.getFinalDiscountAmount();
        const finalDiscountNote = cartManager.finalDiscount.note || '';

        const customerName = (document.getElementById('customerNameInput')?.value || '').trim() || 'Pelanggan / Meja';
        const notes = (document.getElementById('orderNotesInput')?.value || '').trim();
        const poDetails = cartManager.getPoDetails();
        const invoiceNo = cartManager.editingPendingInvoiceNo || generateInvoiceNumber();
        const activeCashier = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';

        const orderData = {
            invoiceNo: invoiceNo,
            customerName: customerName,
            orderType: cartManager.orderType,
            paymentMethod: this.paymentMethod || 'cash',
            subtotalAmount: subtotal,
            finalDiscountAmount: finalDiscountAmount,
            finalDiscountNote: finalDiscountNote,
            totalAmount: grandTotal,
            cashReceived: 0,
            changeAmount: 0,
            notes: notes,
            cashierName: activeCashier,
            status: 'unpaid',
            pickupDate: poDetails.pickupDate,
            pickupTime: poDetails.pickupTime,
            pickupMethod: poDetails.pickupMethod,
            pickupAddress: poDetails.pickupAddress,
            deliveryFee: poDetails.deliveryFee || 0,
            createdAt: new Date().toISOString()
        };

        const items = cartManager.cart.map(item => ({ ...item }));
        orderData.items = items;

        try {
            const savedOrder = await db.saveOrder(orderData, items);
            sounds.playSuccess();

            // Potong stok transit dari daging matang ready / barang jadi
            if (typeof inventoryManager !== 'undefined') {
                await inventoryManager.deductOrderStock(items, savedOrder || orderData);
            }

            // Tampilkan modal bill untuk dicetak kasir atau diberikan ke pelanggan
            this.showBillModal(orderData, items);

            // Bersihkan keranjang kasir karena pesanan sudah tercatat di antrean "Transaksi Diproses"
            cartManager.clearCart(true);

            if (typeof activeOrdersManager !== 'undefined') {
                await activeOrdersManager.refreshBadge();
            }
        } catch (err) {
            console.error('Gagal menyimpan tagihan sementara:', err);
            alert('Gagal menyimpan tagihan sementara: ' + err.message);
        }
    }

    // Simpan pesanan sebagai Tagihan Sementara (Unpaid / Open Bill)
    async savePendingOrder() {
        const subtotal = cartManager.getSubtotal();
        const grandTotal = cartManager.getGrandTotal();
        const finalDiscountAmount = cartManager.getFinalDiscountAmount();
        const finalDiscountNote = cartManager.finalDiscount.note || '';

        if (cartManager.cart.length === 0) {
            sounds.playWarning();
            alert('Keranjang pesanan masih kosong! Silakan pilih menu terlebih dahulu.');
            return;
        }

        const customerName = (document.getElementById('customerNameInput')?.value || '').trim() || 'Pelanggan / Meja';
        const notes = (document.getElementById('orderNotesInput')?.value || '').trim();
        const poDetails = cartManager.getPoDetails();
        const invoiceNo = cartManager.editingPendingInvoiceNo || generateInvoiceNumber();
        const activeCashier = (typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir';

        const orderData = {
            invoiceNo: invoiceNo,
            customerName: customerName,
            orderType: cartManager.orderType,
            paymentMethod: this.paymentMethod || 'cash',
            subtotalAmount: subtotal,
            finalDiscountAmount: finalDiscountAmount,
            finalDiscountNote: finalDiscountNote,
            totalAmount: grandTotal,
            cashReceived: 0,
            changeAmount: 0,
            notes: notes,
            cashierName: activeCashier,
            status: 'unpaid',
            pickupDate: poDetails.pickupDate,
            pickupTime: poDetails.pickupTime,
            pickupMethod: poDetails.pickupMethod,
            pickupAddress: poDetails.pickupAddress,
            deliveryFee: poDetails.deliveryFee || 0,
            createdAt: new Date().toISOString()
        };

        const items = cartManager.cart.map(item => ({ ...item }));

        try {
            const savedOrder = await db.saveOrder(orderData, items);
            sounds.playSuccess();

            // Potong stok transit dari daging matang ready / barang jadi
            if (typeof inventoryManager !== 'undefined') {
                await inventoryManager.deductOrderStock(items, savedOrder || orderData);
            }

            alert(`✅ Tagihan Sementara Tersimpan!\nNo. Tagihan: ${invoiceNo}\nPelanggan: ${customerName}\n\nAnda dapat melanjutkan pembayaran atau mengeditnya kapan saja melalui tombol 'Transaksi Diproses' di navbar atas.`);

            this.closeBillModal();
            cartManager.clearCart(true);

            if (typeof activeOrdersManager !== 'undefined') {
                await activeOrdersManager.refreshBadge();
            }
        } catch (err) {
            console.error('Gagal menyimpan tagihan sementara:', err);
            alert('Gagal menyimpan tagihan sementara: ' + err.message);
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
                ${order.orderType === 'take_away' ? `
                    <div class="receipt-info-row" style="color: #B45309; font-weight: 700;">
                        <span>Jadwal Ambil:</span>
                        <span>${order.pickupDate || '-'} ${order.pickupTime ? `(${order.pickupTime})` : ''}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span>Metode Ambil:</span>
                        <span>${order.pickupMethod === 'ojol' ? '🛵 Ojol / Kurir' : (order.pickupMethod === 'delivery' ? '🚚 Diantar Toko' : '🏪 Ambil di Toko')}</span>
                    </div>
                    ${order.pickupAddress ? `
                        <div class="receipt-info-row">
                            <span>Info/Alamat:</span>
                            <span>${order.pickupAddress}</span>
                        </div>
                    ` : ''}
                ` : ''}
                ${order.notes ? `
                    <div class="receipt-info-row">
                        <span>Catatan:</span>
                        <span>${order.notes}</span>
                    </div>
                ` : ''}

                <div class="receipt-items">
                    ${(order.items || []).map(item => {
                        const normalPrice = Number(item.priceNormal || item.normalPriceLocked || item.priceLocked) || item.priceLocked;
                        const hasPromoDiscount = item.isPromo && normalPrice > item.priceLocked;
                        const itemSavings = (normalPrice - item.priceLocked) * item.qty;
                        return `
                            <div class="receipt-item-row">
                                <div class="item-name-line">
                                    <strong>${item.name}</strong> ${item.isPromo ? '(PROMO)' : ''}
                                </div>
                                <div class="item-calc-line">
                                    <span>
                                        ${item.qty} x ${formatRupiah(item.priceLocked)}
                                        ${hasPromoDiscount ? ` <span style="text-decoration: line-through; color: #64748B; font-size: 11px;">${formatRupiah(normalPrice)}</span>` : ''}
                                    </span>
                                    <span><strong>${formatRupiah(item.qty * item.priceLocked)}</strong></span>
                                </div>
                                ${hasPromoDiscount ? `
                                    <div class="item-promo-savings-note">
                                        * Hemat Promo: -${formatRupiah(itemSavings)} (Diskon ${formatRupiah(normalPrice - item.priceLocked)}/item)
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="receipt-divider">================================</div>

                ${(() => {
                    const orderPromoSavings = (order.items || []).reduce((sum, item) => {
                        const normal = Number(item.priceNormal || item.normalPriceLocked || item.priceLocked) || item.priceLocked;
                        return sum + (item.isPromo && normal > item.priceLocked ? (normal - item.priceLocked) * item.qty : 0);
                    }, 0);
                    return orderPromoSavings > 0 ? `
                        <div class="receipt-info-row" style="font-size: 12px; color: #166534; font-weight: bold; margin-bottom: 3px;">
                            <span>Total Hemat Promo:</span>
                            <span>-${formatRupiah(orderPromoSavings)}</span>
                        </div>
                    ` : '';
                })()}

                ${(finalDiscount > 0 || (order.deliveryFee > 0)) ? `
                    <div class="receipt-info-row" style="font-size: 12px; margin-bottom: 3px;">
                        <span>Subtotal Pesanan:</span>
                        <span>${formatRupiah(subtotal)}</span>
                    </div>
                ` : ''}
                ${finalDiscount > 0 ? `
                    <div class="receipt-info-row" style="font-size: 12px; color: #C0392B; margin-bottom: 3px;">
                        <span>Diskon Tambahan${finalDiscountNote}:</span>
                        <span>-${formatRupiah(finalDiscount)}</span>
                    </div>
                ` : ''}
                ${(order.deliveryFee > 0) ? `
                    <div class="receipt-info-row" style="font-size: 12px; color: #0284C7; font-weight: bold; margin-bottom: 3px;">
                        <span>🛵 Biaya Kurir / Ongkir:</span>
                        <span>+${formatRupiah(order.deliveryFee)}</span>
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

    // Simpan / Bagikan struk sebagai Foto (Langsung Masuk Galeri Foto HP atau Native Share Sheet)
    async shareOrSaveReceiptPhoto() {
        const receiptEl = document.getElementById('thermalReceiptPaper');
        if (!receiptEl) return;

        const order = this.currentViewingOrder;
        const filename = `Struk_DIASAP_${order?.invoiceNo || 'transaksi'}.png`;

        if (typeof html2canvas === 'undefined') {
            alert('Pustaka gambar sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        try {
            const canvas = await html2canvas(receiptEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true
            });

            const dataUrl = canvas.toDataURL('image/png');
            const file = dataURLtoFile(dataUrl, filename);

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        title: `Struk DIASAP - ${order?.invoiceNo || ''}`,
                        text: `Struk pembayaran ${order?.invoiceNo || ''} (${formatRupiah(order?.totalAmount || 0)})`,
                        files: [file]
                    });
                    return;
                } catch (shareErr) {
                    if (shareErr.name === 'AbortError') return;
                    console.warn('Native share error, fallback to direct download:', shareErr);
                }
            }

            const link = document.createElement('a');
            link.download = filename;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            if (typeof adminManager !== 'undefined' && adminManager.showToast) {
                adminManager.showToast('Foto struk berhasil disimpan!');
            }
        } catch (err) {
            console.error('Gagal simpan/bagikan struk:', err);
            alert('Gagal memproses foto struk: ' + err.message);
        }
    }

    // Alias untuk kompatibilitas tombol lama
    async saveReceiptAsImage() {
        return this.shareOrSaveReceiptPhoto();
    }

    async shareReceipt() {
        return this.shareOrSaveReceiptPhoto();
    }

    // Simpan struk sebagai file PDF (pilihan alternatif)
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
            window.print();
        }
    }

    generateReceiptTextSummary(order) {
        try {
            if (!order) order = this.currentViewingOrder;
            if (!order) return 'Struk Pembayaran DIASAP';
            let text = `*STRUK PEMBAYARAN DIASAP*\n`;
            text += `No. Faktur: ${order.invoiceNo || '-'}\n`;
            text += `Pelanggan: ${order.customerName || 'Pelanggan'}\n`;
            text += `Tanggal: ${order.date ? new Date(order.date).toLocaleString('id-ID') : new Date().toLocaleString('id-ID')}\n`;
            text += `--------------------------------\n`;
            (order.items || []).forEach(item => {
                text += `${item.name} x${item.quantity} = ${formatRupiah((item.price || 0) * item.quantity)}\n`;
            });
            text += `--------------------------------\n`;
            if (order.discount > 0) text += `Diskon: -${formatRupiah(order.discount)}\n`;
            if (order.shippingCost > 0) text += `Ongkir: ${formatRupiah(order.shippingCost)}\n`;
            text += `*TOTAL: ${formatRupiah(order.totalAmount || 0)}*\n`;
            text += `Metode: ${order.paymentMethod || 'Tunai'}\n`;
            text += `Status: ${order.paymentStatus === 'paid' ? 'LUNAS' : 'BELUM LUNAS'}\n\n`;
            text += `Terima kasih telah berbelanja di DIASAP! 🙏`;
            return text;
        } catch (e) {
            return `Struk DIASAP - Total: ${formatRupiah(order?.totalAmount || 0)}`;
        }
    }

    closeReceiptModal() {
        const modal = document.getElementById('receiptModal');
        if (modal) modal.classList.remove('active');
        this.currentViewingOrder = null;
    }

    // ================= MODAL BILL / TAGIHAN SEMENTARA (LANGKAH 1 RESTORAN) =================

    showBillModal(order = null, items = null) {
        const orderItems = items || (order && order.items) || (cartManager ? cartManager.cart : []);
        if (!order && (!cartManager || cartManager.cart.length === 0)) {
            sounds.playWarning();
            alert('Keranjang pesanan masih kosong! Silakan pilih menu terlebih dahulu sebelum mencetak bill.');
            return;
        }

        const modal = document.getElementById('billModal');
        const content = document.getElementById('billPrintArea');
        if (!modal || !content) return;

        this.currentViewingBillOrder = order;

        const settings = (typeof settingsManager !== 'undefined' && settingsManager.settings)
            ? settingsManager.settings
            : CONFIG;

        const storeName = settings.storeName || CONFIG.STORE_NAME || 'DIASAP RESTO';
        const storeTagline = settings.storeTagline || 'Smoked Meat & Kitchen';
        const storeAddress = settings.storeAddress || CONFIG.STORE_ADDRESS || '';
        const storePhone = settings.storePhone || CONFIG.STORE_PHONE || '';
        const activeCashier = order?.cashierName || ((typeof authManager !== 'undefined') ? authManager.getActiveCashier() : 'Kasir');
        const customerName = order?.customerName || ((document.getElementById('customerNameInput')?.value || '').trim() || 'Pelanggan / Meja');
        const notes = order?.notes || ((document.getElementById('orderNotesInput')?.value || '').trim());
        const orderType = order?.orderType || (cartManager ? cartManager.orderType : 'dine_in');
        const orderTypeLabel = orderType === 'dine_in' ? 'Dine In (Makan di Tempat)' : 'Take Away (Bungkus)';

        const subtotal = order ? Number(order.subtotalAmount || 0) : cartManager.getSubtotal();
        const finalDiscount = order ? Number(order.finalDiscountAmount || 0) : cartManager.getFinalDiscountAmount();
        const finalDiscountNote = (order?.finalDiscountNote || cartManager?.finalDiscount?.note) ? ` (${order?.finalDiscountNote || cartManager.finalDiscount.note})` : '';
        const grandTotal = order ? Number(order.totalAmount || 0) : cartManager.getGrandTotal();
        const poDetails = order ? {
            pickupDate: order.pickupDate,
            pickupTime: order.pickupTime,
            pickupMethod: order.pickupMethod,
            pickupAddress: order.pickupAddress,
            deliveryFee: Number(order.deliveryFee) || 0
        } : cartManager.getPoDetails();
        const deliveryFee = poDetails.deliveryFee || 0;
        const billNo = order?.invoiceNo || cartManager.editingPendingInvoiceNo || ('BILL-' + Date.now().toString().slice(-6));
        const orderDate = order?.createdAt || new Date().toISOString();

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
                    <span>${formatDateTime(orderDate)}</span>
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
                ${orderType === 'take_away' ? `
                    <div class="receipt-info-row" style="color: #B45309; font-weight: 700;">
                        <span>Jadwal Ambil:</span>
                        <span>${poDetails.pickupDate || '-'} ${poDetails.pickupTime ? `(${poDetails.pickupTime})` : ''}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span>Metode Ambil:</span>
                        <span>${poDetails.pickupMethod === 'ojol' ? '🛵 Ojol / Kurir' : (poDetails.pickupMethod === 'delivery' ? '🚚 Diantar Toko' : '🏪 Ambil di Toko')}</span>
                    </div>
                    ${poDetails.pickupAddress ? `
                        <div class="receipt-info-row">
                            <span>Info/Alamat:</span>
                            <span>${poDetails.pickupAddress}</span>
                        </div>
                    ` : ''}
                ` : ''}
                ${notes ? `
                    <div class="receipt-info-row">
                        <span>Catatan:</span>
                        <span>${notes}</span>
                    </div>
                ` : ''}

                <div class="receipt-divider">--------------------------------</div>

                <div class="receipt-items">
                    ${orderItems.map(item => {
                        const normalPrice = Number(item.normalPriceLocked || item.priceNormal || item.priceLocked) || item.priceLocked;
                        const hasPromoDiscount = item.isPromo && normalPrice > item.priceLocked;
                        const itemSavings = (normalPrice - item.priceLocked) * item.qty;
                        return `
                            <div class="receipt-item-row">
                                <div class="item-name-line">
                                    <strong>${item.name}</strong> ${item.isPromo ? '(PROMO)' : ''}
                                </div>
                                <div class="item-calc-line">
                                    <span>
                                        ${item.qty} x ${formatRupiah(item.priceLocked)}
                                        ${hasPromoDiscount ? ` <span style="text-decoration: line-through; color: #64748B; font-size: 11px;">${formatRupiah(normalPrice)}</span>` : ''}
                                    </span>
                                    <span><strong>${formatRupiah(item.qty * item.priceLocked)}</strong></span>
                                </div>
                                ${hasPromoDiscount ? `
                                    <div class="item-promo-savings-note">
                                        * Hemat Promo: -${formatRupiah(itemSavings)} (Diskon ${formatRupiah(normalPrice - item.priceLocked)}/item)
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="receipt-divider">================================</div>

                ${(() => {
                    const totalPromoSavings = orderItems.reduce((sum, item) => {
                        const normal = Number(item.normalPriceLocked || item.priceNormal || item.priceLocked) || item.priceLocked;
                        return sum + (item.isPromo && normal > item.priceLocked ? (normal - item.priceLocked) * item.qty : 0);
                    }, 0);
                    return totalPromoSavings > 0 ? `
                        <div class="receipt-info-row" style="font-size: 12px; color: #166534; font-weight: bold; margin-bottom: 3px;">
                            <span>Total Hemat Promo:</span>
                            <span>-${formatRupiah(totalPromoSavings)}</span>
                        </div>
                    ` : '';
                })()}

                ${(finalDiscount > 0 || (deliveryFee > 0)) ? `
                    <div class="receipt-info-row" style="margin-bottom: 3px;">
                        <span>Subtotal Pesanan:</span>
                        <span>${formatRupiah(subtotal)}</span>
                    </div>
                ` : ''}
                ${finalDiscount > 0 ? `
                    <div class="receipt-info-row" style="margin-bottom: 3px;">
                        <span>Diskon Tambahan${finalDiscountNote}:</span>
                        <span>-${formatRupiah(finalDiscount)}</span>
                    </div>
                ` : ''}
                ${(deliveryFee > 0) ? `
                    <div class="receipt-info-row" style="margin-bottom: 3px; color: #0284C7; font-weight: bold;">
                        <span>🛵 Biaya Kurir / Ongkir:</span>
                        <span>+${formatRupiah(deliveryFee)}</span>
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
        this.currentViewingBillOrder = null;
    }

    printBill() {
        window.print();
    }

    proceedToPayment() {
        if (this.currentViewingBillOrder) {
            cartManager.loadOrderToCart(this.currentViewingBillOrder);
        }
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

    // Simpan / Bagikan lembar tagihan sebagai Foto (Langsung Masuk Galeri Foto HP atau Native Share Sheet)
    async shareOrSaveBillPhoto() {
        const billEl = document.getElementById('thermalBillPaper');
        if (!billEl) return;

        const filename = `Bill_DIASAP_${Date.now().toString().slice(-6)}.png`;

        if (typeof html2canvas === 'undefined') {
            alert('Pustaka gambar sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        try {
            const canvas = await html2canvas(billEl, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                allowTaint: true
            });

            const dataUrl = canvas.toDataURL('image/png');
            const file = dataURLtoFile(dataUrl, filename);

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        title: `Lembar Tagihan DIASAP`,
                        text: `Lembar tagihan pesanan DIASAP sebesar ${formatRupiah(cartManager?.getGrandTotal() || 0)}`,
                        files: [file]
                    });
                    return;
                } catch (shareErr) {
                    if (shareErr.name === 'AbortError') return;
                    console.warn('Share file gagal:', shareErr);
                }
            }

            // Fallback (Desktop atau jika share sheet tidak ada): Langsung unduh gambar PNG
            const link = document.createElement('a');
            link.download = filename;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            if (typeof adminManager !== 'undefined' && adminManager.showToast) {
                adminManager.showToast('Foto tagihan berhasil disimpan!');
            }
        } catch (err) {
            console.error('Gagal simpan/bagikan bill:', err);
            alert('Gagal memproses foto tagihan: ' + err.message);
        }
    }

    // Alias untuk kompatibilitas tombol lama
    async saveBillAsImage() {
        return this.shareOrSaveBillPhoto();
    }

    async shareBill() {
        return this.shareOrSaveBillPhoto();
    }

    generateBillTextSummary() {
        try {
            const items = (typeof cartManager !== 'undefined' && cartManager.items) ? cartManager.items : [];
            const subtotal = (typeof cartManager !== 'undefined' && cartManager.getSubtotal) ? cartManager.getSubtotal() : 0;
            const discount = (typeof cartManager !== 'undefined' && cartManager.discount) ? cartManager.discount : 0;
            const shipping = (typeof cartManager !== 'undefined' && cartManager.shippingCost) ? cartManager.shippingCost : 0;
            const grandTotal = (typeof cartManager !== 'undefined' && cartManager.getGrandTotal) ? cartManager.getGrandTotal() : 0;
            const orderType = document.getElementById('orderTypeSelect')?.value || 'dine-in';
            const customerName = document.getElementById('poCustomerName')?.value || document.getElementById('customerNameInput')?.value || 'Pelanggan';

            let typeLabel = 'Makan di Tempat';
            if (orderType === 'takeaway') typeLabel = 'Bungkus (Takeaway)';
            if (orderType === 'po') typeLabel = 'Pre-Order (PO)';

            let text = `*LEMBAR TAGIHAN DIASAP*\n`;
            text += `Pelanggan: ${customerName}\n`;
            text += `Tipe: ${typeLabel}\n`;
            text += `Tanggal: ${new Date().toLocaleString('id-ID')}\n`;
            text += `--------------------------------\n`;
            items.forEach(item => {
                const itemTotal = (item.price || 0) * (item.quantity || 1);
                text += `${item.name} x${item.quantity} = ${formatRupiah(itemTotal)}\n`;
            });
            text += `--------------------------------\n`;
            if (discount > 0) text += `Diskon: -${formatRupiah(discount)}\n`;
            if (shipping > 0) text += `Ongkir: ${formatRupiah(shipping)}\n`;
            text += `*TOTAL: ${formatRupiah(grandTotal)}*\n\n`;
            text += `Terima kasih atas pesanan Anda di DIASAP! 🙏`;
            return text;
        } catch (e) {
            return `Lembar Tagihan DIASAP - Total: ${formatRupiah(cartManager?.getGrandTotal() || 0)}`;
        }
    }
}

const paymentManager = new PaymentManager();
