/**
 * DIASAP POS - Main Application Controller
 * Menghubungkan seluruh modul, event listener, riwayat transaksi, rekap penjualan, dan shortcut
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Inisialisasi Proteksi Akses Kasir (Lock Screen)
    if (typeof authManager !== 'undefined') {
        authManager.init();
    }

    // Inisialisasi Admin Panel Manager
    if (typeof adminManager !== 'undefined') {
        adminManager.init();
    }

    // Inisialisasi Inventory Manager (Stok Bahan Baku Master & Barang Jadi)
    if (typeof inventoryManager !== 'undefined') {
        await inventoryManager.init();
    }

    // Inisialisasi Pengaturan Toko & Kasir
    if (typeof settingsManager !== 'undefined') {
        await settingsManager.init();
    }

    // 1. Setup Status Koneksi Database
    const dbStatusBadge = document.getElementById('dbStatusBadge');
    const dbStatusText = document.getElementById('dbStatusText');

    db.onStatusChange((isOnline, msg) => {
        if (dbStatusBadge && dbStatusText) {
            if (isOnline) {
                dbStatusBadge.className = 'status-indicator status-online';
                dbStatusText.textContent = 'Neon DB Online';
                dbStatusBadge.title = msg;
            } else {
                dbStatusBadge.className = 'status-indicator status-offline';
                dbStatusText.textContent = 'Mode Lokal';
                dbStatusBadge.title = msg;
            }
        }
    });

    // Cek koneksi awal & sinkronkan database
    await db.checkConnection();

    // Inisialisasi Transaksi Aktif / Diproses (Badge & Antrean)
    if (typeof activeOrdersManager !== 'undefined') {
        await activeOrdersManager.init();
    }

    // 2. Muat Produk
    await productManager.loadProducts();

    // 3. Inisialisasi & Render Keranjang Awal
    if (typeof cartManager !== 'undefined') {
        cartManager.init();
        cartManager.render();
    }
    paymentManager.calculate();

    // 4. Event Listener Mode Promo Switch
    const promoToggle = document.getElementById('promoToggle');
    const priceModeLabel = document.getElementById('priceModeLabel');
    const menuContainer = document.getElementById('menuContainer');

    if (promoToggle) {
        promoToggle.addEventListener('change', function() {
            const isPromo = this.checked;
            productManager.setPromoMode(isPromo);

            if (isPromo) {
                priceModeLabel.textContent = 'PROMO AKTIF!';
                priceModeLabel.classList.add('promo-active-text');
                menuContainer.classList.add('promo-mode');
            } else {
                priceModeLabel.textContent = 'Normal';
                priceModeLabel.classList.remove('promo-active-text');
                menuContainer.classList.remove('promo-mode');
            }
            sounds.playBeep();
        });
    }

    // 5. Filter Kategori
    document.querySelectorAll('.cat-pill').forEach(pill => {
        pill.addEventListener('click', function() {
            document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            productManager.setCategory(this.dataset.category);
            sounds.playBeep();
        });
    });

    // 6. Pencarian Produk
    const searchInput = document.getElementById('searchMenuInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            productManager.setSearch(e.target.value);
        });
    }

    // 7. Input Pembayaran Tunai
    const cashInput = document.getElementById('cashInput');
    if (cashInput) {
        cashInput.addEventListener('input', () => {
            paymentManager.calculate();
        });

        cashInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                paymentManager.processCheckout();
            }
        });
    }

    // 8. Tombol Nominal Cepat
    document.querySelectorAll('.btn-quick-cash').forEach(btn => {
        btn.addEventListener('click', function() {
            const val = this.dataset.val;
            paymentManager.setQuickCash(val === 'exact' ? 'exact' : Number(val));
            sounds.playBeep();
        });
    });

    // 9. Metode Pembayaran
    document.querySelectorAll('.pay-method-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            paymentManager.setPaymentMethod(this.dataset.method);
            sounds.playBeep();
        });
    });

    // 10. Tipe Pesanan (Dine-in / Take-away)
    document.querySelectorAll('.order-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            cartManager.setOrderType(this.dataset.type);
            sounds.playBeep();
        });
    });

    // 11. Keyboard Shortcuts Kasir
    window.addEventListener('keydown', (e) => {
        // F2: Toggle Mode Promo
        if (e.key === 'F2') {
            e.preventDefault();
            if (promoToggle) {
                promoToggle.checked = !promoToggle.checked;
                promoToggle.dispatchEvent(new Event('change'));
            }
        }
        // F4: Kosongkan Keranjang
        if (e.key === 'F4') {
            e.preventDefault();
            cartManager.clearCart();
        }
        // F7: Buka Transaksi Diproses / Pending
        if (e.key === 'F7') {
            e.preventDefault();
            if (typeof activeOrdersManager !== 'undefined') {
                activeOrdersManager.openModal();
            }
        }
        // F8: Buka Rekap Riwayat
        if (e.key === 'F8') {
            e.preventDefault();
            openHistoryModal();
        }
    });

    // 12. Setup Input Diskon Final (Tambahan)
    const discModeBtns = document.querySelectorAll('.btn-disc-mode');
    const discValInput = document.getElementById('finalDiscountValue');
    const discNoteInput = document.getElementById('finalDiscountNote');
    let currentDiscMode = 'nominal';

    discModeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            discModeBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentDiscMode = this.dataset.mode;
            if (discValInput) {
                discValInput.placeholder = currentDiscMode === 'percent' ? 'Diskon (%) misal: 10' : 'Diskon (Rp) misal: 5000';
            }
            if (discValInput && discValInput.value) {
                cartManager.setFinalDiscount(currentDiscMode, discValInput.value, discNoteInput ? discNoteInput.value : '');
            }
        });
    });

    if (discValInput) {
        discValInput.addEventListener('input', (e) => {
            cartManager.setFinalDiscount(currentDiscMode, e.target.value, discNoteInput ? discNoteInput.value : '');
        });
    }

    if (discNoteInput) {
        discNoteInput.addEventListener('input', (e) => {
            cartManager.setFinalDiscount(currentDiscMode, discValInput ? discValInput.value : 0, e.target.value);
        });
    }
});

// ================= MODAL RIWAYAT & REKAP TRANSAKSI =================

let currentHistoryFilter = 'all'; // 'today' | 'week' | 'month' | 'all' | 'custom'

async function openHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (!modal) return;

    modal.classList.add('active');
    await renderHistoryData();
}

function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.classList.remove('active');
}

function setHistoryFilter(filterType) {
    currentHistoryFilter = filterType;

    document.querySelectorAll('.history-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterType);
    });

    const customDateWrap = document.getElementById('historyCustomDateRange');
    if (customDateWrap) {
        customDateWrap.style.display = (filterType === 'custom') ? 'flex' : 'none';
    }

    renderHistoryData();
}

async function renderHistoryData() {
    const tableBody = document.getElementById('historyTableBody');
    const totalRevenueEl = document.getElementById('rekapTotalRevenue');
    const deliveryFeeTotalEl = document.getElementById('rekapDeliveryFeeTotal');
    const foodRevenueEl = document.getElementById('rekapFoodRevenue');
    const totalCogsEl = document.getElementById('rekapTotalCogs');
    const profitNominalEl = document.getElementById('rekapProfitNominal');
    const profitMarginEl = document.getElementById('rekapProfitMargin');
    const totalOrdersEl = document.getElementById('rekapTotalOrders');
    const avgOrderEl = document.getElementById('rekapAvgOrder');
    const cashTotalEl = document.getElementById('rekapCashTotal');
    const qrisTotalEl = document.getElementById('rekapQrisTotal');
    const transferTotalEl = document.getElementById('rekapTransferTotal');

    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 20px;">Memuat data riwayat...</td></tr>`;
    }

    const allOrders = await db.getOrdersHistory(500);

    // Filter berdasarkan Periode yang dipilih
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfToday - (6 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const orders = allOrders.filter(o => {
        const orderTime = new Date(o.createdAt).getTime();
        if (currentHistoryFilter === 'today') {
            return orderTime >= startOfToday;
        } else if (currentHistoryFilter === 'week') {
            return orderTime >= startOfWeek;
        } else if (currentHistoryFilter === 'month') {
            return orderTime >= startOfMonth;
        } else if (currentHistoryFilter === 'custom') {
            const startVal = document.getElementById('historyStartDate')?.value;
            const endVal = document.getElementById('historyEndDate')?.value;
            if (startVal) {
                const startMs = new Date(startVal + 'T00:00:00').getTime();
                if (orderTime < startMs) return false;
            }
            if (endVal) {
                const endMs = new Date(endVal + 'T23:59:59').getTime();
                if (orderTime > endMs) return false;
            }
            return true;
        }
        return true; // 'all'
    });

    let totalRevenue = 0;
    let totalCogs = 0;
    let cashRevenue = 0;
    let qrisRevenue = 0;
    let transferRevenue = 0;

    // Helper kalkulasi COGS
    const calculateOrderCogs = (order) => {
        let orderCogs = 0;
        if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
                let itemCogs = Number(item.cogsLocked) || 0;
                if (itemCogs === 0 && item.id) {
                    const p = productManager.getProductById(item.id);
                    if (p) itemCogs = Number(p.cogs) || 0;
                }
                orderCogs += itemCogs * (Number(item.qty) || 1);
            });
        }
        return orderCogs;
    };

    let activeOrdersCount = 0;
    let voidOrdersCount = 0;
    let totalDeliveryFee = 0;
    let totalFoodRevenue = 0;

    orders.forEach(o => {
        if (o.isVoid) {
            voidOrdersCount++;
            return; // Transaksi void tidak dihitung ke omset
        }
        if (o.status === 'unpaid') {
            return; // Tagihan sementara belum lunas tidak dihitung ke omset
        }
        activeOrdersCount++;
        const val = Number(o.totalAmount) || 0;
        const dFee = Number(o.deliveryFee) || 0;
        const foodVal = Math.max(0, val - dFee);

        totalRevenue += val;
        totalDeliveryFee += dFee;
        totalFoodRevenue += foodVal;
        totalCogs += calculateOrderCogs(o);
        if (o.paymentMethod === 'cash') cashRevenue += val;
        else if (o.paymentMethod === 'qris') qrisRevenue += val;
        else if (o.paymentMethod === 'transfer') transferRevenue += val;
    });

    // Keuntungan bersih resto HANYA dari omzet produk makanan/minuman dikurangi HPP (ongkir kurir dipisahkan 100%)
    const totalProfit = totalFoodRevenue - totalCogs;
    const overallMargin = totalFoodRevenue > 0 ? Math.round((totalProfit / totalFoodRevenue) * 100) : 0;
    const avgOrder = activeOrdersCount > 0 ? Math.round(totalRevenue / activeOrdersCount) : 0;

    if (totalRevenueEl) totalRevenueEl.textContent = formatRupiah(totalRevenue);
    if (deliveryFeeTotalEl) deliveryFeeTotalEl.textContent = formatRupiah(totalDeliveryFee);
    if (foodRevenueEl) foodRevenueEl.textContent = formatRupiah(totalFoodRevenue);
    if (totalCogsEl) totalCogsEl.textContent = formatRupiah(totalCogs);
    if (profitNominalEl) profitNominalEl.textContent = formatRupiah(totalProfit);
    if (profitMarginEl) {
        profitMarginEl.textContent = `${overallMargin}% Margin`;
        profitMarginEl.className = `margin-pill ${overallMargin >= 30 ? 'positive' : (overallMargin >= 0 ? 'warning' : 'danger')}`;
    }

    if (totalOrdersEl) {
        if (voidOrdersCount > 0) {
            totalOrdersEl.innerHTML = `
                <div style="line-height: 1.2;">${activeOrdersCount} Sukses</div>
                <div style="font-size: 11px; font-weight: 700; color: #DC2626; margin-top: 3px; line-height: 1;">(${voidOrdersCount} Void)</div>
            `;
        } else {
            totalOrdersEl.textContent = `${activeOrdersCount} Sukses`;
        }
    }
    if (avgOrderEl) avgOrderEl.textContent = formatRupiah(avgOrder);
    if (cashTotalEl) cashTotalEl.textContent = formatRupiah(cashRevenue);
    if (qrisTotalEl) qrisTotalEl.textContent = formatRupiah(qrisRevenue);
    if (transferTotalEl) transferTotalEl.textContent = formatRupiah(transferRevenue);

    // Render Grafik Sederhana Penjualan (Hanya transaksi lunas/selesai)
    renderHistoryChart(orders);

    // Simpan data periode saat ini agar dapat difilter secara reaktif
    window.rawPeriodOrders = orders;

    // Terapkan filter tabel (status pesanan, metode bayar, exclude void, pencarian)
    applyHistoryTableFilters();
}

// Filter tabel riwayat transaksi secara dinamis
function applyHistoryTableFilters() {
    const allOrders = window.rawPeriodOrders || [];
    const searchVal = (document.getElementById('historySearchInput')?.value || '').toLowerCase().trim();
    const statusVal = document.getElementById('filterHistoryStatus')?.value || 'all';
    const payVal = document.getElementById('filterHistoryPayment')?.value || 'all';
    const excludeVoid = document.getElementById('filterExcludeVoid')?.checked ?? true;

    const filtered = allOrders.filter(o => {
        const isVoid = Boolean(o.isVoid);
        const isUnpaid = o.status === 'unpaid';
        const isPendingPo = o.orderType === 'take_away' && !isVoid && !isUnpaid && (!o.pickedUpAt || o.status === 'paid');
        const isSent = !isVoid && !isUnpaid && !isPendingPo && o.orderType === 'take_away' && (o.pickupMethod === 'ojol' || o.pickupMethod === 'delivery');
        const isPicked = !isVoid && !isUnpaid && !isPendingPo && o.orderType === 'take_away' && (o.pickupMethod !== 'ojol' && o.pickupMethod !== 'delivery');
        const isCompleted = !isVoid && !isUnpaid && !isPendingPo;

        // Exclude void
        if (excludeVoid && isVoid && statusVal !== 'void') {
            return false;
        }

        // Status filter
        if (statusVal === 'completed' && !isCompleted) return false;
        if (statusVal === 'sent' && !isSent) return false;
        if (statusVal === 'picked' && !isPicked) return false;
        if (statusVal === 'pending_po' && !isPendingPo) return false;
        if (statusVal === 'unpaid' && !isUnpaid) return false;
        if (statusVal === 'void' && !isVoid) return false;

        // Payment method filter
        if (payVal !== 'all') {
            if (payVal === 'unpaid') {
                if (!isUnpaid) return false;
            } else {
                if (isUnpaid || (o.paymentMethod || 'cash').toLowerCase() !== payVal) {
                    return false;
                }
            }
        }

        // Search text filter
        if (searchVal) {
            const inv = (o.invoiceNo || '').toLowerCase();
            const cust = (o.customerName || '').toLowerCase();
            const notes = (o.notes || '').toLowerCase();
            const itemsStr = (o.items || []).map(i => i.name || '').join(' ').toLowerCase();
            if (!inv.includes(searchVal) && !cust.includes(searchVal) && !notes.includes(searchVal) && !itemsStr.includes(searchVal)) {
                return false;
            }
        }

        return true;
    });

    window.currentlyRenderedOrders = filtered;

    const countBadge = document.getElementById('historyFilterCountBadge');
    if (countBadge) {
        if (filtered.length === allOrders.length) {
            countBadge.textContent = `${filtered.length} transaksi`;
        } else {
            countBadge.textContent = `Menampilkan ${filtered.length} dari ${allOrders.length} transaksi`;
        }
    }

    renderHistoryTableRows(filtered);
}

// Render baris tabel riwayat transaksi
function renderHistoryTableRows(orders) {
    const tableBody = document.getElementById('historyTableBody');
    if (!tableBody) return;

    if (!orders || orders.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 36px 20px; color: #95a5a6;">Tidak ada transaksi yang cocok dengan filter.</td></tr>`;
        return;
    }

    tableBody.innerHTML = orders.map((o, idx) => {
        const isVoid = Boolean(o.isVoid);
        const isUnpaid = o.status === 'unpaid';
        const isPendingPo = o.orderType === 'take_away' && !isVoid && !isUnpaid && (!o.pickedUpAt || o.status === 'paid');
        const orderCogs = calculateOrderCogs(o);
        const orderRevenue = Number(o.totalAmount) || 0;
        const orderDeliveryFee = Number(o.deliveryFee) || 0;
        const orderFoodRevenue = Math.max(0, orderRevenue - orderDeliveryFee);
        const orderProfit = orderFoodRevenue - orderCogs; // Ongkir bukan laba toko
        const orderMargin = orderFoodRevenue > 0 ? Math.round((orderProfit / orderFoodRevenue) * 100) : 0;
        const cashierName = o.cashierName || 'Kasir';
        const finalDiscount = Number(o.finalDiscountAmount) || 0;

        let statusTagHtml = '';
        if (isVoid) {
            statusTagHtml = '<div class="tag-void-mini">⚠️ VOID</div>';
        } else if (isUnpaid) {
            statusTagHtml = '<div class="tag-unpaid-mini">🕒 BELUM BAYAR</div>';
        } else if (isPendingPo) {
            statusTagHtml = '<div class="tag-po-mini">📦 MENUNGGU PICKUP</div>';
        } else {
            // Selesai / Lunas
            if (o.orderType === 'take_away') {
                const isDelivery = o.pickupMethod === 'ojol' || o.pickupMethod === 'delivery';
                if (isDelivery) {
                    const timeInfo = o.pickedUpAt ? ` (${formatDateTime(o.pickedUpAt)})` : '';
                    statusTagHtml = `<div class="tag-completed-mini" title="Pesanan telah selesai dan dikirim via ${o.pickupMethod === 'ojol' ? 'Ojol / Kurir' : 'Kurir Toko'}${timeInfo}">🛵 SUDAH KIRIM</div>`;
                } else {
                    const timeInfo = o.pickedUpAt ? ` (${formatDateTime(o.pickedUpAt)})` : '';
                    statusTagHtml = `<div class="tag-completed-mini" title="Pesanan telah selesai diambil di toko${timeInfo}">🏪 SUDAH DIAMBIL</div>`;
                }
            } else {
                statusTagHtml = '<div class="tag-completed-mini">✅ SELESAI</div>';
            }
        }

        const itemsHtml = (o.items && o.items.length > 0)
            ? `<div class="history-items-list">
                ${o.items.map(i => `
                    <div class="history-item-chip" title="${i.name} (x${i.qty})">
                        <strong class="item-qty-badge">[ ${i.qty}x ]</strong>
                        <span class="item-name-text">${i.name}</span>
                    </div>
                `).join('')}
            </div>`
            : '<span style="color: #94A3B8; font-size: 11px;">-</span>';

        return `
            <tr class="${isVoid ? 'row-voided' : (isUnpaid ? 'row-unpaid' : '')}">
                <td class="col-num-cell" style="text-align: center; color: #64748B;">${idx + 1}</td>
                <td class="col-invoice-cell">
                    <div class="invoice-num-text"><strong>${o.invoiceNo}</strong></div>
                    ${statusTagHtml}
                    ${o.resiPrintedAt ? `<div class="badge-resi-printed-tag" title="Resi dicetak: ${formatDateTime(o.resiPrintedAt)}">🖨️ Resi Dicetak</div>` : ''}
                    <div class="invoice-cashier-text">Kasir: <strong>${cashierName}</strong></div>
                </td>
                <td class="col-time-cell" style="white-space: nowrap;">${formatDateTime(o.createdAt)}</td>
                <td class="col-customer-cell">
                    <div class="customer-name-text"><strong>${o.customerName || 'Pelanggan'}</strong></div>
                    <div class="customer-type-row">
                        <span class="order-badge ${o.orderType === 'dine_in' ? 'badge-dine-in' : 'badge-take-away'}">${o.orderType === 'dine_in' ? 'Dine In' : 'Take Away (PO)'}</span>
                    </div>
                    ${o.notes ? `<div class="customer-notes-mini" title="${o.notes}">📝 <em>${o.notes}</em></div>` : ''}
                </td>
                <td class="col-schedule-cell" style="white-space: nowrap;">
                    ${o.orderType === 'take_away' && o.pickupDate ? `
                        <div class="schedule-date-text">⏰ <strong>${o.pickupDate}</strong> ${o.pickupTime ? `(${o.pickupTime})` : ''}</div>
                        <div class="schedule-method-text">${o.pickupMethod === 'ojol' ? '🛵 Ojol / Kurir' : (o.pickupMethod === 'delivery' ? '🚚 Diantar' : '🏪 Ambil Toko')}</div>
                        ${o.pickupAddress ? `<div class="schedule-addr-text" title="${o.pickupAddress}">📍 ${o.pickupAddress}</div>` : ''}
                    ` : `
                        <span style="color: #94A3B8; font-size: 11px;">-</span>
                    `}
                </td>
                <td class="col-items-cell">${itemsHtml}</td>
                <td class="col-method-cell" style="text-align: center; white-space: nowrap;">
                    ${isUnpaid 
                        ? '<span class="badge-method badge-unpaid">BELUM BAYAR</span>' 
                        : `<span class="badge-method badge-${o.paymentMethod}">${(o.paymentMethod || 'cash').toUpperCase()}</span>`}
                </td>
                <td class="col-cogs-cell">
                    <span class="badge-cogs ${isVoid ? 'text-strikethrough' : ''}">${formatRupiah(orderCogs)}</span>
                </td>
                <td class="col-revenue-cell">
                    <div class="revenue-nominal-text ${isVoid ? 'text-strikethrough' : ''}">${formatRupiah(orderRevenue)}</div>
                    ${finalDiscount > 0 ? `<div class="discount-subtext">(Disc: -${formatRupiah(finalDiscount)})</div>` : ''}
                </td>
                <td class="col-ongkir-cell" style="text-align: right;">
                    ${orderDeliveryFee > 0 ? `
                        <span class="badge-ongkir ${isVoid ? 'text-strikethrough' : ''}" style="color: #0284C7; font-weight: 700; font-size: 13px;">
                            ${formatRupiah(orderDeliveryFee)}
                        </span>
                    ` : `
                        <span style="color: #94A3B8; font-size: 12px;">-</span>
                    `}
                </td>
                <td class="col-profit-cell">
                    ${isVoid ? `
                        <span class="profit-void-text">Dibatalkan</span>
                    ` : (isUnpaid ? `
                        <span style="color: #D97706; font-size: 11px; font-weight: 700;">Menunggu Bayar</span>
                    ` : `
                        <div class="profit-nominal-text">
                            <span class="badge-profit ${orderProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                                ${orderProfit >= 0 ? '+' : ''}${formatRupiah(orderProfit)}
                            </span>
                        </div>
                        <div class="profit-margin-row">
                            <span class="margin-pill ${orderMargin >= 30 ? 'positive' : 'warning'}">
                                ${orderMargin}%
                            </span>
                        </div>
                    `)}
                </td>
                <td class="col-actions-cell" style="text-align: center;">
                    <div class="table-action-btns-row">
                        ${isVoid ? `
                            <button type="button" class="btn-table-reprint" onclick="reprintOrder('${o.invoiceNo}')" title="Cetak Ulang Struk">
                                🖨️ Struk
                            </button>
                            <button type="button" class="btn-table-resi ${o.resiPrintedAt ? 'is-printed' : ''}" onclick="activeOrdersManager.printSingleResi('${o.invoiceNo}')" title="${o.resiPrintedAt ? 'Resi sudah dicetak (' + formatDateTime(o.resiPrintedAt) + '). Klik cetak ulang.' : 'Cetak Resi Label 58mm'}">
                                ${o.resiPrintedAt ? '✅ Resi' : '🏷️ Resi'}
                            </button>
                            <span class="badge-void" style="width: 68px;">VOID</span>
                        ` : (isUnpaid ? `
                            <button type="button" class="btn-table-pay" onclick="activeOrdersManager.proceedPayment('${o.invoiceNo}')" title="Bayar & Selesaikan Sekarang">
                                💳 Bayar
                            </button>
                            <button type="button" class="btn-table-reprint" onclick="reprintOrder('${o.invoiceNo}')" title="Cetak Struk / Tagihan">
                                🖨️ Struk
                            </button>
                            <button type="button" class="btn-table-del" onclick="activeOrdersManager.cancelOrder('${o.invoiceNo}')" title="Hapus Tagihan (Delete Transaction)">
                                🗑️ Hapus
                            </button>
                        ` : (isPendingPo ? `
                            <button type="button" class="btn-table-pickup" onclick="activeOrdersManager.markPickedUp('${o.invoiceNo}')" title="Tandai Sudah Diambil">
                                ✅ Diambil
                            </button>
                            <button type="button" class="btn-table-reprint" onclick="reprintOrder('${o.invoiceNo}')" title="Cetak Ulang Struk">
                                🖨️ Struk
                            </button>
                            <button type="button" class="btn-table-void" onclick="openVoidModal('${o.invoiceNo}')" title="Batalkan Transaksi (Void)">
                                ⚠️ Void
                            </button>
                        ` : `
                            <button type="button" class="btn-table-reprint" onclick="reprintOrder('${o.invoiceNo}')" title="Cetak Ulang Struk">
                                🖨️ Struk
                            </button>
                            <button type="button" class="btn-table-resi ${o.resiPrintedAt ? 'is-printed' : ''}" onclick="activeOrdersManager.printSingleResi('${o.invoiceNo}')" title="${o.resiPrintedAt ? 'Resi sudah dicetak (' + formatDateTime(o.resiPrintedAt) + '). Klik cetak ulang.' : 'Cetak Resi Label 58mm'}">
                                ${o.resiPrintedAt ? '✅ Resi' : '🏷️ Resi'}
                            </button>
                            <button type="button" class="btn-table-void" onclick="openVoidModal('${o.invoiceNo}')" title="Batalkan Transaksi (Void)">
                                ⚠️ Void
                            </button>
                        `))}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ================= GRAFIK VISUAL PENJUALAN (PURE SVG) =================

function renderHistoryChart(orders) {
    const chartContainer = document.getElementById('historyChartContainer');
    if (!chartContainer) return;

    const activeOrders = orders.filter(o => !o.isVoid && o.status !== 'unpaid');

    if (activeOrders.length === 0) {
        chartContainer.innerHTML = `
            <div class="chart-empty-state">
                <span>📉 Tidak ada transaksi aktif untuk divisualisasikan pada periode ini.</span>
            </div>
        `;
        return;
    }

    // Kelompokkan data harian
    const dayMap = {};
    activeOrders.forEach(o => {
        const d = new Date(o.createdAt);
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayLabel = `${d.getDate()}/${d.getMonth() + 1}`;

        if (!dayMap[dateKey]) {
            dayMap[dateKey] = { label: dayLabel, omset: 0, profit: 0, count: 0 };
        }

        let orderCogs = 0;
        if (o.items && o.items.length > 0) {
            o.items.forEach(item => {
                let itemCogs = Number(item.cogsLocked) || 0;
                if (itemCogs === 0 && item.id) {
                    const p = (typeof productManager !== 'undefined') ? productManager.getProductById(item.id) : null;
                    if (p) itemCogs = Number(p.cogs) || 0;
                }
                orderCogs += itemCogs * (Number(item.qty) || 1);
            });
        }

        const rev = Number(o.totalAmount) || 0;
        const dFee = Number(o.deliveryFee) || 0;
        const foodRev = Math.max(0, rev - dFee);
        dayMap[dateKey].omset += rev;
        dayMap[dateKey].profit += (foodRev - orderCogs);
        dayMap[dateKey].count++;
    });

    const sortedDates = Object.keys(dayMap).sort();
    const chartData = sortedDates.map(k => dayMap[k]);

    const maxVal = Math.max(...chartData.map(d => Math.max(d.omset, d.profit, 10000)));
    const svgWidth = 650;
    const svgHeight = 170;
    const paddingLeft = 60;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 35;
    const plotWidth = svgWidth - paddingLeft - paddingRight;
    const plotHeight = svgHeight - paddingTop - paddingBottom;

    const barGroupWidth = plotWidth / chartData.length;
    const barWidth = Math.min(22, (barGroupWidth - 10) / 2);

    let barsHtml = '';
    chartData.forEach((d, i) => {
        const groupCenterX = paddingLeft + (i * barGroupWidth) + (barGroupWidth / 2);
        const omsetHeight = (d.omset / maxVal) * plotHeight;
        const profitHeight = Math.max(0, (d.profit / maxVal) * plotHeight);

        const omsetX = groupCenterX - barWidth - 1;
        const omsetY = paddingTop + plotHeight - omsetHeight;

        const profitX = groupCenterX + 1;
        const profitY = paddingTop + plotHeight - profitHeight;

        barsHtml += `
            <g class="chart-bar-group">
                <!-- Bar Omset -->
                <rect x="${omsetX}" y="${omsetY}" width="${barWidth}" height="${omsetHeight}" rx="3" fill="#3B82F6">
                    <title>${d.label} | Omset: ${formatRupiah(d.omset)} (${d.count} Trx)</title>
                </rect>
                <!-- Bar Untung Bersih -->
                <rect x="${profitX}" y="${profitY}" width="${barWidth}" height="${profitHeight}" rx="3" fill="#10B981">
                    <title>${d.label} | Untung: ${formatRupiah(d.profit)}</title>
                </rect>
                <!-- Label Tanggal -->
                <text x="${groupCenterX}" y="${svgHeight - 12}" text-anchor="middle" font-size="11" fill="#64748B" font-weight="600">
                    ${d.label}
                </text>
            </g>
        `;
    });

    // Y Axis Grid lines
    const ySteps = 3;
    let gridHtml = '';
    for (let s = 0; s <= ySteps; s++) {
        const valAtStep = (maxVal / ySteps) * s;
        const yPos = paddingTop + plotHeight - (s / ySteps) * plotHeight;
        gridHtml += `
            <line x1="${paddingLeft}" y1="${yPos}" x2="${svgWidth - paddingRight}" y2="${yPos}" stroke="#E2E8F0" stroke-dasharray="3,3" />
            <text x="${paddingLeft - 8}" y="${yPos + 4}" text-anchor="end" font-size="10" fill="#94A3B8">
                ${s === 0 ? '0' : formatRupiah(valAtStep).replace('Rp ', '')}
            </text>
        `;
    }

    chartContainer.innerHTML = `
        <div class="chart-header-row">
            <div class="chart-title">📈 Tren Omset & Untung Bersih</div>
            <div class="chart-legend">
                <span class="legend-item"><span class="legend-dot dot-omset"></span> Omset Penjualan</span>
                <span class="legend-item"><span class="legend-dot dot-profit"></span> Untung Bersih</span>
            </div>
        </div>
        <div class="chart-svg-wrapper">
            <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="history-svg-chart">
                ${gridHtml}
                ${barsHtml}
            </svg>
        </div>
    `;
}

// ================= CETAK ULANG STRUK =================

async function reprintOrder(invoiceNo) {
    const orders = await db.getOrdersHistory(500);
    const order = orders.find(o => o.invoiceNo === invoiceNo);
    if (!order) {
        alert('Data transaksi tidak ditemukan.');
        return;
    }

    paymentManager.showReceiptModal(order, true);
}

// ================= EKSPOR LAPORAN KE EXCEL (.XLSX) =================

async function exportHistoryToExcel() {
    const orders = (window.currentlyRenderedOrders && window.currentlyRenderedOrders.length > 0)
        ? window.currentlyRenderedOrders
        : (await db.getOrdersHistory(500));
    if (orders.length === 0) {
        alert('Tidak ada data transaksi untuk diekspor.');
        return;
    }

    const header = [
        'No',
        'No Invoice',
        'Waktu',
        'Kasir',
        'Pelanggan',
        'Layanan',
        'Metode Bayar',
        'Status Transaksi',
        'Item Pesanan',
        'Varian',
        'Qty',
        'Harga Normal / Item (Rp)',
        'Harga Jual / Item (Rp)',
        'Diskon / Item (Rp)',
        'Total Diskon Item (Rp)',
        'Subtotal Item (Rp)',
        'Modal Satuan (HPP) (Rp)',
        'Total Modal (HPP) (Rp)',
        'Untung Bersih Item (Rp)',
        'Ongkir Kurir (Rp)',
        'Diskon Final Nota (Rp)',
        'Total Bayar Nota (Rp)',
        'Catatan / Info PO',
        'Dibatalkan Oleh',
        'Alasan Void'
    ];

    const dataRows = [header];

    let rowNum = 1;
    let sumQty = 0;
    let sumDiscountItem = 0;
    let sumSubtotalItem = 0;
    let sumCogs = 0;
    let sumProfit = 0;
    let sumOngkir = 0;
    let sumFinalDiscount = 0;
    let sumOmset = 0;

    orders.forEach(o => {
        const isVoid = Boolean(o.isVoid);
        const ongkir = Number(o.deliveryFee) || 0;
        const finalDiscount = Number(o.finalDiscountAmount) || 0;
        const totalPaid = Number(o.totalAmount) || 0;
        const notes = [
            o.notes || '',
            o.pickupDate ? `Tgl: ${o.pickupDate}` : '',
            o.pickupTime ? `Jam: ${o.pickupTime}` : '',
            o.pickupMethod ? `Metode: ${o.pickupMethod}` : '',
            o.pickupAddress ? `Alamat: ${o.pickupAddress}` : ''
        ].filter(Boolean).join(' | ');

        let statusExcel = 'SELESAI';
        if (isVoid) statusExcel = 'VOID / DIBATALKAN';
        else if (o.status === 'unpaid') statusExcel = 'BELUM BAYAR';
        else if (o.orderType === 'take_away' && (!o.pickedUpAt || o.status === 'paid')) statusExcel = 'PO MENUNGGU PICKUP';
        else if (o.orderType === 'take_away' && (o.pickupMethod === 'ojol' || o.pickupMethod === 'delivery')) statusExcel = 'SELESAI (SUDAH KIRIM)';
        else if (o.orderType === 'take_away') statusExcel = 'SELESAI (SUDAH DIAMBIL)';

        if (!isVoid) {
            sumOngkir += ongkir;
            sumFinalDiscount += finalDiscount;
            sumOmset += totalPaid;
        }

        const items = (Array.isArray(o.items) && o.items.length > 0) ? o.items : [null];

        items.forEach((item, itemIdx) => {
            const isFirstItem = (itemIdx === 0);

            let itemName = '-';
            let variantName = '-';
            let qty = 0;
            let priceNormal = 0;
            let priceLocked = 0;
            let discountPerItem = 0;
            let totalDiscountItem = 0;
            let subtotalItem = 0;
            let cogsLocked = 0;
            let totalItemCogs = 0;
            let itemProfit = 0;

            if (item) {
                itemName = item.name || '-';
                variantName = item.variantName || '-';
                qty = Number(item.qty) || 1;
                priceLocked = Number(item.priceLocked) || 0;
                priceNormal = Number(item.priceNormal) || priceLocked;
                discountPerItem = Math.max(0, priceNormal - priceLocked);
                totalDiscountItem = discountPerItem * qty;
                subtotalItem = priceLocked * qty;

                cogsLocked = Number(item.cogsLocked) || 0;
                if (cogsLocked === 0 && item.id && typeof productManager !== 'undefined') {
                    const p = productManager.getProductById(item.id);
                    if (p) cogsLocked = Number(p.cogs) || 0;
                }
                totalItemCogs = cogsLocked * qty;
                itemProfit = subtotalItem - totalItemCogs;

                if (!isVoid) {
                    sumQty += qty;
                    sumDiscountItem += totalDiscountItem;
                    sumSubtotalItem += subtotalItem;
                    sumCogs += totalItemCogs;
                    sumProfit += itemProfit;
                }
            } else {
                // Fallback untuk transaksi tanpa data detail item
                subtotalItem = isVoid ? 0 : Math.max(0, totalPaid - ongkir);
                if (!isVoid) {
                    sumSubtotalItem += subtotalItem;
                    sumProfit += subtotalItem;
                }
            }

            dataRows.push([
                rowNum++,
                o.invoiceNo,
                formatDateTime(o.createdAt),
                o.cashierName || 'Kasir',
                o.customerName || 'Pelanggan',
                o.orderType === 'dine_in' ? 'Dine In' : 'Take Away (PO)',
                (o.paymentMethod || 'cash').toUpperCase(),
                statusExcel,
                itemName,
                variantName,
                qty,
                priceNormal,
                priceLocked,
                discountPerItem,
                totalDiscountItem,
                subtotalItem,
                cogsLocked,
                totalItemCogs,
                itemProfit,
                isFirstItem ? ongkir : 0,
                isFirstItem ? finalDiscount : 0,
                isFirstItem ? totalPaid : 0,
                isFirstItem ? notes : '',
                isFirstItem ? (o.voidBy || '') : '',
                isFirstItem ? (o.voidReason || '') : ''
            ]);
        });
    });

    // Baris Total Akumulasi
    dataRows.push([]);
    dataRows.push([
        '', '', '', '', '', '', '', 'TOTAL AKUMULASI:',
        '', '',
        sumQty,
        '', '', '',
        sumDiscountItem,
        sumSubtotalItem,
        '',
        sumCogs,
        sumProfit,
        sumOngkir,
        sumFinalDiscount,
        sumOmset,
        '', '', ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `DIASAP_Rekap_Penjualan_${dateStr}.xlsx`;

    // Gunakan SheetJS jika tersedia
    if (typeof XLSX !== 'undefined') {
        const ws = XLSX.utils.aoa_to_sheet(dataRows);

        ws['!cols'] = [
            { wch: 6 },  // No
            { wch: 22 }, // No Invoice
            { wch: 20 }, // Waktu
            { wch: 12 }, // Kasir
            { wch: 18 }, // Pelanggan
            { wch: 15 }, // Layanan
            { wch: 14 }, // Metode Bayar
            { wch: 18 }, // Status Transaksi
            { wch: 26 }, // Item Pesanan
            { wch: 12 }, // Varian
            { wch: 8 },  // Qty
            { wch: 16 }, // Harga Normal / Item (Rp)
            { wch: 16 }, // Harga Jual / Item (Rp)
            { wch: 14 }, // Diskon / Item (Rp)
            { wch: 16 }, // Total Diskon Item (Rp)
            { wch: 16 }, // Subtotal Item (Rp)
            { wch: 16 }, // Modal Satuan (HPP) (Rp)
            { wch: 16 }, // Total Modal (HPP) (Rp)
            { wch: 16 }, // Untung Bersih Item (Rp)
            { wch: 15 }, // Ongkir Kurir (Rp)
            { wch: 16 }, // Diskon Final Nota (Rp)
            { wch: 18 }, // Total Bayar Nota (Rp)
            { wch: 28 }, // Catatan / Info PO
            { wch: 14 }, // Dibatalkan Oleh
            { wch: 22 }  // Alasan Void
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rekap Penjualan');
        XLSX.writeFile(wb, filename);

        if (typeof adminManager !== 'undefined' && adminManager.showToast) {
            adminManager.showToast('Laporan Excel (.xlsx) berhasil diunduh!');
        }
    } else {
        // Fallback jika pustaka XLSX sedang offline: buat XML Spreadsheet (.xls)
        const csvContent = 'data:application/vnd.ms-excel;charset=utf-8,\uFEFF' + dataRows.map(r => r.join('\t')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `DIASAP_Rekap_Penjualan_${dateStr}.xls`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// ================= VOID TRANSAKSI CONTROLLER =================

let currentVoidOrder = null;

async function openVoidModal(invoiceNo) {
    const orders = await db.getOrdersHistory(100);
    const order = orders.find(o => o.invoiceNo === invoiceNo);
    if (!order) {
        alert('Data transaksi tidak ditemukan.');
        return;
    }

    if (order.isVoid) {
        alert('Transaksi ini sudah berstatus VOID.');
        return;
    }

    currentVoidOrder = order;

    const modal = document.getElementById('voidModal');
    const invoiceInput = document.getElementById('voidInvoiceNo');
    const summaryBox = document.getElementById('voidOrderSummary');
    const authorInput = document.getElementById('voidAuthorName');
    const reasonSelect = document.getElementById('voidReasonSelect');
    const customGroup = document.getElementById('voidCustomReasonGroup');
    const customInput = document.getElementById('voidCustomReason');
    const passInput = document.getElementById('voidPassword');
    const errBox = document.getElementById('voidErrorMessage');
    const submitBtn = document.getElementById('btnSubmitVoid');

    if (invoiceInput) invoiceInput.value = order.invoiceNo;
    if (authorInput) authorInput.value = '';
    if (reasonSelect) reasonSelect.value = '';
    if (customGroup) customGroup.style.display = 'none';
    if (customInput) customInput.value = '';
    if (passInput) passInput.value = '';
    if (errBox) errBox.style.display = 'none';
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>⚠️ Konfirmasi VOID</span>';
    }

    if (summaryBox) {
        const itemsList = (order.items && order.items.length > 0)
            ? order.items.map(i => `${i.name} (${i.qty}x)`).join(', ')
            : 'Tidak ada item';

        summaryBox.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                <div>
                    <strong style="font-size: 14px; color: #1E293B;">${order.invoiceNo}</strong>
                    <div style="color: #64748B; font-size: 11px;">${formatDateTime(order.createdAt)} &bull; ${order.customerName || 'Pelanggan'}</div>
                </div>
                <strong style="font-size: 15px; color: #DC2626;">${formatRupiah(order.totalAmount)}</strong>
            </div>
            <div style="font-size: 11px; color: #475569; background: white; padding: 6px 10px; border-radius: 6px; border: 1px solid #E2E8F0;">
                <strong>Item:</strong> ${itemsList}
            </div>
        `;
    }

    if (modal) modal.classList.add('active');
    setTimeout(() => { if (authorInput) authorInput.focus(); }, 150);
}

function closeVoidModal() {
    const modal = document.getElementById('voidModal');
    if (modal) modal.classList.remove('active');
    currentVoidOrder = null;
}

function toggleVoidCustomReason(val) {
    const customGroup = document.getElementById('voidCustomReasonGroup');
    const customInput = document.getElementById('voidCustomReason');
    if (customGroup) {
        const isOther = (val === 'other');
        customGroup.style.display = isOther ? 'block' : 'none';
        if (isOther && customInput) {
            customInput.focus();
            customInput.required = true;
        } else if (customInput) {
            customInput.required = false;
        }
    }
}

async function handleConfirmVoid(e) {
    e.preventDefault();
    const invoiceNo = document.getElementById('voidInvoiceNo')?.value;
    const authorName = document.getElementById('voidAuthorName')?.value.trim();
    const reasonSelect = document.getElementById('voidReasonSelect')?.value;
    const customReason = document.getElementById('voidCustomReason')?.value.trim();
    const password = document.getElementById('voidPassword')?.value;
    const errBox = document.getElementById('voidErrorMessage');
    const submitBtn = document.getElementById('btnSubmitVoid');

    if (!invoiceNo) {
        alert('Invoice transaksi tidak valid.');
        return;
    }

    if (!authorName) {
        if (errBox) {
            errBox.textContent = 'Nama staf / otorisator wajib diisi!';
            errBox.style.display = 'block';
        }
        return;
    }

    let finalReason = reasonSelect;
    if (reasonSelect === 'other') {
        if (!customReason) {
            if (errBox) {
                errBox.textContent = 'Silakan tuliskan alasan pembatalan!';
                errBox.style.display = 'block';
            }
            return;
        }
        finalReason = customReason;
    }

    if (!finalReason) {
        if (errBox) {
            errBox.textContent = 'Pilih atau isi alasan pembatalan transaksi!';
            errBox.style.display = 'block';
        }
        return;
    }

    if (!password) {
        if (errBox) {
            errBox.textContent = 'Password kasir wajib diisi untuk verifikasi!';
            errBox.style.display = 'block';
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Memverifikasi Password...</span>';
    }
    if (errBox) errBox.style.display = 'none';

    // 1. Verifikasi Password Otorisasi
    const isPasswordValid = await authManager.verifyPassword(password);
    if (!isPasswordValid) {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>⚠️ Konfirmasi VOID</span>';
        }
        if (errBox) {
            errBox.textContent = 'Password otorisasi salah! Pembatalan transaksi ditolak.';
            errBox.style.display = 'block';
        }
        sounds.playWarning();
        return;
    }

    // 2. Eksekusi Void di Database & Pulihkan Stok
    if (submitBtn) {
        submitBtn.innerHTML = '<span>Membatalkan Transaksi & Mengembalikan Stok...</span>';
    }

    try {
        await db.voidOrder(invoiceNo, authorName, finalReason);
        sounds.playWarning();
        closeVoidModal();

        // Refresh tabel riwayat transaksi
        await renderHistoryData();

        alert(`Transaksi ${invoiceNo} berhasil DIBATALKAN (VOID).\nStok bahan baku & produk fisik telah dikembalikan ke sistem.`);
    } catch (err) {
        console.error('Gagal void order:', err);
        alert('Gagal membatalkan transaksi: ' + err.message);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>⚠️ Konfirmasi VOID</span>';
        }
    }
}

// ================= MODAL KELOLA MENU =================

function openMenuModal() {
    const modal = document.getElementById('menuModal');
    if (modal) modal.classList.add('active');
}

function closeMenuModal() {
    const modal = document.getElementById('menuModal');
    if (modal) modal.classList.remove('active');
}

async function handleSaveNewProduct(event) {
    event.preventDefault();

    const id = document.getElementById('newProdId').value.trim().toUpperCase();
    const name = document.getElementById('newProdName').value.trim();
    const desc = document.getElementById('newProdDesc').value.trim();
    const category = document.getElementById('newProdCategory').value;
    const cogsInput = document.getElementById('newProdCogs');
    const cogs = cogsInput ? (parseFloat(cogsInput.value) || 0) : 0;
    const priceNormal = parseFloat(document.getElementById('newProdPriceNormal').value) || 0;
    const pricePromo = parseFloat(document.getElementById('newProdPricePromo').value) || priceNormal;
    const emoji = document.getElementById('newProdEmoji').value.trim() || '🍗';

    if (!id || !name || priceNormal <= 0) {
        alert('Mohon lengkapi kode menu, nama menu, dan harga normal!');
        return;
    }

    const product = {
        id,
        name,
        desc,
        category,
        cogs,
        priceNormal,
        pricePromo,
        emoji
    };

    const saveBtn = document.getElementById('btnSaveMenu');
    if (saveBtn) saveBtn.textContent = 'Menyimpan...';

    try {
        await db.saveProduct(product);
        await productManager.loadProducts();
        sounds.playSuccess();
        alert(`Menu "${name}" berhasil disimpan!`);
        closeMenuModal();
        document.getElementById('formAddProduct').reset();
    } catch (e) {
        alert('Gagal menyimpan menu: ' + e.message);
    } finally {
        if (saveBtn) saveBtn.textContent = 'Simpan Menu';
    }
}

// ================= MANAJEMEN TRANSAKSI AKTIF / DIPROSES =================

class ActiveOrdersManager {
    constructor() {
        this.currentTab = 'unpaid'; // 'unpaid' | 'po'
        this.selectedInvoices = new Set();
        this.visibleOrders = [];
    }

    async init() {
        await this.refreshBadge();
    }

    async refreshBadge() {
        const badge = document.getElementById('activeOrdersCountBadge');
        if (!badge) return;

        try {
            const activeOrders = await db.getActiveOrders();
            const count = activeOrders.length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        } catch (e) {
            console.warn('Gagal memuat badge active orders:', e);
        }
    }

    async openModal() {
        const modal = document.getElementById('activeOrdersModal');
        if (!modal) return;
        modal.classList.add('active');
        await this.render();
        await this.refreshBadge();
    }

    closeModal() {
        const modal = document.getElementById('activeOrdersModal');
        if (modal) modal.classList.remove('active');
    }

    setTab(tab) {
        this.currentTab = tab;
        this.selectedInvoices.clear();
        document.querySelectorAll('.active-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
        });
        this.render();
    }

    async render() {
        const container = document.getElementById('activeOrdersContainer');
        const countUnpaidEl = document.getElementById('countPendingBills');
        const countPoEl = document.getElementById('countPendingPickups');

        if (!container) return;
        container.innerHTML = `<div style="text-align: center; padding: 24px; color: #64748B;">Memuat transaksi diproses...</div>`;

        const activeOrders = await db.getActiveOrders();
        const unpaidList = activeOrders.filter(o => o.status === 'unpaid');
        const poList = activeOrders.filter(o => o.orderType === 'take_away' && !o.isVoid && o.status !== 'unpaid' && (!o.pickedUpAt || o.status === 'paid'));

        if (countUnpaidEl) countUnpaidEl.textContent = unpaidList.length;
        if (countPoEl) countPoEl.textContent = poList.length;

        // Auto-switch to PO tab jika tab unpaid kosong tapi ada antrean PO
        if (this.currentTab === 'unpaid' && unpaidList.length === 0 && poList.length > 0) {
            this.currentTab = 'po';
            document.querySelectorAll('.active-tab-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'po');
            });
        }

        this.visibleOrders = (this.currentTab === 'unpaid') ? unpaidList : poList;
        this.updateBulkToolbar();

        if (this.currentTab === 'unpaid') {
            if (unpaidList.length === 0) {
                container.innerHTML = `
                    <div class="active-orders-empty">
                        <div style="font-size: 40px; margin-bottom: 8px; opacity: 0.6;">🧾</div>
                        <h4>Tidak ada tagihan sementara yang menggantung</h4>
                        <p>Saat Anda membuat tagihan / pesanan belum bayar, tagihan tersebut akan muncul di sini untuk dilunasi.</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="active-table-container">
                    <table class="active-orders-table">
                        <thead>
                            <tr>
                                <th style="text-align: center; width: 38px;">
                                    <input type="checkbox" class="order-select-all-head" onchange="activeOrdersManager.toggleSelectAll(this.checked)" title="Pilih Semua">
                                </th>
                                <th style="width: 175px;">Invoice & Waktu</th>
                                <th style="width: 180px;">Pelanggan</th>
                                <th style="width: 190px;">Jadwal / Pengambilan</th>
                                <th>Item Pesanan</th>
                                <th style="text-align: right; width: 125px;">Total Tagihan</th>
                                <th style="text-align: center; width: 260px;">Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${unpaidList.map(o => {
                                const isSelected = this.selectedInvoices.has(o.invoiceNo);
                                const itemsHtml = (o.items && o.items.length > 0)
                                    ? `<div class="active-items-list">${o.items.map(i => `<span class="active-item-chip" title="${i.name} (x${i.qty})"><strong>${i.qty}x</strong> ${i.name}</span>`).join('')}</div>`
                                    : '<span class="text-muted-mini">-</span>';
                                return `
                                    <tr class="active-order-row row-unpaid ${isSelected ? 'is-selected-bulk' : ''}" id="orderRow_${o.invoiceNo}">
                                        <td style="text-align: center;">
                                            <input type="checkbox" class="order-row-checkbox" value="${o.invoiceNo}" 
                                                   ${isSelected ? 'checked' : ''} 
                                                   onchange="activeOrdersManager.toggleOrder('${o.invoiceNo}', this.checked)">
                                        </td>
                                        <td>
                                            <div class="active-inv-num">${o.invoiceNo}</div>
                                            <div class="active-badge-status status-unpaid">🕒 Belum Bayar</div>
                                            ${o.resiPrintedAt ? `
                                                <div class="badge-resi-printed-tag" title="Resi telah dicetak (${formatDateTime(o.resiPrintedAt)})">
                                                    🖨️ Resi Sudah Dicetak
                                                </div>
                                            ` : `
                                                <div class="badge-resi-unprinted-tag" title="Resi belum dicetak">
                                                    ⏳ Belum Cetak Resi
                                                </div>
                                            `}
                                            <div class="active-time-text">${formatDateTime(o.createdAt)}</div>
                                        </td>
                                        <td>
                                            <div class="active-cust-name">👤 ${o.customerName || 'Pelanggan'}</div>
                                            <div class="active-cust-meta">
                                                <span class="order-badge ${o.orderType === 'dine_in' ? 'badge-dine-in' : 'badge-take-away'}">${o.orderType === 'dine_in' ? 'Dine In' : 'Take Away (PO)'}</span>
                                            </div>
                                            ${o.notes ? `<div class="active-notes-tag">📝 <em>${o.notes}</em></div>` : ''}
                                        </td>
                                        <td>
                                            ${o.orderType === 'take_away' && o.pickupDate ? `
                                                <div class="active-sched-date">📅 <strong>${o.pickupDate}</strong> ${o.pickupTime ? `(${o.pickupTime})` : ''}</div>
                                                <div class="active-sched-method">${o.pickupMethod === 'ojol' ? '🛵 Ojol / Kurir' : (o.pickupMethod === 'delivery' ? '🚚 Diantar Toko' : '🏪 Ambil di Toko')}</div>
                                                ${o.pickupAddress ? `<div class="active-sched-addr" title="${o.pickupAddress}">📍 ${o.pickupAddress}</div>` : ''}
                                            ` : `<span class="text-muted-mini">${o.orderType === 'dine_in' ? 'Makan di Tempat' : '-'}</span>`}
                                        </td>
                                        <td>
                                            ${itemsHtml}
                                        </td>
                                        <td style="text-align: right;">
                                            <div class="active-total-num">${formatRupiah(o.totalAmount)}</div>
                                        </td>
                                        <td style="text-align: center;">
                                            <div class="active-table-actions">
                                                <button type="button" class="btn-act-table btn-active-pay" onclick="activeOrdersManager.proceedPayment('${o.invoiceNo}')" title="Bayar / Lunasi">
                                                    💳 Bayar
                                                </button>
                                                <button type="button" class="btn-act-table btn-active-edit" onclick="activeOrdersManager.editOrder('${o.invoiceNo}')" title="Edit Pesanan">
                                                    ✏️ Edit
                                                </button>
                                                <button type="button" class="btn-act-table btn-active-resi ${o.resiPrintedAt ? 'is-printed' : ''}" onclick="activeOrdersManager.printSingleResi('${o.invoiceNo}')" title="${o.resiPrintedAt ? 'Resi sudah dicetak (' + formatDateTime(o.resiPrintedAt) + '). Klik cetak ulang.' : 'Cetak / Unduh Resi Label 58mm'}">
                                                    ${o.resiPrintedAt ? '✅ Resi' : '🏷️ Resi'}
                                                </button>
                                                <button type="button" class="btn-act-table btn-active-bill" onclick="activeOrdersManager.printBillForOrder('${o.invoiceNo}')" title="Cetak Bill Sementara">
                                                    🧾 Bill
                                                </button>
                                                <button type="button" class="btn-act-table btn-active-del" onclick="activeOrdersManager.cancelOrder('${o.invoiceNo}')" title="Hapus Tagihan">
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } else {
            // PO Tab
            if (poList.length === 0) {
                container.innerHTML = `
                    <div class="active-orders-empty">
                        <div style="font-size: 40px; margin-bottom: 8px; opacity: 0.6;">📦</div>
                        <h4>Tidak ada antrean PO yang menunggu diambil</h4>
                        <p>Pesanan Take Away (PO) yang sudah dibayar lunas akan tampil di sini hingga barang diserahkan ke pelanggan / kurir.</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="active-table-container">
                    <table class="active-orders-table">
                        <thead>
                            <tr>
                                <th style="text-align: center; width: 38px;">
                                    <input type="checkbox" class="order-select-all-head" onchange="activeOrdersManager.toggleSelectAll(this.checked)" title="Pilih Semua">
                                </th>
                                <th style="width: 175px;">Invoice & Waktu</th>
                                <th style="width: 180px;">Pelanggan</th>
                                <th style="width: 190px;">Jadwal / Pengambilan</th>
                                <th>Item Pesanan</th>
                                <th style="text-align: right; width: 125px;">Total Bayar</th>
                                <th style="text-align: center; width: 260px;">Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${poList.map(o => {
                                const isSelected = this.selectedInvoices.has(o.invoiceNo);
                                const itemsHtml = (o.items && o.items.length > 0)
                                    ? `<div class="active-items-list">${o.items.map(i => `<span class="active-item-chip" title="${i.name} (x${i.qty})"><strong>${i.qty}x</strong> ${i.name}</span>`).join('')}</div>`
                                    : '<span class="text-muted-mini">-</span>';
                                return `
                                    <tr class="active-order-row row-po ${isSelected ? 'is-selected-bulk' : ''}" id="orderRow_${o.invoiceNo}">
                                        <td style="text-align: center;">
                                            <input type="checkbox" class="order-row-checkbox" value="${o.invoiceNo}" 
                                                   ${isSelected ? 'checked' : ''} 
                                                   onchange="activeOrdersManager.toggleOrder('${o.invoiceNo}', this.checked)">
                                        </td>
                                        <td>
                                            <div class="active-inv-num">${o.invoiceNo}</div>
                                            <div class="active-badge-status status-po">📦 Menunggu Pickup</div>
                                            ${o.resiPrintedAt ? `
                                                <div class="badge-resi-printed-tag" title="Resi telah dicetak (${formatDateTime(o.resiPrintedAt)}) - Siap diproses dapur!">
                                                    🖨️ Resi Sudah Dicetak
                                                </div>
                                            ` : `
                                                <div class="badge-resi-unprinted-tag" title="Resi belum dicetak">
                                                    ⏳ Belum Cetak Resi
                                                </div>
                                            `}
                                            <div class="active-time-text">${formatDateTime(o.createdAt)}</div>
                                        </td>
                                        <td>
                                            <div class="active-cust-name">👤 ${o.customerName || 'Pelanggan'}</div>
                                            <div class="active-cust-meta">
                                                <span class="badge-method badge-${o.paymentMethod}">LUNAS (${(o.paymentMethod || 'cash').toUpperCase()})</span>
                                            </div>
                                            ${o.notes ? `<div class="active-notes-tag">📝 <em>${o.notes}</em></div>` : ''}
                                        </td>
                                        <td>
                                            <div class="active-sched-date po-date-highlight">⏰ <strong>${o.pickupDate || '-'}</strong> ${o.pickupTime ? `(${o.pickupTime})` : ''}</div>
                                            <div class="active-sched-method">${o.pickupMethod === 'ojol' ? '🛵 Ojol / Kurir' : (o.pickupMethod === 'delivery' ? '🚚 Diantar Toko' : '🏪 Ambil di Toko')}</div>
                                            ${o.pickupAddress ? `<div class="active-sched-addr" title="${o.pickupAddress}">📍 ${o.pickupAddress}</div>` : ''}
                                        </td>
                                        <td>
                                            ${itemsHtml}
                                        </td>
                                        <td style="text-align: right;">
                                            <div class="active-total-num text-success">${formatRupiah(o.totalAmount)}</div>
                                        </td>
                                        <td style="text-align: center;">
                                            <div class="active-table-actions">
                                                <button type="button" class="btn-act-table btn-active-complete" onclick="activeOrdersManager.markPickedUp('${o.invoiceNo}')" title="Tandai Sudah Diambil (Selesai)">
                                                    ✅ Selesai Diambil
                                                </button>
                                                <button type="button" class="btn-act-table btn-active-resi ${o.resiPrintedAt ? 'is-printed' : ''}" onclick="activeOrdersManager.printSingleResi('${o.invoiceNo}')" title="${o.resiPrintedAt ? 'Resi sudah dicetak (' + formatDateTime(o.resiPrintedAt) + '). Klik cetak ulang.' : 'Cetak / Unduh Resi Label 58mm'}">
                                                    ${o.resiPrintedAt ? '✅ Resi' : '🏷️ Resi'}
                                                </button>
                                                <button type="button" class="btn-act-table btn-active-reprint" onclick="reprintOrder('${o.invoiceNo}')" title="Cetak Struk Transaksi">
                                                    🖨️ Struk
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    // Toggle pemilihan kartu/baris order
    toggleOrder(invoiceNo, isChecked) {
        if (isChecked) {
            this.selectedInvoices.add(invoiceNo);
        } else {
            this.selectedInvoices.delete(invoiceNo);
        }
        const el = document.getElementById(`orderRow_${invoiceNo}`) || document.getElementById(`orderCard_${invoiceNo}`);
        if (el) {
            el.classList.toggle('is-selected-bulk', isChecked);
        }
        this.updateBulkToolbar();
    }

    // Toggle pilih semua order yang tampil
    toggleSelectAll(isChecked) {
        if (isChecked) {
            this.visibleOrders.forEach(o => this.selectedInvoices.add(o.invoiceNo));
        } else {
            this.visibleOrders.forEach(o => this.selectedInvoices.delete(o.invoiceNo));
        }
        document.querySelectorAll('.order-row-checkbox, .order-card-checkbox').forEach(cb => {
            cb.checked = isChecked;
            const el = document.getElementById(`orderRow_${cb.value}`) || document.getElementById(`orderCard_${cb.value}`);
            if (el) el.classList.toggle('is-selected-bulk', isChecked);
        });
        this.updateBulkToolbar();
    }

    // Bersihkan seluruh pilihan
    clearSelection() {
        this.selectedInvoices.clear();
        document.querySelectorAll('.order-row-checkbox, .order-card-checkbox').forEach(cb => {
            cb.checked = false;
            const el = document.getElementById(`orderRow_${cb.value}`) || document.getElementById(`orderCard_${cb.value}`);
            if (el) el.classList.remove('is-selected-bulk');
        });
        const allCb = document.getElementById('bulkSelectAllCheckbox');
        if (allCb) allCb.checked = false;
        document.querySelectorAll('.order-select-all-head').forEach(cb => cb.checked = false);
        this.updateBulkToolbar();
    }

    // Pilih hanya order yang belum pernah dicetak resinya
    selectUnprintedOnly() {
        this.selectedInvoices.clear();
        this.visibleOrders.forEach(o => {
            if (!o.resiPrintedAt) {
                this.selectedInvoices.add(o.invoiceNo);
            }
        });
        document.querySelectorAll('.order-row-checkbox, .order-card-checkbox').forEach(cb => {
            const shouldCheck = this.selectedInvoices.has(cb.value);
            cb.checked = shouldCheck;
            const el = document.getElementById(`orderRow_${cb.value}`) || document.getElementById(`orderCard_${cb.value}`);
            if (el) el.classList.toggle('is-selected-bulk', shouldCheck);
        });
        this.updateBulkToolbar();
    }

    // Salin daftar transaksi diproses atau antrean PO untuk dikirim ke WhatsApp
    copyForWhatsApp() {
        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

        const orders = this.visibleOrders || [];
        if (orders.length === 0) {
            alert(`Tidak ada data ${this.activeTab === 'po' ? 'Antrean PO' : 'Transaksi Diproses'} untuk disalin.`);
            return;
        }

        const lines = [];
        if (this.activeTab === 'po') {
            lines.push('📦 *ANTREAN PO DIASAP (MENUNGGU PICKUP)*');
            lines.push(`⏰ Update: ${dateStr}, ${timeStr}`);
            lines.push(`Total Antrean: ${orders.length} Pesanan`);
            lines.push('');

            const itemSummaryMap = {};

            orders.forEach((o, idx) => {
                const custName = o.customerName || 'Pelanggan';
                const invNo = o.invoiceNo;
                lines.push(`${idx + 1}. 👤 *${custName}* • (${invNo})`);

                // Jadwal & Metode
                let schedText = o.pickupDate ? `*${o.pickupDate}*` : '-';
                if (o.pickupTime) schedText += ` (${o.pickupTime})`;
                let methodText = 'Ambil di Toko';
                if (o.pickupMethod === 'ojol') methodText = '🛵 Ojol / Kurir';
                else if (o.pickupMethod === 'delivery') methodText = '🚚 Diantar Toko';
                else methodText = '🏪 Ambil di Toko';
                lines.push(`   ⏰ Jadwal: ${schedText} • ${methodText}`);

                // Alamat jika ada
                if (o.pickupAddress) {
                    lines.push(`   📍 Alamat: ${o.pickupAddress}`);
                }

                // Pesanan
                lines.push('   📋 Pesanan:');
                const items = o.items || [];
                if (items.length > 0) {
                    items.forEach(i => {
                        let displayName = i.name || i.baseName || 'Item';
                        if (i.baseName && i.variantName && !displayName.includes(i.variantName)) {
                            displayName = `${i.baseName} (${i.variantName})`;
                        }
                        lines.push(`   • ${i.qty}x ${displayName}`);

                        // Akumulasi ringkasan item
                        itemSummaryMap[displayName] = (itemSummaryMap[displayName] || 0) + Number(i.qty);
                    });
                } else {
                    lines.push('   • (Tidak ada item)');
                }

                // Catatan jika ada
                if (o.notes) {
                    lines.push(`   📝 Catatan: ${o.notes}`);
                }

                // Status Resi
                lines.push(`   🏷️ Status Resi: ${o.resiPrintedAt ? 'Sudah Dicetak ✅' : 'Belum Cetak ⏳'}`);
                lines.push('');
            });

            // Total Ringkasan Item PO untuk Dapur
            const summaryKeys = Object.keys(itemSummaryMap);
            if (summaryKeys.length > 0) {
                lines.push('-------------------------------------------');
                lines.push('🔥 *TOTAL RINGKASAN ITEM PO:*');
                summaryKeys.forEach(k => {
                    lines.push(`• ${k}: ${itemSummaryMap[k]}x`);
                });
                lines.push('-------------------------------------------');
            }

            lines.push('_DIASAP Smokehouse POS_');
        } else {
            // Transaksi Diproses (Unpaid)
            const totalBill = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
            lines.push('🕒 *TRANSAKSI DIPROSES (BELUM LUNAS) - DIASAP*');
            lines.push(`⏰ Update: ${dateStr}, ${timeStr}`);
            lines.push(`Total Tagihan: ${orders.length} Pesanan • Total: ${formatRupiah(totalBill)}`);
            lines.push('');

            orders.forEach((o, idx) => {
                const custName = o.customerName || 'Pelanggan';
                const invNo = o.invoiceNo;
                const typeText = o.orderType === 'dine_in' ? 'Dine In (Makan di Tempat)' : 'Take Away (PO)';
                lines.push(`${idx + 1}. 👤 *${custName}* • (${invNo})`);
                lines.push(`   🏷️ Tipe: ${typeText}`);
                if (o.orderType === 'take_away' && o.pickupDate) {
                    const methodText = o.pickupMethod === 'ojol' ? '🛵 Ojol' : (o.pickupMethod === 'delivery' ? '🚚 Diantar' : '🏪 Ambil di Toko');
                    lines.push(`   ⏰ Jadwal: ${o.pickupDate} ${o.pickupTime ? `(${o.pickupTime})` : ''} • ${methodText}`);
                }
                lines.push(`   💰 Total: *${formatRupiah(o.totalAmount)}*`);

                lines.push('   📋 Pesanan:');
                const items = o.items || [];
                if (items.length > 0) {
                    items.forEach(i => {
                        let displayName = i.name || i.baseName || 'Item';
                        if (i.baseName && i.variantName && !displayName.includes(i.variantName)) {
                            displayName = `${i.baseName} (${i.variantName})`;
                        }
                        lines.push(`   • ${i.qty}x ${displayName}`);
                    });
                } else {
                    lines.push('   • (Tidak ada item)');
                }

                if (o.notes) {
                    lines.push(`   📝 Catatan: ${o.notes}`);
                }
                lines.push(`   🏷️ Status Resi: ${o.resiPrintedAt ? 'Sudah Dicetak ✅' : 'Belum Cetak ⏳'}`);
                lines.push('');
            });

            lines.push('-------------------------------------------');
            lines.push('_DIASAP Smokehouse POS_');
        }

        const text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                if (typeof sounds !== 'undefined') sounds.playSuccess();
                if (typeof showPosToast === 'function') {
                    showPosToast(`📋 Rekap ${this.activeTab === 'po' ? 'Antrean PO' : 'Transaksi Diproses'} berhasil disalin!`, 3000);
                } else {
                    alert('📋 Rekap berhasil disalin ke clipboard!\nSilakan paste ke WhatsApp.');
                }
            }).catch(() => {
                prompt('Salin teks rekap berikut:', text);
            });
        } else {
            prompt('Salin teks rekap berikut:', text);
        }
    }

    // Perbarui status toolbar bulk
    updateBulkToolbar() {
        const count = this.selectedInvoices.size;
        const total = this.visibleOrders.length;
        const unprintedCount = this.visibleOrders.filter(o => !o.resiPrintedAt).length;
        
        const badge = document.getElementById('bulkBadgeSelected');
        const countEl = document.getElementById('bulkCountSelected');
        const totalEl = document.getElementById('bulkTotalVisibleCount');
        const unprintedEl = document.getElementById('bulkUnprintedCount');
        const btnSelectUnprinted = document.getElementById('btnSelectUnprinted');
        const btnPdf = document.getElementById('btnBulkPdf');
        const btnPrint = document.getElementById('btnBulkPrint');
        const btnCancel = document.getElementById('btnBulkCancel');
        const allCb = document.getElementById('bulkSelectAllCheckbox');

        if (totalEl) totalEl.textContent = total;
        if (countEl) countEl.textContent = count;
        if (unprintedEl) unprintedEl.textContent = unprintedCount;
        
        if (btnSelectUnprinted) btnSelectUnprinted.style.display = unprintedCount > 0 ? 'inline-flex' : 'none';
        if (badge) badge.style.display = count > 0 ? 'inline-block' : 'none';
        if (btnCancel) btnCancel.style.display = count > 0 ? 'inline-flex' : 'none';
        if (btnPdf) btnPdf.disabled = count === 0;
        if (btnPrint) btnPrint.disabled = count === 0;

        if (allCb) {
            allCb.checked = (total > 0 && count >= total);
            allCb.indeterminate = (count > 0 && count < total);
        }
        document.querySelectorAll('.order-select-all-head').forEach(cb => {
            cb.checked = (total > 0 && count >= total);
            cb.indeterminate = (count > 0 && count < total);
        });
    }

    // Unduh resi 58mm untuk satu pesanan spesifik
    async printSingleResi(invoiceNo) {
        this.selectedInvoices.clear();
        this.selectedInvoices.add(invoiceNo);
        this.updateBulkToolbar();
        await this.downloadBulkPdf();
    }

    // Format HTML Resi Struk Ukuran Label 58mm (Printer Label Compliant: No Emoji, 2 Font Sizes, Prominent Notes)
    generateResi58mmHtml(order) {
        const storeName = (typeof CONFIG !== 'undefined' && CONFIG.STORE_NAME) ? CONFIG.STORE_NAME : 'DIASAP';
        const storeAddress = (typeof CONFIG !== 'undefined' && CONFIG.STORE_ADDRESS) ? CONFIG.STORE_ADDRESS : '';
        const storePhone = (typeof CONFIG !== 'undefined' && CONFIG.STORE_PHONE) ? CONFIG.STORE_PHONE : '';
        
        let pickupMethodText = 'Ambil di Toko';
        if (order.pickupMethod === 'ojol') {
            pickupMethodText = 'Ojol / Kurir' + (order.pickupAddress && !order.pickupAddress.includes('\n') ? ` (${order.pickupAddress})` : '');
        } else if (order.pickupMethod === 'delivery') {
            pickupMethodText = 'Diantar Toko';
        }

        const paymentMethod = (order.paymentMethod || 'cash').toUpperCase();
        const isPaid = order.status !== 'unpaid';

        const items = order.items || [];
        const itemsRows = items.map(i => {
            // Cegah duplikasi nama varian (misal AYAM KILOAN (Paha) (Paha))
            let displayName = i.name || i.baseName || 'Item';
            if (i.baseName && i.variantName && !displayName.includes(i.variantName)) {
                displayName = `${i.baseName} (${i.variantName})`;
            }
            return `
                <div class="resi-item-row resi-f-normal">
                    <span class="resi-item-qty"><strong>[ ${i.qty}x ]</strong></span>
                    <span class="resi-item-name">${displayName}</span>
                </div>
            `;
        }).join('');

        const notesHtml = order.notes ? `
            <div class="resi-notes-box">
                <div class="resi-notes-header">*** CATATAN KHUSUS ***</div>
                <div class="resi-notes-body">${order.notes}</div>
            </div>
        ` : '';

        return `
            <div class="resi-label-58mm">
                <div class="resi-header">
                    <div class="resi-title">${storeName}</div>
                    <div class="resi-subtitle">SMOKED MEAT & KITCHEN</div>
                    ${storeAddress ? `<div class="resi-f-normal">${storeAddress}</div>` : ''}
                    ${storePhone ? `<div class="resi-f-normal">WA: ${storePhone}</div>` : ''}
                    <div class="resi-tag">RESI / LABEL PACKING</div>
                </div>

                <div class="resi-divider">================================</div>

                <div class="resi-recipient-box">
                    <div class="resi-f-normal" style="font-weight: bold;">PENERIMA:</div>
                    <div class="resi-recipient-name">${order.customerName || 'Pelanggan'}</div>

                    <div class="resi-schedule-box">
                        <div class="resi-f-normal"><strong>JADWAL :</strong> ${order.pickupDate || '-'} ${order.pickupTime ? `(${order.pickupTime})` : ''}</div>
                        <div class="resi-f-normal"><strong>METODE :</strong> ${pickupMethodText}</div>
                        ${order.pickupAddress ? `<div class="resi-f-normal" style="margin-top: 2px;"><strong>ALAMAT :</strong> ${order.pickupAddress}</div>` : ''}
                    </div>

                    ${notesHtml}
                </div>

                <div class="resi-divider">--------------------------------</div>

                <div class="resi-items-section">
                    <div class="resi-section-title">DAFTAR PESANAN:</div>
                    ${itemsRows || '<div class="resi-f-normal">- Tidak ada item -</div>'}
                </div>

                <div class="resi-divider">--------------------------------</div>

                <div class="resi-meta-row resi-f-normal">
                    <span>No. Invoice:</span>
                    <strong>${order.invoiceNo}</strong>
                </div>
                <div class="resi-meta-row resi-f-normal">
                    <span>Status Bayar:</span>
                    <strong>${isPaid ? `LUNAS (${paymentMethod})` : 'BELUM BAYAR'}</strong>
                </div>
                ${order.deliveryFee > 0 ? `
                    <div class="resi-meta-row resi-f-normal">
                        <span>Biaya Ongkir:</span>
                        <span>${formatRupiah(order.deliveryFee)}</span>
                    </div>
                ` : ''}
                <div class="resi-total-line">
                    <span>TOTAL:</span>
                    <span>${formatRupiah(order.totalAmount)}</span>
                </div>
                <div class="resi-meta-row resi-f-normal" style="margin-top: 3px;">
                    <span>Waktu Order:</span>
                    <span>${formatDateTime(order.createdAt)}</span>
                </div>

                <div class="resi-divider">================================</div>

                <div class="resi-footer resi-f-normal">
                    <div>Simpan di chiller jika belum dikonsumsi.</div>
                    <div style="font-weight: bold; margin-top: 2px;">Terima Kasih! - diasap.resto</div>
                </div>
            </div>
        `;
    }

    // Unduh file PDF berisi kumpulan resi 58mm terpilih
    async downloadBulkPdf() {
        if (this.selectedInvoices.size === 0) {
            alert('Pilih minimal 1 pesanan terlebih dahulu.');
            return;
        }

        if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
            alert('Pustaka renderer PDF sedang dimuat, silakan coba sesaat lagi.');
            return;
        }

        const activeOrders = await db.getActiveOrders();
        const historyOrders = (this.selectedInvoices.size > activeOrders.length) 
            ? await db.getOrdersHistory(300) 
            : [];
        const allOrders = [...activeOrders, ...historyOrders];
        
        const selectedOrders = [];
        for (const inv of this.selectedInvoices) {
            const o = allOrders.find(item => item.invoiceNo === inv);
            if (o && !selectedOrders.some(x => x.invoiceNo === inv)) {
                selectedOrders.push(o);
            }
        }

        if (selectedOrders.length === 0) {
            alert('Tidak ada data pesanan yang valid untuk dicetak.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const renderBox = document.getElementById('bulkRenderContainer');
        if (!renderBox) return;

        if (typeof showPosToast === 'function') {
            showPosToast(`⏳ Sedang membuat PDF Resi 58mm (${selectedOrders.length} pesanan)...`, 4000);
        }

        try {
            let pdf = null;
            for (let i = 0; i < selectedOrders.length; i++) {
                const order = selectedOrders[i];
                renderBox.innerHTML = this.generateResi58mmHtml(order);

                // Tunggu sebentar agar font dirender
                await new Promise(resolve => setTimeout(resolve, 80));

                const canvas = await html2canvas(renderBox.firstElementChild, {
                    scale: 3,
                    backgroundColor: '#ffffff',
                    useCORS: true,
                    logging: false
                });

                // Binarization: snap every pixel to pure black or pure white (eliminates thermal dotted dithering)
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const imgDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const d = imgDataObj.data;
                    for (let p = 0; p < d.length; p += 4) {
                        const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
                        const val = lum < 215 ? 0 : 255;
                        d[p] = val;
                        d[p + 1] = val;
                        d[p + 2] = val;
                        d[p + 3] = 255;
                    }
                    ctx.putImageData(imgDataObj, 0, 0);
                }

                const imgData = canvas.toDataURL('image/png');
                const contentWidthMm = 48; // 58mm label width with exactly 5mm margin on both sides (58 - 5 - 5 = 48mm)
                const imgHeightMm = (canvas.height * contentWidthMm) / canvas.width;
                const pageHeightMm = imgHeightMm + 10; // Exactly 5mm top + 5mm bottom margin

                if (i === 0) {
                    pdf = new jsPDF({
                        orientation: 'portrait',
                        unit: 'mm',
                        format: [58, pageHeightMm]
                    });
                } else {
                    pdf.addPage([58, pageHeightMm], 'portrait');
                }

                pdf.addImage(imgData, 'PNG', 5, 5, contentWidthMm, imgHeightMm);
            }

            renderBox.innerHTML = '';
            const dateStr = new Date().toISOString().slice(0, 10);
            const timeStr = Date.now().toString().slice(-4);
            const filename = `Resi_DIASAP_58mm_${dateStr}_${timeStr}.pdf`;
            pdf.save(filename);

            const invoiceList = Array.from(this.selectedInvoices);
            await db.markMultipleResiPrinted(invoiceList);
            await this.render();
            if (typeof renderHistoryTable === 'function') renderHistoryTable();

            if (typeof showPosToast === 'function') {
                showPosToast(`✅ Berhasil mengunduh PDF resi bulk (${selectedOrders.length} label 58mm)!`, 3500);
            }
            if (typeof sounds !== 'undefined') sounds.playSuccess();
        } catch (err) {
            console.error('Gagal generate bulk PDF:', err);
            alert('Terjadi kesalahan saat membuat PDF: ' + err.message);
        }
    }

    // Cetak langsung seluruh label 58mm terpilih ke printer thermal
    async printBulkLabels() {
        if (this.selectedInvoices.size === 0) {
            alert('Pilih minimal 1 pesanan terlebih dahulu.');
            return;
        }

        const activeOrders = await db.getActiveOrders();
        const historyOrders = (this.selectedInvoices.size > activeOrders.length) 
            ? await db.getOrdersHistory(300) 
            : [];
        const allOrders = [...activeOrders, ...historyOrders];
        
        const selectedOrders = [];
        for (const inv of this.selectedInvoices) {
            const o = allOrders.find(item => item.invoiceNo === inv);
            if (o && !selectedOrders.some(x => x.invoiceNo === inv)) {
                selectedOrders.push(o);
            }
        }

        if (selectedOrders.length === 0) return;

        const printArea = document.getElementById('bulkPrintArea');
        if (!printArea) return;

        printArea.innerHTML = selectedOrders.map(order => `
            <div class="resi-58mm-print-page">
                ${this.generateResi58mmHtml(order)}
            </div>
        `).join('');

        document.body.classList.add('printing-58mm-bulk');
        if (typeof sounds !== 'undefined') sounds.playBeep();

        const invoiceList = Array.from(this.selectedInvoices);
        setTimeout(async () => {
            window.print();
            await db.markMultipleResiPrinted(invoiceList);
            await this.render();
            if (typeof renderHistoryTable === 'function') renderHistoryTable();
            setTimeout(() => {
                document.body.classList.remove('printing-58mm-bulk');
                printArea.innerHTML = '';
            }, 1000);
        }, 200);
    }

    async proceedPayment(invoiceNo) {
        const orders = await db.getOrdersHistory(300);
        const order = orders.find(o => o.invoiceNo === invoiceNo);
        if (!order) return;
        cartManager.loadOrderToCart(order);
        this.closeModal();
        paymentManager.proceedToPayment();
    }

    async editOrder(invoiceNo) {
        const orders = await db.getOrdersHistory(300);
        const order = orders.find(o => o.invoiceNo === invoiceNo);
        if (!order) return;
        cartManager.loadOrderToCart(order);
        this.closeModal();
    }

    async printBillForOrder(invoiceNo) {
        const orders = await db.getOrdersHistory(300);
        const order = orders.find(o => o.invoiceNo === invoiceNo);
        if (!order) return;
        cartManager.loadOrderToCart(order);
        paymentManager.showBillModal();
    }

    async cancelOrder(invoiceNo) {
        if (confirm(`Yakin ingin membatalkan dan menghapus tagihan sementara ${invoiceNo}?`)) {
            await db.deletePendingOrder(invoiceNo);
            if (typeof sounds !== 'undefined') sounds.playSuccess();
            await this.render();
            await this.refreshBadge();
            const historyModal = document.getElementById('historyModal');
            if (historyModal && historyModal.classList.contains('active')) {
                await renderHistoryData();
            }
        }
    }

    async markPickedUp(invoiceNo) {
        if (confirm(`Tandai pesanan ${invoiceNo} sebagai SUDAH DIAMBIL / SELESAI?`)) {
            await db.updateOrderStatus(invoiceNo, 'completed', { pickedUpAt: new Date().toISOString() });
            if (typeof sounds !== 'undefined') sounds.playSuccess();
            await this.render();
            await this.refreshBadge();
            const historyModal = document.getElementById('historyModal');
            if (historyModal && historyModal.classList.contains('active')) {
                await renderHistoryData();
            }
        }
    }
}

window.activeOrdersManager = new ActiveOrdersManager();
const activeOrdersManager = window.activeOrdersManager;
