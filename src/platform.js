/**
 * Platform detection utility for Phim.tv
 * Works across Desktop (Tauri), Mobile (Android/iOS), and Web
 */

const Platform = (() => {
    let _cached = null;

    function detect() {
        if (_cached) return _cached;

        // Tauri v2 with internals
        const isTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

        // Check navigator for mobile
        const ua = navigator.userAgent || '';
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);

        let platform = 'web';
        if (isAndroid) platform = 'android';
        else if (isIOS) platform = 'ios';
        else if (isTauri) platform = 'desktop';

        _cached = {
            isDesktop: platform === 'desktop',
            isAndroid: platform === 'android',
            isIOS: platform === 'ios',
            isMobile: platform === 'android' || platform === 'ios',
            isWeb: platform === 'web',
            isTauri: isTauri,
            platform: platform,
            // Whether proxy is needed (only on desktop where CORS applies)
            needsProxy: isTauri && !isAndroid && !isIOS,
        };

        console.log(`[Platform] Detected: ${_cached.platform}, needsProxy: ${_cached.needsProxy}`);
        return _cached;
    }

    return { detect, get current() { return detect(); } };
})();

// Setup platform-aware features after DOM is ready
function setupPlatformFeatures() {
    const p = Platform.current;
    
    // Remove ALL data-tauri-drag-region attributes by default (safe for mobile/web)
    document.querySelectorAll('[data-tauri-drag-region]').forEach(el => {
        el.removeAttribute('data-tauri-drag-region');
    });
    
    // Only enable drag-region on desktop Tauri
    if (p.isDesktop) {
        // Restore drag-region on desktop: covers all header types across pages
        const dragSelectors = [
            '.entry-header', '.entry-body',     // index.html
            '.tv-header', '.tv-header-left',     // truyenhinh.html
            'header', '.header-left'             // phim.html
        ].join(', ');
        document.querySelectorAll(dragSelectors).forEach(el => {
            el.setAttribute('data-tauri-drag-region', '');
        });
    }
}

// Also try to get platform from Tauri backend for more accuracy
(async () => {
    try {
        if (window.__TAURI__ && window.__TAURI__.core) {
            const backendPlatform = await window.__TAURI__.core.invoke('get_platform');
            if (backendPlatform) {
                const p = Platform.current;
                p.platform = backendPlatform;
                p.isDesktop = backendPlatform === 'desktop';
                p.isAndroid = backendPlatform === 'android';
                p.isIOS = backendPlatform === 'ios';
                p.isMobile = backendPlatform === 'android' || backendPlatform === 'ios';
                p.needsProxy = p.isDesktop;
                console.log(`[Platform] Backend confirmed: ${backendPlatform}`);
            }
        }
    } catch (e) { }
    
    // Setup features once platform is known
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupPlatformFeatures);
    } else {
        setupPlatformFeatures();
    }
})();

// Android-specific: hide exit button (back button handles it)
document.addEventListener('DOMContentLoaded', () => {
    const p = Platform.current;
    if (p.isAndroid) {
        const exitBtn = document.getElementById('btn-exit-main');
        if (exitBtn) exitBtn.classList.add('android-hidden');
        
        // Also hide "Thoát" buttons in sub-page headers
        document.querySelectorAll('.btn-exit-header').forEach(btn => {
            btn.style.display = 'none';
        });
    }
});
