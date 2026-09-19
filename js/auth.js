/**
 * DIASAP POS - Authentication & Lock Screen Manager
 * Mengamankan akses webapp dengan password (syalala123)
 * Mendukung verifikasi serverless Vercel (/api/auth) dan offline fallback
 */

class AuthManager {
    constructor() {
        this.storageKey = 'diasap_auth_token';
        this.storageKeyCashier = 'diasap_active_cashier';
        this.fallbackPassword = 'syalala123';
        this.isAuthenticated = false;
        this.activeCashier = sessionStorage.getItem(this.storageKeyCashier) || 'Ayu';
        this.cashierList = ['Ayu', 'Dina', 'Nining'];
    }

    init() {
        // Cek apakah kasir sudah login pada sesi ini
        const savedToken = sessionStorage.getItem(this.storageKey);
        const savedCashier = sessionStorage.getItem(this.storageKeyCashier);
        if (savedCashier) {
            this.activeCashier = savedCashier;
        }

        if (savedToken) {
            this.unlockApp(false);
        } else {
            this.lockApp();
        }

        this.updateActiveCashierBadge();
        this.setupListeners();
    }

    setupListeners() {
        const form = document.getElementById('lockScreenForm');
        const passInput = document.getElementById('lockPasswordInput');
        const toggleBtn = document.getElementById('toggleShowPassBtn');

        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        if (toggleBtn && passInput) {
            toggleBtn.addEventListener('click', () => {
                const isPass = passInput.type === 'password';
                passInput.type = isPass ? 'text' : 'password';
                toggleBtn.innerHTML = isPass ? `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                ` : `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                `;
            });
        }
    }

    async handleLogin() {
        const input = document.getElementById('lockPasswordInput');
        const submitBtn = document.getElementById('lockSubmitBtn');
        const errorEl = document.getElementById('lockErrorMessage');
        const card = document.getElementById('lockCard');

        if (!input) return;
        const enteredPassword = input.value.trim();

        if (!enteredPassword) {
            this.showError('Silakan masukkan password.');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Memverifikasi...';
        }
        if (errorEl) errorEl.style.display = 'none';

        let authorized = false;

        // 1. Coba verifikasi ke Vercel Serverless Endpoint /api/auth
        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: enteredPassword })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    authorized = true;
                    sessionStorage.setItem(this.storageKey, data.token || 'auth_verified');
                }
            } else if (response.status === 401) {
                authorized = false;
            } else {
                // Fallback jika bukan 401 (misal endpoint tidak ada saat mode file:///)
                authorized = (enteredPassword === this.fallbackPassword);
            }
        } catch (e) {
            // Fallback offline / local file:/// protocol
            authorized = (enteredPassword === this.fallbackPassword);
        }

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Buka Kunci Akses';
        }

        if (authorized) {
            const cashierSelect = document.getElementById('lockCashierSelect');
            if (cashierSelect && cashierSelect.value) {
                this.activeCashier = cashierSelect.value;
                sessionStorage.setItem(this.storageKeyCashier, this.activeCashier);
            }
            this.updateActiveCashierBadge();

            sessionStorage.setItem(this.storageKey, 'dsp_auth_' + Date.now());
            sounds.playSuccess();
            this.unlockApp(true);
            input.value = '';
        } else {
            sounds.playWarning();
            this.showError('Password salah! Silakan coba lagi.');
            if (card) {
                card.classList.remove('shake-animation');
                void card.offsetWidth; // trigger reflow
                card.classList.add('shake-animation');
            }
            input.focus();
            input.select();
        }
    }

    showError(msg) {
        const errorEl = document.getElementById('lockErrorMessage');
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
        }
    }

    unlockApp(animate = true) {
        this.isAuthenticated = true;
        const lockOverlay = document.getElementById('lockScreenOverlay');
        if (lockOverlay) {
            if (animate) {
                lockOverlay.classList.add('lock-fade-out');
                setTimeout(() => {
                    lockOverlay.style.display = 'none';
                    lockOverlay.classList.remove('lock-fade-out');
                }, 300);
            } else {
                lockOverlay.style.display = 'none';
            }
        }
    }

    lockApp() {
        this.isAuthenticated = false;
        sessionStorage.removeItem(this.storageKey);
        const lockOverlay = document.getElementById('lockScreenOverlay');
        const input = document.getElementById('lockPasswordInput');
        const errorEl = document.getElementById('lockErrorMessage');

        if (errorEl) errorEl.style.display = 'none';
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }

        if (lockOverlay) {
            lockOverlay.style.display = 'flex';
        }
    }

    // Verifikasi password untuk otorisasi tindakan sensitif (seperti Void Transaksi)
    async verifyPassword(password) {
        if (!password) return false;
        const trimmed = password.trim();

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: trimmed })
            });

            if (response.ok) {
                const data = await response.json();
                return data.success === true;
            } else if (response.status === 401) {
                return false;
            }
        } catch (e) {
            // Offline fallback
        }

        const fallback = (typeof CONFIG !== 'undefined' && CONFIG.APP_PASSWORD) ? CONFIG.APP_PASSWORD : this.fallbackPassword;
        return trimmed === fallback || trimmed === this.fallbackPassword;
    }

    // Ambil nama kasir aktif saat ini
    getActiveCashier() {
        return sessionStorage.getItem(this.storageKeyCashier) || this.activeCashier || 'Kasir';
    }

    // Update daftar kasir di elemen UI
    updateCashierList(list) {
        if (Array.isArray(list) && list.length > 0) {
            this.cashierList = list;
        }

        const select = document.getElementById('lockCashierSelect');
        if (select) {
            const currentVal = select.value || this.getActiveCashier();
            select.innerHTML = this.cashierList.map(name => `
                <option value="${name}" ${name === currentVal ? 'selected' : ''}>👤 Kasir: ${name}</option>
            `).join('');
        }

        // Update juga dropdown staf di modal void
        const voidAuthorSelect = document.getElementById('voidAuthorSelect');
        if (voidAuthorSelect) {
            const currentVal = voidAuthorSelect.value || this.getActiveCashier();
            voidAuthorSelect.innerHTML = `
                <option value="">-- Pilih Nama Kasir --</option>
                ${this.cashierList.map(name => `
                    <option value="${name}" ${name === currentVal ? 'selected' : ''}>${name}</option>
                `).join('')}
            `;
        }
    }

    // Update tampilan lencana kasir di header
    updateActiveCashierBadge() {
        const badge = document.getElementById('activeCashierBadge');
        const nameEl = document.getElementById('activeCashierName');
        const current = this.getActiveCashier();
        if (nameEl) {
            nameEl.textContent = current;
        }
        if (badge) {
            badge.title = `Kasir bertugas: ${current}. Klik untuk ganti kasir / kunci.`;
        }
    }
}

const authManager = new AuthManager();
