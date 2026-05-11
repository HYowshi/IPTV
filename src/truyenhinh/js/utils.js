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
    // Check cache first
    const cached = normalizeCache.get(name);
    if (cached !== undefined) return cached;

    let clean = name.toLowerCase();
    clean = clean.normalize("NFD").replace(DIACRITICS_REGEX, "");
    clean = clean.replace(/đ/g, "d");
    clean = clean.replace(BRACKET_REGEX, '');

    // Reset lastIndex for reusable global regex
    NOISE_REGEX.lastIndex = 0;
    clean = clean.replace(NOISE_REGEX, '');
    clean = clean.replace(NON_ALPHANUM_REGEX, '');

    // Cache result (bounded size)
    if (normalizeCache.size > 2000) normalizeCache.clear();
    normalizeCache.set(name, clean);

    return clean;
}

// ==================== LOGO & UI HELPERS ====================
function isValidLogoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function escapeHtml(str) {
    return str.replace(ESCAPE_HTML_REGEX, ch => ESCAPE_HTML_MAP[ch]);
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

// ==================== TIME & EPG HELPERS ====================
function formatTime(ms) {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getCurrentEpgTime() {
    return Date.now();
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