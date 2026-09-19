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

    // Cek koneksi awal
    await db.checkConnection();

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
    const totalCogsEl = document.getElementById('rekapTotalCogs');
    const profitNominalEl = document.getElementById('rekapProfitNominal');
    const profitMarginEl = document.getElementById('rekapProfitMargin');
    const totalOrdersEl = document.getElementById('rekapTotalOrders');
    const avgOrderEl = document.getElementById('rekapAvgOrder');
    const cashTotalEl = document.getElementById('rekapCashTotal');
    const qrisTotalEl = document.getElementById('rekapQrisTotal');

    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px;">Memuat data riwayat...</td></tr>`;
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

    orders.forEach(o => {
        if (o.isVoid) {
            voidOrdersCount++;
            return; // Transaksi void tidak dihitung ke omset
        }
        activeOrdersCount++;
        const val = Number(o.totalAmount) || 0;
        totalRevenue += val;
        totalCogs += calculateOrderCogs(o);
        if (o.paymentMethod === 'cash') cashRevenue += val;
        else if (o.paymentMethod === 'qris') qrisRevenue += val;
    });

    const totalProfit = totalRevenue - totalCogs;
    const overallMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;
    const avgOrder = activeOrdersCount > 0 ? Math.round(totalRevenue / activeOrdersCount) : 0;

    if (totalRevenueEl) totalRevenueEl.textContent = formatRupiah(totalRevenue);
    if (totalCogsEl) totalCogsEl.textContent = formatRupiah(totalCogs);
    if (profitNominalEl) profitNominalEl.textContent = formatRupiah(totalProfit);
    if (profitMarginEl) {
        profitMarginEl.textContent = `${overallMargin}% Margin`;
        profitMarginEl.className = `margin-pill ${overallMargin >= 30 ? 'positive' : (overallMargin >= 0 ? 'warning' : 'danger')}`;
    }
    if (totalOrdersEl) {
        totalOrdersEl.textContent = voidOrdersCount > 0
            ? `${activeOrdersCount} Sukses (${voidOrdersCount} Void)`
            : `${activeOrdersCount} Transaksi`;
    }
    if (avgOrderEl) avgOrderEl.textContent = formatRupiah(avgOrder);
    if (cashTotalEl) cashTotalEl.textContent = formatRupiah(cashRevenue);
    if (qrisTotalEl) qrisTotalEl.textContent = formatRupiah(qrisRevenue);

    // Render Grafik Sederhana Penjualan
    renderHistoryChart(orders);

    if (!tableBody) return;

    if (orders.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 36px 20px; color: #95a5a6;">Tidak ada transaksi pada periode yang dipilih.</td></tr>`;
        return;
    }

    tableBody.innerHTML = orders.map((o, idx) => {
        const isVoid = Boolean(o.isVoid);
        const orderCogs = calculateOrderCogs(o);
        const orderRevenue = Number(o.totalAmount) || 0;
        const orderProfit = orderRevenue - orderCogs;
        const orderMargin = orderRevenue > 0 ? Math.round((orderProfit / orderRevenue) * 100) : 0;
        const cashierName = o.cashierName || 'Kasir';
        const finalDiscount = Number(o.finalDiscountAmount) || 0;

        const itemsSummary = (o.items && o.items.length > 0)
            ? o.items.map(i => `${i.name} (x${i.qty})`).join(', ')
            : '-';

        return `
            <tr class="${isVoid ? 'row-voided' : ''}">
                <td style="text-align: center; color: #64748B;">${idx + 1}</td>
                <td>
                    <strong>${o.invoiceNo}</strong>
                    ${isVoid ? '<div class="tag-void-mini">VOID</div>' : ''}
                    <div style="font-size: 11px; color: #64748B; margin-top: 2px;">Kasir: <strong>${cashierName}</strong></div>
                </td>
                <td style="white-space: nowrap;">${formatDateTime(o.createdAt)}</td>
                <td>
                    <div><strong>${o.customerName || 'Pelanggan'}</strong></div>
                    <span class="order-badge">${o.orderType === 'dine_in' ? 'Dine In' : 'Take Away'}</span>
                </td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${itemsSummary}">${itemsSummary}</td>
                <td><span class="badge-method badge-${o.paymentMethod}">${(o.paymentMethod || 'cash').toUpperCase()}</span></td>
                <td><span class="badge-cogs ${isVoid ? 'text-strikethrough' : ''}">${formatRupiah(orderCogs)}</span></td>
                <td>
                    <strong class="${isVoid ? 'text-strikethrough' : ''}">${formatRupiah(orderRevenue)}</strong>
                    ${finalDiscount > 0 ? `<div style="font-size: 10px; color: #C0392B;">(Disc: -${formatRupiah(finalDiscount)})</div>` : ''}
                </td>
                <td>
                    ${isVoid ? `
                        <span style="color: #94A3B8; font-size: 11px; font-style: italic;">Dibatalkan</span>
                    ` : `
                        <span class="badge-profit ${orderProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                            ${orderProfit >= 0 ? '+' : ''}${formatRupiah(orderProfit)}
                        </span>
                        <span class="margin-pill ${orderMargin >= 30 ? 'positive' : 'warning'}" style="font-size: 10px; margin-left: 4px;">
                            ${orderMargin}%
                        </span>
                    `}
                </td>
                <td style="text-align: center;">
                    <div class="table-action-btns-row">
                        <button type="button" class="btn-table-reprint" onclick="reprintOrder('${o.invoiceNo}')" title="Cetak Ulang / Bagikan Struk">
                            🖨️ Struk
                        </button>
                        ${isVoid ? `
                            <div class="void-status-cell">
                                <span class="badge-void">VOID</span>
                            </div>
                        ` : `
                            <button type="button" class="btn-table-void" onclick="openVoidModal('${o.invoiceNo}')" title="Batalkan Transaksi (Void)">
                                ⚠️ Void
                            </button>
                        `}
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

    const activeOrders = orders.filter(o => !o.isVoid);

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
        dayMap[dateKey].omset += rev;
        dayMap[dateKey].profit += (rev - orderCogs);
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
    const orders = await db.getOrdersHistory(500);
    if (orders.length === 0) {
        alert('Tidak ada data transaksi untuk diekspor.');
        return;
    }

    const calculateOrderCogs = (order) => {
        let orderCogs = 0;
        if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
                let itemCogs = Number(item.cogsLocked) || 0;
                if (itemCogs === 0 && item.id) {
                    const p = (typeof productManager !== 'undefined') ? productManager.getProductById(item.id) : null;
                    if (p) itemCogs = Number(p.cogs) || 0;
                }
                orderCogs += itemCogs * (Number(item.qty) || 1);
            });
        }
        return orderCogs;
    };

    const header = [
        'No', 'No Invoice', 'Waktu', 'Kasir', 'Pelanggan',
        'Layanan', 'Metode Bayar', 'Status Transaksi', 'Dibatalkan Oleh', 'Alasan Void',
        'Subtotal (Rp)', 'Diskon Final (Rp)', 'Total Omset (Rp)', 'Total Modal (HPP)', 'Untung Bersih (Rp)',
        'Margin %', 'Bayar Diterima (Rp)', 'Kembalian (Rp)', 'Catatan'
    ];

    const dataRows = [header];

    let sumOmset = 0;
    let sumCogs = 0;
    let sumProfit = 0;

    orders.forEach((o, idx) => {
        const isVoid = Boolean(o.isVoid);
        const rev = isVoid ? 0 : (Number(o.totalAmount) || 0);
        const cogs = isVoid ? 0 : calculateOrderCogs(o);
        const profit = rev - cogs;
        const marginPct = rev > 0 ? Number(((profit / rev) * 100).toFixed(1)) : 0;
        const subtotal = Number(o.subtotalAmount) || rev;
        const finalDiscount = Number(o.finalDiscountAmount) || 0;

        if (!isVoid) {
            sumOmset += rev;
            sumCogs += cogs;
            sumProfit += profit;
        }

        dataRows.push([
            idx + 1,
            o.invoiceNo,
            formatDateTime(o.createdAt),
            o.cashierName || 'Kasir',
            o.customerName || 'Pelanggan',
            o.orderType === 'dine_in' ? 'Dine In' : 'Take Away',
            (o.paymentMethod || 'cash').toUpperCase(),
            isVoid ? 'VOID / DIBATALKAN' : 'SUKSES',
            o.voidBy || '',
            o.voidReason || '',
            subtotal,
            finalDiscount,
            rev,
            cogs,
            profit,
            `${marginPct}%`,
            Number(o.cashReceived) || 0,
            Number(o.changeAmount) || 0,
            o.notes || ''
        ]);
    });

    // Baris Total Akumulasi
    dataRows.push([]);
    dataRows.push([
        '', '', '', '', '', '', '', 'TOTAL AKUMULASI:', '', '',
        '', '', sumOmset, sumCogs, sumProfit,
        sumOmset > 0 ? `${((sumProfit / sumOmset) * 100).toFixed(1)}%` : '0%',
        '', '', ''
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `DIASAP_Rekap_Penjualan_${dateStr}.xlsx`;

    // Gunakan SheetJS jika tersedia
    if (typeof XLSX !== 'undefined') {
        const ws = XLSX.utils.aoa_to_sheet(dataRows);

        ws['!cols'] = [
            { wch: 5 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 18 },
            { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 15 }, { wch: 22 },
            { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
            { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 25 }
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
