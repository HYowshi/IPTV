// ==================== GLOBAL STATE ====================
let epgData = {};
let allChannels = [];
let currentChannelList = [];
let tvHlsInstance = null;
let currentPlayingChannel = null;
let tvDashInstance = null;
let osdTimer = null;
let selectedGroup = 'all';
let quickListDirty = true;
let currentStreamUrl = null;
let ytPlayerReady = false;
let ytPlayerInstance = null;
let ytLoadTimeout = null;
let ytRetryCount = 0;
const YT_MAX_RETRIES = 3;

// ==================== CONSTANTS ====================
const REMOTE_DATA_SERVER = 'https://raw.githubusercontent.com/HYowshi/IPTV/main';
const M3U_FILES = [
    `${REMOTE_DATA_SERVER}/IPTV_Master.m3u`,
    `${REMOTE_DATA_SERVER}/Vietnam_HBO_Final.m3u`
];

const TV_CACHE_PREFIX = 'tv_cache_';
const TV_CACHE_TTL = 10 * 60 * 1000;          // 10 phút fresh
const TV_STALE_TTL = 60 * 60 * 1000;           // 60 phút stale window
const TV_LONG_TERM_TTL = 12 * 60 * 60 * 1000;  // 12 hours in LocalStorage
const TV_MEMORY_MAX = 20;                       // LRU max entries in memory
const inFlightTvRequests = new Map();

// LRU Memory Cache for TV
class TVLRUCache {
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
}
const tvMemoryCache = new TVLRUCache(TV_MEMORY_MAX);

// Recently watched
const TV_RECENT_KEY = 'tv_recent';
const MAX_RECENT_CHANNELS = 20;

// ==================== HLS CONFIGURATION ====================
const TV_HLS_CONFIG = {
    xhrSetup: function (xhr) { xhr.withCredentials = false; },
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 30 * 1024 * 1024,
    maxBufferHole: 0.5,
    backBufferLength: 10,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 1000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1000,
    nudgeOffset: 0.2,
    nudgeMaxRetry: 5,
    maxFragLookUpTolerance: 0.25,
    startLevel: -1,
    abrBandWidthFactor: 0.95,
    abrBandWidthUpFactor: 0.7,
    abrEwmaDefaultEstimate: 2000000,
    appendErrorMaxRetry: 5
};

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

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, duration = 3000, type = 'info') {
    let container = document.getElementById('tv-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tv-toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `tv-toast tv-toast-${type}`;
    const icons = { info: 'info', success: 'check_circle', error: 'error' };
    toast.innerHTML = `<span class="material-symbols-rounded">${icons[type] || 'info'}</span><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ==================== ERROR OVERLAY ====================
function showErrorWithRetry(message, retryCallback) {
    const watchView = document.getElementById('watch-view');
    if (!watchView) return;
    let overlay = document.getElementById('tv-error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tv-error-overlay';
        watchView.appendChild(overlay);
    }
    overlay.innerHTML = `
        <span class="material-symbols-rounded" style="font-size:64px;color:#f91942;">cloud_off</span>
        <p style="font-size:18px;color:#ccc;max-width:400px;text-align:center;line-height:1.6;">${message}</p>
        <button id="tv-retry-btn" class="btn-watch" style="margin-top:20px;">
            <span class="material-symbols-rounded">refresh</span> Thử lại
        </button>
    `;
    overlay.style.display = 'flex';
    document.getElementById('tv-retry-btn').onclick = () => {
        overlay.style.display = 'none';
        if (retryCallback) retryCallback();
    };
}

function hideErrorOverlay() {
    const overlay = document.getElementById('tv-error-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ==================== RECENTLY WATCHED ====================
function getRecentlyWatched() {
    try { return JSON.parse(localStorage.getItem(TV_RECENT_KEY)) || []; }
    catch (e) { return []; }
}

function saveRecentlyWatched(channel) {
    let recent = getRecentlyWatched();
    recent = recent.filter(c => c.url !== channel.url);
    recent.unshift({
        url: channel.url,
        name: channel.name,
        logo: channel.logo || '',
        group: channel.group || 'Khác',
        id: channel.id || '',
        timestamp: Date.now()
    });
    if (recent.length > MAX_RECENT_CHANNELS) recent = recent.slice(0, MAX_RECENT_CHANNELS);
    try { localStorage.setItem(TV_RECENT_KEY, JSON.stringify(recent)); } catch (e) { }
}

// ==================== FILTER SYSTEM ====================
function applyFilters() {
    const searchInput = document.getElementById('tv-search-input');
    const keyword = searchInput ? normalizeChannelName(searchInput.value) : "";
    let filtered = allChannels;

    if (keyword) {
        filtered = filtered.filter(c => normalizeChannelName(c.name).includes(keyword));
    }

    if (selectedGroup === 'favorites') {
        const fav = JSON.parse(localStorage.getItem('tv_favorites')) || [];
        filtered = filtered.filter(c => fav.includes(c.url));
    } else if (selectedGroup === 'recent') {
        const recentUrls = getRecentlyWatched().map(r => r.url);
        filtered = filtered.filter(c => recentUrls.includes(c.url));
    } else if (selectedGroup !== 'all') {
        filtered = filtered.filter(c => (c.group || 'Khác') === selectedGroup);
    }

    renderChannels(filtered);
}

function buildFilterTabs() {
    const existing = document.getElementById('tv-filter-bar');
    if (existing) existing.remove();

    const groups = new Set();
    allChannels.forEach(ch => groups.add(ch.group || 'Khác'));

    const filterBar = document.createElement('div');
    filterBar.id = 'tv-filter-bar';
    filterBar.className = 'tv-filter-bar';

    const tabDefs = [
        { value: 'all', label: 'Tất cả', icon: 'apps' },
        { value: 'favorites', label: 'Yêu Thích', icon: 'favorite' }
    ];
    if (getRecentlyWatched().length > 0) {
        tabDefs.push({ value: 'recent', label: 'Gần Đây', icon: 'history' });
    }
    Array.from(groups).sort().forEach(g => tabDefs.push({ value: g, label: g, icon: 'tv' }));

    tabDefs.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'tv-filter-tab' + (selectedGroup === t.value ? ' active' : '');
        btn.setAttribute('data-group', t.value);
        btn.innerHTML = `<span class="material-symbols-rounded">${t.icon}</span>${t.label}`;
        btn.onclick = () => {
            selectedGroup = t.value;
            filterBar.querySelectorAll('.tv-filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        };
        filterBar.appendChild(btn);
    });

    const container = document.getElementById('channels-container');
    if (container) container.parentNode.insertBefore(filterBar, container);
}

// ==================== PICTURE-IN-PICTURE ====================
async function togglePiP() {
    const videoPlayer = document.getElementById('tv-player');
    const btnPiP = document.getElementById('btn-pip-tv');
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else if (videoPlayer && videoPlayer.videoWidth > 0 && document.pictureInPictureEnabled) {
            await videoPlayer.requestPictureInPicture();
        } else {
            showToast('Không hỗ trợ Picture-in-Picture', 3000, 'error');
        }
    } catch (e) {
        showToast('Không thể bật PiP: ' + e.message, 3000, 'error');
    }
}

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", () => {
    // ==================== HAMBURGER MENU ====================
    const hamburgerBtn = document.getElementById('hamburgerBtnTv');
    let mobileNavOverlay = null;
    let mobileNavPanel = null;

    function buildMobileMenu() {
        if (mobileNavOverlay) return;

        mobileNavOverlay = document.createElement('div');
        mobileNavOverlay.className = 'mobile-nav-overlay';
        mobileNavOverlay.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:999;opacity:0;transition:opacity 0.3s ease;';
        document.body.appendChild(mobileNavOverlay);

        mobileNavPanel = document.createElement('div');
        mobileNavPanel.className = 'mobile-nav-panel-tv';
        mobileNavPanel.style.cssText = 'position:fixed;top:0;right:-300px;width:min(300px,85vw);height:100vh;background:linear-gradient(180deg,#0d0d0d,#050505);border-left:1px solid rgba(255,255,255,0.06);z-index:1000;overflow-y:auto;padding:80px 20px 30px;display:flex;flex-direction:column;gap:8px;transition:right 0.35s cubic-bezier(0.16,1,0.3,1);box-shadow:-10px 0 40px rgba(0,0,0,0.5);';

        const menuHTML = `
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#555;padding:10px 0 6px;margin-top:10px;">Điều hướng</div>
            <a href="../index.html" class="transition-link-tv" style="display:flex;align-items:center;gap:12px;color:#ccc;text-decoration:none;font-size:14px;font-weight:600;padding:12px 16px;border-radius:10px;transition:all 0.25s;border-left:3px solid transparent;"><span class="material-symbols-rounded" style="color:#00f2fe;opacity:0.7;">home</span> Trang chủ</a>
            <a href="../phim/phim.html" class="transition-link-tv" style="display:flex;align-items:center;gap:12px;color:#ccc;text-decoration:none;font-size:14px;font-weight:600;padding:12px 16px;border-radius:10px;transition:all 0.25s;border-left:3px solid transparent;"><span class="material-symbols-rounded" style="color:#f91942;opacity:0.7;">movie</span> Phim Ảnh</a>
            <a href="#" style="display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 16px;border-radius:10px;background:rgba(0,242,254,0.1);border-left:3px solid #00f2fe;"><span class="material-symbols-rounded" style="color:#00f2fe;">tv</span> Truyền hình</a>
        `;
        mobileNavPanel.innerHTML = menuHTML;
        document.body.appendChild(mobileNavPanel);

        mobileNavPanel.querySelectorAll('.transition-link-tv').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetUrl = link.getAttribute('href');
                closeMobileMenuTv();
                if (targetUrl && targetUrl !== '#') {
                    document.body.classList.add('fade-out');
                    setTimeout(() => { window.location.href = targetUrl; }, 500);
                }
            });
        });

        mobileNavOverlay.addEventListener('click', closeMobileMenuTv);
    }

    function openMobileMenuTv() {
        buildMobileMenu();
        hamburgerBtn.classList.add('active');
        mobileNavOverlay.style.display = 'block';
        requestAnimationFrame(() => {
            mobileNavOverlay.style.opacity = '1';
            mobileNavPanel.style.right = '0';
        });
        document.body.style.overflow = 'hidden';
    }

    function closeMobileMenuTv() {
        if (!mobileNavOverlay || !mobileNavPanel) return;
        hamburgerBtn.classList.remove('active');
        mobileNavOverlay.style.opacity = '0';
        mobileNavPanel.style.right = '-300px';
        document.body.style.overflow = '';
        setTimeout(() => { mobileNavOverlay.style.display = 'none'; }, 350);
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            if (hamburgerBtn.classList.contains('active')) {
                closeMobileMenuTv();
            } else {
                openMobileMenuTv();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && hamburgerBtn && hamburgerBtn.classList.contains('active')) {
            closeMobileMenuTv();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && hamburgerBtn && hamburgerBtn.classList.contains('active')) {
            closeMobileMenuTv();
        }
    });

    // ==================== INIT ====================
    initUIEvents();
    initSpatialNavigation();
    // Fetch EPG and M3U in parallel — they're independent
    Promise.all([
        fetchAndParseEPG(`${REMOTE_DATA_SERVER}/epg.xml`),
        fetchAllM3UFiles(M3U_FILES)
    ]).then(() => {
        if (allChannels.length > 0) {
            const firstCard = document.querySelector('.channel-card');
            if (firstCard) firstCard.focus();
        }
    });
});

function initUIEvents() {
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

    const btnBack = document.getElementById('btn-back-tv');
    const watchView = document.getElementById('watch-view');
    const videoPlayer = document.getElementById('tv-player');

    let hideUITimer;
    let lastActivityTime = 0;

    const closePlayer = () => {
        watchView.style.display = 'none';
        watchView.classList.remove('hide-cursor');
        watchView.classList.add('show-ui');
        clearTimeout(hideUITimer);

        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();

        // Exit PiP if active
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => { });
        }

        // Cleanup YouTube API player
        if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
            clearTimeout(ytLoadTimeout);
            try { ytPlayerInstance.destroy(); } catch (e) { }
            ytPlayerInstance = null;
            ytPlayerReady = false;
        }
        const ytContainer = document.getElementById('yt-player-container');
        if (ytContainer) ytContainer.style.display = 'none';

        // Cleanup YouTube fallback iframe
        const ytPlayer = document.getElementById('yt-iframe-player');
        if (ytPlayer) {
            ytPlayer.src = "";
            ytPlayer.style.display = 'none';
        }

        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';

        hideErrorOverlay();

        if (tvHlsInstance) {
            tvHlsInstance.destroy();
            tvHlsInstance = null;
        }

        if (tvDashInstance) {
            tvDashInstance.destroy();
            tvDashInstance = null;
        }

        document.getElementById('tv-quality-selector').style.display = 'none';

        // Reset quick sidebar
        const quickSidebar = document.getElementById('quick-channel-sidebar');
        if (quickSidebar) quickSidebar.classList.remove('show');
        quickListDirty = true;

        if (currentPlayingChannel) {
            const activeCard = document.querySelector(`.channel-card[data-url="${currentPlayingChannel.url}"]`);
            if (activeCard) {
                activeCard.focus();
                activeCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                return;
            }
        }

        const lastFocused = document.querySelector('.channel-card:focus') || document.querySelector('.channel-card');
        if (lastFocused) {
            lastFocused.focus();
            lastFocused.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    };

    if (btnBack) {
        btnBack.addEventListener('click', closePlayer);
    }

    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnMute = document.getElementById('btn-mute');
    const volumeSlider = document.getElementById('volume-slider');
    let isPlaying = true;

    if (btnPlayPause) {
        btnPlayPause.addEventListener('click', () => {
            // Check YT API player first
            if (ytPlayerInstance && ytPlayerReady && typeof ytPlayerInstance.getPlayerState === 'function') {
                const state = ytPlayerInstance.getPlayerState();
                if (state === 1 || state === 3) { // PLAYING or BUFFERING
                    ytPlayerInstance.pauseVideo();
                } else {
                    ytPlayerInstance.playVideo();
                }
                return;
            }
            // Check fallback iframe
            const ytPlayer = document.getElementById('yt-iframe-player');
            const isYt = ytPlayer && ytPlayer.style.display === 'block';

            if (isYt) {
                isPlaying = !isPlaying;
                const icon = btnPlayPause.querySelector('span');
                if (icon) icon.innerText = isPlaying ? 'pause' : 'play_arrow';
                const action = isPlaying ? 'playVideo' : 'pauseVideo';
                ytPlayer.contentWindow.postMessage(JSON.stringify({ event: 'command', func: action, args: [] }), '*');
            } else {
                if (videoPlayer.paused) videoPlayer.play().catch(() => { });
                else videoPlayer.pause();
            }
        });
    }

    videoPlayer.addEventListener('play', () => {
        isPlaying = true;
        if (btnPlayPause) {
            const icon = btnPlayPause.querySelector('span');
            if (icon) icon.innerText = 'pause';
        }
    });

    videoPlayer.addEventListener('pause', () => {
        isPlaying = false;
        if (btnPlayPause) {
            const icon = btnPlayPause.querySelector('span');
            if (icon) icon.innerText = 'play_arrow';
        }
    });

    videoPlayer.addEventListener('waiting', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'flex';
    });

    videoPlayer.addEventListener('playing', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
        hideErrorOverlay();
    });

    videoPlayer.addEventListener('error', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
        showErrorWithRetry('Không thể phát kênh này. Vui lòng thử lại.', () => {
            if (currentPlayingChannel) playChannel(currentPlayingChannel);
        });
    });

    videoPlayer.addEventListener('stalled', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
    });

    // ==================== PiP EVENTS ====================
    videoPlayer.addEventListener('enterpictureinpicture', () => {
        const btnPiP = document.getElementById('btn-pip-tv');
        if (btnPiP) btnPiP.classList.add('pip-active');
    });
    videoPlayer.addEventListener('leavepictureinpicture', () => {
        const btnPiP = document.getElementById('btn-pip-tv');
        if (btnPiP) btnPiP.classList.remove('pip-active');
    });

    // ==================== FULLSCREEN ====================
    const btnFullscreen = document.getElementById('btn-fullscreen-tv');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            const fsElement = watchView;
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            try {
                if (!isFs) {
                    if (fsElement.requestFullscreen) fsElement.requestFullscreen();
                    else if (fsElement.webkitRequestFullscreen) fsElement.webkitRequestFullscreen();
                    else if (fsElement.msRequestFullscreen) fsElement.msRequestFullscreen();
                } else {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                    else if (document.msExitFullscreen) document.msExitFullscreen();
                }
            } catch (e) { }
        });

        const updateFullscreenIcon = () => {
            const icon = btnFullscreen.querySelector('span');
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (icon) icon.textContent = isFs ? 'fullscreen_exit' : 'fullscreen';
        };
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
    }

    // ==================== PiP BUTTON ====================
    const btnPiP = document.getElementById('btn-pip-tv');
    if (btnPiP) {
        if (!document.pictureInPictureEnabled) {
            btnPiP.style.display = 'none';
        } else {
            btnPiP.addEventListener('click', togglePiP);
        }
    }

    const updateVolumeUI = (vol) => {
        if (!btnMute) return;
        const icon = btnMute.querySelector('span');
        if (icon) {
            if (vol === 0) icon.innerText = 'volume_off';
            else if (vol < 0.5) icon.innerText = 'volume_down';
            else icon.innerText = 'volume_up';
        }
    };

    // Helper to sync volume to YouTube player
    const syncYtVolume = (vol) => {
        if (ytPlayerInstance && ytPlayerReady && typeof ytPlayerInstance.setVolume === 'function') {
            ytPlayerInstance.setVolume(vol * 100);
            if (vol === 0) ytPlayerInstance.mute();
            else ytPlayerInstance.unMute();
        } else {
            const ytIframe = document.getElementById('yt-iframe-player');
            if (ytIframe && ytIframe.style.display === 'block') {
                ytIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [vol * 100] }), '*');
            }
        }
    };

    if (volumeSlider) {
        volumeSlider.style.background = `linear-gradient(to right, #00f2fe ${volumeSlider.value * 100}%, rgba(255,255,255,0.3) ${volumeSlider.value * 100}%)`;
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value);
            videoPlayer.volume = vol;
            e.target.style.background = `linear-gradient(to right, #00f2fe ${vol * 100}%, rgba(255,255,255,0.3) ${vol * 100}%)`;
            updateVolumeUI(vol);
            syncYtVolume(vol);
        });
    }

    if (btnMute) {
        btnMute.addEventListener('click', () => {
            let currentVol = videoPlayer.volume;
            if (currentVol > 0) {
                videoPlayer.setAttribute('data-last-vol', currentVol);
                volumeSlider.value = 0;
                videoPlayer.volume = 0;
            } else {
                let lastVol = videoPlayer.getAttribute('data-last-vol') || 1;
                volumeSlider.value = lastVol;
                videoPlayer.volume = lastVol;
            }
            volumeSlider.style.background = `linear-gradient(to right, #00f2fe ${volumeSlider.value * 100}%, rgba(255,255,255,0.3) ${volumeSlider.value * 100}%)`;
            updateVolumeUI(videoPlayer.volume);
            syncYtVolume(videoPlayer.volume);
        });
    }

    const handleActivity = () => {
        const watchView = document.getElementById('watch-view');
        if (watchView && watchView.style.display === 'block') {
            if (!watchView.classList.contains('show-ui')) {
                watchView.classList.add('show-ui');
                watchView.classList.remove('hide-cursor');
            }

            clearTimeout(hideUITimer);
            hideUITimer = setTimeout(() => {
                watchView.classList.remove('show-ui');
                watchView.classList.add('hide-cursor');
                if (document.activeElement && document.activeElement.tagName !== 'BODY') {
                    document.activeElement.blur();
                }
            }, 4000);
        }
    };

    const watchViewContainer = document.getElementById('watch-view');
    if (watchViewContainer) {
        watchViewContainer.addEventListener('mousemove', () => {
            const now = Date.now();
            if (now - lastActivityTime > 200) {
                lastActivityTime = now;
                handleActivity();
            }
        });
        watchViewContainer.addEventListener('click', handleActivity);

        let lastTapTime = 0;
        watchViewContainer.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTapTime < 300) {
                if (btnFullscreen) btnFullscreen.click();
                lastTapTime = 0;
            } else {
                lastTapTime = now;
            }
        });
    }

    // ==================== SEARCH ====================
    const searchContainer = document.getElementById('tv-search-container');
    const searchInput = document.getElementById('tv-search-input');
    let searchTimer;

    if (searchContainer && searchInput) {
        searchContainer.addEventListener('click', () => {
            searchInput.focus();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                applyFilters();
            }, 300); // Giảm từ 500ms xuống 300ms
        });
    }

    // ==================== KEYBOARD CONTROLS ====================
    document.addEventListener('keydown', (e) => {
        if (watchView.style.display === 'block') {
            if (document.activeElement && document.activeElement.id === 'volume-slider' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                return;
            }

            const quickSidebar = document.getElementById('quick-channel-sidebar');
            const isQuickListOpen = quickSidebar && quickSidebar.classList.contains('show');

            if (e.key === 'Escape' || e.key === 'Backspace') {
                e.preventDefault();
                if (isQuickListOpen) {
                    quickSidebar.classList.remove('show');
                    videoPlayer.focus();
                } else {
                    closePlayer();
                }
                return;
            }

            if (isQuickListOpen) {
                const items = Array.from(document.querySelectorAll('.quick-channel-item'));
                let currentIndex = items.indexOf(document.activeElement);

                if (e.code === 'ArrowDown') {
                    e.preventDefault();
                    let nextIndex = currentIndex + 1 >= items.length ? 0 : currentIndex + 1;
                    items[nextIndex].focus();
                    clearTimeout(window.quickPlayTimer);
                    window.quickPlayTimer = setTimeout(() => items[nextIndex].click(), 500);
                } else if (e.code === 'ArrowUp') {
                    e.preventDefault();
                    let nextIndex = currentIndex - 1 < 0 ? items.length - 1 : currentIndex - 1;
                    items[nextIndex].focus();
                    clearTimeout(window.quickPlayTimer);
                    window.quickPlayTimer = setTimeout(() => items[nextIndex].click(), 500);
                } else if (e.code === 'ArrowRight') {
                    e.preventDefault();
                    quickSidebar.classList.remove('show');
                    videoPlayer.focus();
                }
            } else {
                if (e.code === 'ArrowDown') {
                    e.preventDefault();
                    if (currentPlayingChannel && currentChannelList.length > 0) {
                        let currentIndex = currentChannelList.findIndex(c => c.url === currentPlayingChannel.url);
                        if (currentIndex !== -1) {
                            let nextIndex = currentIndex + 1 >= currentChannelList.length ? 0 : currentIndex + 1;
                            playChannel(currentChannelList[nextIndex]);
                        }
                    }
                } else if (e.code === 'ArrowUp') {
                    e.preventDefault();
                    if (currentPlayingChannel && currentChannelList.length > 0) {
                        let currentIndex = currentChannelList.findIndex(c => c.url === currentPlayingChannel.url);
                        if (currentIndex !== -1) {
                            let nextIndex = currentIndex - 1 < 0 ? currentChannelList.length - 1 : currentIndex - 1;
                            playChannel(currentChannelList[nextIndex]);
                        }
                    }
                } else if (e.code === 'ArrowLeft') {
                    e.preventDefault();
                    if (quickSidebar) {
                        populateQuickList();
                        quickSidebar.classList.add('show');
                        setTimeout(() => {
                            if (currentPlayingChannel) {
                                const activeItem = document.querySelector(`.quick-channel-item[data-url="${currentPlayingChannel.url}"]`);
                                if (activeItem) {
                                    activeItem.focus();
                                    activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                } else {
                                    const firstItem = document.querySelector('.quick-channel-item');
                                    if (firstItem) firstItem.focus();
                                }
                            }
                        }, 100);
                    }
                } else if (e.code === 'Space' || e.key === 'Enter') {
                    e.preventDefault();
                    if (videoPlayer.paused) videoPlayer.play().catch(() => { });
                    else videoPlayer.pause();
                }
                // ==================== VOLUME SHORTCUTS ====================
                else if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    const newVol = Math.min(1, parseFloat((videoPlayer.volume + 0.1).toFixed(2)));
                    videoPlayer.volume = newVol;
                    if (volumeSlider) {
                        volumeSlider.value = newVol;
                        volumeSlider.style.background = `linear-gradient(to right, #00f2fe ${newVol * 100}%, rgba(255,255,255,0.3) ${newVol * 100}%)`;
                    }
                    updateVolumeUI(newVol);
                    handleActivity();
                } else if (e.key === '-') {
                    e.preventDefault();
                    const newVol = Math.max(0, parseFloat((videoPlayer.volume - 0.1).toFixed(2)));
                    videoPlayer.volume = newVol;
                    if (volumeSlider) {
                        volumeSlider.value = newVol;
                        volumeSlider.style.background = `linear-gradient(to right, #00f2fe ${newVol * 100}%, rgba(255,255,255,0.3) ${newVol * 100}%)`;
                    }
                    updateVolumeUI(newVol);
                    handleActivity();
                }
            }
        }
    });

    startClock();
}

// ==================== QUICK SIDEBAR (OPTIMIZED) ====================
function populateQuickList() {
    const listContent = document.getElementById('quick-channel-list');
    if (!listContent) return;

    // Only rebuild DOM when channel list changed
    if (quickListDirty || listContent.children.length !== currentChannelList.length) {
        listContent.innerHTML = '';
        const fragment = document.createDocumentFragment();

        currentChannelList.forEach(channel => {
            const item = document.createElement('div');
            item.className = 'quick-channel-item';
            item.tabIndex = 0;
            item.setAttribute('data-url', channel.url);

            let logoHTML = '';
            if (channel.logo && channel.logo.trim() !== "") {
                logoHTML = `<img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'">`;
            } else {
                logoHTML = `<span class="material-symbols-rounded">tv</span>`;
            }

            item.innerHTML = `${logoHTML}<span>${escapeHtml(channel.name)}</span>`;

            item.onclick = () => {
                document.querySelectorAll('.quick-channel-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                playChannel(channel);
            };

            fragment.appendChild(item);
        });

        listContent.appendChild(fragment);
        quickListDirty = false;
    }

    // Update active state only
    listContent.querySelectorAll('.quick-channel-item').forEach(item => {
        const isActive = currentPlayingChannel && item.getAttribute('data-url') === currentPlayingChannel.url;
        item.classList.toggle('active', isActive);
        const existingBadge = item.querySelector('.playing-badge');
        if (isActive && !existingBadge) {
            const badge = document.createElement('span');
            badge.className = 'playing-badge';
            badge.style.cssText = 'margin-left:auto;font-size:10px;background:#00f2fe;color:#000;padding:3px 6px;border-radius:4px;font-weight:900;letter-spacing:1px;';
            badge.textContent = 'ĐANG XEM';
            item.appendChild(badge);
        } else if (!isActive && existingBadge) {
            existingBadge.remove();
        }
    });
}

// ==================== CLOCK ====================
function startClock() {
    const clockEl = document.getElementById('tv-clock');
    if (!clockEl) return;

    const updateTime = () => {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        clockEl.innerText = `${hours}:${minutes}`;
    };

    updateTime();
    setInterval(updateTime, 1000);
}

// ==================== CHANNEL NORMALIZATION ====================
function normalizeChannelName(name) {
    let clean = name.toLowerCase();

    clean = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    clean = clean.replace(/đ/g, "d");
    clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');

    const noiseWords = [
        'hd', 'fhd', 'uhd', '4k', 'sd', '1080p', '720p', '1080i', '50fps', '60fps',
        'hevc', 'h264', 'h265', 'vip', 'premium', 'vietsub', 'thuyet minh', 'raw',
        'bao va ptth', 'bao', 'ptth', 'channel', 'tv', 'truyen hinh'
    ];

    const regex = new RegExp('\\b(' + noiseWords.join('|') + ')\\b', 'g');
    clean = clean.replace(regex, '');
    clean = clean.replace(/[^a-z0-9]/g, '');

    return clean;
}

// ==================== M3U LOADING ====================
async function fetchAllM3UFiles(urls) {
    const container = document.getElementById('channels-container');
    container.innerHTML = "<div style='color: white; text-align: center; padding: 20px;'>Đang tải tổng hợp danh sách kênh...</div>";

    const cacheKey = 'm3u_combined';
    const cached = tvGetCached(cacheKey);

    let combinedRawData = "";

    try {
        if (cached && !cached.stale) {
            combinedRawData = cached.data;
        } else {
            const fetchPromises = urls.map((url, i) =>
                tvFetchWithCache(`m3u_${i}`, url).catch(() => "")
            );

            const results = await Promise.all(fetchPromises);

            results.forEach(data => {
                if (data) combinedRawData += "\n" + data;
            });

            if (combinedRawData.trim()) {
                tvSetCache(cacheKey, combinedRawData);
            }
        }

        const parsedChannels = parseM3U(combinedRawData);
        const uniqueChannelsMap = new Map();

        parsedChannels.forEach(channel => {
            const normalizedName = normalizeChannelName(channel.name);
            if (!uniqueChannelsMap.has(normalizedName)) {
                uniqueChannelsMap.set(normalizedName, channel);
            }
        });

        allChannels = Array.from(uniqueChannelsMap.values());

        if (allChannels.length === 0) {
            container.innerHTML = "<div style='color: #f91942; text-align: center; padding: 20px;'>Không tìm thấy kênh nào.</div>";
            return;
        }

        // Build filter tabs and render
        buildFilterTabs();
        renderChannels(allChannels);

        setTimeout(() => {
            const firstCard = document.querySelector('.channel-card');
            if (firstCard) {
                firstCard.focus();
                firstCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }, 100);
    } catch (error) {
        container.innerHTML = "<div style='color: #f91942; text-align: center; padding: 20px;'>Lỗi tải danh sách kênh.</div>";
    }
}

function parseM3U(data) {
    const lines = data.split(/\r?\n/);
    const channels = [];
    let currentChannel = {};
    let pendingProps = {};

    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            pendingProps = {};
            const groupMatch = line.match(/group-title="([^"]+)"/);
            currentChannel.group = groupMatch ? groupMatch[1] : "Khác";

            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            currentChannel.logo = logoMatch ? logoMatch[1] : "";

            const idMatch = line.match(/tvg-id="([^"]*)"/);
            currentChannel.id = idMatch ? idMatch[1] : "";

            const nameParts = line.split(',');
            currentChannel.name = nameParts.length > 1 ? nameParts[1].trim() : "Kênh không tên";
        } else if (line.startsWith('#EXTGRP:')) {
            currentChannel.group = line.replace('#EXTGRP:', '').trim();
        } else if (line.startsWith('#KODIPROP:')) {
            const propValue = line.replace('#KODIPROP:', '');
            if (propValue.startsWith('inputstream.adaptive.license_type=')) {
                pendingProps.licenseType = propValue.split('=')[1];
            } else if (propValue.startsWith('inputstream.adaptive.license_key=')) {
                pendingProps.licenseKey = propValue.substring(propValue.indexOf('=') + 1);
            }
        } else if (line.startsWith('#EXTVLCOPT:')) {
            const optValue = line.replace('#EXTVLCOPT:', '');
            if (optValue.startsWith('http-referrer=')) {
                pendingProps.referrer = optValue.substring('http-referrer='.length);
            } else if (optValue.startsWith('http-user-agent=')) {
                pendingProps.userAgent = optValue.substring('http-user-agent='.length);
            }
        } else if (line.startsWith('http') || line.startsWith('udp://') || line.startsWith('rtmp') || line.startsWith('rtsp') || line.startsWith('mms')) {
            currentChannel.url = line;
            if (!currentChannel.group) currentChannel.group = "Khác";
            // Merge DRM license and HTTP header properties
            if (pendingProps.licenseType) currentChannel.licenseType = pendingProps.licenseType;
            if (pendingProps.licenseKey) currentChannel.licenseKey = pendingProps.licenseKey;
            if (pendingProps.referrer) currentChannel.referrer = pendingProps.referrer;
            if (pendingProps.userAgent) currentChannel.userAgent = pendingProps.userAgent;
            channels.push({ ...currentChannel });
            currentChannel = {};
            pendingProps = {};
        }
    });
    return channels;
}

/**
 * Parse DRM license keys from M3U #KODIPROP format into dashjs protection data.
 * Supports both JSON format {"keyId":"key",...} and simple "keyId:key" format.
 */
function parseDashLicenseKeys(licenseType, licenseKey) {
    const schemeMap = {
        'clearkey': 'org.w3.clearkey',
        'org.w3.clearkey': 'org.w3.clearkey',
        'widevine': 'com.widevine.alpha',
        'com.widevine.alpha': 'com.widevine.alpha',
        'playready': 'com.microsoft.playready',
        'com.microsoft.playready': 'com.microsoft.playready'
    };
    const scheme = schemeMap[(licenseType || '').toLowerCase()];
    if (!scheme) return null;

    let keys = {};
    try {
        const parsed = JSON.parse(licenseKey);
        if (typeof parsed === 'object' && parsed !== null) {
            keys = parsed;
        }
    } catch (e) {
        // Fallback: parse "keyId:key" format
        const parts = licenseKey.split(':');
        if (parts.length === 2) {
            keys[parts[0].trim()] = parts[1].trim();
        }
    }

    if (Object.keys(keys).length === 0) return null;

    return {
        [scheme]: {
            clearkeys: keys
        }
    };
}

// ==================== LOGO & UI HELPERS ====================
const LOGO_FALLBACK = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23141414%22 rx=%2210%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2210%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ETV%3C/text%3E%3C/svg%3E";
const OSD_FALLBACK = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23141414%22 rx=%228%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2212%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ETV%3C/text%3E%3C/svg%3E";

function isValidLogoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function buildLogoHTML(channel) {
    if (isValidLogoUrl(channel.logo)) {
        return `<img src="${channel.logo}" alt="${channel.name}" loading="lazy" decoding="async" style="width:60px;height:60px;object-fit:contain;z-index:2;" onerror="this.onerror=null;this.src='${LOGO_FALLBACK}'">`;
    }
    // Generate letter avatar from channel name
    const initials = channel.name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    if (initials.length > 0) {
        return `<div class="channel-letter-avatar">${initials}</div>`;
    }
    return `<span class="material-symbols-rounded channel-logo" style="font-size:32px;">tv</span>`;
}

// ==================== CHANNEL RENDERING ====================
function renderChannels(channels) {
    currentChannelList = channels;
    const container = document.getElementById('channels-container');

    if (!channels || channels.length === 0) {
        container.innerHTML = '<div style="color: #aaa; text-align: center; padding: 50px 20px; width: 100%; font-size: 18px;">Không tìm thấy kênh phù hợp.</div>';
        return;
    }

    let favorites;
    try {
        favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];
    } catch (e) {
        favorites = [];
    }

    // Build groups
    const groups = {};
    const playingUrl = currentPlayingChannel ? currentPlayingChannel.url : null;

    if (selectedGroup === 'all') {
        // Recently watched group
        const recentUrls = getRecentlyWatched().map(r => r.url);
        const recentChannels = channels.filter(c => recentUrls.includes(c.url));
        if (recentChannels.length > 0) {
            groups["⏰ Xem Gần Đây"] = recentChannels;
        }

        // Favorites group
        const favoriteChannels = channels.filter(c => favorites.includes(c.url));
        if (favoriteChannels.length > 0) {
            groups["❤️ Kênh Yêu Thích"] = favoriteChannels;
        }

        // Regular groups
        channels.forEach(channel => {
            const groupName = channel.group || 'Khác';
            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(channel);
        });
    } else if (selectedGroup === 'favorites') {
        groups["❤️ Kênh Yêu Thích"] = channels;
    } else if (selectedGroup === 'recent') {
        groups["⏰ Xem Gần Đây"] = channels;
    } else {
        groups[selectedGroup] = channels;
    }

    // Build DOM
    const fragment = document.createDocumentFragment();

    for (const groupName in groups) {
        const groupChannels = groups[groupName];
        if (groupChannels.length === 0) continue;

        const rowDiv = document.createElement('div');
        rowDiv.className = 'channel-row';

        const titleElement = document.createElement('h2');
        titleElement.className = 'row-title';
        titleElement.innerText = `${groupName} (${groupChannels.length})`;
        rowDiv.appendChild(titleElement);

        const scrollWrapper = document.createElement('div');
        scrollWrapper.className = 'channel-scroll-wrapper';

        for (let i = 0; i < groupChannels.length; i++) {
            const channel = groupChannels[i];
            const card = document.createElement('div');
            card.className = 'channel-card';
            card.tabIndex = 0;
            card.setAttribute('data-url', channel.url || '');
            card.setAttribute('data-group', groupName);

            if (playingUrl && channel.url === playingUrl) {
                card.classList.add('playing');
            }

            const logoHTML = buildLogoHTML(channel);
            const isFav = favorites.includes(channel.url);
            const favHTML = isFav ? '<span class="material-symbols-rounded" style="position:absolute;top:10px;right:10px;color:#f91942;z-index:10;font-size:18px;pointer-events:none;">favorite</span>' : '';
            const safeName = escapeHtml(channel.name);

            // Recently watched badge
            const recentUrls = getRecentlyWatched().map(r => r.url);
            const recentBadge = recentUrls.includes(channel.url) && groupName !== '⏰ Xem Gần Đây'
                ? '<span class="recent-badge">GẦN ĐÂY</span>' : '';

            card.innerHTML = `
                ${favHTML}${recentBadge}
                <div class="logo-container">${logoHTML}</div>
                <span class="channel-name" style="font-weight:700;color:#eee;font-size:14px;">${safeName}</span>
            `;

            const ch = channel;
            const gn = groupName;
            card.addEventListener('mouseenter', () => updateHeroBanner(ch, gn));
            card.addEventListener('focus', () => updateHeroBanner(ch, gn));
            card.addEventListener('click', () => playChannel(ch));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playChannel(ch);
                }
            });

            scrollWrapper.appendChild(card);
        }

        rowDiv.appendChild(scrollWrapper);
        fragment.appendChild(rowDiv);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
}

// ==================== TIME & EPG HELPERS ====================
function formatTime(ms) {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getCurrentEpgTime() {
    return Date.now();
}

// ==================== HERO BANNER ====================
function updateHeroBanner(channel, category) {
    const heroTitle = document.getElementById('hero-title');
    const heroCategory = document.getElementById('hero-category');
    const btnWatch = document.getElementById('btn-watch-channel');
    const heroDesc = document.getElementById('hero-desc');
    const heroBackdrop = document.getElementById('hero-backdrop');

    if (heroTitle) heroTitle.innerText = channel.name;
    if (heroCategory) heroCategory.innerText = category.toUpperCase();

    if (heroBackdrop) {
        if (channel.logo && channel.logo.trim() !== "") {
            heroBackdrop.style.backgroundImage = `url('${channel.logo}')`;
            heroBackdrop.style.opacity = '0.3';
        } else {
            heroBackdrop.style.backgroundImage = 'none';
        }
    }

    let currentProgram = "Đang cập nhật lịch phát sóng...";
    if (channel.id && epgData[channel.id]) {
        const now = getCurrentEpgTime();
        const programs = epgData[channel.id];
        const playing = programs.find(p => now >= p.start && now <= p.stop);

        if (playing) {
            currentProgram = `Đang phát (${formatTime(playing.start)} - ${formatTime(playing.stop)}): ${playing.title}`;
            if (playing.desc) currentProgram += `\n${playing.desc}`;
        } else {
            if (programs.length > 0) {
                currentProgram = `Sắp chiếu (${formatTime(programs[0].start)}): ${programs[0].title}`;
                if (programs[0].desc) currentProgram += `\n${programs[0].desc}`;
            }
        }
    }

    if (heroDesc) heroDesc.innerText = currentProgram;

    if (btnWatch) {
        btnWatch.onclick = () => playChannel(channel);
    }

    const btnFav = document.getElementById('btn-favorite-channel');
    if (btnFav) {
        let favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];
        let isFav = favorites.includes(channel.url);

        if (isFav) {
            btnFav.innerHTML = '<span class="material-symbols-rounded">heart_broken</span> Bỏ Thích';
            btnFav.style.color = '#f91942';
            btnFav.style.borderColor = '#f91942';
        } else {
            btnFav.innerHTML = '<span class="material-symbols-rounded">favorite</span> Yêu Thích';
            btnFav.style.color = 'white';
            btnFav.style.borderColor = 'rgba(255,255,255,0.2)';
        }

        btnFav.onclick = () => {
            favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];
            if (favorites.includes(channel.url)) {
                favorites = favorites.filter(url => url !== channel.url);
            } else {
                favorites.push(channel.url);
            }
            localStorage.setItem('tv_favorites', JSON.stringify(favorites));

            applyFilters();
            updateHeroBanner(channel, category);
        };
    }
}

// ==================== YOUTUBE SMART DETECTION ====================
function detectYouTubeUrl(url) {
    if (!url) return null;
    const patterns = [
        /(?:www\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
        /(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        /(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
        /(?:www\.)?youtube-nocookie\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// YouTube IFrame API Loader
function loadYouTubeIFrameAPI() {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            resolve(window.YT);
            return;
        }
        // Check if script already loading
        if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
            window.onYouTubeIframeAPIReady = () => resolve(window.YT);
            return;
        }
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.onerror = () => {
            console.error('[YT] Failed to load IFrame API');
            resolve(null);
        };
        document.head.appendChild(tag);
        window.onYouTubeIFrameAPIReady = () => resolve(window.YT);
    });
}

// Create or update YouTube player using YT API
async function playYouTubeChannel(channel, videoId) {
    const videoPlayer = document.getElementById('tv-player');
    const tvLoader = document.getElementById('tv-loader');
    const btnPlayPause = document.getElementById('btn-play-pause');

    videoPlayer.style.display = 'none';
    document.getElementById('tv-quality-selector').style.display = 'none';
    ytRetryCount = 0;

    // Hide fallback iframe if exists
    const oldIframe = document.getElementById('yt-iframe-player');
    if (oldIframe) { oldIframe.style.display = 'none'; oldIframe.src = ''; }

    const YT = await loadYouTubeIFrameAPI();
    if (!YT) {
        playYouTubeFallback(channel, videoId);
        return;
    }

    let container = document.getElementById('yt-player-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'yt-player-container';
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        videoPlayer.parentNode.insertBefore(container, videoPlayer.nextSibling);
    }
    container.style.display = 'block';

    if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
        clearTimeout(ytLoadTimeout);
        try { ytPlayerInstance.destroy(); } catch (e) { }
        ytPlayerInstance = null;
        ytPlayerReady = false;
    }

    clearTimeout(ytLoadTimeout);

    ytPlayerInstance = new YT.Player('yt-player-container', {
        videoId,
        playerVars: {
            autoplay: 1, controls: 0, disablekb: 1, fs: 0,
            modestbranding: 1, rel: 0, iv_load_policy: 3,
            playsinline: 1, enablejsapi: 1, cc_load_policy: 0, hl: 'vi',
        },
        events: {
            onReady: (event) => {
                ytPlayerReady = true;
                if (tvLoader) tvLoader.style.display = 'none';
                const volumeSlider = document.getElementById('volume-slider');
                if (volumeSlider) event.target.setVolume(parseFloat(volumeSlider.value) * 100);
                if (btnPlayPause) {
                    const icon = btnPlayPause.querySelector('span');
                    if (icon) icon.innerText = 'pause';
                }
            },
            onStateChange: (event) => {
                const YTState = YT.PlayerState;
                if (event.data === YTState.PLAYING) {
                    if (tvLoader) tvLoader.style.display = 'none';
                    hideErrorOverlay();
                    if (btnPlayPause) { const icon = btnPlayPause.querySelector('span'); if (icon) icon.innerText = 'pause'; }
                } else if (event.data === YTState.PAUSED) {
                    if (btnPlayPause) { const icon = btnPlayPause.querySelector('span'); if (icon) icon.innerText = 'play_arrow'; }
                } else if (event.data === YTState.BUFFERING) {
                    if (tvLoader) tvLoader.style.display = 'flex';
                }
            },
            onError: (event) => {
                const msgs = { 2: 'ID video không hợp lệ', 5: 'Lỗi HTML5', 100: 'Video không tồn tại', 101: 'Không cho phép nhúng', 150: 'Không cho phép nhúng' };
                const msg = msgs[event.data] || `Lỗi YouTube (#${event.data})`;
                if (tvLoader) tvLoader.style.display = 'none';
                ytRetryCount++;
                if (ytRetryCount <= YT_MAX_RETRIES && event.data !== 100 && event.data !== 101 && event.data !== 150) {
                    showToast(`Đang thử lại... (${ytRetryCount}/${YT_MAX_RETRIES})`, 2000, 'info');
                    setTimeout(() => { if (ytPlayerInstance?.loadVideoById) ytPlayerInstance.loadVideoById(videoId); }, 1500 * ytRetryCount);
                } else {
                    showErrorWithRetry(msg, () => playChannel(channel));
                }
            }
        }
    });

    ytLoadTimeout = setTimeout(() => {
        if (!ytPlayerReady) {
            if (tvLoader) tvLoader.style.display = 'none';
            showErrorWithRetry('Timeout: Không thể tải YouTube.', () => playChannel(channel));
        }
    }, 15000);
}

// Fallback: embed iframe if YT API not available
function playYouTubeFallback(channel, videoId) {
    const videoPlayer = document.getElementById('tv-player');
    const tvLoader = document.getElementById('tv-loader');
    const container = document.getElementById('yt-player-container');
    if (container) container.style.display = 'none';

    let ytIframe = document.getElementById('yt-iframe-player');
    if (!ytIframe) {
        ytIframe = document.createElement('iframe');
        ytIframe.id = 'yt-iframe-player';
        ytIframe.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;z-index:1;pointer-events:none;';
        ytIframe.allow = 'autoplay; encrypted-media';
        videoPlayer.parentNode.appendChild(ytIframe);
    }
    videoPlayer.style.display = 'none';
    ytIframe.style.display = 'block';
    ytIframe.onload = () => { if (tvLoader) tvLoader.style.display = 'none'; };
    ytIframe.onerror = () => { if (tvLoader) tvLoader.style.display = 'none'; showErrorWithRetry('Không thể tải YouTube.', () => playChannel(channel)); };
    ytIframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1`;

    const btnPlayPause = document.getElementById('btn-play-pause');
    if (btnPlayPause) { const icon = btnPlayPause.querySelector('span'); if (icon) icon.innerText = 'pause'; }
}

// ==================== PLAYER ====================
function playChannel(channel) {
    currentPlayingChannel = channel;
    currentStreamUrl = channel.url;
    quickListDirty = true;

    // Save to recently watched
    saveRecentlyWatched(channel);

    const watchView = document.getElementById('watch-view');
    const videoPlayer = document.getElementById('tv-player');
    const qualitySelector = document.getElementById('tv-quality-selector');
    const tvLoader = document.getElementById('tv-loader');
    const osd = document.getElementById('tv-osd');
    const osdLogo = document.getElementById('tv-osd-logo');
    const osdName = document.getElementById('tv-osd-name');
    const osdNow = document.getElementById('tv-osd-now');

    watchView.style.display = 'block';
    if (tvLoader) tvLoader.style.display = 'flex';
    hideErrorOverlay();

    document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('playing'));
    const activeCard = document.querySelector(`.channel-card[data-url="${channel.url}"]`);
    if (activeCard) activeCard.classList.add('playing');

    if (osd && osdLogo && osdName && osdNow) {
        osdLogo.onerror = function () {
            this.onerror = null;
            this.src = OSD_FALLBACK;
        };
        osdLogo.src = isValidLogoUrl(channel.logo) ? channel.logo : OSD_FALLBACK;
        osdName.innerText = channel.name;

        let programText = "Đang phát sóng";
        if (channel.id && epgData[channel.id]) {
            const now = getCurrentEpgTime();
            const programs = epgData[channel.id];
            const playing = programs.find(p => now >= p.start && now <= p.stop);
            if (playing) {
                programText = `${formatTime(playing.start)} - ${playing.title}`;
            }
        }
        osdNow.innerText = programText;

        osd.classList.add('show');
        clearTimeout(osdTimer);
        osdTimer = setTimeout(() => {
            osd.classList.remove('show');
        }, 4000);
    }

    // ==================== CLEANUP ALL PLAYERS ====================
    // Stop video player
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();

    // Cleanup HLS
    if (tvHlsInstance) {
        if (typeof tvHlsInstance.stopLoad === 'function') tvHlsInstance.stopLoad();
        tvHlsInstance.destroy();
        tvHlsInstance = null;
    }

    // Cleanup DASH
    if (tvDashInstance) {
        tvDashInstance.destroy();
        tvDashInstance = null;
    }

    // Cleanup YouTube API player
    if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
        clearTimeout(ytLoadTimeout);
        try { ytPlayerInstance.destroy(); } catch (e) { }
        ytPlayerInstance = null;
        ytPlayerReady = false;
    }
    const ytContainer = document.getElementById('yt-player-container');
    if (ytContainer) ytContainer.style.display = 'none';

    // Cleanup YouTube fallback iframe
    const ytIframe = document.getElementById('yt-iframe-player');
    if (ytIframe) {
        ytIframe.style.display = 'none';
        ytIframe.src = '';
    }

    let streamUrl = channel.url;

    // ==================== YOUTUBE SMART DETECTION ====================
    const ytVideoId = detectYouTubeUrl(streamUrl);
    if (ytVideoId) {
        playYouTubeChannel(channel, ytVideoId);
        return;
    }

    // ==================== NON-YOUTUBE PLAYBACK ====================
    videoPlayer.style.display = 'block';

    const plat = typeof Platform !== 'undefined' ? Platform.current : { needsProxy: true };
    if (streamUrl.startsWith("http://") && (!plat.needsProxy || !Hls.isSupported())) {
        streamUrl = streamUrl.replace("http://", "https://");
    }

    qualitySelector.style.display = 'none';
    qualitySelector.innerHTML = '<option value="-1" style="background: #111;">Tự động</option>';

    videoPlayer.setAttribute('playsinline', '');
    videoPlayer.setAttribute('webkit-playsinline', '');
    videoPlayer.setAttribute('x5-playsinline', '');
    videoPlayer.setAttribute('x5-video-player-type', 'h5');
    videoPlayer.setAttribute('x5-video-player-fullscreen', 'false');
    videoPlayer.preload = 'auto';

    if (streamUrl.includes('.mpd')) {
        if (typeof dashjs !== 'undefined') {
            tvDashInstance = dashjs.MediaPlayer().create();

            // Apply DRM protection data from M3U #KODIPROP (clearkey, widevine, playready)
            if (channel.licenseType && channel.licenseKey) {
                try {
                    const protectionData = parseDashLicenseKeys(channel.licenseType, channel.licenseKey);
                    if (protectionData) {
                        tvDashInstance.setProtectionData(protectionData);
                    }
                } catch (e) { console.warn('[TV DASH] DRM setup error:', e); }
            }

            tvDashInstance.updateSettings({
                streaming: {
                    lowLatencyEnabled: true,
                    abr: {
                        useDefaultABRRules: true,
                        autoSwitchBitrate: { video: true }
                    }
                }
            });

            tvDashInstance.initialize(videoPlayer, streamUrl, true);

            tvDashInstance.on(dashjs.MediaPlayer.events.PLAYBACK_METADATA_LOADED, function () {
                if (tvLoader) tvLoader.style.display = 'none';
            });

            tvDashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, function () {
                const bitrates = tvDashInstance.getBitrateInfoListFor('video');
                if (bitrates && bitrates.length > 1) {
                    bitrates.forEach((bitrate, index) => {
                        const option = document.createElement('option');
                        option.value = index;
                        option.style.background = '#111';
                        option.innerText = bitrate.height ? `${bitrate.height}p` : `Chất lượng ${index + 1}`;
                        qualitySelector.appendChild(option);
                    });
                    qualitySelector.style.display = 'block';

                    qualitySelector.onchange = (e) => {
                        const val = parseInt(e.target.value);
                        if (val === -1) {
                            tvDashInstance.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
                        } else {
                            tvDashInstance.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
                            tvDashInstance.setQualityFor('video', val);
                        }
                    };
                }
            });

            tvDashInstance.on(dashjs.MediaPlayer.events.ERROR, function (e) {
                if (tvLoader) tvLoader.style.display = 'none';
                if (e.error && (e.error === 'download' || e.error.message)) {
                    console.error("[TV DASH] Lỗi tải luồng mạng:", e);
                    showToast('Không thể tải kênh. Máy chủ từ chối kết nối.', 4000, 'error');
                    showErrorWithRetry('Không thể tải kênh này. Máy chủ nguồn từ chối kết nối hoặc đường truyền bị đứt.', () => {
                        playChannel(channel);
                    });
                    tvDashInstance.destroy();
                    tvDashInstance = null;
                }
            });
        } else {
            showToast('Trình duyệt không hỗ trợ phát định dạng DASH', 3000, 'error');
            if (tvLoader) tvLoader.style.display = 'none';
        }
    } else {
        if (Hls.isSupported()) {
            let mediaErrorRetries = 0;
            const maxMediaRetries = 5;
            // Build per-channel HLS config with optional custom headers
            const hlsConfig = {
                ...TV_HLS_CONFIG,
                xhrSetup: function (xhr) {
                    xhr.withCredentials = false;
                    if (channel.referrer) { try { xhr.setRequestHeader('Referer', channel.referrer); } catch (e) { } }
                    if (channel.userAgent) { try { xhr.setRequestHeader('User-Agent', channel.userAgent); } catch (e) { } }
                }
            };
            tvHlsInstance = new Hls(hlsConfig);
            const p = typeof Platform !== 'undefined' ? Platform.current : { needsProxy: true };
            const finalUrl = p.needsProxy
                ? `http://127.0.0.1:1420/proxy?url=${encodeURIComponent(streamUrl)}`
                : streamUrl;
            tvHlsInstance.loadSource(finalUrl);
            tvHlsInstance.attachMedia(videoPlayer);

            tvHlsInstance.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
                const levels = data.levels;
                const qualityInlineEl = document.getElementById('tv-quality-inline');
                if (levels && levels.length > 1) {
                    levels.forEach((level, index) => {
                        const optText = level.height ? `${level.height}p` : `Chất lượng ${index + 1}`;
                        const option1 = document.createElement('option');
                        option1.value = index;
                        option1.style.background = '#111';
                        option1.innerText = optText;
                        qualitySelector.appendChild(option1);
                        if (qualityInlineEl) {
                            const option2 = document.createElement('option');
                            option2.value = index;
                            option2.style.background = '#111';
                            option2.innerText = optText;
                            qualityInlineEl.appendChild(option2);
                        }
                    });
                    qualitySelector.style.display = 'block';
                    if (qualityInlineEl) qualityInlineEl.style.display = 'block';

                    qualitySelector.onchange = (e) => {
                        tvHlsInstance.currentLevel = parseInt(e.target.value);
                        if (qualityInlineEl) qualityInlineEl.value = e.target.value;
                    };
                }
                if (tvLoader) tvLoader.style.display = 'none';
                videoPlayer.play().catch(() => { });
            });

            tvHlsInstance.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.warn('[TV HLS] Network error, retrying load...');
                            setTimeout(() => tvHlsInstance.startLoad(), 1500);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            mediaErrorRetries++;
                            if (mediaErrorRetries <= maxMediaRetries) {
                                console.warn(`[TV HLS] Media error (#${mediaErrorRetries}), recovering...`);
                                try {
                                    if (data.details === 'bufferAppendError' || data.details === 'bufferFullError') {
                                        tvHlsInstance.recoverMediaError();
                                    }
                                    tvHlsInstance.recoverMediaError();
                                } catch (e) {
                                    console.warn('[TV HLS] recoverMediaError failed, restarting...');
                                    const currentTime = videoPlayer.currentTime;
                                    const wasPaused = videoPlayer.paused;
                                    tvHlsInstance.destroy();
                                    mediaErrorRetries = 0;
                                    // Use same config for recovery
                                    tvHlsInstance = new Hls({ ...TV_HLS_CONFIG });
                                    tvHlsInstance.loadSource(finalUrl);
                                    tvHlsInstance.attachMedia(videoPlayer);
                                    tvHlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
                                        videoPlayer.currentTime = currentTime;
                                        if (!wasPaused) videoPlayer.play().catch(() => { });
                                    });
                                }
                            } else {
                                console.error('[TV HLS] Max media retries reached, giving up.');
                                if (tvLoader) tvLoader.style.display = 'none';
                                mediaErrorRetries = 0;
                                showErrorWithRetry('Kênh phát gặp lỗi liên tục. Vui lòng thử lại hoặc chọn kênh khác.', () => {
                                    playChannel(channel);
                                });
                            }
                            break;
                        default:
                            console.error('[TV HLS] Unrecoverable error:', data.details);
                            if (tvLoader) tvLoader.style.display = 'none';
                            tvHlsInstance.destroy();
                            showErrorWithRetry('Lỗi phát sóng không thể khôi phục.', () => {
                                playChannel(channel);
                            });
                            break;
                    }
                } else {
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        if (data.details === 'bufferAppendError' || data.details === 'bufferSeekOverHole' || data.details === 'bufferNudgeOnStall') {
                            console.warn(`[TV HLS] Non-fatal: ${data.details}, recovering...`);
                            try { tvHlsInstance.recoverMediaError(); } catch (e) { }
                        }
                    }
                }
            });

        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = streamUrl;
            videoPlayer.onloadedmetadata = () => {
                if (tvLoader) tvLoader.style.display = 'none';
                videoPlayer.play().catch(() => { });
            };
        }
    }
}

// ==================== SPATIAL NAVIGATION ====================
function initSpatialNavigation() {
    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        if (watchView && watchView.style.display === 'block') return;

        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (!arrowKeys.includes(e.key)) return;

        if (document.activeElement && document.activeElement.id === 'tv-search-input') {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                return;
            }
        }

        const focusables = Array.from(document.querySelectorAll('.switch-item, .btn-exit-header, .btn-watch, .channel-card, #tv-search-input'));
        const currentFocus = document.activeElement;

        if (!currentFocus || !focusables.includes(currentFocus)) {
            e.preventDefault();
            const startElement = document.querySelector('.switch-item.active') || focusables[0];
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

            let isMatch = false;
            let distance = Infinity;

            const dx = (rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2);
            const dy = (rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2);

            if (e.key === 'ArrowRight' && rect.left >= currentRect.right - 20) {
                isMatch = true;
                distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (e.key === 'ArrowLeft' && rect.right <= currentRect.left + 20) {
                isMatch = true;
                distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (e.key === 'ArrowDown' && rect.top >= currentRect.bottom - 20) {
                isMatch = true;
                distance = Math.abs(dy) + Math.abs(dx) * 3;
            } else if (e.key === 'ArrowUp' && rect.bottom <= currentRect.top + 20) {
                isMatch = true;
                distance = Math.abs(dy) + Math.abs(dx) * 3;
            }

            if (isMatch && distance < minDistance) {
                minDistance = distance;
                bestMatch = el;
            }
        });

        if (bestMatch) {
            bestMatch.focus();
            bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    });
}

// ==================== EPG ====================
function parseEPGTime(timeStr) {
    if (!timeStr || timeStr.length < 14) return 0;
    const y = +timeStr.slice(0, 4);
    const M = +timeStr.slice(4, 6) - 1;
    const d = +timeStr.slice(6, 8);
    const h = +timeStr.slice(8, 10);
    const m = +timeStr.slice(10, 12);
    const s = +timeStr.slice(12, 14);
    return new Date(y, M, d, h, m, s).getTime();
}

async function fetchAndParseEPG(url) {
    const epgCacheKey = 'epg_parsed';
    const cachedEpg = tvGetCached(epgCacheKey);
    if (cachedEpg) {
        epgData = cachedEpg;
        console.log("EPG loaded from cache!");
        return;
    }

    try {
        const text = await tvFetchWithCache('epg_raw', url, 2, 30000);

        const blockRegex = /<programme channel="([^"]+)"[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*>(.*?)<\/programme>/gs;
        const titleRegex = /<title[^>]*>([^<]*)<\/title>/;
        const descRegex = /<desc[^>]*>([^<]*)<\/desc>/;

        let match;
        while ((match = blockRegex.exec(text)) !== null) {
            const channelId = match[1];
            const start = parseEPGTime(match[2]);
            const stop = parseEPGTime(match[3]);
            const innerXml = match[4];

            const titleMatch = titleRegex.exec(innerXml);
            const descMatch = descRegex.exec(innerXml);

            const title = titleMatch ? titleMatch[1].trim() : "Không có tên";
            const desc = descMatch ? descMatch[1].trim() : "";

            if (!epgData[channelId]) {
                epgData[channelId] = [];
            }
            epgData[channelId].push({ start, stop, title, desc });
        }

        if (Object.keys(epgData).length > 0) {
            tvSetCache(epgCacheKey, epgData);
            console.log("Tải EPG thành công!");
        } else {
            console.warn("EPG: Không có dữ liệu lịch phát sóng khả dụng.");
        }
    } catch (error) {
        console.warn("EPG: Không thể tải lịch phát sóng (file không tồn tại hoặc lỗi mạng). Kênh vẫn hoạt động bình thường.");
    }
}