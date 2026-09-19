/**
 * DIASAP POS - Authentication & Lock Screen Manager
 * Mengamankan akses webapp dengan password (syalala123)
 * Mendukung verifikasi serverless Vercel (/api/auth) dan offline fallback
 */

class AuthManager {
    constructor() {
        this.storageKey = 'diasap_auth_token';
        this.fallbackPassword = 'syalala123';
        this.isAuthenticated = false;
    }

    init() {
        // Cek apakah kasir sudah login pada sesi ini
        const savedToken = sessionStorage.getItem(this.storageKey);
        if (savedToken) {
            this.unlockApp(false);
        } else {
            this.lockApp();
        }

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
                toggleBtn.textContent = isPass ? '🙈' : '👁️';
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
}

const authManager = new AuthManager();
