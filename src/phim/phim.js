const API_BASE_URL = 'https://ophim1.com';
const IMAGE_BASE_URL = 'https://img.ophim.live/uploads/movies/';

// Responsive TMDB sizes: smaller for thumbnails, medium for posters, large for backdrops
const TMDB_THUMB_BASE = "https://image.tmdb.org/t/p/w185";     // Card thumbnails (185px wide)
const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w342";     // Detail posters (342px - was w500)
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";  // Backdrops (w1280 instead of original)
const TMDB_GALLERY_BASE = "https://image.tmdb.org/t/p/w500";    // Gallery (w500 instead of w780)

const ERROR_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%231a1a1a%22/%3E%3Crect width=%22300%22 height=%22450%22 fill=%22none%22 stroke=%22%23333%22 stroke-width=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2220%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ELỗi Ảnh%3C/text%3E%3C/svg%3E";

// Intersection Observer for smarter lazy loading with preload buffer
let imageObserver = null;
function getImageObserver() {
    if (imageObserver) return imageObserver;
    if (!('IntersectionObserver' in window)) return null;
    imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const dataSrc = img.dataset.src;
                if (dataSrc) {
                    img.src = dataSrc;
                    img.removeAttribute('data-src');
                }
                imageObserver.unobserve(img);
            }
        });
    }, {
        rootMargin: '200px 0px',  // Start loading 200px before entering viewport
        threshold: 0.01
    });
    return imageObserver;
}

let currentFilterEndpoint = "";
let currentFilterSlug = "";
let currentFilterTitle = "";
let currentFilterPage = 1;
let totalFilterPages = 1;
let currentMovieData = null;
let imageDomain = IMAGE_BASE_URL;
let currentSearchId = 0;

let categoriesMap = new Map();
let countriesMap = new Map();
let yearsSet = new Set();
let watchHistoryCache = null;
let hlsInstance = null;
let nextEpTimer = null;
// ==================== MULTI-TIER CACHE SYSTEM ====================
// Tier 1: Memory (fastest, per-session) with LRU eviction
// Tier 2: SessionStorage (persists across navigations within tab)
// Tier 3: LocalStorage (persists across tab closes, long-term)
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'phim_api_cache_';
const CACHE_TTL = 8 * 60 * 1000;              // 8 min fresh (was 5)
const DETAIL_CACHE_TTL = 5 * 60 * 1000;        // 5 min fresh (was 3)
const STALE_REVALIDATE_TTL = 45 * 60 * 1000;   // 45 min stale window (was 30)
const LONG_TERM_TTL = 6 * 60 * 60 * 1000;      // 6 hours in LocalStorage
const MEMORY_CACHE_MAX_SIZE = 80;               // LRU max entries in memory
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
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        this.cache.set(key, value);
        // Evict oldest if over limit
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

// Prefetch queue for next-page data
const prefetchQueue = new Set();

const MAX_HISTORY_ENTRIES = 150;
const CONTROLS_HIDE_DELAY = 3000;

async function toggleFullscreen(container) {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    try {
        if (!isFs) {
            if (container.requestFullscreen) await container.requestFullscreen();
            else if (container.webkitRequestFullscreen) await container.webkitRequestFullscreen();
            else if (container.msRequestFullscreen) await container.msRequestFullscreen();
        } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            else if (document.msExitFullscreen) await document.msExitFullscreen();
        }
    } catch (e) { }
}

function getCacheTTL(url) {
    if (url.includes('/phim/')) return DETAIL_CACHE_TTL;
    return CACHE_TTL;
}

function getCachedData(url) {
    const ttl = getCacheTTL(url);
    const now = Date.now();

    // Tier 1: Memory LRU cache (fastest)
    const memCache = apiCache.get(url);
    if (memCache) {
        if (now - memCache.time < ttl) return { data: memCache.data, stale: false };
        if (now - memCache.time < STALE_REVALIDATE_TTL) return { data: memCache.data, stale: true };
    }

    // Tier 2: SessionStorage (persists across navigations within tab)
    const ssKey = CACHE_PREFIX + url;
    try {
        const cached = sessionStorage.getItem(ssKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (now - parsed.time < ttl) {
                apiCache.set(url, parsed); // Promote to memory
                return { data: parsed.data, stale: false };
            }
            if (now - parsed.time < STALE_REVALIDATE_TTL) {
                apiCache.set(url, parsed);
                return { data: parsed.data, stale: true };
            }
            sessionStorage.removeItem(ssKey);
        }
    } catch (e) { }

    // Tier 3: LocalStorage (long-term, survives tab close)
    const lsKey = CACHE_PREFIX + 'lt_' + url;
    try {
        const cached = localStorage.getItem(lsKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            // Version check
            if (parsed.v !== CACHE_VERSION) { localStorage.removeItem(lsKey); return null; }
            if (now - parsed.time < LONG_TERM_TTL) {
                // Promote to memory + sessionStorage
                apiCache.set(url, parsed);
                try { sessionStorage.setItem(ssKey, JSON.stringify(parsed)); } catch (_) {}
                // Check freshness for stale status
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

    // Tier 1: Memory LRU (auto-evicts oldest)
    apiCache.set(url, cacheEntry);

    // Tier 2: SessionStorage
    const ssKey = CACHE_PREFIX + url;
    try {
        sessionStorage.setItem(ssKey, JSON.stringify(cacheEntry));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            evictStorageEntries(sessionStorage, CACHE_PREFIX, 0.3);
            try { sessionStorage.setItem(ssKey, JSON.stringify(cacheEntry)); } catch (_) {}
        }
    }

    // Tier 3: LocalStorage (long-term, only for important endpoints)
    // Only cache list/filter/search endpoints (not detail pages which change more often)
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

// Shared eviction helper for storage quota exceeded
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

// Clean stale long-term cache entries on load (run once)
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
    // 1. Check cache
    const cached = getCachedData(url);
    if (cached && !cached.stale) {
        return cached.data;
    }

    // 2. Request deduplication: if same URL is already in-flight, share the result
    if (inFlightRequests.has(url)) {
        return inFlightRequests.get(url);
    }

    // 3. If we have stale cache, return it immediately and revalidate in background
    if (cached && cached.stale) {
        // Background revalidation (fire-and-forget)
        const revalidatePromise = fetchRaw(url, timeout)
            .then(data => {
                setCacheData(url, data);
                return data;
            })
            .catch(() => { })
            .finally(() => { inFlightRequests.delete(url); });

        inFlightRequests.set(url, revalidatePromise);
        return cached.data;
    }

    // 4. No cache — fetch with retries
    const fetchPromise = (async () => {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const data = await fetchRaw(url, timeout + (i * 2000));
                setCacheData(url, data);
                return data;
            } catch (error) {
                lastError = error;
                if (i < retries - 1) {
                    await new Promise(r => setTimeout(r, 800 * (i + 1)));
                }
            }
        }
        throw lastError;
    })();

    inFlightRequests.set(url, fetchPromise);

    try {
        return await fetchPromise;
    } finally {
        inFlightRequests.delete(url);
    }
}

function trimWatchHistory(history) {
    const keys = Object.keys(history);
    if (keys.length > MAX_HISTORY_ENTRIES) {
        const excess = keys.length - MAX_HISTORY_ENTRIES;
        for (let i = 0; i < excess; i++) {
            delete history[keys[i]];
        }
    }
    return history;
}

function handleImageError(imgElement) {
    imgElement.onerror = null;
    imgElement.src = ERROR_IMAGE;
}

const CDN_FALLBACKS = [
    'https://img.ophim.live/uploads/movies',
    'https://phimimg.com/uploads/movies'
];

function getImageUrl(domain, path) {
    if (!path || path.trim() === "") return ERROR_IMAGE;

    // Absolute URLs - normalize to https
    if (path.startsWith("http://") || path.startsWith("https://")) {
        let url = path.replace("http://", "https://");
        // Normalize known CDN domains
        url = url.replace("img.ophim.cc", "phimimg.com").replace("ophim.cc", "phimimg.com");
        return url;
    }

    // Determine effective domain with fallback chain
    let cleanDomain = "";
    if (domain && domain.trim() !== "") {
        cleanDomain = domain.trim();
    } else if (imageDomain && imageDomain.trim() !== "") {
        cleanDomain = imageDomain;
    } else {
        cleanDomain = IMAGE_BASE_URL;
    }

    // Normalize known CDN domains
    cleanDomain = cleanDomain.replace("img.ophim.cc", "phimimg.com").replace("ophim.cc", "phimimg.com");

    if (cleanDomain.endsWith('/')) cleanDomain = cleanDomain.slice(0, -1);
    let cleanPath = path.trim();
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);

    // Path is actually an absolute URL
    if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
        return cleanPath.replace("http://", "https://");
    }

    // Avoid double "uploads/movies" in path
    if (cleanDomain.includes("uploads/movies") && cleanPath.startsWith("uploads/movies/")) {
        cleanPath = cleanPath.replace("uploads/movies/", "");
    }

    // Ensure domain has uploads/movies path
    if (!cleanDomain.includes("uploads/movies") && !cleanPath.includes("uploads/movies")) {
        cleanDomain += "/uploads/movies";
    }

    return cleanDomain + '/' + cleanPath;
}

function handleImageErrorWithFallback(imgElement, originalSrc) {
    imgElement.onerror = null;
    // Try CDN fallbacks
    for (const cdn of CDN_FALLBACKS) {
        if (originalSrc && !originalSrc.includes(cdn)) {
            const path = originalSrc.split('/uploads/movies/')[1];
            if (path) {
                const fallbackUrl = cdn + '/' + path;
                if (fallbackUrl !== originalSrc) {
                    imgElement.onerror = () => { imgElement.onerror = null; imgElement.src = ERROR_IMAGE; };
                    imgElement.src = fallbackUrl;
                    return;
                }
            }
        }
    }
    imgElement.src = ERROR_IMAGE;
}

function formatResponse(res) {
    const defaultFallback = { items: [], domain: IMAGE_BASE_URL };
    if (!res || typeof res !== 'object') return defaultFallback;

    let items = [];
    let domain = IMAGE_BASE_URL;

    if (res.data) {
        if (Array.isArray(res.data.items)) items = res.data.items;
        else if (Array.isArray(res.data)) items = res.data;
        if (res.data.APP_DOMAIN_CDN_IMAGE) domain = res.data.APP_DOMAIN_CDN_IMAGE;
    } else if (res.items) {
        if (Array.isArray(res.items)) items = res.items;
        if (res.pathImage) domain = res.pathImage;
    }

    if (items.length === 0 && res.movie && Array.isArray(res.movie)) {
        items = res.movie;
    }

    return { items: items, domain: domain };
}

document.addEventListener("DOMContentLoaded", () => {
    // ==================== HAMBURGER MENU ====================
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    let mobileNavOverlay = null;
    let mobileNavPanel = null;

    function buildMobileMenu() {
        if (mobileNavOverlay) return;
        
        mobileNavOverlay = document.createElement('div');
        mobileNavOverlay.className = 'mobile-nav-overlay';
        document.body.appendChild(mobileNavOverlay);

        mobileNavPanel = document.createElement('div');
        mobileNavPanel.className = 'mobile-nav-panel';
        
        const menuHTML = `
            <div class="mobile-nav-title">Điều hướng</div>
            <a href="../index.html" class="transition-link"><span class="material-symbols-rounded">home</span> Trang chủ</a>
            <a href="../truyenhinh/truyenhinh.html" class="transition-link"><span class="material-symbols-rounded">tv</span> Truyền hình</a>
            
            <div class="mobile-nav-title">Danh sách</div>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('new', '', 'Phim mới cập nhật', 1);"><span class="material-symbols-rounded">local_fire_department</span> Phim mới cập nhật</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-bo', 'Phim bộ', 1);"><span class="material-symbols-rounded">movie</span> Phim bộ</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-le', 'Phim lẻ', 1);"><span class="material-symbols-rounded">theaters</span> Phim lẻ</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'hoat-hinh', 'Hoạt hình', 1);"><span class="material-symbols-rounded">animation</span> Hoạt hình</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-vietsub', 'Phim Vietsub', 1);"><span class="material-symbols-rounded">subtitles</span> Phim Vietsub</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-thuyet-minh', 'Phim Thuyết minh', 1);"><span class="material-symbols-rounded">mic</span> Phim Thuyết minh</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-long-tieng', 'Phim Lồng tiếng', 1);"><span class="material-symbols-rounded">translate</span> Phim Lồng tiếng</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-bo-dang-chieu', 'Phim bộ đang chiếu', 1);"><span class="material-symbols-rounded">progress_activity</span> Phim bộ đang chiếu</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-bo-hoan-tat', 'Phim bộ hoàn tất', 1);"><span class="material-symbols-rounded">task_alt</span> Phim bộ hoàn tất</a>
            <a href="#" onclick="event.preventDefault(); closeMobileMenu(); loadFilterData('danh-sach', 'phim-sap-chieu', 'Phim sắp chiếu', 1);"><span class="material-symbols-rounded">schedule</span> Phim sắp chiếu</a>
        `;
        mobileNavPanel.innerHTML = menuHTML;
        document.body.appendChild(mobileNavPanel);

        // Add transition link handlers for mobile menu
        mobileNavPanel.querySelectorAll('.transition-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetUrl = link.getAttribute('href');
                closeMobileMenu();
                if (targetUrl && targetUrl !== '#') {
                    document.body.classList.add('fade-out');
                    setTimeout(() => {
                        window.location.href = targetUrl;
                    }, 500);
                }
            });
        });

        mobileNavOverlay.addEventListener('click', closeMobileMenu);
    }

    function openMobileMenu() {
        buildMobileMenu();
        hamburgerBtn.classList.add('active');
        mobileNavOverlay.style.display = 'block';
        requestAnimationFrame(() => {
            mobileNavOverlay.classList.add('show');
            mobileNavPanel.classList.add('show');
        });
        document.body.style.overflow = 'hidden';
    }

    window.closeMobileMenu = function() {
        if (!mobileNavOverlay || !mobileNavPanel) return;
        hamburgerBtn.classList.remove('active');
        mobileNavOverlay.classList.remove('show');
        mobileNavPanel.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(() => {
            mobileNavOverlay.style.display = 'none';
        }, 350);
    };

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            if (hamburgerBtn.classList.contains('active')) {
                closeMobileMenu();
            } else {
                openMobileMenu();
            }
        });
    }

    // Close mobile menu on ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && hamburgerBtn && hamburgerBtn.classList.contains('active')) {
            closeMobileMenu();
        }
    });

    // Close mobile menu on window resize to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && hamburgerBtn && hamburgerBtn.classList.contains('active')) {
            closeMobileMenu();
        }
    });

    // ==================== TRANSITION LINKS ====================
    const transitionLinks = document.querySelectorAll('.transition-link');
    transitionLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); 
            const targetUrl = link.getAttribute('href');
            if (targetUrl && targetUrl !== '#') {
                document.body.classList.add('fade-out');
                setTimeout(() => {
                    window.location.href = targetUrl; 
                }, 500);
            }
        });
    });

    initSpatialNavigation();

    const videoPlayerNode = document.getElementById('video-player');
    if (videoPlayerNode) {
        videoPlayerNode.addEventListener('ended', () => {
            let isAutoplayOn = localStorage.getItem('phimtv_autoplay') === 'true';
            if (!isAutoplayOn) {
                return;
            }

            if (nextEpTimer) {
                clearInterval(nextEpTimer);
            }

            let allBtns = Array.from(document.getElementById('watch-episode-list').querySelectorAll('.btn-episode'));
            let activeIndex = allBtns.findIndex(btn => btn.classList.contains('active'));
            if (activeIndex >= 0 && activeIndex < allBtns.length - 1) {
                const overlay = document.getElementById('next-ep-overlay');
                const numberEl = document.getElementById('countdown-number');
                const nameEl = document.getElementById('next-ep-name');
                const btnPlayNow = document.getElementById('btn-play-next-now');
                const btnCancel = document.getElementById('btn-cancel-next');

                let timeLeft = 5;
                overlay.style.display = 'flex';
                numberEl.innerText = timeLeft;
                nameEl.innerText = "Tập " + allBtns[activeIndex + 1].innerText;

                const playNext = () => {
                    clearInterval(nextEpTimer);
                    overlay.style.display = 'none';
                    allBtns[activeIndex + 1].click();
                };

                const cancelNext = () => {
                    clearInterval(nextEpTimer);
                    overlay.style.display = 'none';
                };

                btnPlayNow.onclick = playNext;
                btnCancel.onclick = cancelNext;

                nextEpTimer = setInterval(() => {
                    timeLeft -= 1;
                    numberEl.innerText = timeLeft;
                    if (timeLeft <= 0) {
                        playNext();
                    }
                }, 1000);
            }
        });
    }

    const safeAddListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

    safeAddListener('btn-back-watch', 'click', () => {
        document.getElementById('watch-view').style.display = 'none';
        document.getElementById('detail-view').style.display = 'block';
        const videoPlayer = document.getElementById('video-player');
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.removeAttribute('src');
            videoPlayer.load();
        }
        if (hlsInstance) {
            try { hlsInstance.destroy(); } catch (e) { }
            hlsInstance = null;
        }
        if (nextEpTimer) {
            clearInterval(nextEpTimer);
            const overlay = document.getElementById('next-ep-overlay');
            if (overlay) overlay.style.display = 'none';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    safeAddListener('searchBtn', 'click', handleSearch);

    let searchDebounceTimer;
    safeAddListener('searchInput', 'input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            if (e.target.value.trim() !== "") {
                handleSearch();
            } else {
                navigateToHome(null);
            }
        }, 600);
    });

    safeAddListener('btn-prev-page', 'click', () => {
        if (currentFilterPage > 1) {
            loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, currentFilterPage - 1);
        }
    });

    safeAddListener('btn-next-page', 'click', () => {
        if (currentFilterPage < totalFilterPages) {
            loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, currentFilterPage + 1);
        }
    });

    safeAddListener('input-page-jump', 'keypress', (e) => {
        if (e.key === 'Enter') {
            let targetPage = parseInt(e.target.value);
            if (targetPage >= 1 && targetPage <= totalFilterPages) {
                loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, targetPage);
            } else {
                e.target.value = currentFilterPage;
            }
        }
    });

    safeAddListener('btn-advance-filter', 'click', handleAdvancedFilter);

    safeAddListener('btn-more-new', 'click', () => loadFilterData('new', '', 'Phim mới cập nhật', 1));
    safeAddListener('btn-more-series', 'click', () => loadFilterData('danh-sach', 'phim-bo', 'Phim bộ mới', 1));
    safeAddListener('btn-more-movies', 'click', () => loadFilterData('danh-sach', 'phim-le', 'Phim lẻ mới', 1));

    const btnPipToggle = document.getElementById('btn-pip-toggle');
    const videoPlayerGlobal = document.getElementById('video-player');

    // Settings toggle handlers
    const settingAutoplay = document.getElementById('setting-autoplay');
    const settingAutoplayStatus = document.getElementById('setting-autoplay-status');
    const settingTheater = document.getElementById('setting-theater');
    const settingTheaterStatus = document.getElementById('setting-theater-status');
    const settingLights = document.getElementById('setting-lights');
    const settingLightsStatus = document.getElementById('setting-lights-status');

    const updateToggleUI = (el, isOn) => {
        if (!el) return;
        el.textContent = isOn ? 'BẬT' : 'TẮT';
        el.className = 'toggle-status ' + (isOn ? 'on' : 'off');
    };

    let isAutoplayOn = localStorage.getItem('phimtv_autoplay') === 'true';
    let isTheaterMode = localStorage.getItem('phimtv_theater') === 'true';
    let isLightOff = localStorage.getItem('phimtv_light') === 'true';

    updateToggleUI(settingAutoplayStatus, isAutoplayOn);
    updateToggleUI(settingTheaterStatus, isTheaterMode);
    updateToggleUI(settingLightsStatus, isLightOff);
    if (isTheaterMode) document.body.classList.add('theater-mode');
    if (isLightOff) document.body.classList.add('lights-off');

    if (settingAutoplay) settingAutoplay.addEventListener('click', () => {
        isAutoplayOn = !isAutoplayOn;
        localStorage.setItem('phimtv_autoplay', isAutoplayOn);
        updateToggleUI(settingAutoplayStatus, isAutoplayOn);
    });
    if (settingTheater) settingTheater.addEventListener('click', () => {
        isTheaterMode = !isTheaterMode;
        localStorage.setItem('phimtv_theater', isTheaterMode);
        updateToggleUI(settingTheaterStatus, isTheaterMode);
        document.body.classList.toggle('theater-mode', isTheaterMode);
    });
    const updateSpotlight = () => {
        const videoContainer = document.getElementById('custom-video-container');
        const overlay = document.getElementById('light-overlay');
        if (!videoContainer || !overlay) return;
        const rect = videoContainer.getBoundingClientRect();
        const cx = ((rect.left + rect.width / 2) / window.innerWidth * 100);
        const cy = ((rect.top + rect.height / 2) / window.innerHeight * 100);
        overlay.style.setProperty('--spotlight-x', cx + '%');
        overlay.style.setProperty('--spotlight-y', cy + '%');
    };

    if (settingLights) settingLights.addEventListener('click', () => {
        isLightOff = !isLightOff;
        localStorage.setItem('phimtv_light', isLightOff);
        updateToggleUI(settingLightsStatus, isLightOff);
        if (isLightOff) {
            updateSpotlight();
        }
        document.body.classList.toggle('lights-off', isLightOff);
    });

    if (isLightOff) {
        requestAnimationFrame(() => updateSpotlight());
    }

    window.addEventListener('resize', () => {
        if (document.body.classList.contains('lights-off')) {
            updateSpotlight();
        }
    });

    window.addEventListener('scroll', () => {
        if (document.body.classList.contains('lights-off')) {
            requestAnimationFrame(updateSpotlight);
        }
    }, { passive: true });

    const playPauseBtn = document.getElementById('play-pause-btn');
    const progressBar = document.getElementById('progress-bar');
    const progressContainer = document.getElementById('progress-container');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationDisplay = document.getElementById('duration');
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsMenu = document.getElementById('settings-menu');
    const speedSelector = document.getElementById('speed-selector');
    const customVideoContainer = document.getElementById('custom-video-container');

    if (videoPlayerGlobal && playPauseBtn) {
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsMenu.classList.toggle('show');
            });
            document.addEventListener('click', (e) => {
                if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
                    settingsMenu.classList.remove('show');
                }
            });
        }

        if (speedSelector) {
            speedSelector.value = localStorage.getItem('phimtv_speed') || "1";
            speedSelector.addEventListener('change', (e) => {
                videoPlayerGlobal.playbackRate = parseFloat(e.target.value);
                localStorage.setItem('phimtv_speed', e.target.value);
            });
        }

        const formatTime = (time) => {
            if (isNaN(time)) return "00:00";
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60);
            return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
        };

        const togglePlay = () => {
            if (videoPlayerGlobal.paused) {
                videoPlayerGlobal.play().catch(() => { });
                playPauseBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>';
            } else {
                videoPlayerGlobal.pause();
                playPauseBtn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
            }
        };
        playPauseBtn.addEventListener('click', togglePlay);
        videoPlayerGlobal.addEventListener('click', togglePlay);

        videoPlayerGlobal.addEventListener('play', () => playPauseBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>');
        videoPlayerGlobal.addEventListener('pause', () => playPauseBtn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>');

        const bufferedBar = document.getElementById('progress-buffered');
        const hoverTimeEl = document.getElementById('progress-hover-time');

        videoPlayerGlobal.addEventListener('timeupdate', () => {
            const current = videoPlayerGlobal.currentTime;
            const duration = videoPlayerGlobal.duration;
            if (duration) {
                const percent = (current / duration) * 100;
                progressBar.style.width = `${percent}%`;
                currentTimeDisplay.innerText = formatTime(current);
            }
        });

        videoPlayerGlobal.addEventListener('progress', () => {
            if (videoPlayerGlobal.duration && videoPlayerGlobal.buffered.length > 0) {
                const bufferedEnd = videoPlayerGlobal.buffered.end(videoPlayerGlobal.buffered.length - 1);
                const percent = (bufferedEnd / videoPlayerGlobal.duration) * 100;
                if (bufferedBar) bufferedBar.style.width = `${percent}%`;
            }
        });

        videoPlayerGlobal.addEventListener('loadedmetadata', () => {
            durationDisplay.innerText = formatTime(videoPlayerGlobal.duration);
        });

        let isSeeking = false;
        const seekToPosition = (clientX) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            if (videoPlayerGlobal.duration) {
                videoPlayerGlobal.currentTime = pos * videoPlayerGlobal.duration;
                progressBar.style.width = `${pos * 100}%`;
            }
        };

        progressContainer.addEventListener('mousedown', (e) => {
            isSeeking = true;
            seekToPosition(e.clientX);
        });
        document.addEventListener('mousemove', (e) => {
            if (isSeeking) seekToPosition(e.clientX);
        });
        document.addEventListener('mouseup', () => { isSeeking = false; });

        progressContainer.addEventListener('mousemove', (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (hoverTimeEl && videoPlayerGlobal.duration) {
                hoverTimeEl.innerText = formatTime(pos * videoPlayerGlobal.duration);
                hoverTimeEl.style.left = `${pos * rect.width}px`;
            }
        });

        const volumePercent = document.getElementById('volume-percent');
        const volumeContainer = document.getElementById('volume-container');

        const updateVolumeUI = () => {
            const vol = videoPlayerGlobal.muted ? 0 : videoPlayerGlobal.volume;
            volumeSlider.value = vol;
            const pct = Math.round(vol * 100);
            if (volumePercent) volumePercent.textContent = pct;

            // Gradient fill on slider track
            const gradient = `linear-gradient(to right, #f91942 0%, #ff4070 ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;
            volumeSlider.style.background = gradient;

            // Icon
            if (videoPlayerGlobal.muted || vol === 0) {
                muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_off</span>';
                muteBtn.classList.add('muted');
            } else if (vol < 0.3) {
                muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_mute</span>';
                muteBtn.classList.remove('muted');
            } else if (vol < 0.7) {
                muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_down</span>';
                muteBtn.classList.remove('muted');
            } else {
                muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_up</span>';
                muteBtn.classList.remove('muted');
            }
        };

        volumeSlider.addEventListener('input', (e) => {
            videoPlayerGlobal.volume = parseFloat(e.target.value);
            videoPlayerGlobal.muted = parseFloat(e.target.value) === 0;
            updateVolumeUI();
        });

        muteBtn.addEventListener('click', () => {
            videoPlayerGlobal.muted = !videoPlayerGlobal.muted;
            if (!videoPlayerGlobal.muted && videoPlayerGlobal.volume === 0) {
                videoPlayerGlobal.volume = 0.5;
            }
            updateVolumeUI();
        });

        videoPlayerGlobal.addEventListener('volumechange', () => {
            updateVolumeUI();
        });

        // Scroll wheel volume control on video container
        customVideoContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newVol = Math.max(0, Math.min(1, videoPlayerGlobal.volume + delta));
            videoPlayerGlobal.volume = newVol;
            videoPlayerGlobal.muted = newVol === 0;
            updateVolumeUI();

            // Brief highlight on volume container
            if (volumeContainer) {
                volumeContainer.classList.add('active');
                clearTimeout(volumeContainer._hideTimer);
                volumeContainer._hideTimer = setTimeout(() => {
                    volumeContainer.classList.remove('active');
                }, 1500);
            }
        }, { passive: false });

        // Initial volume UI
        updateVolumeUI();

        const updateFullscreenIcon = () => {
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (isFs) {
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen_exit</span>';
                fullscreenBtn.classList.add('fs-active');
            } else {
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen</span>';
                fullscreenBtn.classList.remove('fs-active');
            }
        };

        fullscreenBtn.addEventListener('click', () => toggleFullscreen(customVideoContainer));
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
    }

    if (btnPipToggle && videoPlayerGlobal) {
        btnPipToggle.addEventListener('click', async () => {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await videoPlayerGlobal.requestPictureInPicture();
            }
        });
    }

    if (videoPlayerGlobal) {
        const savedVolume = localStorage.getItem('phimtv_volume');
        if (savedVolume !== null) {
            videoPlayerGlobal.volume = parseFloat(savedVolume);
        }

        videoPlayerGlobal.addEventListener('volumechange', () => {
            localStorage.setItem('phimtv_volume', videoPlayerGlobal.volume);
        });

        videoPlayerGlobal.addEventListener('dblclick', () => {
            toggleFullscreen(document.getElementById('custom-video-container'));
        });
    }

    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        const videoPlayer = document.getElementById('video-player');

        if (!watchView || watchView.style.display !== 'block' || !videoPlayer) return;

        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement.isContentEditable;
        if (isInput) return;

        if (e.code === 'Space') {
            e.preventDefault();
            if (videoPlayer.paused) {
                videoPlayer.play().catch(() => { });
            } else {
                videoPlayer.pause();
            }
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            videoPlayer.currentTime += 10;
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            videoPlayer.currentTime -= 10;
        } else if (e.code === 'KeyF') {
            e.preventDefault();
            const btnFullscreen = document.getElementById('fullscreen-btn');
            if (btnFullscreen) {
                btnFullscreen.click();
            }
        } else if (e.code === 'ArrowUp') {
            e.preventDefault();
            if (videoPlayer.volume < 1) {
                videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1);
            }
        } else if (e.code === 'ArrowDown') {
            e.preventDefault();
            if (videoPlayer.volume > 0) {
                videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1);
            }
        } else if (e.code === 'KeyM') {
            e.preventDefault();
            videoPlayer.muted = !videoPlayer.muted;
        }
    });

    fetchHomeData();

    // ==================== RANDOM MOVIE BUTTON ====================
    const btnRandomMovie = document.getElementById('btn-random-movie');
    if (btnRandomMovie) {
        btnRandomMovie.addEventListener('click', async () => {
            btnRandomMovie.disabled = true;
            btnRandomMovie.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;animation:spin 1s linear infinite;">casino</span> ĐANG TÌM...';
            try {
                // Fetch a random page from new movies
                const randomPage = Math.floor(Math.random() * 5) + 1;
                const res = await fetchWithCache(`${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?page=${randomPage}`);
                const formatted = formatResponse(res);
                if (formatted.items && formatted.items.length > 0) {
                    const randomIndex = Math.floor(Math.random() * formatted.items.length);
                    const randomMovie = formatted.items[randomIndex];
                    showMovieDetails(randomMovie.slug);
                }
            } catch (e) {
                console.error('Random movie error:', e);
            } finally {
                btnRandomMovie.disabled = false;
                btnRandomMovie.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">casino</span> XEM GÌ HÔM NAY?';
            }
        });
    }

    // ==================== TRAILER AUTO-PLAY ON HOVER ====================
    let trailerPreviewTimer = null;
    let trailerPreviewVideo = null;

    function createTrailerPreview() {
        if (trailerPreviewVideo) return;
        trailerPreviewVideo = document.createElement('div');
        trailerPreviewVideo.className = 'trailer-preview-overlay';
        trailerPreviewVideo.innerHTML = `
            <iframe id="trailer-preview-iframe" src="" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
        `;
        document.body.appendChild(trailerPreviewVideo);
    }

    // Hover on movie cards to show trailer preview
    document.addEventListener('mouseenter', (e) => {
        const card = e.target.closest('.movie-card');
        if (!card) return;

        // Only on desktop
        if (window.innerWidth < 768) return;

        const slug = card.dataset?.slug;
        // We'll use the movie name from the card for search
        const movieName = card.querySelector('h3')?.innerText;
        if (!movieName) return;

        clearTimeout(trailerPreviewTimer);
        trailerPreviewTimer = setTimeout(async () => {
            try {
                // Search for trailer on YouTube
                const searchQuery = encodeURIComponent(movieName + ' trailer');
                createTrailerPreview();
                const iframe = document.getElementById('trailer-preview-iframe');
                if (iframe) {
                    iframe.src = `https://www.youtube.com/embed?listType=search&list=${searchQuery}&autoplay=1&mute=1`;
                    trailerPreviewVideo.style.display = 'flex';
                    const rect = card.getBoundingClientRect();
                    trailerPreviewVideo.style.top = (rect.top + rect.height / 2 - 150) + 'px';
                    trailerPreviewVideo.style.left = (rect.left + rect.width / 2 - 200) + 'px';
                }
            } catch (e) { }
        }, 1200);
    }, true);

    document.addEventListener('mouseleave', (e) => {
        const card = e.target.closest('.movie-card');
        if (!card) return;
        clearTimeout(trailerPreviewTimer);
        if (trailerPreviewVideo) {
            trailerPreviewVideo.style.display = 'none';
            const iframe = document.getElementById('trailer-preview-iframe');
            if (iframe) iframe.src = '';
        }
    }, true);

    // ==================== WATCH PARTY (BroadcastChannel) ====================
    let watchPartyChannel = null;
    let currentRoomId = null;
    let isHost = false;
    let wpSyncLock = false;

    const btnWatchParty = document.getElementById('btn-watch-party');
    const wpModal = document.getElementById('watch-party-modal');
    const btnCloseWpModal = document.getElementById('btn-close-wp-modal');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const wpRoomInput = document.getElementById('wp-room-input');
    const wpRoomInfo = document.getElementById('wp-room-info');
    const wpRoomCodeText = document.getElementById('wp-room-code-text');
    const wpStatus = document.getElementById('wp-status');
    const btnCopyRoom = document.getElementById('btn-copy-room');
    const btnLeaveRoom = document.getElementById('btn-leave-room');

    function generateRoomId() {
        return 'PTV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    function openWatchPartyModal() {
        wpModal.style.display = 'flex';
        if (currentRoomId) {
            wpRoomInfo.style.display = 'block';
            document.getElementById('wp-create-section').style.display = 'none';
            document.getElementById('wp-join-section').style.display = 'none';
            document.querySelector('.wp-divider').style.display = 'none';
        } else {
            wpRoomInfo.style.display = 'none';
            document.getElementById('wp-create-section').style.display = 'block';
            document.getElementById('wp-join-section').style.display = 'block';
            document.querySelector('.wp-divider').style.display = 'flex';
        }
    }

    function closeWatchPartyModal() {
        wpModal.style.display = 'none';
    }

    function joinRoom(roomId) {
        if (watchPartyChannel) {
            watchPartyChannel.close();
        }
        currentRoomId = roomId;
        watchPartyChannel = new BroadcastChannel('phimtv_watchparty_' + roomId);

        watchPartyChannel.onmessage = (event) => {
            const msg = event.data;
            if (msg.type === 'sync') {
                const videoPlayer = document.getElementById('video-player');
                if (!videoPlayer || wpSyncLock) return;
                wpSyncLock = true;
                if (videoPlayer.paused !== msg.paused) {
                    if (msg.paused) videoPlayer.pause();
                    else videoPlayer.play().catch(() => {});
                }
                if (Math.abs(videoPlayer.currentTime - msg.time) > 2) {
                    videoPlayer.currentTime = msg.time;
                }
                setTimeout(() => { wpSyncLock = false; }, 500);
            } else if (msg.type === 'play-movie') {
                showMovieDetails(msg.slug);
            } else if (msg.type === 'member-joined') {
                wpStatus.textContent = 'Có người vừa tham gia!';
                updateWpStatusDot(true);
            } else if (msg.type === 'host-left') {
                wpStatus.textContent = 'Chủ phòng đã rời đi';
                updateWpStatusDot(false);
            }
        };

        wpRoomCodeText.textContent = roomId;
        wpRoomInfo.style.display = 'block';
        document.getElementById('wp-create-section').style.display = 'none';
        document.getElementById('wp-join-section').style.display = 'none';
        document.querySelector('.wp-divider').style.display = 'none';
        wpStatus.textContent = 'Đã kết nối phòng!';
        updateWpStatusDot(true);

        // Notify others
        watchPartyChannel.postMessage({ type: 'member-joined' });
    }

    function leaveRoom() {
        if (watchPartyChannel) {
            if (isHost) {
                watchPartyChannel.postMessage({ type: 'host-left' });
            }
            watchPartyChannel.close();
            watchPartyChannel = null;
        }
        currentRoomId = null;
        isHost = false;
        wpRoomInfo.style.display = 'none';
        document.getElementById('wp-create-section').style.display = 'block';
        document.getElementById('wp-join-section').style.display = 'block';
        document.querySelector('.wp-divider').style.display = 'flex';
    }

    function updateWpStatusDot(connected) {
        const dot = document.querySelector('.wp-status-dot');
        if (dot) {
            dot.style.background = connected ? '#4caf50' : '#f44336';
            dot.style.boxShadow = connected ? '0 0 8px #4caf50' : '0 0 8px #f44336';
        }
    }

    if (btnWatchParty) btnWatchParty.addEventListener('click', openWatchPartyModal);
    if (btnCloseWpModal) btnCloseWpModal.addEventListener('click', closeWatchPartyModal);
    if (wpModal) wpModal.addEventListener('click', (e) => {
        if (e.target === wpModal) closeWatchPartyModal();
    });

    if (btnCreateRoom) btnCreateRoom.addEventListener('click', () => {
        isHost = true;
        joinRoom(generateRoomId());
    });

    if (btnJoinRoom) btnJoinRoom.addEventListener('click', () => {
        const roomId = wpRoomInput.value.trim();
        if (roomId) {
            isHost = false;
            joinRoom(roomId);
        }
    });

    if (wpRoomInput) wpRoomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnJoinRoom.click();
    });

    if (btnCopyRoom) btnCopyRoom.addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoomId).then(() => {
            btnCopyRoom.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">check</span> Đã sao chép';
            setTimeout(() => {
                btnCopyRoom.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">content_copy</span> Sao chép';
            }, 2000);
        });
    });

    if (btnLeaveRoom) btnLeaveRoom.addEventListener('click', leaveRoom);

    // Sync video state periodically when in room
    setInterval(() => {
        if (!watchPartyChannel || !currentRoomId) return;
        const videoPlayer = document.getElementById('video-player');
        const watchView = document.getElementById('watch-view');
        if (!videoPlayer || !watchView || watchView.style.display !== 'block') return;
        if (wpSyncLock) return;

        watchPartyChannel.postMessage({
            type: 'sync',
            time: videoPlayer.currentTime,
            paused: videoPlayer.paused,
            slug: currentMovieData?.slug || ''
        });
    }, 3000);

    // ==================== ENHANCED PICTURE-IN-PICTURE ====================
    const pipIndicator = document.getElementById('pip-indicator');
    const pipReturn = document.getElementById('pip-return');
    const pipTitle = document.getElementById('pip-title');

    if (videoPlayerGlobal) {
        videoPlayerGlobal.addEventListener('enterpictureinpicture', () => {
            if (pipIndicator) {
                pipIndicator.style.display = 'flex';
                pipTitle.textContent = currentMovieData ? `Đang phát: ${currentMovieData.name}` : 'Đang phát thu nhỏ';
            }
        });

        videoPlayerGlobal.addEventListener('leavepictureinpicture', () => {
            if (pipIndicator) pipIndicator.style.display = 'none';
        });
    }

    if (pipReturn) {
        pipReturn.addEventListener('click', async () => {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            }
        });
    }

});

async function fetchHomeData() {
    document.getElementById('loading-initial').style.display = 'flex';
    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';

    try {
        const endpoints = [
            `${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?page=1`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?page=2`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-bo`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-le`,
            `${API_BASE_URL}/v1/api/danh-sach/hoat-hinh`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-le?page=2`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-bo?page=2`
        ];

        const responses = await Promise.all(endpoints.map(url => fetchWithCache(url).catch(() => null)));
        const formatted = responses.map(formatResponse);

        let allMovies = [];
        formatted.forEach(f => allMovies = allMovies.concat(f.items || []));
        extractFiltersFromMovies(allMovies);

        if (formatted[0].domain) imageDomain = formatted[0].domain + '/';

        const heroMovie = formatted[0].items?.[0] || null;
        if (heroMovie) {
            const imgUrl = getImageUrl(imageDomain, heroMovie.thumb_url || heroMovie.poster_url);
            const heroSection = document.getElementById('heroBanner');
            heroSection.style.backgroundImage = `linear-gradient(to right, #050505 10%, rgba(5, 5, 5, 0.4) 60%), linear-gradient(to top, #050505 0%, transparent 30%), url('${imgUrl}')`;
            document.getElementById('hero-title').innerText = heroMovie.name;
            document.getElementById('hero-year').innerText = heroMovie.year || "2024";
            document.getElementById('hero-desc').innerText = heroMovie.origin_name || "";
            document.getElementById('hero-btn').onclick = () => showMovieDetails(heroMovie.slug);

            fetchWithCache(`${API_BASE_URL}/v1/api/phim/${heroMovie.slug}/images`).then(tmdbJson => {
                if (tmdbJson.success && tmdbJson.data && tmdbJson.data.images) {
                    const tmdbBackdrops = tmdbJson.data.images.filter(img => img.type === "backdrop");
                    if (tmdbBackdrops.length > 0 && tmdbBackdrops[0].file_path) {
                        const bgUrl = TMDB_BACKDROP_BASE + tmdbBackdrops[0].file_path;
                        heroSection.style.backgroundImage = `linear-gradient(to right, #050505 10%, rgba(5, 5, 5, 0.4) 60%), linear-gradient(to top, #050505 0%, transparent 30%), url('${bgUrl}')`;
                    }
                }
            }).catch(() => { });
        }

        renderMoviesCards(formatted[0].items.slice(0, 21), 'grid-new-update', false);
        renderMoviesCards(formatted[1].items.slice(0, 4), 'grid-theaters', true);
        renderMoviesCards(formatted[2].items.slice(0, 7), 'grid-series', false);
        renderMoviesCards(formatted[3].items.slice(0, 7), 'grid-movies', false);

        renderUpcoming(formatted[4].items.slice(0, 5), 'sidebar-upcoming');
        renderTopMovies(formatted[5].items.slice(0, 5), 'sidebar-top-movies');
        renderTopSeries(formatted[6].items.slice(0, 8), 'sidebar-top-series');

    } catch (e) {
        console.error(e);
    } finally {
        document.getElementById('loading-initial').style.display = 'none';
        document.getElementById('heroBanner').style.display = 'flex';
        document.getElementById('main-content').style.display = 'flex';
        document.getElementById('home-view').style.display = 'block';
    }
}

function extractFiltersFromMovies(movies) {
    if (!movies || !Array.isArray(movies)) return;
    let isUpdated = false;

    movies.forEach(m => {
        if (m.year && !yearsSet.has(m.year)) {
            yearsSet.add(m.year);
            isUpdated = true;
        }
        if (m.category && Array.isArray(m.category)) {
            m.category.forEach(c => {
                if (c.slug && c.name && !categoriesMap.has(c.slug)) {
                    categoriesMap.set(c.slug, c);
                    isUpdated = true;
                }
            });
        }
        if (m.country && Array.isArray(m.country)) {
            m.country.forEach(c => {
                if (c.slug && c.name && !countriesMap.has(c.slug)) {
                    countriesMap.set(c.slug, c);
                    isUpdated = true;
                }
            });
        }
    });

    renderFilterUI();
}

function renderFilterUI() {
    const catList = document.getElementById('category-list');
    const countryList = document.getElementById('country-list');
    const yearList = document.getElementById('year-list');
    const filterCat = document.getElementById('filter-category');
    const filterCountry = document.getElementById('filter-country');
    const filterYear = document.getElementById('filter-year');

    const renderMap = (map, navEl, selectEl, endpointPrefix, labelPrefix) => {
        navEl.innerHTML = "";
        selectEl.innerHTML = `<option value="">- Tất cả ${labelPrefix.toLowerCase()} -</option>`;
        const sortedArray = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

        sortedArray.forEach(item => {
            const a = document.createElement('a');
            a.href = "#";
            a.innerText = item.name;
            a.onclick = (e) => {
                e.preventDefault();
                loadFilterData(endpointPrefix, item.slug, `${labelPrefix}: ${item.name}`, 1);
            };
            navEl.appendChild(a);

            const opt = document.createElement('option');
            opt.value = item.slug;
            opt.innerText = item.name;
            selectEl.appendChild(opt);
        });
    };

    renderMap(categoriesMap, catList, filterCat, 'the-loai', 'Thể loại');
    renderMap(countriesMap, countryList, filterCountry, 'quoc-gia', 'Quốc gia');

    yearList.innerHTML = "";
    filterYear.innerHTML = `<option value="">- Tất cả năm -</option>`;
    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

    sortedYears.forEach(year => {
        const a = document.createElement('a');
        a.href = "#";
        a.innerText = year;
        a.onclick = (e) => {
            e.preventDefault();
            loadFilterData('nam', year, `Năm phát hành: ${year}`, 1);
        };
        yearList.appendChild(a);

        const opt = document.createElement('option');
        opt.value = year;
        opt.innerText = year;
        filterYear.appendChild(opt);
    });

    if (typeof currentFilterEndpoint !== 'undefined') {
        filterCat.value = currentFilterEndpoint === 'the-loai' ? currentFilterSlug : "";
        filterCountry.value = currentFilterEndpoint === 'quoc-gia' ? currentFilterSlug : "";
        // So sánh chuỗi cho khớp với value của option
        filterYear.value = currentFilterEndpoint === 'nam' ? currentFilterSlug.toString() : "";
    }
}

function navigateToHome(e) {
    if (e) e.preventDefault();
    document.title = "Phim.tv - Giao diện Web";
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';

    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }
    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) { }
        hlsInstance = null;
    }
    if (nextEpTimer) {
        clearInterval(nextEpTimer);
        const overlay = document.getElementById('next-ep-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    currentFilterEndpoint = "";
    currentFilterSlug = "";
    currentFilterTitle = "";
    currentFilterPage = 1;

    const filterCat = document.getElementById('filter-category');
    const filterCountry = document.getElementById('filter-country');
    const filterYear = document.getElementById('filter-year');
    if (filterCat) filterCat.value = "";
    if (filterCountry) filterCountry.value = "";
    if (filterYear) filterYear.value = "";

    document.getElementById('heroBanner').style.display = 'flex';
    document.getElementById('home-view').style.display = 'block';
    document.getElementById('filter-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'none';
    document.querySelector('.main-container').classList.add('with-hero');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleSearch() {
    const keyword = document.getElementById('searchInput').value.trim();
    if (!keyword) return;
    loadFilterData('search', keyword, `Kết quả tìm kiếm: ${keyword}`, 1);
}

function handleAdvancedFilter() {
    const cat = document.getElementById('filter-category').value;
    const country = document.getElementById('filter-country').value;
    const year = document.getElementById('filter-year').value;

    if (cat) loadFilterData('the-loai', cat, `Thể loại: ${categoriesMap.get(cat)?.name || cat}`, 1);
    else if (country) loadFilterData('quoc-gia', country, `Quốc gia: ${countriesMap.get(country)?.name || country}`, 1);
    else if (year) loadFilterData('nam', year, `Năm phát hành: ${year}`, 1);
    else loadFilterData('new', '', 'Tất cả tác phẩm', 1);
}

function buildFilterUrl(endpointType, slug, page) {
    if (endpointType === 'search') {
        return `${API_BASE_URL}/v1/api/tim-kiem?keyword=${encodeURIComponent(slug)}&limit=24&page=${page}`;
    } else if (endpointType === 'nam') {
        return `${API_BASE_URL}/v1/api/nam-phat-hanh/${slug}?limit=24&page=${page}`;
    } else if (endpointType === 'new') {
        return `${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?limit=24&page=${page}`;
    } else if (endpointType === 'danh-sach') {
        return `${API_BASE_URL}/v1/api/danh-sach/${slug}?limit=24&page=${page}`;
    } else {
        return `${API_BASE_URL}/v1/api/${endpointType}/${slug}?limit=24&page=${page}`;
    }
}

async function loadFilterData(endpointType, slug, titleText, page) {
    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'flex';
    document.getElementById('video-player').src = "";
    document.getElementById('filter-view').style.display = 'block';
    document.querySelector('.main-container').classList.remove('with-hero');

    currentFilterEndpoint = endpointType;
    currentFilterSlug = slug;
    currentFilterTitle = titleText;
    currentFilterPage = page;

    const titleElement = document.getElementById('filter-title');
    const gridElement = document.getElementById('grid-filter');
    const paginationContainer = document.getElementById('pagination-container');

    titleElement.innerText = titleText;
    gridElement.innerHTML = "<div style='color: white; padding: 20px; width: 100%; text-align: center;'>Đang tải dữ liệu...</div>";
    paginationContainer.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const searchId = ++currentSearchId;

    try {
        const url = buildFilterUrl(endpointType, slug, page);
        const res = await fetchWithCache(url);

        if (searchId !== currentSearchId) return;
        if (!res) throw new Error("API null");

        const formatted = formatResponse(res);
        const items = formatted.items;
        const localDomain = formatted.domain.endsWith('/') ? formatted.domain : formatted.domain + '/';

        const dataObj = res?.data || res;
        let paginationObj = dataObj?.params?.pagination || dataObj?.pagination;
        if (paginationObj) {
            if (paginationObj.totalPages) {
                totalFilterPages = paginationObj.totalPages;
            } else if (paginationObj.totalItems && paginationObj.totalItemsPerPage) {
                totalFilterPages = Math.ceil(paginationObj.totalItems / paginationObj.totalItemsPerPage);
            } else {
                totalFilterPages = 1;
            }
        } else {
            totalFilterPages = 1;
        }

        extractFiltersFromMovies(items);

        gridElement.innerHTML = "";
        if (items.length === 0) {
            gridElement.innerHTML = "<div style='color: white; padding: 20px; width: 100%; text-align: center;'>Không tìm thấy tác phẩm nào.</div>";
        }

        renderMoviesCardsAppend(items, gridElement, false, localDomain);

        if (totalFilterPages > 1) {
            paginationContainer.style.display = 'flex';
            document.getElementById('total-pages-display').innerText = totalFilterPages;
            document.getElementById('input-page-jump').value = currentFilterPage;

            document.getElementById('btn-prev-page').disabled = (currentFilterPage === 1);
            document.getElementById('btn-next-page').disabled = (currentFilterPage === totalFilterPages);
        }

        if (page < totalFilterPages) {
            const nextUrl = buildFilterUrl(endpointType, slug, page + 1);
            fetchWithCache(nextUrl).catch(() => { });
        }
    } catch (error) {
        if (searchId === currentSearchId) {
            gridElement.innerHTML = `<div style='color: #f91942; padding: 20px; width: 100%; text-align: center;'>Lỗi tải dữ liệu.</div>`;
        }
    }
}

function renderMoviesCards(movies, containerId, isHorizontal = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    renderMoviesCardsAppend(movies, container, isHorizontal);
}

function renderMoviesCardsAppend(movies, container, isHorizontal = false, domain = imageDomain) {
    const fragment = document.createDocumentFragment();
    const observer = getImageObserver();

    movies.forEach(movie => {
        const card = document.createElement("div");
        card.className = `movie-card ${isHorizontal ? 'horizontal' : ''}`;
        card.tabIndex = 0;

        const imagePath = isHorizontal ? (movie.thumb_url || movie.poster_url) : (movie.poster_url || movie.thumb_url);
        const imgUrl = getImageUrl(domain, imagePath);
        card.innerHTML = `
            <span class="badge badge-red">${getMovieBadge(movie)}</span>
            <div class="image-container">
                <img class="skeleton" data-src="${imgUrl}" alt="${movie.name}" decoding="async" fetchpriority="low" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
                <div class="card-overlay"><span class="material-symbols-rounded" style="font-size:40px;">play_arrow</span></div>
            </div>
            <div class="info">
                <h3>${movie.name}</h3>
            <p>${isHorizontal ? (movie.origin_name || "") : (movie.year || movie.origin_name || "")}</p>
            </div>
        `;

        card.onclick = () => showMovieDetails(movie.slug);
        card.onkeydown = (e) => { if (e.key === 'Enter') showMovieDetails(movie.slug); };
        fragment.appendChild(card);
    });

    container.appendChild(fragment);

    // Use Intersection Observer for smarter lazy loading with preload buffer
    if (observer) {
        container.querySelectorAll('img[data-src]').forEach(img => {
            observer.observe(img);
        });
    } else {
        // Fallback: load all images immediately if no observer support
        container.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        });
    }
}

function renderUpcoming(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach(movie => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="bullet"><span class="material-symbols-rounded" style="font-size:12px;">fiber_manual_record</span></span> <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${movie.name}</span> <span class="year">${movie.year || ""}</span>`;
        li.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(li);
    });
}

function renderTopMovies(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach((movie, index) => {
        const li = document.createElement("li");
        const imagePath = movie.poster_url || movie.thumb_url;
        const imgUrl = getImageUrl(imageDomain, imagePath);
        const episodeCurrent = movie.episode_current || "HD";

        li.innerHTML = `
            <div class="rank-number">${index + 1}</div>
            <img src="${imgUrl}" class="rank-thumb skeleton" alt="${movie.name}" loading="lazy" decoding="async" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
            <div class="rank-info">
                <h4>${movie.name}</h4>
                <div class="rank-meta">
                    <span class="quality">${episodeCurrent}</span> <span class="rating"><span class="material-symbols-rounded" style="font-size:14px;color:#ffc107;">star</span> 8.0</span> <span class="year">${movie.year || ""}</span>
                </div>
            </div>
        `;
        li.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(li);
    });
}

function getMovieBadge(movie) {
    if (movie.episode_current && movie.episode_current.trim() !== "") {
        if (movie.episode_current.toLowerCase() === "full") {
            return movie.quality || "Hoàn thành";
        }
        return movie.episode_current;
    }
    if (movie.type === "single") return movie.quality || "Phim lẻ";
    if (movie.type === "hoathinh") return movie.quality || "Hoạt hình";
    return movie.quality || "";
}

function renderTopSeries(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card small";

        const imagePath = movie.poster_url || movie.thumb_url;
        const imgUrl = getImageUrl(imageDomain, imagePath);

        card.innerHTML = `
            <span class="badge badge-red">${getMovieBadge(movie)}</span>
            <div class="image-container">
               <img class="skeleton" src="${imgUrl}" alt="${movie.name}" loading="lazy" decoding="async" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
               <div class="card-overlay"><span class="material-symbols-rounded" style="font-size:40px;">play_arrow</span></div>
            </div>
            <div class="info"><h4>${movie.name}</h4></div>
        `;
        card.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(card);
    });
}

async function showMovieDetails(slug) {
    // Properly cleanup video player before loading new movie
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }
    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) { }
        hlsInstance = null;
    }
    if (nextEpTimer) {
        clearInterval(nextEpTimer);
        const overlay = document.getElementById('next-ep-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('filter-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'none';
    document.getElementById('detail-view').style.display = 'block';
    document.getElementById('detail-view').style.backgroundImage = "none";
    document.querySelector('.main-container').classList.remove('with-hero');

    document.getElementById('detail-title').innerText = "Đang tải...";
    document.getElementById('episode-list').innerHTML = "";
    document.getElementById('server-list').innerHTML = "";
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        const json = await fetchWithCache(`${API_BASE_URL}/v1/api/phim/${slug}`);
        currentMovieData = json.status === 'success' ? json.data.item : json.movie;
        const eps = json.status === 'success' ? currentMovieData.episodes : json.episodes;
        currentMovieData.episodes = eps;

        const dImg = json.data?.APP_DOMAIN_CDN_IMAGE || json.pathImage || imageDomain;

        const posterEl = document.getElementById('detail-poster');
        const imagePath = currentMovieData.poster_url || currentMovieData.thumb_url;
        posterEl.src = getImageUrl(dImg, imagePath);
        posterEl.decoding = 'async';
        posterEl.fetchPriority = 'high';
        posterEl.onerror = function () { handleImageError(this); };

        document.title = currentMovieData.name + " - Phim.tv";
        document.getElementById('detail-title').innerText = currentMovieData.name;
        document.getElementById('detail-origin-name').innerText = currentMovieData.origin_name || "Đang cập nhật";
        document.getElementById('detail-quality').innerText = currentMovieData.quality || "HD";
        document.getElementById('detail-lang').innerText = currentMovieData.lang || "Vietsub";
        document.getElementById('detail-year').innerText = currentMovieData.year || "Đang cập nhật";
        document.getElementById('detail-content').innerHTML = currentMovieData.content || "Chưa có nội dung mô tả.";

        const trailerBtn = document.getElementById('detail-trailer');
        if (currentMovieData.trailer_url) {
            trailerBtn.href = currentMovieData.trailer_url;
            trailerBtn.style.display = 'inline-flex';
        } else {
            trailerBtn.style.display = 'none';
        }

        const btnWatchNow = document.getElementById('btn-watch-now');
        if (eps && eps.length > 0 && eps[0].server_data && eps[0].server_data.length > 0) {
            btnWatchNow.style.display = 'inline-flex';
            btnWatchNow.onclick = () => openWatchView(eps[0].server_data[0]);
        } else {
            btnWatchNow.style.display = 'none';
        }

        const btnContinue = document.getElementById('btn-continue-watch');
        if (!watchHistoryCache) {
            watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
        }
        let lastWatchedEp = watchHistoryCache[slug];

        if (btnContinue) {
            if (lastWatchedEp) {
                btnContinue.style.display = 'inline-flex';
                btnContinue.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">play_arrow</span> TIẾP TỤC XEM TẬP ${lastWatchedEp.name}`;
                btnContinue.onclick = () => openWatchView(lastWatchedEp);
            } else {
                btnContinue.style.display = 'none';
            }
        }

        const categories = currentMovieData.category ? currentMovieData.category.map(c => c.name).join(', ') : "Đang cập nhật";
        document.getElementById('detail-categories').innerText = categories;
        const countries = currentMovieData.country ? currentMovieData.country.map(c => c.name).join(', ') : "Đang cập nhật";
        document.getElementById('detail-countries').innerText = countries;
        const directors = currentMovieData.director && currentMovieData.director.length > 0 ? currentMovieData.director.join(', ') : "Đang cập nhật";
        document.getElementById('detail-directors').innerText = directors;
        const actors = currentMovieData.actor && currentMovieData.actor.length > 0 ? currentMovieData.actor.join(', ') : "Đang cập nhật";
        document.getElementById('detail-actors').innerText = actors;

        const serverContainer = document.getElementById('server-list');

        if (eps && eps.length > 0) {
            eps.forEach((server, index) => {
                const sBtn = document.createElement("button");
                sBtn.className = "btn-server" + (index === 0 ? " active" : "");
                sBtn.innerText = "Server " + server.server_name;
                sBtn.onclick = (e) => {
                    document.querySelectorAll('.btn-server').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    renderEpisodesByServer(server.server_data, 'episode-list', false);
                };
                serverContainer.appendChild(sBtn);
            });
            renderEpisodesByServer(eps[0].server_data, 'episode-list', false);
        } else {
            document.getElementById('episode-list').innerHTML = "<p style='color: white;'>Phim đang được cập nhật tập mới.</p>";
        }

        loadTMDBImagesForDetail(slug);
    } catch (error) {
        document.getElementById('detail-title').innerText = "Lỗi khi lấy thông tin phim.";
    }
}

async function loadTMDBImagesForDetail(slug) {
    const gallerySection = document.getElementById('gallery-section');
    const galleryWrapper = document.getElementById('detail-gallery');
    const detailView = document.getElementById('detail-view');
    const posterEl = document.getElementById('detail-poster');

    galleryWrapper.innerHTML = "";
    gallerySection.style.display = 'none';
    try {
        const json = await fetchWithCache(`${API_BASE_URL}/v1/api/phim/${slug}/images`);
        if (json.success && json.data && json.data.images && json.data.images.length > 0) {
            const allImages = json.data.images;
            const tmdbPoster = allImages.find(img => img.type === "poster");
            if (tmdbPoster && tmdbPoster.file_path) {
                const newPosterUrl = TMDB_POSTER_BASE + tmdbPoster.file_path;
                const tempImg = new Image();
                tempImg.onload = () => { posterEl.src = newPosterUrl; };
                tempImg.src = newPosterUrl;
            }
            const tmdbBackdrops = allImages.filter(img => img.type === "backdrop");
            if (tmdbBackdrops.length > 0 && tmdbBackdrops[0].file_path) {
                const bgUrl = TMDB_BACKDROP_BASE + tmdbBackdrops[0].file_path;
                detailView.style.backgroundImage = `linear-gradient(to right, #050505 30%, rgba(5, 5, 5, 0.7) 100%), url('${bgUrl}')`;
                detailView.style.backgroundSize = "cover";
                detailView.style.backgroundPosition = "center top";
                detailView.style.backgroundAttachment = "fixed";
            }
            if (tmdbBackdrops.length > 1) {
                const galleryImages = tmdbBackdrops.slice(1);
                galleryImages.forEach(imgData => {
                    const img = document.createElement('img');
                    img.className = 'gallery-img';
                    img.src = TMDB_GALLERY_BASE + imgData.file_path;
                    img.loading = "lazy";
                    img.decoding = "async";
                    img.onerror = function () { this.style.display = 'none'; };
                    galleryWrapper.appendChild(img);
                });
                gallerySection.style.display = 'block';
            }
        }
    } catch (error) { }
}

function renderEpisodesByServer(serverData, containerId, isWatchView) {
    const episodeContainer = document.getElementById(containerId);
    episodeContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();

    serverData.forEach(ep => {
        const btn = document.createElement("button");
        btn.className = "btn-episode";
        btn.innerText = ep.name;
        btn.onclick = (e) => {
            if (!isWatchView) {
                openWatchView(ep);
            } else {
                updateWatchViewPlayer(ep, e.target);
            }
        };
        fragment.appendChild(btn);
    });

    episodeContainer.appendChild(fragment);
}

function openWatchView(episodeData) {
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const watchServerContainer = document.getElementById('watch-server-list');
    watchServerContainer.innerHTML = "";
    currentMovieData.episodes.forEach((server, index) => {
        const sBtn = document.createElement("button");
        sBtn.className = "btn-server" + (index === 0 ? " active" : "");
        sBtn.innerText = "Server " + server.server_name;
        sBtn.onclick = (e) => {
            document.getElementById('watch-server-list').querySelectorAll('.btn-server').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderEpisodesByServer(server.server_data, 'watch-episode-list', true);
        };
        watchServerContainer.appendChild(sBtn);
    });
    renderEpisodesByServer(currentMovieData.episodes[0].server_data, 'watch-episode-list', true);

    setTimeout(() => {
        const firstEpBtn = document.getElementById('watch-episode-list').querySelector('.btn-episode');
        if (firstEpBtn) {
            updateWatchViewPlayer(episodeData, firstEpBtn);
        }
    }, 100);
}

function updateWatchViewPlayer(ep, btnElement) {
    if (nextEpTimer) {
        clearInterval(nextEpTimer);
    }
    const overlay = document.getElementById('next-ep-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    const episodeListContainer = document.getElementById('watch-episode-list');
    const currentActive = episodeListContainer.querySelector('.active');

    if (currentActive) {
        currentActive.classList.remove('active');
    }

    const allBtns = Array.from(episodeListContainer.children);
    let currentIndex = allBtns.indexOf(btnElement);

    if (btnElement) {
        btnElement.classList.add('active');
        btnElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.title = `▶ ${currentMovieData.name} - Tập ${ep.name}`;
    document.getElementById('watch-title').innerText = `${currentMovieData.name} - Tập ${ep.name}`;

    const videoPlayer = document.getElementById('video-player');
    const videoLoader = document.getElementById('video-loader');

    videoPlayer.focus();
    videoPlayer.playbackRate = parseFloat(localStorage.getItem('phimtv_speed') || "1");
    videoLoader.style.display = 'flex';
    videoPlayer.style.opacity = '0';

    if (!watchHistoryCache) {
        watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
    }

    let savedTime = 0;
    if (watchHistoryCache[currentMovieData.slug] && watchHistoryCache[currentMovieData.slug].name === ep.name && watchHistoryCache[currentMovieData.slug].currentTime) {
        savedTime = watchHistoryCache[currentMovieData.slug].currentTime;
    }

    watchHistoryCache[currentMovieData.slug] = ep;
    watchHistoryCache[currentMovieData.slug].currentTime = savedTime;
    trimWatchHistory(watchHistoryCache);
    localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));

    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) { }
        hlsInstance = null;
    }

    videoPlayer.src = "";
    videoPlayer.load();

    let streamUrl = ep.link_m3u8;
    if (streamUrl.startsWith("http://")) {
        streamUrl = streamUrl.replace(/^http:/, "https:");
    }

    if (window.Hls && Hls.isSupported()) {
        let hlsConfig = {
            fragLoadingMaxRetry: 8,
            fragLoadingRetryDelay: 500,
            manifestLoadingMaxRetry: 5,
            manifestLoadingRetryDelay: 500,
            levelLoadingMaxRetry: 5,
            levelLoadingRetryDelay: 500,
            startLevel: -1,
            abrEwmaDefaultEstimate: 2000000,
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.7,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            maxBufferSize: 60 * 1024 * 1024,
            maxBufferHole: 0.5,
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            nudgeOffset: 0.2,
            nudgeMaxRetry: 5,
            maxFragLookUpTolerance: 0.25
        };
        hlsInstance = new Hls(hlsConfig);
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(videoPlayer);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
            videoLoader.style.display = 'none';
            videoPlayer.style.opacity = '1';
            videoPlayer.currentTime = savedTime;

            const qualitySetting = document.getElementById('quality-setting');
            const qualitySelector = document.getElementById('quality-selector');
            if (data.levels && data.levels.length > 1) {
                qualitySelector.innerHTML = '<option value="-1">Tự động</option>';
                data.levels.forEach((level, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    opt.innerText = level.height ? `${level.height}p` : `${index + 1}`;
                    qualitySelector.appendChild(opt);
                });
                qualitySetting.style.display = 'flex';

                qualitySelector.onchange = (e) => {
                    hlsInstance.currentLevel = parseInt(e.target.value);
                };
            } else {
                qualitySetting.style.display = 'none';
            }

            videoPlayer.muted = false;

            const playPromise = videoPlayer.play();

            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        videoLoader.style.display = 'none';
                        videoPlayer.style.opacity = '1';
                    })
                    .catch(() => {
                        videoPlayer.muted = true;

                        videoPlayer.play().then(() => {
                            videoLoader.style.display = 'none';
                            videoPlayer.style.opacity = '1';
                        });
                    });
            }
        });
        let mediaErrorRetries = 0;
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            console.log("HLS ERROR:", data.type, data.details, data.fatal);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.warn("Lỗi mạng, đang thử tải lại...");
                        setTimeout(() => hlsInstance.startLoad(), 1000);
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        mediaErrorRetries++;
                        if (mediaErrorRetries <= 3) {
                            console.warn(`Lỗi media (#${mediaErrorRetries}), đang khôi phục...`);
                            if (data.details === 'bufferAppendError' || data.details === 'bufferFullError') {
                                try {
                                    const sb = videoPlayer.buffered;
                                    if (sb.length > 0) {
                                        hlsInstance.recoverMediaError();
                                    }
                                } catch (e) { }
                            }
                            hlsInstance.recoverMediaError();
                        } else {
                            console.error("Không thể khôi phục media, tải lại từ đầu...");
                            mediaErrorRetries = 0;
                            const currentTime = videoPlayer.currentTime;
                            const wasPaused = videoPlayer.paused;
                            try { hlsInstance.destroy(); } catch (e) { }
                            hlsInstance = new Hls(hlsConfig);
                            hlsInstance.loadSource(streamUrl);
                            hlsInstance.attachMedia(videoPlayer);
                            hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
                                videoPlayer.currentTime = currentTime;
                                if (!wasPaused) videoPlayer.play().catch(() => { });
                            });
                        }
                        break;
                    default:
                        console.error("Lỗi HLS nghiêm trọng.");
                        try { hlsInstance.destroy(); } catch (e) { }
                        hlsInstance = null;
                        break;
                }
            } else {
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    if (data.details === 'bufferAppendError' || data.details === 'bufferSeekOverHole' || data.details === 'bufferNudgeOnStall') {
                        console.warn(`Non-fatal: ${data.details}, recovering...`);
                        try {
                            hlsInstance.recoverMediaError();
                        } catch (e) { }
                    }
                }
            }
        });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        videoPlayer.src = streamUrl;

        videoPlayer.addEventListener('loadedmetadata', function () {
            videoPlayer.currentTime = savedTime;

            videoPlayer.muted = false;

            const playPromise = videoPlayer.play();

            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        videoLoader.style.display = 'none';
                        videoPlayer.style.opacity = '1';
                    })
                    .catch(() => {
                        videoPlayer.muted = true;

                        videoPlayer.play().then(() => {
                            videoLoader.style.display = 'none';
                            videoPlayer.style.opacity = '1';
                        });
                    });
            }
        });
    }

    videoPlayer.ontimeupdate = () => {
        if (!watchHistoryCache) {
            watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
        }
        if (watchHistoryCache[currentMovieData.slug] && watchHistoryCache[currentMovieData.slug].name === ep.name) {
            watchHistoryCache[currentMovieData.slug].currentTime = videoPlayer.currentTime;
            localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));
        }
    };

    document.getElementById('watch-view').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const btnPrev = document.getElementById('btn-prev-ep');
    const btnNext = document.getElementById('btn-next-ep');

    if (btnPrev) {
        if (currentIndex > 0) {
            btnPrev.style.display = 'inline-block';
            btnPrev.onclick = () => {
                allBtns[currentIndex - 1].click();
            };
        } else {
            btnPrev.style.display = 'none';
        }
    }

    if (btnNext) {
        if (currentIndex >= 0 && currentIndex < allBtns.length - 1) {
            btnNext.style.display = 'inline-block';
            btnNext.onclick = () => {
                allBtns[currentIndex + 1].click();
            };
        } else {
            btnNext.style.display = 'none';
        }
    }
}

function initSpatialNavigation() {
    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        if (watchView && watchView.style.display === 'block') return;

        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (!arrowKeys.includes(e.key)) return;

        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement.isContentEditable;
        if (isInput) return;

        const focusables = Array.from(document.querySelectorAll('.movie-card, .btn-play, .btn-primary, .btn-more, .btn-server, .btn-episode, .switch-item, .dropdown > a, .btn-exit-header, .sidebar-list li, #searchInput, .btn-page'));
        const currentFocus = document.activeElement;

        if (!currentFocus || !focusables.includes(currentFocus)) {
            e.preventDefault();
            const startElement = document.querySelector('.movie-card') || focusables[0];
            if (startElement) startElement.focus();
            return;
        }

        e.preventDefault();
        const currentRect = currentFocus.getBoundingClientRect();
        let bestMatch = null;
        let minDistance = Infinity;

        focusables.forEach(el => {
            if (el === currentFocus) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            let isMatch = false;
            let distance = Infinity;

            const dx = (rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2);
            const dy = (rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2);

            if (e.key === 'ArrowRight' && rect.left >= currentRect.right - 20) {
                isMatch = true; distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (e.key === 'ArrowLeft' && rect.right <= currentRect.left + 20) {
                isMatch = true; distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (e.key === 'ArrowDown' && rect.top >= currentRect.bottom - 20) {
                isMatch = true; distance = Math.abs(dy) + Math.abs(dx) * 3;
            } else if (e.key === 'ArrowUp' && rect.bottom <= currentRect.top + 20) {
                isMatch = true; distance = Math.abs(dy) + Math.abs(dx) * 3;
            }

            if (isMatch && distance < minDistance) {
                minDistance = distance;
                bestMatch = el;
            }
        });

        if (bestMatch) {
            bestMatch.focus();
            bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}