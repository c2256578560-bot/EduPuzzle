// ===== 本地存储封装 =====
// IndexedDB：存资料全文、试卷、OCR 识别历史（体积大）
// localStorage：存科目、词库、设置（体积小）

const DB = {
  _db: null,

  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      // 版本 2 新增 ocr（识别历史）表；旧版本数据会保留
      const req = indexedDB.open('edupuzzle', 2);
      req.onupgradeneeded = () => {
        for (const name of ['docs', 'papers', 'ocr']) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(this._db = req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // 通用事务：fn 里对 store 做操作，事务完成后返回结果
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  },

  all(store)     { return this.tx(store, 'readonly',  s => s.getAll()); },
  put(store, v)  { return this.tx(store, 'readwrite', s => s.put(v)); },
  del(store, id) { return this.tx(store, 'readwrite', s => s.delete(id)); },
  clear(store)   { return this.tx(store, 'readwrite', s => s.clear()); },
};

// localStorage 存取 JSON，键名统一加 ep_ 前缀，方便备份和清空
const LS = {
  get(key, def) {
    try { return JSON.parse(localStorage.getItem('ep_' + key)) ?? def; } catch { return def; }
  },
  set(key, val) { localStorage.setItem('ep_' + key, JSON.stringify(val)); },
};
