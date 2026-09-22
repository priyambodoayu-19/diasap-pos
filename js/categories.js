/**
 * DIASAP POS - Dynamic Category Management
 * Mengelola kategori menu secara dinamis: tambah kategori baru, hapus kategori,
 * update dropdown di form produk, serta sinkronisasi pills kategori di POS & Admin Panel.
 */

class CategoryManager {
    constructor() {
        this.storageKey = 'diasap_custom_categories';
        this.categories = [];
        this.defaultCategories = [
            { id: 'makanan', name: 'Makanan / Paket', icon: '🍗' },
            { id: 'minuman', name: 'Minuman', icon: '🍹' },
            { id: 'tambahan', name: 'Tambahan', icon: '🍚' }
        ];
    }

    async init() {
        await this.loadCategories();
        this.renderAll();
    }

    async loadCategories() {
        try {
            // 1. Coba ambil dari database store_settings jika ada
            if (typeof db !== 'undefined' && db.getStoreSettings) {
                const settings = await db.getStoreSettings();
                if (settings && Array.isArray(settings.categories) && settings.categories.length > 0) {
                    this.categories = settings.categories;
                    localStorage.setItem(this.storageKey, JSON.stringify(this.categories));
                    return this.categories;
                }
            }
        } catch (e) {
            console.warn('Gagal memuat kategori dari DB, fallback cache lokal:', e);
        }

        // 2. Fallback ke localStorage
        const cached = localStorage.getItem(this.storageKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.categories = parsed;
                    return this.categories;
                }
            } catch (e) {}
        }

        // 3. Fallback ke default
        this.categories = [...this.defaultCategories];
        localStorage.setItem(this.storageKey, JSON.stringify(this.categories));
        return this.categories;
    }

    async saveCategories() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.categories));
        
        // Simpan ke Neon DB store_settings (key: categories)
        try {
            if (typeof db !== 'undefined' && db.saveStoreSettings) {
                await db.saveStoreSettings({ categories: this.categories });
            }
        } catch (e) {
            console.warn('Gagal menyimpan kategori ke Neon DB:', e);
        }

        this.renderAll();
    }

    getCategories() {
        return this.categories && this.categories.length > 0 ? this.categories : this.defaultCategories;
    }

    getCategoryById(id) {
        return this.getCategories().find(c => c.id === id) || { id, name: id, icon: '🍽️' };
    }

    // Tambah Kategori Baru
    async addCategory(name, icon = '🍽️') {
        const cleanName = (name || '').trim();
        if (!cleanName) {
            alert('Nama kategori tidak boleh kosong!');
            return false;
        }

        // Generate slug ID unik
        let baseSlug = cleanName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!baseSlug) baseSlug = 'cat_' + Date.now();

        let uniqueId = baseSlug;
        let counter = 1;
        while (this.categories.some(c => c.id === uniqueId)) {
            uniqueId = `${baseSlug}_${counter++}`;
        }

        const newCat = {
            id: uniqueId,
            name: cleanName,
            icon: (icon || '🍽️').trim()
        };

        this.categories.push(newCat);
        await this.saveCategories();

        if (typeof sounds !== 'undefined') sounds.playSuccess();
        if (typeof showPosToast === 'function') {
            showPosToast(`✅ Kategori "${cleanName}" berhasil ditambahkan!`, 3000);
        }

        return newCat;
    }

    // Hapus Kategori
    async deleteCategory(id) {
        // Cek apakah kategori masih dipakai produk
        const products = (typeof productManager !== 'undefined' && productManager.products) ? productManager.products : [];
        const usedCount = products.filter(p => p.category === id).length;

        if (usedCount > 0) {
            alert(`⚠️ Kategori tidak dapat dihapus karena masih digunakan oleh ${usedCount} menu.\nSilakan ubah kategori menu tersebut terlebih dahulu sebelum menghapus.`);
            return false;
        }

        const cat = this.getCategoryById(id);
        if (!confirm(`Yakin ingin menghapus kategori "${cat.name}"?`)) {
            return false;
        }

        this.categories = this.categories.filter(c => c.id !== id);
        if (this.categories.length === 0) {
            this.categories = [...this.defaultCategories];
        }

        await this.saveCategories();

        if (typeof sounds !== 'undefined') sounds.playSuccess();
        if (typeof showPosToast === 'function') {
            showPosToast(`🗑️ Kategori "${cat.name}" berhasil dihapus.`, 3000);
        }

        return true;
    }

    // Render Semua Elemen Kategori di UI
    renderAll() {
        this.renderPosPills();
        this.renderAdminPills();
        this.renderSelectOptions();
        this.renderCategoryModalList();
    }

    // 1. Render Pills Kategori di Halaman Kasir POS (#categoryPills)
    renderPosPills() {
        const container = document.getElementById('categoryPills');
        if (!container) return;

        const currentActive = (typeof productManager !== 'undefined' && productManager.currentCategory) ? productManager.currentCategory : 'all';
        const products = (typeof productManager !== 'undefined' && productManager.products) ? productManager.products : [];
        const totalCount = products.length;

        let html = `
            <button type="button" class="cat-pill ${currentActive === 'all' ? 'active' : ''}" data-category="all" title="Semua Menu (${totalCount} menu)">
                <div class="cat-pill-icon-wrap">
                    <span class="cat-icon-symbol">🍽️</span>
                </div>
                <div class="cat-pill-info">
                    <span class="cat-pill-title">Semua Menu</span>
                    <span class="cat-pill-count" id="countCatAll">${totalCount} items</span>
                </div>
            </button>
        `;

        this.getCategories().forEach(cat => {
            const count = products.filter(p => p.category === cat.id).length;
            const isActive = currentActive === cat.id;
            html += `
                <button type="button" class="cat-pill ${isActive ? 'active' : ''}" data-category="${cat.id}" title="${cat.name} (${count} menu)">
                    <div class="cat-pill-icon-wrap">
                        <span class="cat-icon-symbol">${cat.icon || '🍽️'}</span>
                    </div>
                    <div class="cat-pill-info">
                        <span class="cat-pill-title">${cat.name}</span>
                        <span class="cat-pill-count" id="countCat_${cat.id}">${count} items</span>
                    </div>
                </button>
            `;
        });

        container.innerHTML = html;

        // Pasang event listener click untuk cat-pill
        container.querySelectorAll('.cat-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (typeof productManager !== 'undefined' && productManager.filterByCategory) {
                    productManager.filterByCategory(btn.dataset.category);
                }
            });
        });
    }

    // 2. Render Pills Kategori di Toolbar Admin (.admin-cat-pills)
    renderAdminPills() {
        const container = document.querySelector('.admin-cat-pills');
        if (!container) return;

        const currentActive = (typeof adminManager !== 'undefined' && adminManager.currentCategory) ? adminManager.currentCategory : 'all';

        let html = `
            <button type="button" class="admin-cat-btn ${currentActive === 'all' ? 'active' : ''}" data-category="all">Semua</button>
        `;

        this.getCategories().forEach(cat => {
            const isActive = currentActive === cat.id;
            html += `
                <button type="button" class="admin-cat-btn ${isActive ? 'active' : ''}" data-category="${cat.id}">
                    ${cat.icon || ''} ${cat.name}
                </button>
            `;
        });

        container.innerHTML = html;

        // Pasang event listener click untuk admin-cat-btn
        container.querySelectorAll('.admin-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.admin-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (typeof adminManager !== 'undefined' && adminManager.filterByCategory) {
                    adminManager.filterByCategory(btn.dataset.category);
                }
            });
        });
    }

    // 3. Render Dropdown Kategori di Form Tambah/Edit Produk (#adminProdCategory)
    renderSelectOptions(selectedId = null) {
        const select = document.getElementById('adminProdCategory');
        if (!select) return;

        const currentValue = selectedId || select.value || 'makanan';
        let html = '';

        this.getCategories().forEach(cat => {
            const isSelected = cat.id === currentValue ? 'selected' : '';
            html += `<option value="${cat.id}" ${isSelected}>${cat.icon || '🍽️'} ${cat.name}</option>`;
        });

        select.innerHTML = html;
        if (selectedId) select.value = selectedId;
    }

    // 4. Modal Manajemen Kategori
    openCategoryModal() {
        this.renderCategoryModalList();
        const modal = document.getElementById('categoryManagerModal');
        if (modal) modal.classList.add('active');
    }

    closeCategoryModal() {
        const modal = document.getElementById('categoryManagerModal');
        if (modal) modal.classList.remove('active');
    }

    renderCategoryModalList() {
        const listEl = document.getElementById('categoryModalList');
        if (!listEl) return;

        const products = (typeof productManager !== 'undefined' && productManager.products) ? productManager.products : [];

        let html = '';
        this.getCategories().forEach(cat => {
            const count = products.filter(p => p.category === cat.id).length;
            html += `
                <div class="category-item-row" id="catRow_${cat.id}">
                    <div class="cat-item-left">
                        <span class="cat-item-icon">${cat.icon || '🍽️'}</span>
                        <div class="cat-item-meta">
                            <span class="cat-item-name">${cat.name}</span>
                            <span class="cat-item-count">${count} menu menggunakan kategori ini</span>
                        </div>
                    </div>
                    <div class="cat-item-right">
                        <button type="button" class="btn-del-cat" onclick="categoryManager.deleteCategory('${cat.id}')" title="Hapus kategori ini">
                            🗑️ Hapus
                        </button>
                    </div>
                </div>
            `;
        });

        listEl.innerHTML = html;
    }

    async submitNewCategory() {
        const nameInput = document.getElementById('newCategoryNameInput');
        const iconInput = document.getElementById('newCategoryIconInput');
        if (!nameInput) return;

        const name = nameInput.value.trim();
        const icon = (iconInput?.value || '🍽️').trim();

        if (!name) {
            alert('Masukkan nama kategori terlebih dahulu!');
            nameInput.focus();
            return;
        }

        const newCat = await this.addCategory(name, icon);
        if (newCat) {
            nameInput.value = '';
            if (iconInput) iconInput.value = '🍽️';
            this.renderSelectOptions(newCat.id);
            this.renderCategoryModalList();
        }
    }
}

window.categoryManager = new CategoryManager();
const categoryManager = window.categoryManager;
