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
        window.onYouTubeIframeAPIReady = () => resolve(window.YT);
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
                        // bufferSeekOverHole and bufferNudgeOnStamp are already handled
                        // internally by HLS.js — calling recoverMediaError() here causes
                        // an infinite recovery loop.  Only log them once per session.
                        if (data.details === 'bufferSeekOverHole' || data.details === 'bufferNudgeOnStall') {
                            if (!tvHlsInstance._holeWarned) {
                                console.warn(`[TV HLS] Non-fatal: ${data.details}, handled by HLS.js`);
                                tvHlsInstance._holeWarned = true;
                            }
                            return;
                        }
                        if (data.details === 'bufferAppendError') {
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