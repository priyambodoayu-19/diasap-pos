/**
 * DIASAP POS - Store Settings & Cashier Management
 * Mengelola profil toko, favicon, rekening bank, gambar QRIS, teks struk, dan daftar kasir
 */

class SettingsManager {
    constructor() {
        this.settings = { ...CONFIG.DEFAULT_SETTINGS };
        this.activeTab = 'profile'; // 'profile' | 'bank' | 'cashiers'
    }

    async init() {
        await this.loadSettings();
        this.applySettingsToUI();
        this.setupEventListeners();
    }

    async loadSettings() {
        this.settings = await db.getStoreSettings();
        return this.settings;
    }

    applySettingsToUI() {
        if (!this.settings) return;

        // 1. Update Title & Favicon
        if (this.settings.storeName) {
            document.title = `🔥 ${this.settings.storeName} - Kasir & Manajemen Penjualan`;
        }

        // Favicon
        if (this.settings.storeFavicon) {
            this.updateFavicon(this.settings.storeFavicon);
        }

        // 2. Brand Section di Header
        const brandTitle = document.querySelector('.brand-text h1');
        const brandTagline = document.querySelector('.brand-text span');
        if (brandTitle && this.settings.storeName) {
            brandTitle.textContent = this.settings.storeName;
        }
        if (brandTagline && this.settings.storeTagline) {
            brandTagline.textContent = this.settings.storeTagline;
        }

        // 3. Konfigurasi Global Struk
        CONFIG.STORE_NAME = this.settings.storeName || CONFIG.STORE_NAME;
        CONFIG.STORE_ADDRESS = this.settings.storeAddress || CONFIG.STORE_ADDRESS;
        CONFIG.STORE_PHONE = this.settings.storePhone || CONFIG.STORE_PHONE;
        CONFIG.FOOTER_RECEIPT_NOTE = this.settings.receiptFooter || CONFIG.FOOTER_RECEIPT_NOTE;

        // 4. Update Dropdown Kasir di Lock Screen & Modal Void
        if (typeof authManager !== 'undefined') {
            authManager.updateCashierList(this.settings.cashiers || ['Ayu', 'Dina', 'Nining']);
        }

        // 5. Update QRIS & Bank Info di Checkout
        this.updateCheckoutPaymentInfo();
    }

    updateFavicon(faviconValue) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.getElementsByTagName('head')[0].appendChild(link);
        }

        if (faviconValue.startsWith('data:image') || faviconValue.startsWith('http')) {
            link.href = faviconValue;
        } else {
            // Jika emoji atau teks singkat, buat SVG Data URI favicon
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${faviconValue}</text></svg>`;
            link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        }
    }

    updateCheckoutPaymentInfo() {
        // Update tampilan QRIS di checkout kasir jika ada gambar
        const qrisBox = document.getElementById('qrisInfoGroup');
        if (qrisBox) {
            const mockQr = qrisBox.querySelector('.qris-code-mock');
            if (this.settings.qrisImage) {
                if (mockQr) {
                    mockQr.style.backgroundImage = `url(${this.settings.qrisImage})`;
                    mockQr.style.backgroundSize = 'contain';
                    mockQr.style.backgroundRepeat = 'no-repeat';
                    mockQr.style.backgroundPosition = 'center';
                }
            } else if (mockQr) {
                mockQr.style.backgroundImage = 'none';
            }
        }

        // Update tampilan info Transfer Bank jika metode transfer dipilih
        let transferBox = document.getElementById('transferInfoGroup');
        if (!transferBox) {
            transferBox = document.createElement('div');
            transferBox.id = 'transferInfoGroup';
            transferBox.className = 'transfer-info-box';
            transferBox.style.display = 'none';
            const payTabs = document.querySelector('.payment-methods-tabs');
            if (payTabs && payTabs.parentNode) {
                payTabs.parentNode.insertBefore(transferBox, document.getElementById('quickCashGroup'));
            }
        }

        if (transferBox) {
            transferBox.innerHTML = `
                <div class="bank-info-card">
                    <div style="font-size: 13px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">
                        🏦 Transfer Bank ${this.settings.bankName || 'BCA'}
                    </div>
                    <div style="font-size: 15px; font-weight: 800; color: var(--primary); letter-spacing: 0.5px;">
                        ${this.settings.bankAccountNo || '123-456-7890'}
                    </div>
                    <div style="font-size: 12px; color: #64748B;">
                        a.n. ${this.settings.bankAccountHolder || 'DIASAP RESTO'}
                    </div>
                </div>
            `;
        }
    }

    setupEventListeners() {
        // Tab Navigasi di Modal Pengaturan Toko
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setTab(btn.dataset.tab);
            });
        });

        // Form Submit
        const form = document.getElementById('storeSettingsForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSaveSettings();
            });
        }

        // Input File QRIS
        const qrisInput = document.getElementById('settingQrisFileInput');
        if (qrisInput) {
            qrisInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.handleQrisFileUpload(file);
            });
        }

        // Input Favicon File
        const favInput = document.getElementById('settingFaviconFileInput');
        if (favInput) {
            favInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.handleFaviconFileUpload(file);
            });
        }
    }

    setTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        document.querySelectorAll('.settings-tab-pane').forEach(pane => {
            pane.style.display = (pane.id === `settingsTab-${tab}`) ? 'block' : 'none';
        });
    }

    async openSettingsModal() {
        const modal = document.getElementById('storeSettingsModal');
        if (!modal) return;

        await this.loadSettings();
        this.populateForm();
        this.setTab('profile');
        modal.classList.add('active');
    }

    closeSettingsModal() {
        const modal = document.getElementById('storeSettingsModal');
        if (modal) modal.classList.remove('active');
    }

    populateForm() {
        const s = this.settings;

        const val = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = (v !== undefined && v !== null) ? v : '';
        };

        val('settingStoreName', s.storeName);
        val('settingStoreTagline', s.storeTagline);
        val('settingStoreFavicon', s.storeFavicon);
        val('settingStoreAddress', s.storeAddress);
        val('settingStorePhone', s.storePhone);
        val('settingReceiptHeader', s.receiptHeader);
        val('settingReceiptFooter', s.receiptFooter);

        val('settingBankName', s.bankName);
        val('settingBankAccountNo', s.bankAccountNo);
        val('settingBankAccountHolder', s.bankAccountHolder);

        this.renderQrisPreview();
        this.renderFaviconPreview();
        this.renderCashiersList();
    }

    renderFaviconPreview() {
        const preview = document.getElementById('settingFaviconPreview');
        const favVal = document.getElementById('settingStoreFavicon')?.value || this.settings.storeFavicon || '🔥';
        if (!preview) return;

        if (favVal.startsWith('data:image') || favVal.startsWith('http')) {
            preview.innerHTML = `<img src="${favVal}" style="width: 32px; height: 32px; object-fit: contain; border-radius: 4px;" alt="Favicon">`;
        } else {
            preview.innerHTML = `<span style="font-size: 28px;">${favVal}</span>`;
        }
    }

    renderQrisPreview() {
        const previewWrap = document.getElementById('settingQrisPreviewWrapper');
        const previewImg = document.getElementById('settingQrisPreviewImg');
        const emptyState = document.getElementById('settingQrisEmptyState');
        const removeBtn = document.getElementById('settingBtnRemoveQris');

        if (!previewWrap) return;

        if (this.settings.qrisImage) {
            if (previewImg) {
                previewImg.src = this.settings.qrisImage;
                previewImg.style.display = 'block';
            }
            if (emptyState) emptyState.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
        } else {
            if (previewImg) {
                previewImg.src = '';
                previewImg.style.display = 'none';
            }
            if (emptyState) emptyState.style.display = 'block';
            if (removeBtn) removeBtn.style.display = 'none';
        }
    }

    handleQrisFileUpload(file) {
        if (!file.type.startsWith('image/')) {
            alert('Silakan pilih file gambar (JPEG, PNG, WebP).');
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            alert('Ukuran gambar maksimal 2 MB agar tidak memperlambat database.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.settings.qrisImage = e.target.result;
            this.renderQrisPreview();
        };
        reader.readAsDataURL(file);
    }

    removeQrisImage() {
        this.settings.qrisImage = '';
        const input = document.getElementById('settingQrisFileInput');
        if (input) input.value = '';
        this.renderQrisPreview();
    }

    handleFaviconFileUpload(file) {
        if (!file.type.startsWith('image/')) {
            alert('Silakan pilih file gambar.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const input = document.getElementById('settingStoreFavicon');
            if (input) input.value = e.target.result;
            this.renderFaviconPreview();
        };
        reader.readAsDataURL(file);
    }

    // ================= MANAJEMEN DAFTAR KASIR =================

    renderCashiersList() {
        const container = document.getElementById('settingCashiersList');
        if (!container) return;

        const cashiers = this.settings.cashiers || ['Ayu', 'Dina', 'Nining'];

        if (cashiers.length === 0) {
            container.innerHTML = `<div style="color: #94A3B8; font-size: 13px; font-style: italic;">Belum ada nama kasir. Tambahkan nama kasir di bawah.</div>`;
            return;
        }

        container.innerHTML = cashiers.map((name, idx) => `
            <div class="cashier-tag-pill">
                <span class="cashier-avatar-badge">👤</span>
                <span class="cashier-name-text">${name}</span>
                <button type="button" class="btn-del-cashier" onclick="settingsManager.removeCashier(${idx})" title="Hapus nama kasir ini">
                    &times;
                </button>
            </div>
        `).join('');
    }

    addCashier() {
        const input = document.getElementById('settingNewCashierName');
        if (!input) return;

        const name = input.value.trim();
        if (!name) {
            alert('Nama kasir tidak boleh kosong!');
            input.focus();
            return;
        }

        if (!this.settings.cashiers) {
            this.settings.cashiers = [];
        }

        if (this.settings.cashiers.map(c => c.toLowerCase()).includes(name.toLowerCase())) {
            alert(`Nama kasir "${name}" sudah terdaftar.`);
            input.focus();
            return;
        }

        this.settings.cashiers.push(name);
        input.value = '';
        this.renderCashiersList();
    }

    removeCashier(index) {
        if (!this.settings.cashiers || !this.settings.cashiers[index]) return;

        if (this.settings.cashiers.length <= 1) {
            alert('Minimal harus ada 1 nama kasir yang terdaftar!');
            return;
        }

        const name = this.settings.cashiers[index];
        if (confirm(`Hapus kasir "${name}" dari daftar?`)) {
            this.settings.cashiers.splice(index, 1);
            this.renderCashiersList();
        }
    }

    // ================= SIMPAN PENGATURAN TOKO =================

    async handleSaveSettings() {
        const val = (id) => document.getElementById(id)?.value?.trim() || '';

        const newSettings = {
            ...this.settings,
            storeName: val('settingStoreName') || 'DIASAP POS',
            storeTagline: val('settingStoreTagline') || 'Smoked Meat & Kitchen',
            storeFavicon: val('settingStoreFavicon') || '🔥',
            storeAddress: val('settingStoreAddress'),
            storePhone: val('settingStorePhone'),
            receiptHeader: val('settingReceiptHeader'),
            receiptFooter: val('settingReceiptFooter'),
            bankName: val('settingBankName') || 'BCA',
            bankAccountNo: val('settingBankAccountNo'),
            bankAccountHolder: val('settingBankAccountHolder'),
            cashiers: (this.settings.cashiers && this.settings.cashiers.length > 0) 
                ? this.settings.cashiers 
                : ['Ayu', 'Dina', 'Nining']
        };

        const submitBtn = document.getElementById('settingBtnSave');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan Pengaturan...';
        }

        try {
            await db.saveStoreSettings(newSettings);
            this.settings = newSettings;
            this.applySettingsToUI();
            this.closeSettingsModal();

            if (typeof adminManager !== 'undefined' && adminManager.showToast) {
                adminManager.showToast('Pengaturan toko berhasil diperbarui!');
            } else {
                alert('Pengaturan toko berhasil disimpan!');
            }
            sounds.playSuccess();
        } catch (err) {
            console.error(err);
            sounds.playWarning();
            alert('Gagal menyimpan pengaturan: ' + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Simpan Pengaturan Toko';
            }
        }
    }
}

const settingsManager = new SettingsManager();
