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

    // 3. Render Keranjang Awal
    cartManager.render();
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
});

// ================= MODAL RIWAYAT & REKAP TRANSAKSI =================

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
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px;">Memuat data riwayat...</td></tr>`;
    }

    const orders = await db.getOrdersHistory(100);

    let totalRevenue = 0;
    let totalCogs = 0;
    let cashRevenue = 0;
    let qrisRevenue = 0;

    // Helper untuk kalkulasi HPP / COGS pesanan
    const calculateOrderCogs = (order) => {
        let orderCogs = 0;
        if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
                let itemCogs = Number(item.cogsLocked) || 0;
                // Fallback untuk transaksi lampau yang belum tercatat cogs_locked di order_items
                if (itemCogs === 0 && item.id) {
                    const p = productManager.getProductById(item.id);
                    if (p) itemCogs = Number(p.cogs) || 0;
                }
                orderCogs += itemCogs * (Number(item.qty) || 1);
            });
        }
        return orderCogs;
    };

    orders.forEach(o => {
        const val = Number(o.totalAmount) || 0;
        totalRevenue += val;
        totalCogs += calculateOrderCogs(o);
        if (o.paymentMethod === 'cash') cashRevenue += val;
        else if (o.paymentMethod === 'qris') qrisRevenue += val;
    });

    const totalProfit = totalRevenue - totalCogs;
    const overallMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;
    const avgOrder = orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0;

    if (totalRevenueEl) totalRevenueEl.textContent = formatRupiah(totalRevenue);
    if (totalCogsEl) totalCogsEl.textContent = formatRupiah(totalCogs);
    if (profitNominalEl) profitNominalEl.textContent = formatRupiah(totalProfit);
    if (profitMarginEl) {
        profitMarginEl.textContent = `${overallMargin}% Margin`;
        profitMarginEl.className = `margin-pill ${overallMargin >= 30 ? 'positive' : (overallMargin >= 0 ? 'warning' : 'danger')}`;
    }
    if (totalOrdersEl) totalOrdersEl.textContent = `${orders.length} Transaksi`;
    if (avgOrderEl) avgOrderEl.textContent = formatRupiah(avgOrder);
    if (cashTotalEl) cashTotalEl.textContent = formatRupiah(cashRevenue);
    if (qrisTotalEl) qrisTotalEl.textContent = formatRupiah(qrisRevenue);

    if (!tableBody) return;

    if (orders.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: #95a5a6;">Belum ada transaksi tercatat.</td></tr>`;
        return;
    }

    tableBody.innerHTML = orders.map((o, idx) => {
        const orderCogs = calculateOrderCogs(o);
        const orderRevenue = Number(o.totalAmount) || 0;
        const orderProfit = orderRevenue - orderCogs;
        const orderMargin = orderRevenue > 0 ? Math.round((orderProfit / orderRevenue) * 100) : 0;

        const itemsSummary = (o.items && o.items.length > 0)
            ? o.items.map(i => `${i.name} (x${i.qty})`).join(', ')
            : '-';

        return `
            <tr>
                <td>${idx + 1}</td>
                <td><strong>${o.invoiceNo}</strong></td>
                <td>${formatDateTime(o.createdAt)}</td>
                <td>${o.customerName || 'Pelanggan'} <span class="order-badge">${o.orderType === 'dine_in' ? 'Dine In' : 'Take Away'}</span></td>
                <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${itemsSummary}">${itemsSummary}</td>
                <td><span class="badge-method badge-${o.paymentMethod}">${o.paymentMethod.toUpperCase()}</span></td>
                <td><span class="badge-cogs">${formatRupiah(orderCogs)}</span></td>
                <td><strong>${formatRupiah(orderRevenue)}</strong></td>
                <td>
                    <span class="badge-profit ${orderProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                        ${orderProfit >= 0 ? '+' : ''}${formatRupiah(orderProfit)}
                    </span>
                    <span class="margin-pill ${orderMargin >= 30 ? 'positive' : 'warning'}" style="font-size: 10px; margin-left: 4px;">
                        ${orderMargin}%
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

// Ekspor Riwayat ke Format CSV (Excel)
async function exportHistoryToCSV() {
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
                    const p = productManager.getProductById(item.id);
                    if (p) itemCogs = Number(p.cogs) || 0;
                }
                orderCogs += itemCogs * (Number(item.qty) || 1);
            });
        }
        return orderCogs;
    };

    const headers = ['No Invoice', 'Waktu', 'Nama Pelanggan', 'Tipe Pesanan', 'Metode Bayar', 'Total Omset', 'Total Modal (HPP)', 'Untung Bersih (Profit)', 'Margin %', 'Bayar Diterima', 'Kembalian', 'Catatan'];
    const rows = orders.map(o => {
        const orderRevenue = Number(o.totalAmount) || 0;
        const orderCogs = calculateOrderCogs(o);
        const orderProfit = orderRevenue - orderCogs;
        const marginPct = orderRevenue > 0 ? ((orderProfit / orderRevenue) * 100).toFixed(1) : '0';

        return [
            `"${o.invoiceNo}"`,
            `"${formatDateTime(o.createdAt)}"`,
            `"${(o.customerName || '').replace(/"/g, '""')}"`,
            `"${o.orderType}"`,
            `"${o.paymentMethod}"`,
            orderRevenue,
            orderCogs,
            orderProfit,
            `"${marginPct}%"`,
            o.cashReceived,
            o.changeAmount,
            `"${(o.notes || '').replace(/"/g, '""')}"`
        ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `diasap-rekap-transaksi-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
