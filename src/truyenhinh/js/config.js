// ==================== GLOBAL STATE ====================
let epgData = {};
let allChannels = [];
let currentChannelList = [];
let tvHlsInstance = null;
let currentPlayingChannel = null;
let tvDashInstance = null;
let osdTimer = null;
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

// Pre-compiled regex for normalizeChannelName (avoids re-creating per call)
const NOISE_REGEX = /\b(hd|fhd|uhd|4k|sd|1080p|720p|1080i|50fps|60fps|hevc|h264|h265|vip|premium|vietsub|thuyet minh|raw|bao va ptth|bao|ptth|channel|tv|truyen hinh)\b/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const BRACKET_REGEX = /\[.*?\]|\(.*?\)/g;
const NON_ALPHANUM_REGEX = /[^a-z0-9]/g;
const ESCAPE_HTML_MAP = { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;' };
const ESCAPE_HTML_REGEX = /[&<>"']/g;
const normalizeCache = new Map();

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
    maxBufferHole: 0.1,
    backBufferLength: 10,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 1000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1000,
    nudgeOffset: 0.5,
    nudgeMaxRetry: 10,
    maxFragLookUpTolerance: 0.25,
    startLevel: -1,
    abrBandWidthFactor: 0.95,
    abrBandWidthUpFactor: 0.7,
    abrEwmaDefaultEstimate: 2000000,
    appendErrorMaxRetry: 5
};

// ==================== LOGO & UI CONSTANTS ====================
const LOGO_FALLBACK = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23141414%22 rx=%2210%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2210%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ETV%3C/text%3E%3C/svg%3E";
const OSD_FALLBACK = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23141414%22 rx=%228%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2212%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ETV%3C/text%3E%3C/svg%3E";

// Pre-compiled M3U parsing regexes
const M3U_GROUP_REGEX = /group-title="([^"]+)"/;
const M3U_LOGO_REGEX = /tvg-logo="([^"]*)"/;
const M3U_ID_REGEX = /tvg-id="([^"]*)"/;
const M3U_LINE_SPLIT = /\r?\n/;

// Pre-compiled EPG parsing regexes
const EPG_BLOCK_REGEX = /<programme channel="([^"]+)"[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g;
const EPG_TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/;
const EPG_DESC_REGEX = /<desc[^>]*>([^<]*)<\/desc>/;