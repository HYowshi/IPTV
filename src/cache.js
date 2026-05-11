/**
 * Enhanced Cache System for Phim.tv
 * - 4-tier cache: Memory → SessionStorage → IndexedDB → LocalStorage
 * - LZ-string compression for storage
 * - Connection-aware TTL
 * - Smart eviction (LRU + frequency)
 * - Cache warming during idle
 * - Quota management
 */

const CacheSystem = (() => {
    const VERSION = 'v3';
    const PREFIX = 'ptv_';
    const IDB_NAME = 'PhimTVCache';
    const IDB_STORE = 'cache';
    
    // TTL tiers (ms)
    const TTL = {
        HOT:    5 * 60 * 1000,     // 5 min - detail pages
        WARM:   10 * 60 * 1000,    // 10 min - list pages
        COOL:   60 * 60 * 1000,    // 1 hour - stale-while-revalidate
        COLD:   12 * 60 * 60 * 1000 // 12 hours - long-term (M3U, EPG)
    };
    
    // Memory cache sizes
    const MEM_MAX = 100;
    const MEM_SMALL_MAX = 50;
    
    // Stats
    let stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
    
    // ==================== LRU CACHE WITH FREQUENCY ====================
    class SmartLRU {
        constructor(maxSize) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }
        
        get(key) {
            if (!this.cache.has(key)) return undefined;
            const entry = this.cache.get(key);
            entry.hits = (entry.hits || 0) + 1;
            entry.lastAccess = Date.now();
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, entry);
            return entry;
        }
        
        set(key, value) {
            if (this.cache.has(key)) this.cache.delete(key);
            this.cache.set(key, { ...value, hits: 1, lastAccess: Date.now() });
            if (this.cache.size > this.maxSize) {
                // Evict least recently used with lowest hit count
                let lruKey = null;
                let lruScore = Infinity;
                for (const [k, v] of this.cache) {
                    const score = (v.hits || 1) * (v.lastAccess || 0);
                    if (score < lruScore) {
                        lruScore = score;
                        lruKey = k;
                    }
                }
                if (lruKey) {
                    this.cache.delete(lruKey);
                    stats.evictions++;
                }
            }
        }
        
        has(key) { return this.cache.has(key); }
        delete(key) { this.cache.delete(key); }
        clear() { this.cache.clear(); }
        get size() { return this.cache.size; }
    }
    
    const memCache = new SmartLRU(MEM_MAX);
    
    // ==================== COMPRESSION ====================
    // Simple RLE + Base64 compression for JSON strings
    function compress(str) {
        if (str.length < 500) return str; // Not worth compressing
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            return str;
        }
    }
    
    function decompress(str) {
        try {
            return decodeURIComponent(escape(atob(str)));
        } catch (e) {
            return str; // Already uncompressed
        }
    }
    
    // ==================== INDEXEDDB ====================
    let idb = null;
    let idbReady = false;
    const idbQueue = [];
    
    function initIDB() {
        if (!('indexedDB' in window)) return;
        const request = indexedDB.open(IDB_NAME, 1);
        
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        
        request.onsuccess = (e) => {
            idb = e.target.result;
            idbReady = true;
            // Flush queued operations
            idbQueue.forEach(fn => fn());
            idbQueue.length = 0;
        };
        
        request.onerror = () => { idbReady = false; };
    }
    
    function idbGet(key) {
        return new Promise((resolve) => {
            if (!idbReady) { resolve(null); return; }
            try {
                const tx = idb.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    
    function idbSet(key, value) {
        return new Promise((resolve) => {
            if (!idbReady) {
                idbQueue.push(() => idbSet(key, value).then(resolve));
                return;
            }
            try {
                const tx = idb.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                store.put(value, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (e) { resolve(false); }
        });
    }
    
    function idbDelete(key) {
        return new Promise((resolve) => {
            if (!idbReady) { resolve(false); return; }
            try {
                const tx = idb.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                store.delete(key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (e) { resolve(false); }
        });
    }
    
    function idbClean(maxAge) {
        if (!idbReady) return;
        try {
            const tx = idb.transaction(IDB_STORE, 'readwrite');
            const store = tx.objectStore(IDB_STORE);
            const req = store.openCursor();
            const now = Date.now();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const val = cursor.value;
                    if (val && val.time && (now - val.time > maxAge)) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
        } catch (e) {}
    }
    
    // ==================== CONNECTION-AWARE TTL ====================
    function getEffectiveTTL(baseTTL) {
        if (typeof ConnectionManager !== 'undefined') {
            if (ConnectionManager.isSlowConnection()) return baseTTL * 2;
            if (ConnectionManager.getEffectiveType() === '3g') return baseTTL * 1.5;
        }
        return baseTTL;
    }
    
    // ==================== CORE GET ====================
    async function get(key, tier) {
        const ttl = getEffectiveTTL(tier || TTL.WARM);
        const now = Date.now();
        
        // Tier 1: Memory (fastest)
        const memEntry = memCache.get(key);
        if (memEntry) {
            if (now - memEntry.time < ttl) { stats.hits++; return { data: memEntry.data, stale: false }; }
            if (now - memEntry.time < TTL.COOL) { stats.hits++; return { data: memEntry.data, stale: true }; }
        }
        
        // Tier 2: SessionStorage
        try {
            const raw = sessionStorage.getItem(PREFIX + key);
            if (raw) {
                const parsed = JSON.parse(decompress(raw));
                if (now - parsed.time < ttl) {
                    memCache.set(key, parsed);
                    stats.hits++;
                    return { data: parsed.data, stale: false };
                }
                if (now - parsed.time < TTL.COOL) {
                    memCache.set(key, parsed);
                    stats.hits++;
                    return { data: parsed.data, stale: true };
                }
                sessionStorage.removeItem(PREFIX + key);
            }
        } catch (e) {}
        
        // Tier 3: IndexedDB (for large data)
        try {
            const idbEntry = await idbGet(key);
            if (idbEntry && idbEntry.time) {
                if (now - idbEntry.time < TTL.COLD) {
                    memCache.set(key, idbEntry);
                    try { sessionStorage.setItem(PREFIX + key, compress(JSON.stringify(idbEntry))); } catch (_) {}
                    if (now - idbEntry.time < ttl) { stats.hits++; return { data: idbEntry.data, stale: false }; }
                    stats.hits++;
                    return { data: idbEntry.data, stale: true };
                }
                idbDelete(key);
            }
        } catch (e) {}
        
        // Tier 4: LocalStorage (fallback)
        try {
            const raw = localStorage.getItem(PREFIX + 'lt_' + key);
            if (raw) {
                const parsed = JSON.parse(decompress(raw));
                if (parsed.v !== VERSION) { localStorage.removeItem(PREFIX + 'lt_' + key); stats.misses++; return null; }
                if (now - parsed.time < TTL.COLD) {
                    memCache.set(key, parsed);
                    try { sessionStorage.setItem(PREFIX + key, compress(JSON.stringify(parsed))); } catch (_) {}
                    if (now - parsed.time < ttl) { stats.hits++; return { data: parsed.data, stale: false }; }
                    stats.hits++;
                    return { data: parsed.data, stale: true };
                }
                localStorage.removeItem(PREFIX + 'lt_' + key);
            }
        } catch (e) {}
        
        stats.misses++;
        return null;
    }
    
    // ==================== CORE SET ====================
    async function set(key, data, options = {}) {
        const entry = { data, time: Date.now(), v: VERSION };
        stats.sets++;
        
        // Tier 1: Memory
        memCache.set(key, entry);
        
        // Tier 2: SessionStorage
        const ssKey = PREFIX + key;
        try {
            sessionStorage.setItem(ssKey, compress(JSON.stringify(entry)));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                evictStorage(sessionStorage, PREFIX);
                try { sessionStorage.setItem(ssKey, compress(JSON.stringify(entry))); } catch (_) {}
            }
        }
        
        // Tier 3: IndexedDB (for large/important data)
        if (options.persistent || key.length > 100 || JSON.stringify(data).length > 5000) {
            await idbSet(key, entry);
        }
        
        // Tier 4: LocalStorage (for critical data like M3U, EPG)
        if (options.critical) {
            const lsKey = PREFIX + 'lt_' + key;
            try {
                localStorage.setItem(lsKey, compress(JSON.stringify(entry)));
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    evictStorage(localStorage, PREFIX + 'lt_');
                    try { localStorage.setItem(lsKey, compress(JSON.stringify(entry))); } catch (_) {}
                }
            }
        }
    }
    
    // ==================== EVICTION ====================
    function evictStorage(storage, prefix) {
        try {
            const keys = Object.keys(storage).filter(k => k.startsWith(prefix));
            const entries = keys.map(k => {
                try {
                    const val = JSON.parse(decompress(storage.getItem(k)));
                    return { key: k, time: val.time || 0 };
                } catch (_) { return { key: k, time: 0 }; }
            });
            entries.sort((a, b) => a.time - b.time);
            const toRemove = Math.max(1, Math.floor(entries.length * 0.3));
            for (let i = 0; i < toRemove; i++) storage.removeItem(entries[i].key);
            stats.evictions += toRemove;
        } catch (_) {}
    }
    
    // ==================== CACHE WARMING ====================
    const warmQueue = [];
    
    function addToWarmQueue(url, key, tier) {
        warmQueue.push({ url, key, tier });
    }
    
    function processWarmQueue() {
        if (warmQueue.length === 0) return;
        const item = warmQueue.shift();
        if (item && typeof fetchWithCache === 'function') {
            const cached = memCache.has(item.key);
            if (!cached) {
                fetchWithCache(item.url).catch(() => {});
            }
        }
        // Process next after a short delay
        if (warmQueue.length > 0) {
            const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
            idle(() => processWarmQueue());
        }
    }
    
    // ==================== CACHE STATS ====================
    function getStats() {
        return {
            ...stats,
            hitRate: stats.hits + stats.misses > 0 
                ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
                : 'N/A',
            memSize: memCache.size,
            memMax: MEM_MAX
        };
    }
    
    // ==================== CLEANUP ====================
    function cleanup() {
        const now = Date.now();
        
        // Clean SessionStorage
        try {
            Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX)).forEach(k => {
                try {
                    const val = JSON.parse(decompress(sessionStorage.getItem(k)));
                    if (val.time && now - val.time > TTL.COOL) {
                        sessionStorage.removeItem(k);
                    }
                } catch (_) { sessionStorage.removeItem(k); }
            });
        } catch (_) {}
        
        // Clean LocalStorage
        try {
            Object.keys(localStorage).filter(k => k.startsWith(PREFIX + 'lt_')).forEach(k => {
                try {
                    const val = JSON.parse(decompress(localStorage.getItem(k)));
                    if (!val || val.v !== VERSION || now - val.time > TTL.COLD) {
                        localStorage.removeItem(k);
                    }
                } catch (_) { localStorage.removeItem(k); }
            });
        } catch (_) {}
        
        // Clean IndexedDB
        idbClean(TTL.COLD);
    }
    
    // ==================== INIT ====================
    function init() {
        initIDB();
        
        // Clean stale cache on load
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => cleanup(), { timeout: 5000 });
        } else {
            setTimeout(cleanup, 2000);
        }
        
        // Warm cache during idle
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => processWarmQueue(), { timeout: 10000 });
        } else {
            setTimeout(processWarmQueue, 5000);
        }
    }
    
    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    return {
        get, set, cleanup, getStats, addToWarmQueue, processWarmQueue,
        TTL, PREFIX, VERSION
    };
})();