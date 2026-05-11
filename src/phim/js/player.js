// ==================== WATCH VIEW PLAYER ====================
function openWatchView(episodeData) {
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const watchServerContainer = document.getElementById('watch-server-list');
    watchServerContainer.innerHTML = "";
    currentMovieData.episodes.forEach((server, index) => {
        const sBtn = document.createElement("button");
        sBtn.className = "btn-server" + (index === 0 ? " active" : "");
        sBtn.innerText = "Server " + server.server_name;
        sBtn.onclick = (e) => {
            document.getElementById('watch-server-list').querySelectorAll('.btn-server').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderEpisodesByServer(server.server_data, 'watch-episode-list', true, currentMovieData.slug);
        };
        watchServerContainer.appendChild(sBtn);
    });
    renderEpisodesByServer(currentMovieData.episodes[0].server_data, 'watch-episode-list', true, currentMovieData.slug);

    setTimeout(() => {
        const firstEpBtn = document.getElementById('watch-episode-list').querySelector('.btn-episode');
        if (firstEpBtn) {
            updateWatchViewPlayer(episodeData, firstEpBtn);
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
    if (watchHistoryCache[currentMovieData.slug] && watchHistoryCache[currentMovieData.slug].name === ep.name && watchHistoryCache[currentMovieData.slug].currentTime) {
        savedTime = watchHistoryCache[currentMovieData.slug].currentTime;
    }

    watchHistoryCache[currentMovieData.slug] = ep;
    watchHistoryCache[currentMovieData.slug].currentTime = savedTime;
    trimWatchHistory(watchHistoryCache);
    localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));

    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) { }
        hlsInstance = null;
    }

    videoPlayer.src = "";
    videoPlayer.load();

    let streamUrl = ep.link_m3u8;
    if (streamUrl.startsWith("http://")) {
        streamUrl = streamUrl.replace(/^http:/, "https:");
    }

    if (window.Hls && Hls.isSupported()) {
        let hlsConfig = {
            fragLoadingMaxRetry: 8,
            fragLoadingRetryDelay: 500,
            manifestLoadingMaxRetry: 5,
            manifestLoadingRetryDelay: 500,
            levelLoadingMaxRetry: 5,
            levelLoadingRetryDelay: 500,
            startLevel: -1,
            abrEwmaDefaultEstimate: 2000000,
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.7,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            maxBufferSize: 60 * 1024 * 1024,
            maxBufferHole: 0.5,
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            nudgeOffset: 0.2,
            nudgeMaxRetry: 5,
            maxFragLookUpTolerance: 0.25
        };
        hlsInstance = new Hls(hlsConfig);
        hlsInstance.loadSource(streamUrl);
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
                    })
                    .catch(() => {
                        videoPlayer.muted = true;

                        videoPlayer.play().then(() => {
                            videoLoader.style.display = 'none';
                            videoPlayer.style.opacity = '1';
                        });
                    });
            }
        });
        let mediaErrorRetries = 0;
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            console.log("HLS ERROR:", data.type, data.details, data.fatal);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.warn("Lỗi mạng, đang thử tải lại...");
                        setTimeout(() => hlsInstance.startLoad(), 1000);
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
                            hlsInstance.loadSource(streamUrl);
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
        videoPlayer.src = streamUrl;

        videoPlayer.addEventListener('loadedmetadata', function () {
            videoPlayer.currentTime = savedTime;

            videoPlayer.muted = false;

            const playPromise = videoPlayer.play();

            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        videoLoader.style.display = 'none';
                        videoPlayer.style.opacity = '1';
                    })
                    .catch(() => {
                        videoPlayer.muted = true;

                        videoPlayer.play().then(() => {
                            videoLoader.style.display = 'none';
                            videoPlayer.style.opacity = '1';
                        });
                    });
            }
        });
    }

    videoPlayer.ontimeupdate = () => {
        if (!watchHistoryCache) {
            watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
        }
        if (watchHistoryCache[currentMovieData.slug] && watchHistoryCache[currentMovieData.slug].name === ep.name) {
            watchHistoryCache[currentMovieData.slug].currentTime = videoPlayer.currentTime;
            localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));
        }
    };

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