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
        const tvHeader = document.querySelector('.tv-header');
        btnFullscreen.addEventListener('click', () => {
            const fsElement = watchView;
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            try {
                if (!isFs) {
                    if (fsElement.requestFullscreen) fsElement.requestFullscreen();
                    else if (fsElement.webkitRequestFullscreen) fsElement.webkitRequestFullscreen();
                    else if (fsElement.msRequestFullscreen) fsElement.msRequestFullscreen();
                    // Hide header on fullscreen enter
                    if (tvHeader) tvHeader.style.display = 'none';
                } else {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                    else if (document.msExitFullscreen) document.msExitFullscreen();
                    // Show header on fullscreen exit
                    if (tvHeader) tvHeader.style.display = '';
                }
            } catch (e) { }
        });

        const updateFullscreenIcon = () => {
            const icon = btnFullscreen.querySelector('span');
            const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (icon) icon.textContent = isFs ? 'fullscreen_exit' : 'fullscreen';
            // Also hide/show header based on fullscreen state
            if (tvHeader) tvHeader.style.display = isFs ? 'none' : '';
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