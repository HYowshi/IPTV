// ==================== API CONFIGURATION ====================
const API_BASE_URL = 'https://ophim1.com';
const IMAGE_BASE_URL = 'https://img.ophim.live/uploads/movies/';

// Responsive TMDB sizes
const TMDB_THUMB_BASE = "https://image.tmdb.org/t/p/w185";
const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w342";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const TMDB_GALLERY_BASE = "https://image.tmdb.org/t/p/w500";

// ==================== MULTI-TIER CACHE SYSTEM ====================
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'phim_api_cache_';
const CACHE_TTL = 8 * 60 * 1000;
const DETAIL_CACHE_TTL = 5 * 60 * 1000;
const STALE_REVALIDATE_TTL = 45 * 60 * 1000;
const LONG_TERM_TTL = 6 * 60 * 60 * 1000;
const MEMORY_CACHE_MAX_SIZE = 80;
const inFlightRequests = new Map();

// LRU Memory Cache
class LRUCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const entry = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        this.cache.set(key, value);
        if (this.cache.size > this.maxSize) {
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
        }
    }
    has(key) { return this.cache.has(key); }
    delete(key) { this.cache.delete(key); }
    clear() { this.cache.clear(); }
    get size() { return this.cache.size; }
}

const apiCache = new LRUCache(MEMORY_CACHE_MAX_SIZE);

function getCacheTTL(url) {
    if (url.includes('/phim/')) return DETAIL_CACHE_TTL;
    return CACHE_TTL;
}

function getCachedData(url) {
    const ttl = getCacheTTL(url);
    const now = Date.now();

    const memCache = apiCache.get(url);
    if (memCache) {
        if (now - memCache.time < ttl) return { data: memCache.data, stale: false };
        if (now - memCache.time < STALE_REVALIDATE_TTL) return { data: memCache.data, stale: true };
    }

    const ssKey = CACHE_PREFIX + url;
    try {
        const cached = sessionStorage.getItem(ssKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (now - parsed.time < ttl) {
                apiCache.set(url, parsed);
                return { data: parsed.data, stale: false };
            }
            if (now - parsed.time < STALE_REVALIDATE_TTL) {
                apiCache.set(url, parsed);
                return { data: parsed.data, stale: true };
            }
            sessionStorage.removeItem(ssKey);
        }
    } catch (e) { }

    const lsKey = CACHE_PREFIX + 'lt_' + url;
    try {
        const cached = localStorage.getItem(lsKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.v !== CACHE_VERSION) { localStorage.removeItem(lsKey); return null; }
            if (now - parsed.time < LONG_TERM_TTL) {
                apiCache.set(url, parsed);
                try { sessionStorage.setItem(ssKey, JSON.stringify(parsed)); } catch (_) {}
                if (now - parsed.time < ttl) return { data: parsed.data, stale: false };
                return { data: parsed.data, stale: true };
            }
            localStorage.removeItem(lsKey);
        }
    } catch (e) { }

    return null;
}

function setCacheData(url, data) {
    const cacheEntry = { data: data, time: Date.now(), v: CACHE_VERSION };
    apiCache.set(url, cacheEntry);

    const ssKey = CACHE_PREFIX + url;
    try {
        sessionStorage.setItem(ssKey, JSON.stringify(cacheEntry));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            evictStorageEntries(sessionStorage, CACHE_PREFIX, 0.3);
            try { sessionStorage.setItem(ssKey, JSON.stringify(cacheEntry)); } catch (_) {}
        }
    }

    const isLongTermCandidate = !url.includes('/phim/') || url.includes('/danh-sach/') || url.includes('/tim-kiem');
    if (isLongTermCandidate) {
        const lsKey = CACHE_PREFIX + 'lt_' + url;
        try {
            localStorage.setItem(lsKey, JSON.stringify(cacheEntry));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                evictStorageEntries(localStorage, CACHE_PREFIX + 'lt_', 0.3);
                try { localStorage.setItem(lsKey, JSON.stringify(cacheEntry)); } catch (_) {}
            }
        }
    }
}

function evictStorageEntries(storage, prefix, evictRatio) {
    try {
        const keys = Object.keys(storage).filter(k => k.startsWith(prefix));
        keys.sort((a, b) => {
            try {
                const ta = JSON.parse(storage.getItem(a)).time || 0;
                const tb = JSON.parse(storage.getItem(b)).time || 0;
                return ta - tb;
            } catch (_) { return 0; }
        });
        const toRemove = Math.max(1, Math.floor(keys.length * evictRatio));
        for (let i = 0; i < toRemove; i++) storage.removeItem(keys[i]);
    } catch (_) {}
}

(function cleanStaleLongTermCache() {
    try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX + 'lt_'));
        const now = Date.now();
        keys.forEach(k => {
            try {
                const parsed = JSON.parse(localStorage.getItem(k));
                if (!parsed || parsed.v !== CACHE_VERSION || now - parsed.time > LONG_TERM_TTL) {
                    localStorage.removeItem(k);
                }
            } catch (_) { localStorage.removeItem(k); }
        });
    } catch (_) {}
})();

// ==================== FETCH UTILITIES ====================
async function fetchRaw(url, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        clearTimeout(timer);
        throw error;
    }
}

async function fetchWithCache(url, retries = 3, timeout = 8000) {
    const cached = getCachedData(url);
    if (cached && !cached.stale) return cached.data;

    if (inFlightRequests.has(url)) return inFlightRequests.get(url);

    if (cached && cached.stale) {
        const revalidatePromise = fetchRaw(url, timeout)
            .then(data => { setCacheData(url, data); return data; })
            .catch(() => { })
            .finally(() => { inFlightRequests.delete(url); });
        inFlightRequests.set(url, revalidatePromise);
        return cached.data;
    }

    const fetchPromise = (async () => {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const data = await fetchRaw(url, timeout + (i * 2000));
                setCacheData(url, data);
                return data;
            } catch (error) {
                lastError = error;
                if (i < retries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
            }
        }
        throw lastError;
    })();

    inFlightRequests.set(url, fetchPromise);
    try { return await fetchPromise; }
    finally { inFlightRequests.delete(url); }
}