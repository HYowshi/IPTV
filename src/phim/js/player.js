function openWatchView(episodeData) {
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Tự động kích hoạt chế độ Fullscreen ngay lập tức trong sự kiện click của user để tránh bị chặn
    const _platform = typeof Platform !== 'undefined' ? Platform.current : null;
    if (_platform && _platform.isAndroid) {
        const fsBtn = document.getElementById('fullscreen-btn');
        const watchView = document.getElementById('watch-view');
        if (fsBtn && watchView && !watchView.classList.contains('landscape-mode')) {
            try {
                fsBtn.click();
            } catch (e) {
                console.warn('[Player] Immediate fullscreen failed, fallback to pending');
                window._pendingAutoFullscreen = true;
            }
        } else {
            window._pendingAutoFullscreen = true;
        }
    }

    // Tìm xem tập phim được chọn thuộc Server nào
    let activeServerIndex = 0;
    if (currentMovieData && currentMovieData.episodes) {
        currentMovieData.episodes.forEach((server, index) => {
            const hasEp = server.server_data.some(ep => ep.link_m3u8 === episodeData.link_m3u8 || (ep.name === episodeData.name && ep.slug === episodeData.slug));
            if (hasEp) {
                activeServerIndex = index;
            }
        });
    }

    const watchServerContainer = document.getElementById('watch-server-list');
    watchServerContainer.innerHTML = "";
    currentMovieData.episodes.forEach((server, index) => {
        const sBtn = document.createElement("button");
        sBtn.className = "btn-server" + (index === activeServerIndex ? " active" : "");
        sBtn.innerText = "Server " + server.server_name;
        sBtn.onclick = (e) => {
            document.getElementById('watch-server-list').querySelectorAll('.btn-server').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderEpisodesByServer(server.server_data, 'watch-episode-list', true, currentMovieData.slug);
        };
        watchServerContainer.appendChild(sBtn);
    });

    renderEpisodesByServer(currentMovieData.episodes[activeServerIndex].server_data, 'watch-episode-list', true, currentMovieData.slug);

    setTimeout(() => {
        const watchEpisodeList = document.getElementById('watch-episode-list');
        const epBtns = Array.from(watchEpisodeList.querySelectorAll('.btn-episode'));
        const targetBtn = epBtns.find(btn => btn.innerText === episodeData.name);
        
        if (targetBtn) {
            updateWatchViewPlayer(episodeData, targetBtn);
        } else {
            const firstEpBtn = watchEpisodeList.querySelector('.btn-episode');
            if (firstEpBtn) {
                updateWatchViewPlayer(episodeData, firstEpBtn);
            }
        }
    }, 100);
}

function updateWatchViewPlayer(ep, btnElement) {
    if (nextEpTimer) {
        clearInterval(nextEpTimer);
    }
    const overlay = document.getElementById('next-ep-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    const btnFloating = document.getElementById('btn-next-ep-floating');
    if (btnFloating) {
        btnFloating.style.display = 'none';
        btnFloating.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const watchEpisodeList = document.getElementById('watch-episode-list');
            if (watchEpisodeList) {
                const allBtns = Array.from(watchEpisodeList.querySelectorAll('.btn-episode'));
                const activeIndex = allBtns.findIndex(btn => btn.classList.contains('active'));
                if (activeIndex >= 0 && activeIndex < allBtns.length - 1) {
                    btnFloating.style.display = 'none';
                    allBtns[activeIndex + 1].click();
                }
            }
        };
    }

    const episodeListContainer = document.getElementById('watch-episode-list');
    const currentActive = episodeListContainer.querySelector('.active');

    if (currentActive) {
        currentActive.classList.remove('active');
    }

    const allBtns = Array.from(episodeListContainer.children);
    let currentIndex = allBtns.indexOf(btnElement);

    if (btnElement) {
        btnElement.classList.add('active');
        btnElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.title = `▶ ${currentMovieData.name} - Tập ${ep.name}`;
    document.getElementById('watch-title').innerText = `${currentMovieData.name} - Tập ${ep.name}`;

    const videoPlayer = document.getElementById('video-player');
    const videoLoader = document.getElementById('video-loader');

    videoPlayer.focus();
    videoPlayer.playbackRate = parseFloat(localStorage.getItem('phimtv_speed') || "1");
    videoLoader.style.display = 'flex';
    videoPlayer.style.opacity = '0';

    if (!watchHistoryCache) {
        watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
    }

    let savedTime = 0;
    const existingCache = watchHistoryCache[currentMovieData.slug];
    if (existingCache && (existingCache.name === ep.name || existingCache.epName === ep.name) && existingCache.currentTime) {
        savedTime = existingCache.currentTime;
    }

    watchHistoryCache[currentMovieData.slug] = {
        ...ep,
        movieName: currentMovieData.name,
        moviePoster: currentMovieData.thumb_url || currentMovieData.poster_url,
        movieSlug: currentMovieData.slug,
        epName: ep.name,
        currentTime: savedTime,
        updatedAt: Date.now()
    };
    trimWatchHistory(watchHistoryCache);
    localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));

    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) { }
        hlsInstance = null;
    }

    videoPlayer.src = "";
    videoPlayer.load();

    let streamUrl = ep.link_m3u8;
    const platform = typeof Platform !== 'undefined' ? Platform.current : { needsProxy: false, isLowMemory: false };
    const useProxy = !!platform.needsProxy;
    const lowMemory = !!platform.isLowMemory;

    // Desktop: luôn convert http → https, load trực tiếp (không dùng proxy)
    // Android: dùng proxy chỉ khi stream là http:// (server IPTV block https upgrade)
    if (useProxy && streamUrl.startsWith('http://')) {
        // Android + stream HTTP → đi qua proxy để bypass CORS
        // Giữ nguyên http:// (proxy sẽ fetch trực tiếp)
    } else {
        // Desktop hoặc stream HTTPS → convert http → https, load trực tiếp
        if (streamUrl.startsWith('http://')) {
            streamUrl = streamUrl.replace(/^http:/, 'https:');
        }
    }

    const finalStreamUrl = (useProxy && ep.link_m3u8.startsWith('http://'))
        ? `http://127.0.0.1:1420/proxy?url=${encodeURIComponent(streamUrl)}`
        : streamUrl;

    // Helper: trigger fullscreen sau khi video bắt đầu play (chỉ Android)
    const triggerAutoFullscreen = () => {
        if (window._pendingAutoFullscreen) {
            window._pendingAutoFullscreen = false;
            setTimeout(() => {
                const fsBtn = document.getElementById('fullscreen-btn');
                if (fsBtn) fsBtn.click();
            }, 500);
        }
    };

    // Helper: tự unmute sau 1 giây (khi bị autoplay policy từ chối)
    const autoUnmuteAfter1s = () => {
        setTimeout(() => {
            videoPlayer.muted = false;
        }, 1000);
    };

    if (window.Hls && Hls.isSupported()) {
        let hlsConfig = {
            fragLoadingMaxRetry: lowMemory ? 3 : 8,
            fragLoadingRetryDelay: 500,
            manifestLoadingMaxRetry: lowMemory ? 2 : 5,
            manifestLoadingRetryDelay: 500,
            levelLoadingMaxRetry: lowMemory ? 2 : 5,
            levelLoadingRetryDelay: 500,
            startLevel: -1,
            abrEwmaDefaultEstimate: 2000000,
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.7,
            maxBufferLength: lowMemory ? 25 : 60,
            maxMaxBufferLength: lowMemory ? 50 : 120,
            maxBufferSize: (lowMemory ? 25 : 60) * 1024 * 1024,
            maxBufferHole: 0.5,
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: lowMemory ? 0 : 30,
            nudgeOffset: 0.2,
            nudgeMaxRetry: 10,
            maxFragLookUpTolerance: 0.25,
            progressive: true,
            forceKeyFrameOnDiscontinuity: true,
            maxAudioFramesDrift: 1
        };
        let _networkRetryCount = 0;
        hlsInstance = new Hls(hlsConfig);
        hlsInstance.loadSource(finalStreamUrl);
        hlsInstance.attachMedia(videoPlayer);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
            videoLoader.style.display = 'none';
            videoPlayer.style.opacity = '1';
            videoPlayer.currentTime = savedTime;

            const qualitySetting = document.getElementById('quality-setting');
            const qualitySelector = document.getElementById('quality-selector');
            if (data.levels && data.levels.length > 1) {
                qualitySelector.innerHTML = '<option value="-1">Tự động</option>';
                data.levels.forEach((level, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    opt.innerText = level.height ? `${level.height}p` : `${index + 1}`;
                    qualitySelector.appendChild(opt);
                });
                qualitySetting.style.display = 'flex';

                qualitySelector.onchange = (e) => {
                    hlsInstance.currentLevel = parseInt(e.target.value);
                };
            } else {
                qualitySetting.style.display = 'none';
            }

            videoPlayer.muted = false;

            const playPromise = videoPlayer.play();

            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        videoLoader.style.display = 'none';
                        videoPlayer.style.opacity = '1';
                        triggerAutoFullscreen();
                    })
                    .catch(() => {
                        // Autoplay bị từ chối bởi browser policy
                        // Mute tạm thời để play được, sau đó tự unmute khi user tương tác
                        videoPlayer.muted = true;
                        videoPlayer.play().then(() => {
                            videoLoader.style.display = 'none';
                            videoPlayer.style.opacity = '1';
                            autoUnmuteAfter1s();
                            triggerAutoFullscreen();
                        }).catch(() => {});
                    });
            }
        });
        let mediaErrorRetries = 0;
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            console.log("HLS ERROR:", data.type, data.details, data.fatal);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        _networkRetryCount++;
                        if (_networkRetryCount <= 5) {
                            console.warn(`Lỗi mạng (#${_networkRetryCount}/5), đang thử tải lại...`);
                            setTimeout(() => hlsInstance.startLoad(), 1000 * _networkRetryCount);
                        } else {
                            console.error("Đã thử kết nối lại 5 lần, dừng tải.");
                            _networkRetryCount = 0;
                            try { hlsInstance.destroy(); } catch (e) { }
                            hlsInstance = null;
                        }
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        mediaErrorRetries++;
                        if (mediaErrorRetries <= 3) {
                            console.warn(`Lỗi media (#${mediaErrorRetries}), đang khôi phục...`);
                            if (data.details === 'bufferAppendError' || data.details === 'bufferFullError') {
                                try {
                                    const sb = videoPlayer.buffered;
                                    if (sb.length > 0) {
                                        hlsInstance.recoverMediaError();
                                        break;
                                    }
                                } catch (e) { }
                            }
                            hlsInstance.recoverMediaError();
                        } else {
                            console.error("Không thể khôi phục media, tải lại từ đầu...");
                            mediaErrorRetries = 0;
                            const currentTime = videoPlayer.currentTime;
                            const wasPaused = videoPlayer.paused;
                            try { hlsInstance.destroy(); } catch (e) { }
                            hlsInstance = new Hls(hlsConfig);
                            hlsInstance.loadSource(finalStreamUrl);
                            hlsInstance.attachMedia(videoPlayer);
                            hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
                                videoPlayer.currentTime = currentTime;
                                if (!wasPaused) videoPlayer.play().catch(() => { });
                            });
                        }
                        break;
                    default:
                        console.error("Lỗi HLS nghiêm trọng.");
                        try { hlsInstance.destroy(); } catch (e) { }
                        hlsInstance = null;
                        break;
                }
            } else {
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    if (data.details === 'bufferAppendError' || data.details === 'bufferSeekOverHole' || data.details === 'bufferNudgeOnStall') {
                        console.warn(`Non-fatal: ${data.details}, recovering...`);
                        try {
                            hlsInstance.recoverMediaError();
                        } catch (e) { }
                    }
                }
            }
        });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        videoPlayer.src = finalStreamUrl;

        videoPlayer.addEventListener('loadedmetadata', function () {
            videoPlayer.currentTime = savedTime;
            videoPlayer.muted = false;

            const playPromise = videoPlayer.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        videoLoader.style.display = 'none';
                        videoPlayer.style.opacity = '1';
                        triggerAutoFullscreen();
                    })
                    .catch(() => {
                        videoPlayer.muted = true;
                        videoPlayer.play().then(() => {
                            videoLoader.style.display = 'none';
                            videoPlayer.style.opacity = '1';
                            autoUnmuteAfter1s();
                            triggerAutoFullscreen();
                        }).catch(() => {});
                    });
            }
        }, { once: true });
    }

    // Throttle lưu lịch sử: mỗi 10 giây thay vì 4 lần/giây → giảm ~97% I/O
    let _lastHistorySave = 0;
    videoPlayer.ontimeupdate = () => {
        const now = Date.now();

        // Kiểm tra hiển thị nút "Tập tiếp theo" khi còn 5 phút (300s)
        const duration = videoPlayer.duration;
        const currentTime = videoPlayer.currentTime;
        const btnFloating = document.getElementById('btn-next-ep-floating');
        
        if (btnFloating && duration && duration > 300) {
            const timeLeft = duration - currentTime;
            
            // Kiểm tra xem có tập tiếp theo không
            const watchEpisodeList = document.getElementById('watch-episode-list');
            let hasNextEp = false;
            if (watchEpisodeList) {
                const allBtns = Array.from(watchEpisodeList.querySelectorAll('.btn-episode'));
                const activeIndex = allBtns.findIndex(btn => btn.classList.contains('active'));
                if (activeIndex >= 0 && activeIndex < allBtns.length - 1) {
                    hasNextEp = true;
                }
            }
            
            if (hasNextEp && timeLeft <= 300 && timeLeft > 5) {
                if (btnFloating.style.display === 'none') {
                    btnFloating.style.display = 'flex';
                }
            } else {
                if (btnFloating.style.display !== 'none') {
                    btnFloating.style.display = 'none';
                }
            }
        }

        if (now - _lastHistorySave < 10000) return;
        _lastHistorySave = now;
        if (!watchHistoryCache) {
            watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
        }
        const cached = watchHistoryCache[currentMovieData.slug];
        if (cached && (cached.name === ep.name || cached.epName === ep.name)) {
            cached.currentTime = videoPlayer.currentTime;
            cached.updatedAt = now;
            localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));
        }
    };

    // Lưu ngay lập tức khi pause hoặc đóng trang
    const _saveHistoryNow = () => {
        if (!watchHistoryCache) return;
        const cached = watchHistoryCache[currentMovieData.slug];
        if (cached && (cached.name === ep.name || cached.epName === ep.name)) {
            cached.currentTime = videoPlayer.currentTime;
            cached.updatedAt = Date.now();
            localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));
        }
    };
    videoPlayer.addEventListener('pause', _saveHistoryNow, { once: false });
    window.addEventListener('beforeunload', _saveHistoryNow);

    // Audio desync detection: kiểm tra mỗi 3 giây, tự sửa nếu drift > 2s
    if (window._desyncCheckTimer) clearInterval(window._desyncCheckTimer);
    window._desyncCheckTimer = setInterval(() => {
        if (videoPlayer.paused || videoPlayer.ended || !videoPlayer.buffered.length) return;
        const buffEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
        const drift = buffEnd - videoPlayer.currentTime;
        if (drift > 2 && drift < 30) {
            console.warn(`[Audio Sync] Drift ${drift.toFixed(1)}s detected, correcting...`);
            videoPlayer.currentTime = buffEnd - 1;
        }
    }, 3000);

    // Volume fade mượt mà khi buffer stall (tránh giật âm thanh)
    let _preMuteVolume = null;
    videoPlayer.addEventListener('waiting', () => {
        if (_preMuteVolume === null && !videoPlayer.paused) {
            _preMuteVolume = videoPlayer.volume;
            videoPlayer.volume = Math.max(0, videoPlayer.volume * 0.3);
        }
    });
    videoPlayer.addEventListener('playing', () => {
        if (_preMuteVolume !== null) {
            const targetVol = _preMuteVolume;
            _preMuteVolume = null;
            let curVol = videoPlayer.volume;
            const fadeStep = (targetVol - curVol) / 10;
            let fadeCount = 0;
            const fadeInterval = setInterval(() => {
                fadeCount++;
                curVol += fadeStep;
                videoPlayer.volume = Math.min(1, Math.max(0, curVol));
                if (fadeCount >= 10) {
                    clearInterval(fadeInterval);
                    videoPlayer.volume = targetVol;
                }
            }, 30);
        }
    });

    document.getElementById('watch-view').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const btnPrev = document.getElementById('btn-prev-ep');
    const btnNext = document.getElementById('btn-next-ep');

    if (btnPrev) {
        if (currentIndex > 0) {
            btnPrev.style.display = 'inline-block';
            btnPrev.onclick = () => {
                allBtns[currentIndex - 1].click();
            };
        } else {
            btnPrev.style.display = 'none';
        }
    }

    if (btnNext) {
        if (currentIndex >= 0 && currentIndex < allBtns.length - 1) {
            btnNext.style.display = 'inline-block';
            btnNext.onclick = () => {
                allBtns[currentIndex + 1].click();
            };
        } else {
            btnNext.style.display = 'none';
        }
    }
}
