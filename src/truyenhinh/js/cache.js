// ==================== CACHE SYSTEM ====================
function tvGetCached(key) {
    const now = Date.now();

    // Tier 1: Memory LRU (fastest)
    const memEntry = tvMemoryCache.get(key);
    if (memEntry) {
        if (now - memEntry.time < TV_CACHE_TTL) return { data: memEntry.data, stale: false };
        if (now - memEntry.time < TV_STALE_TTL) return { data: memEntry.data, stale: true };
    }

    // Tier 2: SessionStorage
    try {
        const raw = sessionStorage.getItem(TV_CACHE_PREFIX + key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (now - parsed.time < TV_CACHE_TTL) {
                tvMemoryCache.set(key, parsed); // Promote to memory
                return { data: parsed.data, stale: false };
            }
            if (now - parsed.time < TV_STALE_TTL) {
                tvMemoryCache.set(key, parsed);
                return { data: parsed.data, stale: true };
            }
            sessionStorage.removeItem(TV_CACHE_PREFIX + key);
        }
    } catch (e) { }

    // Tier 3: LocalStorage (long-term, for M3U and EPG data)
    try {
        const raw = localStorage.getItem(TV_CACHE_PREFIX + 'lt_' + key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (now - parsed.time < TV_LONG_TERM_TTL) {
                tvMemoryCache.set(key, parsed);
                try { sessionStorage.setItem(TV_CACHE_PREFIX + key, JSON.stringify(parsed)); } catch (_) { }
                if (now - parsed.time < TV_CACHE_TTL) return { data: parsed.data, stale: false };
                return { data: parsed.data, stale: true };
            }
            localStorage.removeItem(TV_CACHE_PREFIX + 'lt_' + key);
        }
    } catch (e) { }

    return null;
}

function tvSetCache(key, data) {
    const entry = { data, time: Date.now() };

    // Tier 1: Memory LRU
    tvMemoryCache.set(key, entry);

    // Tier 2: SessionStorage
    const ssKey = TV_CACHE_PREFIX + key;
    try {
        sessionStorage.setItem(ssKey, JSON.stringify(entry));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            tvEvictStorage(sessionStorage, TV_CACHE_PREFIX);
            try { sessionStorage.setItem(ssKey, JSON.stringify(entry)); } catch (_) { }
        }
    }

    // Tier 3: LocalStorage for large/important data (M3U, EPG)
    if (key.startsWith('m3u_') || key === 'm3u_combined' || key === 'epg_parsed' || key === 'epg_raw') {
        const lsKey = TV_CACHE_PREFIX + 'lt_' + key;
        try {
            localStorage.setItem(lsKey, JSON.stringify(entry));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                tvEvictStorage(localStorage, TV_CACHE_PREFIX + 'lt_');
                try { localStorage.setItem(lsKey, JSON.stringify(entry)); } catch (_) { }
            }
        }
    }
}

function tvEvictStorage(storage, prefix) {
    try {
        const keys = Object.keys(storage).filter(k => k.startsWith(prefix));
        keys.sort((a, b) => {
            try { return JSON.parse(storage.getItem(a)).time - JSON.parse(storage.getItem(b)).time; }
            catch (_) { return 0; }
        });
        const toRemove = Math.max(1, Math.floor(keys.length * 0.3));
        for (let i = 0; i < toRemove; i++) storage.removeItem(keys[i]);
    } catch (_) { }
}

// ==================== FETCH UTILITIES ====================
async function tvFetchRaw(url, timeout = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (error) {
        clearTimeout(timer);
        throw error;
    }
}

async function tvFetchWithCache(key, url, retries = 3, timeout = 10000) {
    const cached = tvGetCached(key);
    if (cached && !cached.stale) return cached.data;

    if (inFlightTvRequests.has(key)) return inFlightTvRequests.get(key);

    if (cached && cached.stale) {
        const revalidate = tvFetchRaw(url, timeout)
            .then(data => { tvSetCache(key, data); return data; })
            .catch(() => { })
            .finally(() => { inFlightTvRequests.delete(key); });
        inFlightTvRequests.set(key, revalidate);
        return cached.data;
    }

    const fetchPromise = (async () => {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const data = await tvFetchRaw(url, timeout + i * 2000);
                tvSetCache(key, data);
                return data;
            } catch (error) {
                lastError = error;
                if (i < retries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
            }
        }
        throw lastError;
    })();

    inFlightTvRequests.set(key, fetchPromise);
    try { return await fetchPromise; }
    finally { inFlightTvRequests.delete(key); }
}

// Clean stale long-term TV cache on load
(function cleanStaleTvCache() {
    try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(TV_CACHE_PREFIX + 'lt_'));
        const now = Date.now();
        keys.forEach(k => {
            try {
                const parsed = JSON.parse(localStorage.getItem(k));
                if (!parsed || now - parsed.time > TV_LONG_TERM_TTL) {
                    localStorage.removeItem(k);
                }
            } catch (_) { localStorage.removeItem(k); }
        });
    } catch (_) { }
})();