/**
 * Performance optimization utilities for Phim.tv
 * - Passive event listeners
 * - IntersectionObserver for lazy loading
 * - RequestIdleCallback for deferred tasks
 * - Debounce/throttle utilities
 */

// ==================== PASSIVE EVENT LISTENERS ====================
// Override addEventListener to default touch/wheel events to passive
(function() {
    const origAddEvent = EventTarget.prototype.addEventListener;
    const passiveEvents = new Set(['touchstart', 'touchmove', 'touchend', 'wheel', 'mousewheel', 'scroll']);
    
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (passiveEvents.has(type) && typeof options === 'undefined') {
            options = { passive: true };
        }
        return origAddEvent.call(this, type, listener, options);
    };
})();

// ==================== LAZY IMAGE LOADING ====================
const LazyLoader = (() => {
    let observer = null;
    
    function init() {
        if (!('IntersectionObserver' in window)) return;
        
        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    if (img.dataset.bg) {
                        img.style.backgroundImage = `url(${img.dataset.bg})`;
                        img.removeAttribute('data-bg');
                    }
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '200px 0px', // Load 200px before visible
            threshold: 0.01
        });
    }
    
    function observe(el) {
        if (!observer) init();
        if (observer) observer.observe(el);
    }
    
    function observeAll(selector) {
        document.querySelectorAll(selector).forEach(el => observe(el));
    }
    
    return { observe, observeAll, init };
})();

// ==================== THROTTLE ====================
function throttle(fn, delay) {
    let lastCall = 0;
    let timer = null;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            fn.apply(this, args);
        } else {
            clearTimeout(timer);
            timer = setTimeout(() => {
                lastCall = Date.now();
                fn.apply(this, args);
            }, delay - (now - lastCall));
        }
    };
}

// ==================== DEBOUNCE ====================
function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ==================== REQUEST IDLE CALLBACK POLYFILL ====================
const requestIdle = window.requestIdleCallback || function(cb) {
    return setTimeout(() => cb({ timeRemaining: () => 50 }), 1);
};

// ==================== BATCH DOM UPDATES ====================
function batchDOM(fn) {
    requestAnimationFrame(() => {
        fn();
    });
}

// ==================== CONNECTION OPTIMIZATION ====================
const ConnectionManager = (() => {
    let _online = navigator.onLine;
    let _listeners = [];
    let _retryQueue = [];
    
    window.addEventListener('online', () => {
        _online = true;
        _flushRetryQueue();
        _notify('online');
    }, { passive: true });
    
    window.addEventListener('offline', () => {
        _online = false;
        _notify('offline');
    }, { passive: true });
    
    // Detect slow connection
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    let _effectiveType = connection ? connection.effectiveType : '4g';
    
    if (connection) {
        connection.addEventListener('change', () => {
            _effectiveType = connection.effectiveType;
            _notify('connection-change', { effectiveType: _effectiveType });
        }, { passive: true });
    }
    
    function isOnline() { return _online; }
    function isSlowConnection() { return _effectiveType === 'slow-2g' || _effectiveType === '2g'; }
    function getEffectiveType() { return _effectiveType; }
    
    // Get timeout based on connection speed
    function getTimeout(baseTimeout) {
        if (isSlowConnection()) return baseTimeout * 3;
        if (_effectiveType === '3g') return baseTimeout * 2;
        return baseTimeout;
    }
    
    // Get retry count based on connection
    function getRetries(baseRetries) {
        if (isSlowConnection()) return Math.max(1, baseRetries - 1);
        return baseRetries;
    }
    
    function addToRetryQueue(task) {
        if (_online) {
            task().catch(() => { _retryQueue.push(task); });
        } else {
            _retryQueue.push(task);
        }
    }
    
    function _flushRetryQueue() {
        const queue = [..._retryQueue];
        _retryQueue = [];
        queue.forEach(task => task().catch(() => { _retryQueue.push(task); }));
    }
    
    function onStatusChange(listener) {
        _listeners.push(listener);
        return () => { _listeners = _listeners.filter(l => l !== listener); };
    }
    
    function _notify(type, data) {
        _listeners.forEach(l => {
            try { l(type, data); } catch(e) {}
        });
    }
    
    return {
        isOnline, isSlowConnection, getEffectiveType,
        getTimeout, getRetries, addToRetryQueue, onStatusChange
    };
})();

// ==================== NETWORK-AWARE FETCH ====================
async function smartFetch(url, options = {}) {
    if (!ConnectionManager.isOnline()) {
        throw new Error('No network connection');
    }
    
    const baseTimeout = options.timeout || 8000;
    const timeout = ConnectionManager.getTimeout(baseTimeout);
    const retries = ConnectionManager.getRetries(options.retries || 3);
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timer);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
    } catch (error) {
        clearTimeout(timer);
        throw error;
    }
}

// ==================== PREFETCH ====================
const Prefetcher = (() => {
    const prefetched = new Set();
    
    function prefetch(url) {
        if (prefetched.has(url)) return;
        prefetched.add(url);
        
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        link.as = 'fetch';
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    }
    
    function preconnect(origin) {
        if (prefetched.has(origin)) return;
        prefetched.add(origin);
        
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = origin;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    }
    
    return { prefetch, preconnect };
})();

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    // Observe all lazy images
    requestIdle(() => {
        LazyLoader.observeAll('img[data-src]');
    });
    
    // Preconnect to known CDNs
    requestIdle(() => {
        Prefetcher.preconnect('https://img.ophim.live');
        Prefetcher.preconnect('https://phimimg.com');
        Prefetcher.preconnect('https://image.tmdb.org');
    });
    
    // Show offline banner when connection lost
    ConnectionManager.onStatusChange((type) => {
        let banner = document.getElementById('connection-banner');
        if (type === 'offline') {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'connection-banner';
                banner.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 16px;background:#f91942;color:#fff;text-align:center;font-size:13px;font-weight:600;z-index:99999;transform:translateY(-100%);transition:transform 0.3s ease;';
                banner.textContent = '⚠ Mất kết nối mạng. Đang chờ kết nối lại...';
                document.body.appendChild(banner);
                requestAnimationFrame(() => { banner.style.transform = 'translateY(0)'; });
            }
        } else if (type === 'online' && banner) {
            banner.style.transform = 'translateY(-100%)';
            setTimeout(() => banner.remove(), 300);
        }
    });
});