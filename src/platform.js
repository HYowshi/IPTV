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

    // Phim player: tap video to show/hide controls on mobile
    if (p.isMobile) {
        const videoContainer = document.getElementById('custom-video-container');
        if (videoContainer) {
            let controlsTimer;
            videoContainer.addEventListener('click', (e) => {
                if (e.target.closest('.custom-controls')) return;
                videoContainer.classList.toggle('show-controls');
                clearTimeout(controlsTimer);
                if (videoContainer.classList.contains('show-controls')) {
                    controlsTimer = setTimeout(() => {
                        videoContainer.classList.remove('show-controls');
                    }, 4000);
                }
            });
        }
    }

    // Fix fullscreen for mobile: move watch-view to body level for true fullscreen
    if (p.isMobile) {
        // Store original DOM position for watch-view restoration
        let _fsOriginalParent = null;
        let _fsOriginalNextSibling = null;

        document.addEventListener('click', (e) => {
            const fsBtn = e.target.closest('#btn-fullscreen-tv, #fullscreen-btn');
            if (!fsBtn) return;

            const watchView = document.getElementById('watch-view');
            if (!watchView || watchView.style.display !== 'block') return;

            // Prevent the original handler from also firing
            e.stopImmediatePropagation();

            const isFs = watchView.classList.contains('landscape-mode');

            if (!isFs) {
                // === ENTER FULLSCREEN ===

                // 1. Save original DOM position
                _fsOriginalParent = watchView.parentNode;
                _fsOriginalNextSibling = watchView.nextSibling;

                // 2. Save scroll position
                document.body.dataset.scrollY = window.scrollY;

                // 3. Move watch-view to body level (escape all parent containers)
                document.body.appendChild(watchView);

                // 4. Apply fullscreen classes
                watchView.classList.add('landscape-mode');
                document.body.classList.add('fullscreen-active');

                // 5. Lock screen orientation to landscape
                try {
                    if (screen.orientation && screen.orientation.lock) {
                        screen.orientation.lock('landscape').catch(() => {});
                    }
                } catch (e) {}

                // 6. Try native fullscreen for rotation on Android WebView
                try {
                    if (watchView.requestFullscreen) watchView.requestFullscreen().catch(() => {});
                    else if (watchView.webkitRequestFullscreen) watchView.webkitRequestFullscreen();
                } catch (e) {}

            } else {
                // === EXIT FULLSCREEN ===

                // 1. Remove fullscreen classes
                watchView.classList.remove('landscape-mode');
                document.body.classList.remove('fullscreen-active');

                // 2. Reset body styles
                document.body.style.position = '';
                document.body.style.width = '';
                document.body.style.height = '';
                document.body.style.overflow = '';

                // 3. Restore watch-view to original DOM position
                if (_fsOriginalParent) {
                    if (_fsOriginalNextSibling) {
                        _fsOriginalParent.insertBefore(watchView, _fsOriginalNextSibling);
                    } else {
                        _fsOriginalParent.appendChild(watchView);
                    }
                    _fsOriginalParent = null;
                    _fsOriginalNextSibling = null;
                }

                // 4. Show all hidden elements
                document.querySelectorAll('header, .tv-header').forEach(h => h.style.display = '');

                // 5. Restore scroll position
                const scrollY = document.body.dataset.scrollY;
                if (scrollY) {
                    window.scrollTo(0, parseInt(scrollY));
                    delete document.body.dataset.scrollY;
                }

                // 6. Unlock orientation
                try {
                    if (screen.orientation && screen.orientation.unlock) {
                        screen.orientation.unlock();
                    }
                } catch (e) {}

                // 7. Exit native fullscreen
                try {
                    if (document.fullscreenElement || document.webkitFullscreenElement) {
                        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
                        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                    }
                } catch (e) {}
            }

            // Update icon
            const icon = fsBtn.querySelector('span');
            if (icon) icon.textContent = watchView.classList.contains('landscape-mode') ? 'fullscreen_exit' : 'fullscreen';
        }, true); // capture phase to intercept before original handler
    }
});
