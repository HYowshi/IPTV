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
})();