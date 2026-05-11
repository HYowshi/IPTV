// ==================== SPATIAL NAVIGATION ====================
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

// ==================== MAIN INIT ====================
const CONTROLS_HIDE_DELAY = 3000;

document.addEventListener("DOMContentLoaded", () => {
    // ==================== HAMBURGER MENU ====================
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const mobileNavOverlay = document.getElementById('mobileNavOverlay');
    const mobileNavPanel = document.getElementById('mobileNavPanel');

    if (mobileNavPanel) {
        mobileNavPanel.querySelectorAll('.transition-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetUrl = link.getAttribute('href');
                closeMobileMenu();
                if (targetUrl && targetUrl !== '#') {
                    document.body.classList.add('fade-out');
                    setTimeout(() => { window.location.href = targetUrl; }, 500);
                }
            });
        });
    }

    function openMobileMenu() {
        if (!mobileNavOverlay || !mobileNavPanel) return;
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
        setTimeout(() => { mobileNavOverlay.style.display = 'none'; }, 350);
    };

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            if (hamburgerBtn.classList.contains('active')) closeMobileMenu();
            else openMobileMenu();
        });
    }

    if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', closeMobileMenu);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && hamburgerBtn && hamburgerBtn.classList.contains('active')) closeMobileMenu();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024 && hamburgerBtn && hamburgerBtn.classList.contains('active')) closeMobileMenu();
    });

    // ==================== SEARCH TOGGLE (TABLET) ====================
    const searchBox = document.getElementById('searchBox');
    const searchToggleBtn = document.getElementById('searchToggleBtn');

    if (searchToggleBtn && searchBox) {
        searchToggleBtn.addEventListener('click', () => {
            searchBox.classList.add('expanded');
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.focus();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchBox.classList.contains('expanded')) searchBox.classList.remove('expanded');
        });
    }

    // ==================== HEADER SCROLL (compact mode removed) ====================

    // ==================== TRANSITION LINKS ====================
    document.querySelectorAll('.transition-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetUrl = link.getAttribute('href');
            if (targetUrl && targetUrl !== '#') {
                document.body.classList.add('fade-out');
                setTimeout(() => { window.location.href = targetUrl; }, 500);
            }
        });
    });

    initSpatialNavigation();

    // ==================== AUTO-PLAY NEXT EPISODE ====================
    const videoPlayerNode = document.getElementById('video-player');
    if (videoPlayerNode) {
        videoPlayerNode.addEventListener('ended', () => {
            let isAutoplayOn = localStorage.getItem('phimtv_autoplay') === 'true';
            if (!isAutoplayOn) return;

            if (nextEpTimer) clearInterval(nextEpTimer);

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

                const playNext = () => { clearInterval(nextEpTimer); overlay.style.display = 'none'; allBtns[activeIndex + 1].click(); };
                const cancelNext = () => { clearInterval(nextEpTimer); overlay.style.display = 'none'; };

                btnPlayNow.onclick = playNext;
                btnCancel.onclick = cancelNext;

                nextEpTimer = setInterval(() => {
                    timeLeft -= 1;
                    numberEl.innerText = timeLeft;
                    if (timeLeft <= 0) playNext();
                }, 1000);
            }
        });
    }

    // ==================== BUTTON HANDLERS ====================
    const safeAddListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

    safeAddListener('btn-back-watch', 'click', () => {
        // Exit fullscreen if active (native or simulated)
        document.body.classList.remove('fullscreen-active');
        const headerEl = document.querySelector('header');
        if (headerEl) headerEl.style.display = '';
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { }
        }

        document.getElementById('watch-view').style.display = 'none';
        document.getElementById('detail-view').style.display = 'block';
        window.scrollTo(0, 0);
        const videoPlayer = document.getElementById('video-player');
        if (videoPlayer) { videoPlayer.pause(); videoPlayer.removeAttribute('src'); videoPlayer.load(); }
        if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) { } hlsInstance = null; }
        if (nextEpTimer) {
            clearInterval(nextEpTimer);
            const overlay = document.getElementById('next-ep-overlay');
            if (overlay) overlay.style.display = 'none';
        }
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            if (e.target.value.trim() !== "") handleSearch();
            else navigateToHome(null);
        }, 600);
    });

    safeAddListener('btn-prev-page', 'click', () => {
        if (currentFilterPage > 1) loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, currentFilterPage - 1);
    });

    safeAddListener('btn-next-page', 'click', () => {
        if (currentFilterPage < totalFilterPages) loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, currentFilterPage + 1);
    });

    safeAddListener('input-page-jump', 'keypress', (e) => {
        if (e.key === 'Enter') {
            let targetPage = parseInt(e.target.value);
            if (targetPage >= 1 && targetPage <= totalFilterPages) loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, targetPage);
            else e.target.value = currentFilterPage;
        }
    });

    safeAddListener('btn-advance-filter', 'click', handleAdvancedFilter);

    safeAddListener('btn-more-new', 'click', () => loadFilterData('new', '', 'Phim mới cập nhật', 1));
    safeAddListener('btn-more-series', 'click', () => loadFilterData('danh-sach', 'phim-bo', 'Phim bộ mới', 1));
    safeAddListener('btn-more-movies', 'click', () => loadFilterData('danh-sach', 'phim-le', 'Phim lẻ mới', 1));

    // ==================== VIDEO PLAYER CONTROLS ====================
    const btnPipToggle = document.getElementById('btn-pip-toggle');
    const videoPlayerGlobal = document.getElementById('video-player');
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

    // ==================== SETTINGS TOGGLES ====================
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
        overlay.style.setProperty('--spotlight-x', ((rect.left + rect.width / 2) / window.innerWidth * 100) + '%');
        overlay.style.setProperty('--spotlight-y', ((rect.top + rect.height / 2) / window.innerHeight * 100) + '%');
    };

    if (settingLights) settingLights.addEventListener('click', () => {
        isLightOff = !isLightOff;
        localStorage.setItem('phimtv_light', isLightOff);
        updateToggleUI(settingLightsStatus, isLightOff);
        if (isLightOff) updateSpotlight();
        document.body.classList.toggle('lights-off', isLightOff);
    });

    if (isLightOff) requestAnimationFrame(() => updateSpotlight());

    window.addEventListener('resize', () => { if (document.body.classList.contains('lights-off')) updateSpotlight(); });
    window.addEventListener('scroll', () => { if (document.body.classList.contains('lights-off')) requestAnimationFrame(updateSpotlight); }, { passive: true });

    // ==================== VIDEO CONTROLS ====================
    if (videoPlayerGlobal && playPauseBtn) {
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); settingsMenu.classList.toggle('show'); });
            document.addEventListener('click', (e) => { if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) settingsMenu.classList.remove('show'); });
        }

        if (speedSelector) {
            speedSelector.value = localStorage.getItem('phimtv_speed') || "1";
            speedSelector.addEventListener('change', (e) => { videoPlayerGlobal.playbackRate = parseFloat(e.target.value); localStorage.setItem('phimtv_speed', e.target.value); });
        }

        const formatTime = (time) => {
            if (isNaN(time)) return "00:00";
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60);
            return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
        };

        const togglePlay = () => {
            if (videoPlayerGlobal.paused) { videoPlayerGlobal.play().catch(() => { }); playPauseBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>'; }
            else { videoPlayerGlobal.pause(); playPauseBtn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>'; }
        };
        playPauseBtn.addEventListener('click', togglePlay);
        videoPlayerGlobal.addEventListener('click', togglePlay);

        videoPlayerGlobal.addEventListener('play', () => playPauseBtn.innerHTML = '<span class="material-symbols-rounded">pause</span>');
        videoPlayerGlobal.addEventListener('pause', () => playPauseBtn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>');

        const bufferedBar = document.getElementById('progress-buffered');
        const hoverTimeEl = document.getElementById('progress-hover-time');

        videoPlayerGlobal.addEventListener('timeupdate', () => {
            const duration = videoPlayerGlobal.duration;
            if (duration) {
                progressBar.style.width = `${(videoPlayerGlobal.currentTime / duration) * 100}%`;
                currentTimeDisplay.innerText = formatTime(videoPlayerGlobal.currentTime);
            }
        });

        videoPlayerGlobal.addEventListener('progress', () => {
            if (videoPlayerGlobal.duration && videoPlayerGlobal.buffered.length > 0) {
                bufferedBar.style.width = `${(videoPlayerGlobal.buffered.end(videoPlayerGlobal.buffered.length - 1) / videoPlayerGlobal.duration) * 100}%`;
            }
        });

        videoPlayerGlobal.addEventListener('loadedmetadata', () => { durationDisplay.innerText = formatTime(videoPlayerGlobal.duration); });

        let isSeeking = false;
        const seekToPosition = (clientX) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            if (videoPlayerGlobal.duration) { videoPlayerGlobal.currentTime = pos * videoPlayerGlobal.duration; progressBar.style.width = `${pos * 100}%`; }
        };

        progressContainer.addEventListener('mousedown', (e) => { isSeeking = true; seekToPosition(e.clientX); });
        document.addEventListener('mousemove', (e) => { if (isSeeking) seekToPosition(e.clientX); });
        document.addEventListener('mouseup', () => { isSeeking = false; });

        progressContainer.addEventListener('mousemove', (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (hoverTimeEl && videoPlayerGlobal.duration) {
                hoverTimeEl.innerText = formatTime(pos * videoPlayerGlobal.duration);
                hoverTimeEl.style.left = `${pos * rect.width}px`;
            }
        });

        // ==================== VOLUME ====================
        const volumePercent = document.getElementById('volume-percent');
        const volumeContainer = document.getElementById('volume-container');

        const updateVolumeUI = () => {
            const vol = videoPlayerGlobal.muted ? 0 : videoPlayerGlobal.volume;
            volumeSlider.value = vol;
            const pct = Math.round(vol * 100);
            if (volumePercent) volumePercent.textContent = pct;
            volumeSlider.style.background = `linear-gradient(to right, #f91942 0%, #ff4070 ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;
            if (videoPlayerGlobal.muted || vol === 0) { muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_off</span>'; muteBtn.classList.add('muted'); }
            else if (vol < 0.3) { muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_mute</span>'; muteBtn.classList.remove('muted'); }
            else if (vol < 0.7) { muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_down</span>'; muteBtn.classList.remove('muted'); }
            else { muteBtn.innerHTML = '<span class="material-symbols-rounded">volume_up</span>'; muteBtn.classList.remove('muted'); }
        };

        volumeSlider.addEventListener('input', (e) => { videoPlayerGlobal.volume = parseFloat(e.target.value); videoPlayerGlobal.muted = parseFloat(e.target.value) === 0; updateVolumeUI(); });
        muteBtn.addEventListener('click', () => { videoPlayerGlobal.muted = !videoPlayerGlobal.muted; if (!videoPlayerGlobal.muted && videoPlayerGlobal.volume === 0) videoPlayerGlobal.volume = 0.5; updateVolumeUI(); });
        videoPlayerGlobal.addEventListener('volumechange', () => updateVolumeUI());

        customVideoContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newVol = Math.max(0, Math.min(1, videoPlayerGlobal.volume + delta));
            videoPlayerGlobal.volume = newVol;
            videoPlayerGlobal.muted = newVol === 0;
            updateVolumeUI();
            if (volumeContainer) { volumeContainer.classList.add('active'); clearTimeout(volumeContainer._hideTimer); volumeContainer._hideTimer = setTimeout(() => volumeContainer.classList.remove('active'), 1500); }
        }, { passive: false });

        updateVolumeUI();

        // ==================== FULLSCREEN ====================
        const header = document.querySelector('header');

        const updateFullscreenIcon = () => {
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (isFs) {
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen_exit</span>';
                fullscreenBtn.classList.add('fs-active');
                document.body.classList.add('fullscreen-active');
                if (header) header.style.display = 'none';
            } else {
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen</span>';
                fullscreenBtn.classList.remove('fs-active');
                document.body.classList.remove('fullscreen-active');
                if (header) header.style.display = '';
            }
        };

        const toggleMobileFullscreen = async () => {
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (!isFs) {
                // Always apply simulated fullscreen on mobile to ensure header hides
                document.body.classList.add('fullscreen-active');
                if (header) header.style.display = 'none';
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen_exit</span>';
                fullscreenBtn.classList.add('fs-active');
                // Also try native fullscreen
                try { await toggleFullscreen(customVideoContainer); } catch(e) {}
            } else {
                // Exit both native and simulated fullscreen
                document.body.classList.remove('fullscreen-active');
                if (header) header.style.display = '';
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen</span>';
                fullscreenBtn.classList.remove('fs-active');
                try { await toggleFullscreen(customVideoContainer); } catch(e) {}
            }
        };

        // Override the exit fullscreen to also clean up mobile fullscreen
        const exitMobileFullscreen = () => {
            if (document.body.classList.contains('fullscreen-active')) {
                document.body.classList.remove('fullscreen-active');
                if (header) header.style.display = '';
                fullscreenBtn.innerHTML = '<span class="material-symbols-rounded">fullscreen</span>';
                fullscreenBtn.classList.remove('fs-active');
            }
        };

        fullscreenBtn.addEventListener('click', toggleMobileFullscreen);
        document.addEventListener('fullscreenchange', () => {
            updateFullscreenIcon();
            // If exiting fullscreen via native API, clean up mobile fullscreen too
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (!isFs) {
                exitMobileFullscreen();
            }
        });
        document.addEventListener('webkitfullscreenchange', () => {
            updateFullscreenIcon();
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (!isFs) {
                exitMobileFullscreen();
            }
        });
    }

    if (btnPipToggle && videoPlayerGlobal) {
        btnPipToggle.addEventListener('click', async () => {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else if (document.pictureInPictureEnabled) await videoPlayerGlobal.requestPictureInPicture();
        });
    }

    if (videoPlayerGlobal) {
        const savedVolume = localStorage.getItem('phimtv_volume');
        if (savedVolume !== null) videoPlayerGlobal.volume = parseFloat(savedVolume);
        videoPlayerGlobal.addEventListener('volumechange', () => localStorage.setItem('phimtv_volume', videoPlayerGlobal.volume));
        videoPlayerGlobal.addEventListener('dblclick', () => toggleFullscreen(document.getElementById('custom-video-container')));
    }

    // ==================== KEYBOARD SHORTCUTS (WATCH VIEW) ====================
    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        const videoPlayer = document.getElementById('video-player');
        if (!watchView || watchView.style.display !== 'block' || !videoPlayer) return;

        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement.isContentEditable;
        if (isInput) return;

        if (e.code === 'Space') { e.preventDefault(); videoPlayer.paused ? videoPlayer.play().catch(() => { }) : videoPlayer.pause(); }
        else if (e.code === 'ArrowRight') { e.preventDefault(); videoPlayer.currentTime += 10; }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); videoPlayer.currentTime -= 10; }
        else if (e.code === 'KeyF') { e.preventDefault(); document.getElementById('fullscreen-btn')?.click(); }
        else if (e.code === 'ArrowUp') { e.preventDefault(); videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1); }
        else if (e.code === 'ArrowDown') { e.preventDefault(); videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1); }
        else if (e.code === 'KeyM') { e.preventDefault(); videoPlayer.muted = !videoPlayer.muted; }
    });

    // ==================== FETCH HOME DATA ====================
    fetchHomeData();

    // ==================== RANDOM MOVIE BUTTON ====================
    const btnRandomMovie = document.getElementById('btn-random-movie');
    if (btnRandomMovie) {
        btnRandomMovie.addEventListener('click', async () => {
            btnRandomMovie.disabled = true;
            btnRandomMovie.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;animation:spin 1s linear infinite;">casino</span> ĐANG TÌM...';
            try {
                const randomPage = Math.floor(Math.random() * 5) + 1;
                const res = await fetchWithCache(`${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?page=${randomPage}`);
                const formatted = formatResponse(res);
                if (formatted.items && formatted.items.length > 0) {
                    const randomMovie = formatted.items[Math.floor(Math.random() * formatted.items.length)];
                    showMovieDetails(randomMovie.slug);
                }
            } catch (e) { console.error('Random movie error:', e); }
            finally { btnRandomMovie.disabled = false; btnRandomMovie.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">casino</span> XEM GÌ HÔM NAY?'; }
        });
    }

    // ==================== TRAILER PREVIEW (disabled) ====================
    /* Disabled: YouTube embed causes Tracking Prevention errors (Error 153) in Edge/Tauri
       which blocks actual video playback. YouTube's third-party storage access is
       blocked by the browser, causing cascading errors. */

    // ==================== WATCH PARTY (PeerJS P2P — Optimized) ====================
    let wpPeer = null;
    let wpConnections = {};         // host: Map<peerId, DataConnection>
    let wpHostConn = null;          // guest: connection to host
    let currentRoomId = null;
    let isHost = false;
    let wpSyncLock = false;
    let wpHeartbeatTimer = null;
    let wpSyncTimer = null;
    let wpReconnectAttempts = 0;
    let wpMaxReconnects = 3;
    let wpLatency = {};             // Map<peerId, latencyMs>
    const WP_SYNC_INTERVAL = 1500;  // 1.5s sync interval
    const WP_SYNC_THRESHOLD = 1.0;  // sync if > 1s difference
    const WP_HEARTBEAT_INTERVAL = 5000;

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
    const wpMemberCountEl = document.getElementById('wp-member-count');
    const wpMemberTextEl = document.getElementById('wp-member-text');

    function generateRoomId() { return 'phimtv-' + Math.random().toString(36).substring(2, 8).toLowerCase(); }

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

    function closeWatchPartyModal() { wpModal.style.display = 'none'; }

    function updateWpMemberUI(count) {
        if (wpMemberCountEl) {
            wpMemberCountEl.style.display = 'inline-flex';
            if (wpMemberTextEl) wpMemberTextEl.textContent = count + ' người xem';
        }
    }

    function updateWpStatusDot(connected) {
        const dot = document.querySelector('.wp-status-dot');
        if (dot) dot.classList.toggle('connected', connected);
    }

    // Broadcast to all connected peers (host)
    function wpBroadcast(msg) {
        const data = JSON.stringify(msg);
        Object.values(wpConnections).forEach(conn => {
            try { if (conn.open) conn.send(data); } catch (e) {}
        });
    }

    // Send to host (guest)
    function wpSendToHost(msg) {
        try { if (wpHostConn && wpHostConn.open) wpHostConn.send(JSON.stringify(msg)); } catch (e) {}
    }

    // Measure latency with ping/pong
    function wpSendPing(peerId) {
        const conn = peerId ? wpConnections[peerId] : wpHostConn;
        if (conn && conn.open) {
            conn.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
    }

    // Parse incoming message safely
    function parseWpMsg(raw) {
        if (typeof raw === 'object') return raw; // already object
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    // Handle incoming message from a peer
    function handleWpMessage(rawMsg, conn) {
        const msg = parseWpMsg(rawMsg);
        if (!msg) return;
        const videoPlayer = document.getElementById('video-player');

        switch (msg.type) {
            case 'sync': {
                if (!videoPlayer || wpSyncLock) break;
                wpSyncLock = true;
                // Only apply if time difference exceeds threshold
                if (Math.abs(videoPlayer.currentTime - msg.time) > WP_SYNC_THRESHOLD) {
                    videoPlayer.currentTime = msg.time;
                }
                if (videoPlayer.paused !== msg.paused) {
                    if (msg.paused) videoPlayer.pause();
                    else videoPlayer.play().catch(() => {});
                }
                setTimeout(() => { wpSyncLock = false; }, 300);
                break;
            }
            case 'play-movie': {
                if (msg.slug) showMovieDetails(msg.slug);
                break;
            }
            case 'reaction': {
                showFloatingReaction(msg.emoji);
                // Host re-broadcasts to all other peers
                if (isHost) {
                    Object.values(wpConnections).forEach(c => {
                        if (c.open && c.peer !== conn.peer) c.send(JSON.stringify(msg));
                    });
                }
                break;
            }
            case 'peer-joined': {
                wpStatus.textContent = msg.name || 'Có người vừa tham gia!';
                updateWpStatusDot(true);
                updateWpMemberUI(Object.keys(wpConnections).length + 1);
                break;
            }
            case 'peer-left': {
                wpStatus.textContent = 'Có người vừa rời đi';
                if (conn && conn.peer) {
                    delete wpConnections[conn.peer];
                    delete wpLatency[conn.peer];
                }
                const count = Object.keys(wpConnections).length + 1;
                updateWpMemberUI(count);
                if (count <= 1) updateWpStatusDot(false);
                break;
            }
            case 'ping': {
                // Reply with pong
                const reply = JSON.stringify({ type: 'pong', ts: msg.ts });
                if (conn && conn.open) conn.send(reply);
                break;
            }
            case 'pong': {
                // Calculate latency
                if (conn && conn.peer && msg.ts) {
                    wpLatency[conn.peer] = Date.now() - msg.ts;
                }
                break;
            }
        }
    }

    // Setup connection event handlers for a DataConnection
    function setupConnEvents(conn, peerName) {
        conn.on('open', () => {
            if (isHost) {
                wpConnections[conn.peer] = conn;
                wpStatus.textContent = (peerName || 'Ai đó') + ' vừa tham gia!';
                updateWpStatusDot(true);
                updateWpMemberUI(Object.keys(wpConnections).length + 1);
                // Send current video state to new member
                const videoPlayer = document.getElementById('video-player');
                if (videoPlayer) {
                    conn.send(JSON.stringify({
                        type: 'sync',
                        time: videoPlayer.currentTime,
                        paused: videoPlayer.paused,
                        slug: currentMovieData?.slug || ''
                    }));
                }
            }
        });

        conn.on('data', (rawMsg) => {
            handleWpMessage(rawMsg, conn);
            // Host re-broadcasts sync from guests to all others
            if (isHost) {
                const msg = parseWpMsg(rawMsg);
                if (msg && msg.type === 'sync') {
                    Object.values(wpConnections).forEach(c => {
                        if (c.open && c.peer !== conn.peer) c.send(JSON.stringify(msg));
                    });
                }
            }
        });

        conn.on('close', () => {
            if (isHost) {
                delete wpConnections[conn.peer];
                delete wpLatency[conn.peer];
                const count = Object.keys(wpConnections).length + 1;
                updateWpMemberUI(count);
                if (count <= 1) updateWpStatusDot(false);
                wpStatus.textContent = 'Có người vừa rời đi';
            }
        });

        conn.on('error', (err) => {
            console.warn('[WatchParty] Connection error:', err);
        });
    }

    // Host: create room
    function createRoom(roomId) {
        if (typeof Peer === 'undefined') {
            wpStatus.textContent = 'Lỗi: PeerJS chưa được tải. Kiểm tra kết nối mạng.';
            return;
        }

        wpStatus.textContent = 'Đang tạo phòng...';
        wpPeer = new Peer(roomId, {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });

        wpPeer.on('open', (id) => {
            currentRoomId = id;
            isHost = true;
            wpReconnectAttempts = 0;
            wpRoomCodeText.textContent = id;
            wpRoomInfo.style.display = 'block';
            document.getElementById('wp-create-section').style.display = 'none';
            document.getElementById('wp-join-section').style.display = 'none';
            document.querySelector('.wp-divider').style.display = 'none';
            wpStatus.textContent = 'Phòng sẵn sàng! Chia sẻ mã cho bạn bè.';
            updateWpStatusDot(true);
            updateWpMemberUI(1);
            startWpHeartbeat();
            startWpSync();
        });

        wpPeer.on('connection', (conn) => {
            setupConnEvents(conn, 'Người #' + (Object.keys(wpConnections).length + 1));
        });

        wpPeer.on('disconnected', () => {
            if (currentRoomId && wpPeer) {
                wpStatus.textContent = 'Mất kết nối signaling, đang thử lại...';
                wpPeer.reconnect();
            }
        });

        wpPeer.on('error', (err) => {
            console.error('[WatchParty] Host error:', err);
            if (err.type === 'unavailable-id') {
                wpStatus.textContent = 'Mã phòng đã tồn tại. Thử lại...';
                setTimeout(() => createRoom(generateRoomId()), 1000);
            } else {
                wpStatus.textContent = 'Lỗi: ' + (err.message || err.type);
            }
        });
    }

    // Guest: join room
    function joinRoom(roomId) {
        if (typeof Peer === 'undefined') {
            wpStatus.textContent = 'Lỗi: PeerJS chưa được tải. Kiểm tra kết nối mạng.';
            return;
        }

        wpStatus.textContent = 'Đang tạo kết nối...';
        wpPeer = new Peer(undefined, {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });

        wpPeer.on('open', (myId) => {
            wpStatus.textContent = 'Đang kết nối tới phòng...';
            wpReconnectAttempts = 0;

            const conn = wpPeer.connect(roomId, {
                metadata: { name: 'Khách' },
                reliable: true
            });
            wpHostConn = conn;

            conn.on('open', () => {
                currentRoomId = roomId;
                isHost = false;
                wpRoomCodeText.textContent = roomId;
                wpRoomInfo.style.display = 'block';
                document.getElementById('wp-create-section').style.display = 'none';
                document.getElementById('wp-join-section').style.display = 'none';
                document.querySelector('.wp-divider').style.display = 'none';
                wpStatus.textContent = 'Đã kết nối phòng!';
                updateWpStatusDot(true);
                updateWpMemberUI(2);
                startWpHeartbeat();
                startWpSync();
                // Announce join
                conn.send(JSON.stringify({ type: 'peer-joined', name: 'Khách' }));
            });

            conn.on('data', (rawMsg) => { handleWpMessage(rawMsg, conn); });

            conn.on('close', () => {
                wpStatus.textContent = 'Mất kết nối với chủ phòng';
                updateWpStatusDot(false);
                wpHostConn = null;
                // Auto-reconnect attempt
                if (currentRoomId && wpReconnectAttempts < wpMaxReconnects) {
                    wpReconnectAttempts++;
                    wpStatus.textContent = `Đang thử kết nối lại... (${wpReconnectAttempts}/${wpMaxReconnects})`;
                    setTimeout(() => { if (currentRoomId && !wpHostConn) joinRoom(currentRoomId); }, 2000 * wpReconnectAttempts);
                }
            });

            conn.on('error', (err) => { console.warn('[WatchParty] Guest conn error:', err); });
        });

        wpPeer.on('disconnected', () => {
            if (currentRoomId && wpPeer && !isHost) {
                wpStatus.textContent = 'Mất kết nối signaling, đang thử lại...';
                wpPeer.reconnect();
            }
        });

        wpPeer.on('error', (err) => {
            console.error('[WatchParty] Guest error:', err);
            if (err.type === 'peer-unavailable') {
                wpStatus.textContent = 'Không tìm thấy phòng. Kiểm tra lại mã.';
            } else if (err.type === 'network') {
                wpStatus.textContent = 'Lỗi mạng. Kiểm tra kết nối internet.';
            } else {
                wpStatus.textContent = 'Lỗi: ' + (err.message || err.type);
            }
        });
    }

    function leaveRoom() {
        stopWpHeartbeat();
        stopWpSync();

        if (isHost) {
            wpBroadcast({ type: 'peer-left' });
            Object.values(wpConnections).forEach(conn => { try { conn.close(); } catch(e){} });
            wpConnections = {};
        } else {
            wpSendToHost({ type: 'peer-left' });
            if (wpHostConn) { try { wpHostConn.close(); } catch(e){} }
            wpHostConn = null;
        }

        if (wpPeer) { try { wpPeer.destroy(); } catch(e){} wpPeer = null; }
        wpLatency = {};
        currentRoomId = null; isHost = false; wpReconnectAttempts = 0;
        wpRoomInfo.style.display = 'none';
        if (wpMemberCountEl) wpMemberCountEl.style.display = 'none';
        document.getElementById('wp-create-section').style.display = 'block';
        document.getElementById('wp-join-section').style.display = 'block';
        document.querySelector('.wp-divider').style.display = 'flex';
    }

    // Heartbeat: ping peers for latency measurement
    function startWpHeartbeat() {
        stopWpHeartbeat();
        wpHeartbeatTimer = setInterval(() => {
            if (isHost) {
                Object.keys(wpConnections).forEach(peerId => {
                    wpSendPing(peerId);
                });
            } else if (wpHostConn) {
                wpSendPing(null);
            }
        }, WP_HEARTBEAT_INTERVAL);
    }

    function stopWpHeartbeat() {
        if (wpHeartbeatTimer) { clearInterval(wpHeartbeatTimer); wpHeartbeatTimer = null; }
    }

    // Sync: host sends video state periodically
    function startWpSync() {
        stopWpSync();
        wpSyncTimer = setInterval(() => {
            if (!currentRoomId) return;
            const videoPlayer = document.getElementById('video-player');
            const watchView = document.getElementById('watch-view');
            if (!videoPlayer || !watchView || watchView.style.display !== 'block' || wpSyncLock) return;

            if (isHost && Object.keys(wpConnections).length > 0) {
                wpBroadcast({ type: 'sync', time: videoPlayer.currentTime, paused: videoPlayer.paused, slug: currentMovieData?.slug || '' });
            }
        }, WP_SYNC_INTERVAL);
    }

    function stopWpSync() {
        if (wpSyncTimer) { clearInterval(wpSyncTimer); wpSyncTimer = null; }
    }

    // Floating reaction animation
    function showFloatingReaction(emoji) {
        const el = document.createElement('div');
        el.className = 'wp-floating-reaction';
        el.textContent = emoji;
        el.style.left = (Math.random() * 60 + 20) + 'vw';
        el.style.bottom = '100px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2200);
    }

    // Event listeners
    if (btnWatchParty) btnWatchParty.addEventListener('click', openWatchPartyModal);
    if (btnCloseWpModal) btnCloseWpModal.addEventListener('click', closeWatchPartyModal);
    if (wpModal) wpModal.addEventListener('click', (e) => { if (e.target === wpModal) closeWatchPartyModal(); });
    if (btnCreateRoom) btnCreateRoom.addEventListener('click', () => { createRoom(generateRoomId()); });
    if (btnJoinRoom) btnJoinRoom.addEventListener('click', () => {
        const roomId = wpRoomInput.value.trim().toLowerCase();
        if (roomId) joinRoom(roomId);
    });
    if (wpRoomInput) wpRoomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnJoinRoom.click(); });
    if (btnCopyRoom) btnCopyRoom.addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoomId).then(() => {
            btnCopyRoom.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">check</span> Đã sao chép';
            setTimeout(() => { btnCopyRoom.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">content_copy</span> Sao chép'; }, 2000);
        });
    });
    if (btnLeaveRoom) btnLeaveRoom.addEventListener('click', leaveRoom);

    // Reaction buttons
    document.querySelectorAll('.wp-reaction-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.getAttribute('data-emoji');
            const msg = { type: 'reaction', emoji };
            showFloatingReaction(emoji);
            if (isHost) wpBroadcast(msg);
            else wpSendToHost(msg);
        });
    });

    // Guest: send sync when user interacts with video (bidirectional)
    let lastGuestSync = 0;
    const videoElForSync = document.getElementById('video-player');
    if (videoElForSync) {
        videoElForSync.addEventListener('pause', () => {
            if (isHost || !wpHostConn || !wpHostConn.open) return;
            wpSendToHost({ type: 'sync', time: videoElForSync.currentTime, paused: true });
        });
        videoElForSync.addEventListener('play', () => {
            if (isHost || !wpHostConn || !wpHostConn.open) return;
            wpSendToHost({ type: 'sync', time: videoElForSync.currentTime, paused: false });
        });
        videoElForSync.addEventListener('seeked', () => {
            if (isHost || !wpHostConn || !wpHostConn.open) return;
            const now = Date.now();
            if (now - lastGuestSync < 1000) return;
            lastGuestSync = now;
            wpSendToHost({ type: 'sync', time: videoElForSync.currentTime, paused: videoElForSync.paused });
        });
    }

    // ==================== PIP INDICATOR ====================
    const pipIndicator = document.getElementById('pip-indicator');
    const pipReturn = document.getElementById('pip-return');
    const pipTitle = document.getElementById('pip-title');

    if (videoPlayerGlobal) {
        videoPlayerGlobal.addEventListener('enterpictureinpicture', () => {
            if (pipIndicator) { pipIndicator.style.display = 'flex'; pipTitle.textContent = currentMovieData ? `Đang phát: ${currentMovieData.name}` : 'Đang phát thu nhỏ'; }
        });
        videoPlayerGlobal.addEventListener('leavepictureinpicture', () => { if (pipIndicator) pipIndicator.style.display = 'none'; });
    }

    if (pipReturn) pipReturn.addEventListener('click', async () => { if (document.pictureInPictureElement) await document.exitPictureInPicture(); });
});