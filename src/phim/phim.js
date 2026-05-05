const API_BASE_URL = 'https://ophim1.com';
const IMAGE_BASE_URL = 'https://img.ophim.live/uploads/movies/';
const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/original";
const TMDB_GALLERY_BASE = "https://image.tmdb.org/t/p/w780";
const ERROR_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%231a1a1a%22/%3E%3Crect width=%22300%22 height=%22450%22 fill=%22none%22 stroke=%22%23333%22 stroke-width=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2220%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ELỗi Ảnh%3C/text%3E%3C/svg%3E";

let currentFilterEndpoint = "";
let currentFilterSlug = "";
let currentFilterTitle = "";
let currentFilterPage = 1;
let totalFilterPages = 1;
let currentMovieData = null;
let imageDomain = IMAGE_BASE_URL;
let currentSearchId = 0;

let categoriesMap = new Map();
let countriesMap = new Map();
let yearsSet = new Set();
let watchHistoryCache = null;
let hlsInstance = null;
let nextEpTimer = null;
let apiCache = new Map();
const CACHE_PREFIX = 'phim_api_cache_';
const CACHE_TTL = 5 * 60 * 1000;

async function fetchWithCache(url, retries = 3, timeout = 8000) {
    const isMovieDetail = url.includes('/phim/');
    
    if (!isMovieDetail) {
        const memCache = apiCache.get(url);
        if (memCache && Date.now() - memCache.time < CACHE_TTL) {
            return memCache.data;
        }
        
        try {
            const sessionCacheStr = sessionStorage.getItem(CACHE_PREFIX + url);
            if (sessionCacheStr) {
                const sessionCache = JSON.parse(sessionCacheStr);
                if (Date.now() - sessionCache.time < CACHE_TTL) {
                    apiCache.set(url, sessionCache);
                    return sessionCache.data;
                } else {
                    sessionStorage.removeItem(CACHE_PREFIX + url);
                }
            }
        } catch (e) {}
    }
    
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            
            const data = await response.json();
            
            if (!isMovieDetail) {
                const cacheData = { data: data, time: Date.now() };
                apiCache.set(url, cacheData);
                try {
                    sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify(cacheData));
                } catch (e) {
                    if (e.name === 'QuotaExceededError') {
                        Object.keys(sessionStorage).forEach(key => {
                            if (key.startsWith(CACHE_PREFIX)) {
                                sessionStorage.removeItem(key);
                            }
                        });
                        sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify(cacheData));
                    }
                }
            }
            return data;
        } catch (error) {
            if (i === retries - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

function handleImageError(imgElement) {
    imgElement.onerror = null;
    imgElement.src = ERROR_IMAGE;
}

function getImageUrl(domain, path) {
    if (!path || path.trim() === "") return ERROR_IMAGE;
    if (path.startsWith("http://") || path.startsWith("https://")) {
        return path.replace("http://", "https://");
    }
    
    let cleanDomain = domain ? domain.trim() : imageDomain;
    cleanDomain = cleanDomain.replace("img.ophim.cc", "phimimg.com").replace("ophim.cc", "phimimg.com");
    
    if (cleanDomain.endsWith('/')) cleanDomain = cleanDomain.slice(0, -1);
    let cleanPath = path.trim();
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);
    
    if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
        return cleanPath.replace("http://", "https://");
    }
    
    if (cleanDomain.includes("uploads/movies") && cleanPath.startsWith("uploads/movies/")) {
        cleanPath = cleanPath.replace("uploads/movies/", "");
    }
    
    if (!cleanDomain.includes("uploads/movies") && !cleanPath.includes("uploads/movies")) {
        cleanDomain += "/uploads/movies";
    }
    
    return cleanDomain + '/' + cleanPath;
}

function formatResponse(res) {
    const defaultFallback = { items: [], domain: IMAGE_BASE_URL };
    if (!res || typeof res !== 'object') return defaultFallback;
    
    let items = [];
    let domain = IMAGE_BASE_URL;

    if (res.data) {
        if (Array.isArray(res.data.items)) items = res.data.items;
        else if (Array.isArray(res.data)) items = res.data;
        if (res.data.APP_DOMAIN_CDN_IMAGE) domain = res.data.APP_DOMAIN_CDN_IMAGE;
    } else if (res.items) {
        if (Array.isArray(res.items)) items = res.items;
        if (res.pathImage) domain = res.pathImage;
    }

    if (items.length === 0 && res.movie && Array.isArray(res.movie)) {
        items = res.movie;
    }

    return { items: items, domain: domain };
}

document.addEventListener("DOMContentLoaded", () => {
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

    initSpatialNavigation();

    const videoPlayerNode = document.getElementById('video-player');
    if (videoPlayerNode) {
        videoPlayerNode.addEventListener('ended', () => {
            let isAutoplayOn = localStorage.getItem('phimtv_autoplay') === 'true';
            if (!isAutoplayOn) {
                return;
            }

            if (nextEpTimer) {
                clearInterval(nextEpTimer);
            }

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
                
                const playNext = () => {
                    clearInterval(nextEpTimer);
                    overlay.style.display = 'none';
                    allBtns[activeIndex + 1].click();
                };

                const cancelNext = () => {
                    clearInterval(nextEpTimer);
                    overlay.style.display = 'none';
                };

                btnPlayNow.onclick = playNext;
                btnCancel.onclick = cancelNext;

                nextEpTimer = setInterval(() => {
                    timeLeft -= 1;
                    numberEl.innerText = timeLeft;
                    if (timeLeft <= 0) {
                        playNext();
                    }
                }, 1000);
            }
        });
    }

    const safeAddListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

    safeAddListener('btn-back-watch', 'click', () => {
        document.getElementById('watch-view').style.display = 'none';
        document.getElementById('detail-view').style.display = 'block';
        const videoPlayer = document.getElementById('video-player');
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.removeAttribute('src');
            videoPlayer.load();
        }
        if (hlsInstance) {
            try { hlsInstance.destroy(); } catch(e){}
            hlsInstance = null;
        }
        if (nextEpTimer) {
            clearInterval(nextEpTimer);
            const overlay = document.getElementById('next-ep-overlay');
            if (overlay) overlay.style.display = 'none';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    safeAddListener('searchBtn', 'click', handleSearch);
    
    let searchDebounceTimer;
    safeAddListener('searchInput', 'input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            if (e.target.value.trim() !== "") {
                handleSearch();
            } else {
                navigateToHome(null);
            }
        }, 600);
    });

    safeAddListener('btn-prev-page', 'click', () => {
        if (currentFilterPage > 1) {
            loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, currentFilterPage - 1);
        }
    });

    safeAddListener('btn-next-page', 'click', () => {
        if (currentFilterPage < totalFilterPages) {
            loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, currentFilterPage + 1);
        }
    });

    safeAddListener('input-page-jump', 'keypress', (e) => {
        if (e.key === 'Enter') {
            let targetPage = parseInt(e.target.value);
            if (targetPage >= 1 && targetPage <= totalFilterPages) {
                loadFilterData(currentFilterEndpoint, currentFilterSlug, currentFilterTitle, targetPage);
            } else {
                e.target.value = currentFilterPage;
            }
        }
    });

    safeAddListener('btn-advance-filter', 'click', handleAdvancedFilter);

    safeAddListener('btn-more-new', 'click', () => loadFilterData('new', '', 'Phim mới cập nhật', 1));
    safeAddListener('btn-more-series', 'click', () => loadFilterData('danh-sach', 'phim-bo', 'Phim bộ mới', 1));
    safeAddListener('btn-more-movies', 'click', () => loadFilterData('danh-sach', 'phim-le', 'Phim lẻ mới', 1));

    // Logic Chế độ Tắt đèn
    const btnLightToggle = document.getElementById('btn-light-toggle');
    let isLightOff = localStorage.getItem('phimtv_light') === 'true';

    if (btnLightToggle) {
        if (isLightOff) {
            document.body.classList.add('lights-off');
            btnLightToggle.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Bật đèn';
        }
        btnLightToggle.addEventListener('click', () => {
            isLightOff = !isLightOff;
            if (isLightOff) {
                document.body.classList.add('lights-off');
                btnLightToggle.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Bật đèn';
                localStorage.setItem('phimtv_light', 'true');
            } else {
                document.body.classList.remove('lights-off');
                btnLightToggle.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Tắt đèn';
                localStorage.setItem('phimtv_light', 'false');
            }
        });
    }

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

    if (videoPlayerGlobal && playPauseBtn) {
        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsMenu.classList.toggle('show');
            });
            document.addEventListener('click', (e) => {
                if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
                    settingsMenu.classList.remove('show');
                }
            });
        }

        if (speedSelector) {
            speedSelector.value = localStorage.getItem('phimtv_speed') || "1";
            speedSelector.addEventListener('change', (e) => {
                videoPlayerGlobal.playbackRate = parseFloat(e.target.value);
                localStorage.setItem('phimtv_speed', e.target.value);
            });
        }

        const formatTime = (time) => {
            if (isNaN(time)) return "00:00";
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60);
            return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
        };

        const togglePlay = () => {
            if (videoPlayerGlobal.paused) {
                videoPlayerGlobal.play().catch(()=>{});
                playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            } else {
                videoPlayerGlobal.pause();
                playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            }
        };
        playPauseBtn.addEventListener('click', togglePlay);
        videoPlayerGlobal.addEventListener('click', togglePlay);

        videoPlayerGlobal.addEventListener('play', () => playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>');
        videoPlayerGlobal.addEventListener('pause', () => playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>');

        videoPlayerGlobal.addEventListener('timeupdate', () => {
            const current = videoPlayerGlobal.currentTime;
            const duration = videoPlayerGlobal.duration;
            if (duration) {
                const percent = (current / duration) * 100;
                progressBar.style.width = `${percent}%`;
                currentTimeDisplay.innerText = formatTime(current);
            }
        });

        videoPlayerGlobal.addEventListener('loadedmetadata', () => {
            durationDisplay.innerText = formatTime(videoPlayerGlobal.duration);
        });

        progressContainer.addEventListener('click', (e) => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            videoPlayerGlobal.currentTime = pos * videoPlayerGlobal.duration;
        });

        volumeSlider.addEventListener('input', (e) => {
            videoPlayerGlobal.volume = e.target.value;
            videoPlayerGlobal.muted = e.target.value === '0';
        });
        
        muteBtn.addEventListener('click', () => {
            videoPlayerGlobal.muted = !videoPlayerGlobal.muted;
            if (!videoPlayerGlobal.muted && volumeSlider.value === '0') {
                videoPlayerGlobal.volume = 0.5;
            }
        });

        videoPlayerGlobal.addEventListener('volumechange', () => {
            volumeSlider.value = videoPlayerGlobal.muted ? 0 : videoPlayerGlobal.volume;
            muteBtn.innerHTML = (videoPlayerGlobal.muted || videoPlayerGlobal.volume === 0) ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
        });

        fullscreenBtn.addEventListener('click', async () => {
            const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (!isFullscreen) {
                if (customVideoContainer.requestFullscreen) await customVideoContainer.requestFullscreen().catch(()=>{});
                else if (customVideoContainer.webkitRequestFullscreen) await customVideoContainer.webkitRequestFullscreen().catch(()=>{});
                else if (customVideoContainer.msRequestFullscreen) await customVideoContainer.msRequestFullscreen().catch(()=>{});
            } else {
                if (document.exitFullscreen) await document.exitFullscreen().catch(()=>{});
                else if (document.webkitExitFullscreen) await document.webkitExitFullscreen().catch(()=>{});
                else if (document.msExitFullscreen) await document.msExitFullscreen().catch(()=>{});
            }
        });
    }
    
    if (btnPipToggle && videoPlayerGlobal) {
        btnPipToggle.addEventListener('click', async () => {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await videoPlayerGlobal.requestPictureInPicture();
            }
        });
    }

    const btnTheaterToggle = document.getElementById('btn-theater-toggle');
    let isTheaterMode = localStorage.getItem('phimtv_theater') === 'true';
    
    if (btnTheaterToggle) {
        if (isTheaterMode) {
            document.body.classList.add('theater-mode');
            btnTheaterToggle.innerHTML = '<i class="fa-solid fa-compress"></i> Thu hẹp';
        }
        btnTheaterToggle.addEventListener('click', () => {
            isTheaterMode = !isTheaterMode;
            if (isTheaterMode) {
                document.body.classList.add('theater-mode');
                btnTheaterToggle.innerHTML = '<i class="fa-solid fa-compress"></i> Thu hẹp';
                localStorage.setItem('phimtv_theater', 'true');
            } else {
                document.body.classList.remove('theater-mode');
                btnTheaterToggle.innerHTML = '<i class="fa-solid fa-expand"></i> Mở rộng';
                localStorage.setItem('phimtv_theater', 'false');
            }
        });
    }

    const speedControl = document.getElementById('speed-control');
    if (speedControl) {
        let currentSpeed = localStorage.getItem('phimtv_speed') || "1";
        speedControl.value = currentSpeed;
        speedControl.addEventListener('change', (e) => {
            currentSpeed = e.target.value;
            localStorage.setItem('phimtv_speed', currentSpeed);
            if (videoPlayerGlobal) {
                videoPlayerGlobal.playbackRate = parseFloat(currentSpeed);
            }
        });
    }

    const btnAutoplayToggle = document.getElementById('btn-autoplay-toggle');
    if (btnAutoplayToggle) {
        let isAutoplayOn = localStorage.getItem('phimtv_autoplay') === 'true';
        btnAutoplayToggle.innerHTML = isAutoplayOn ? '<i class="fa-solid fa-repeat"></i> Tự động: BẬT' : '<i class="fa-solid fa-repeat"></i> Tự động: TẮT';
        
        btnAutoplayToggle.addEventListener('click', () => {
            isAutoplayOn = !isAutoplayOn;
            localStorage.setItem('phimtv_autoplay', isAutoplayOn);
            btnAutoplayToggle.innerHTML = isAutoplayOn ? '<i class="fa-solid fa-repeat"></i> Tự động: BẬT' : '<i class="fa-solid fa-repeat"></i> Tự động: TẮT';
        });
    }

    if (videoPlayerGlobal) {
        const savedVolume = localStorage.getItem('phimtv_volume');
        if (savedVolume !== null) {
            videoPlayerGlobal.volume = parseFloat(savedVolume);
        }
        
        videoPlayerGlobal.addEventListener('volumechange', () => {
            localStorage.setItem('phimtv_volume', videoPlayerGlobal.volume);
        });

        videoPlayerGlobal.addEventListener('dblclick', async () => {
            const customContainer = document.getElementById('custom-video-container');
            const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (window.__TAURI__ && window.__TAURI__.window) {
                try {
                    const customContainer = document.getElementById('custom-video-container');

                    const isFullscreen =
                        document.fullscreenElement ||
                        document.webkitFullscreenElement ||
                        document.msFullscreenElement;

                    if (!isFullscreen) {
                        if (customContainer.requestFullscreen) {
                            await customContainer.requestFullscreen().catch(()=>{});
                        } else if (customContainer.webkitRequestFullscreen) {
                            await customContainer.webkitRequestFullscreen().catch(()=>{});
                        } else if (customContainer.msRequestFullscreen) {
                            await customContainer.msRequestFullscreen().catch(()=>{});
                        }
                    } else {
                        if (document.exitFullscreen) {
                            await document.exitFullscreen().catch(()=>{});
                        } else if (document.webkitExitFullscreen) {
                            await document.webkitExitFullscreen().catch(()=>{});
                        } else if (document.msExitFullscreen) {
                            await document.msExitFullscreen().catch(()=>{});
                        }
                    }
                } catch (e) {
                    if (!isFullscreen) {
                        if (customContainer.requestFullscreen) await customContainer.requestFullscreen().catch(()=>{});
                        else if (customContainer.webkitRequestFullscreen) await customContainer.webkitRequestFullscreen().catch(()=>{});
                        else if (customContainer.msRequestFullscreen) await customContainer.msRequestFullscreen().catch(()=>{});
                    } else {
                        if (document.exitFullscreen) await document.exitFullscreen().catch(()=>{});
                        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen().catch(()=>{});
                        else if (document.msExitFullscreen) await document.msExitFullscreen().catch(()=>{});
                    }
                }
            } else {
                if (!isFullscreen) {
                    if (customContainer.requestFullscreen) await customContainer.requestFullscreen().catch(()=>{});
                    else if (customContainer.webkitRequestFullscreen) await customContainer.webkitRequestFullscreen().catch(()=>{});
                    else if (customContainer.msRequestFullscreen) await customContainer.msRequestFullscreen().catch(()=>{});
                } else {
                    if (document.exitFullscreen) await document.exitFullscreen().catch(()=>{});
                    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen().catch(()=>{});
                    else if (document.msExitFullscreen) await document.msExitFullscreen().catch(()=>{});
                }
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        const videoPlayer = document.getElementById('video-player');
        
        if (!watchView || watchView.style.display !== 'block' || !videoPlayer) return;

        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement.isContentEditable;
        if (isInput) return;

        if (e.code === 'Space') {
            e.preventDefault();
            if (videoPlayer.paused) {
                videoPlayer.play().catch(()=>{});
            } else {
                videoPlayer.pause();
            }
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            videoPlayer.currentTime += 10;
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            videoPlayer.currentTime -= 10;
        } else if (e.code === 'KeyF') {
            e.preventDefault();
            const btnFullscreen = document.getElementById('fullscreen-btn');
            if (btnFullscreen) {
                btnFullscreen.click();
            }
        } else if (e.code === 'ArrowUp') {
            e.preventDefault();
            if (videoPlayer.volume < 1) {
                videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1);
            }
        } else if (e.code === 'ArrowDown') {
            e.preventDefault();
            if (videoPlayer.volume > 0) {
                videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1);
            }
        } else if (e.code === 'KeyM') {
            e.preventDefault();
            videoPlayer.muted = !videoPlayer.muted;
        }
    });

    fetchHomeData();
});

async function fetchHomeData() {
    document.getElementById('loading-initial').style.display = 'flex';
    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';

    try {
        const endpoints = [
            `${API_BASE_URL}/danh-sach/phim-moi-cap-nhat?page=1`,
            `${API_BASE_URL}/danh-sach/phim-moi-cap-nhat?page=2`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-bo`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-le`,
            `${API_BASE_URL}/v1/api/danh-sach/hoat-hinh`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-le?page=2`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-bo?page=2`
        ];

        const responses = await Promise.all(endpoints.map(url => fetchWithCache(url).catch(() => null)));
        const formatted = responses.map(formatResponse);
        
        let allMovies = [];
        formatted.forEach(f => allMovies = allMovies.concat(f.items || []));
        extractFiltersFromMovies(allMovies);

        if (formatted[0].domain) imageDomain = formatted[0].domain + '/';

        const heroMovie = formatted[0].items?.[0] || null;
        if (heroMovie) {
            const imgUrl = getImageUrl(imageDomain, heroMovie.thumb_url || heroMovie.poster_url);
            const heroSection = document.getElementById('heroBanner');
            heroSection.style.backgroundImage = `linear-gradient(to right, #050505 10%, rgba(5, 5, 5, 0.4) 60%), linear-gradient(to top, #050505 0%, transparent 30%), url('${imgUrl}')`;
            document.getElementById('hero-title').innerText = heroMovie.name;
            document.getElementById('hero-year').innerText = heroMovie.year || "2024";
            document.getElementById('hero-desc').innerText = heroMovie.origin_name || "";
            document.getElementById('hero-btn').onclick = () => showMovieDetails(heroMovie.slug);

            fetchWithCache(`${API_BASE_URL}/v1/api/phim/${heroMovie.slug}/images`).then(tmdbJson => {
                if (tmdbJson.success && tmdbJson.data && tmdbJson.data.images) {
                    const tmdbBackdrops = tmdbJson.data.images.filter(img => img.type === "backdrop");
                    if (tmdbBackdrops.length > 0 && tmdbBackdrops[0].file_path) {
                        const bgUrl = TMDB_BACKDROP_BASE + tmdbBackdrops[0].file_path;
                        heroSection.style.backgroundImage = `linear-gradient(to right, #050505 10%, rgba(5, 5, 5, 0.4) 60%), linear-gradient(to top, #050505 0%, transparent 30%), url('${bgUrl}')`;
                    }
                }
            }).catch(()=>{});
        }

        renderMoviesCards(formatted[0].items.slice(0, 21), 'grid-new-update', false);
        renderMoviesCards(formatted[1].items.slice(0, 4), 'grid-theaters', true);
        renderMoviesCards(formatted[2].items.slice(0, 7), 'grid-series', false);
        renderMoviesCards(formatted[3].items.slice(0, 7), 'grid-movies', false);
        
        renderUpcoming(formatted[4].items.slice(0, 5), 'sidebar-upcoming');
        renderTopMovies(formatted[5].items.slice(0, 5), 'sidebar-top-movies');
        renderTopSeries(formatted[6].items.slice(0, 8), 'sidebar-top-series');

    } catch (e) {
        console.error(e);
    } finally {
        document.getElementById('loading-initial').style.display = 'none';
        document.getElementById('heroBanner').style.display = 'flex';
        document.getElementById('main-content').style.display = 'flex';
        document.getElementById('home-view').style.display = 'block';
    }
}

function extractFiltersFromMovies(movies) {
    if (!movies || !Array.isArray(movies)) return;
    let isUpdated = false;

    movies.forEach(m => {
        if (m.year && !yearsSet.has(m.year)) {
            yearsSet.add(m.year);
            isUpdated = true;
        }
        if (m.category && Array.isArray(m.category)) {
            m.category.forEach(c => {
                if (c.slug && c.name && !categoriesMap.has(c.slug)) {
                    categoriesMap.set(c.slug, c);
                    isUpdated = true;
                }
            });
        }
        if (m.country && Array.isArray(m.country)) {
            m.country.forEach(c => {
                if (c.slug && c.name && !countriesMap.has(c.slug)) {
                    countriesMap.set(c.slug, c);
                    isUpdated = true;
                }
            });
        }
    });

    if (isUpdated) renderFilterUI();
}

function renderFilterUI() {
    const catList = document.getElementById('category-list');
    const countryList = document.getElementById('country-list');
    const yearList = document.getElementById('year-list');
    const filterCat = document.getElementById('filter-category');
    const filterCountry = document.getElementById('filter-country');
    const filterYear = document.getElementById('filter-year');

    const renderMap = (map, navEl, selectEl, endpointPrefix, labelPrefix) => {
        navEl.innerHTML = "";
        selectEl.innerHTML = `<option value="">- Tất cả ${labelPrefix.toLowerCase()} -</option>`;
        const sortedArray = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        
        sortedArray.forEach(item => {
            const a = document.createElement('a');
            a.href = "#";
            a.innerText = item.name;
            a.onclick = (e) => {
                e.preventDefault();
                loadFilterData(endpointPrefix, item.slug, `${labelPrefix}: ${item.name}`, 1);
            };
            navEl.appendChild(a);

            const opt = document.createElement('option');
            opt.value = item.slug;
            opt.innerText = item.name;
            selectEl.appendChild(opt);
        });
    };

    renderMap(categoriesMap, catList, filterCat, 'the-loai', 'Thể loại');
    renderMap(countriesMap, countryList, filterCountry, 'quoc-gia', 'Quốc gia');

    yearList.innerHTML = "";
    filterYear.innerHTML = `<option value="">- Tất cả năm -</option>`;
    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
    
    sortedYears.forEach(year => {
        const a = document.createElement('a');
        a.href = "#";
        a.innerText = year;
        a.onclick = (e) => {
            e.preventDefault();
            loadFilterData('nam', year, `Năm phát hành: ${year}`, 1);
        };
        yearList.appendChild(a);

        const opt = document.createElement('option');
        opt.value = year;
        opt.innerText = year;
        filterYear.appendChild(opt);
    });
}

function navigateToHome(e) {
    if (e) e.preventDefault();
    document.title = "Phim.tv - Giao diện Web";
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';
    
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }
    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch(e){}
        hlsInstance = null;
    }
    if (nextEpTimer) {
        clearInterval(nextEpTimer);
        const overlay = document.getElementById('next-ep-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    currentFilterEndpoint = "";
    currentFilterSlug = "";
    currentFilterTitle = "";
    currentFilterPage = 1;

    document.getElementById('heroBanner').style.display = 'flex';
    document.getElementById('home-view').style.display = 'block';
    document.getElementById('filter-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'none';
    document.querySelector('.main-container').classList.add('with-hero');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleSearch() {
    const keyword = document.getElementById('searchInput').value.trim();
    if (!keyword) return;
    loadFilterData('search', keyword, `Kết quả tìm kiếm: ${keyword}`, 1);
}

function handleAdvancedFilter() {
    const cat = document.getElementById('filter-category').value;
    const country = document.getElementById('filter-country').value;
    const year = document.getElementById('filter-year').value;

    if (cat) loadFilterData('the-loai', cat, `Thể loại: ${categoriesMap.get(cat)?.name || cat}`, 1);
    else if (country) loadFilterData('quoc-gia', country, `Quốc gia: ${countriesMap.get(country)?.name || country}`, 1);
    else if (year) loadFilterData('nam', year, `Năm phát hành: ${year}`, 1);
    else loadFilterData('new', '', 'Tất cả tác phẩm', 1);
}

async function loadFilterData(endpointType, slug, titleText, page) {
    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'flex';
    document.getElementById('video-player').src = "";
    document.getElementById('filter-view').style.display = 'block';
    document.querySelector('.main-container').classList.remove('with-hero');
    
    currentFilterEndpoint = endpointType;
    currentFilterSlug = slug;
    currentFilterTitle = titleText;
    currentFilterPage = page;
    
    const titleElement = document.getElementById('filter-title');
    const gridElement = document.getElementById('grid-filter');
    const paginationContainer = document.getElementById('pagination-container');
    
    titleElement.innerText = titleText;
    gridElement.innerHTML = "<div style='color: white; padding: 20px; width: 100%; text-align: center;'>Đang tải dữ liệu...</div>";
    paginationContainer.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const searchId = ++currentSearchId;

    try {
        let url = '';
        if (endpointType === 'search' || endpointType === 'nam') {
            url = `${API_BASE_URL}/v1/api/tim-kiem?keyword=${encodeURIComponent(slug)}&limit=24&page=${page}`;
        } else if (endpointType === 'new') {
            url = `${API_BASE_URL}/danh-sach/phim-moi-cap-nhat?limit=24&page=${page}`;
        } else if (endpointType === 'danh-sach') {
            url = `${API_BASE_URL}/v1/api/danh-sach/${slug}?limit=24&page=${page}`;
        } else {
            url = `${API_BASE_URL}/v1/api/${endpointType}/${slug}?limit=24&page=${page}`;
        }

        const res = await fetchWithCache(url);
        
        if (searchId !== currentSearchId) return;
        if (!res) throw new Error("API null");
        
        const formatted = formatResponse(res);
        const items = formatted.items;
        const localDomain = formatted.domain.endsWith('/') ? formatted.domain : formatted.domain + '/';

        const dataObj = res?.data || res;
        let paginationObj = dataObj?.params?.pagination || dataObj?.pagination;
        if (paginationObj) {
            if (paginationObj.totalPages) {
                totalFilterPages = paginationObj.totalPages;
            } else if (paginationObj.totalItems && paginationObj.totalItemsPerPage) {
                totalFilterPages = Math.ceil(paginationObj.totalItems / paginationObj.totalItemsPerPage);
            } else {
                totalFilterPages = 1;
            }
        } else {
            totalFilterPages = 1;
        }
        
        extractFiltersFromMovies(items);

        gridElement.innerHTML = "";
        if (items.length === 0) {
            gridElement.innerHTML = "<div style='color: white; padding: 20px; width: 100%; text-align: center;'>Không tìm thấy tác phẩm nào.</div>";
        }
        
        renderMoviesCardsAppend(items, gridElement, false, localDomain);
        
        if (totalFilterPages > 1) {
            paginationContainer.style.display = 'flex';
            document.getElementById('total-pages-display').innerText = totalFilterPages;
            document.getElementById('input-page-jump').value = currentFilterPage;
            
            document.getElementById('btn-prev-page').disabled = (currentFilterPage === 1);
            document.getElementById('btn-next-page').disabled = (currentFilterPage === totalFilterPages);
        }

        if (page < totalFilterPages) {
            let nextUrl = '';
            let nextPage = page + 1;
            if (endpointType === 'search' || endpointType === 'nam') {
                nextUrl = `${API_BASE_URL}/v1/api/tim-kiem?keyword=${encodeURIComponent(slug)}&limit=24&page=${nextPage}`;
            } else if (endpointType === 'new') {
                nextUrl = `${API_BASE_URL}/danh-sach/phim-moi-cap-nhat?limit=24&page=${nextPage}`;
            } else if (endpointType === 'danh-sach') {
                nextUrl = `${API_BASE_URL}/v1/api/danh-sach/${slug}?limit=24&page=${nextPage}`;
            } else {
                nextUrl = `${API_BASE_URL}/v1/api/${endpointType}/${slug}?limit=24&page=${nextPage}`;
            }
            fetchWithCache(nextUrl).catch(() => {});
        }
    } catch (error) {
        if (searchId === currentSearchId) {
            gridElement.innerHTML = `<div style='color: #f91942; padding: 20px; width: 100%; text-align: center;'>Lỗi tải dữ liệu.</div>`;
        }
    }
}

function renderMoviesCards(movies, containerId, isHorizontal = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    renderMoviesCardsAppend(movies, container, isHorizontal);
}

function renderMoviesCardsAppend(movies, container, isHorizontal = false, domain = imageDomain) {
    const fragment = document.createDocumentFragment();

    movies.forEach(movie => {
        const card = document.createElement("div");
        card.className = `movie-card ${isHorizontal ? 'horizontal' : ''}`;
        card.tabIndex = 0;
        
        const imagePath = isHorizontal ? (movie.thumb_url || movie.poster_url) : (movie.poster_url || movie.thumb_url);
        const imgUrl = getImageUrl(domain, imagePath);
        const episodeCurrent = movie.episode_current || "Full";

        card.innerHTML = `
            <span class="badge badge-red">${episodeCurrent}</span>
            <div class="image-container">
                <img class="skeleton" src="${imgUrl}" alt="${movie.name}" loading="lazy" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
                <div class="card-overlay"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="info">
                <h3>${movie.name}</h3>
                <p>${isHorizontal ? (movie.origin_name || "Đang cập nhật") : (movie.year || "Đang cập nhật")}</p>
            </div>
        `;
        
        card.onclick = () => showMovieDetails(movie.slug);
        card.onkeydown = (e) => { if (e.key === 'Enter') showMovieDetails(movie.slug); };
        fragment.appendChild(card);
    });

    container.appendChild(fragment);
}

function renderUpcoming(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach(movie => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="bullet"><i class="fa-solid fa-circle-dot"></i></span> <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${movie.name}</span> <span class="year">${movie.year || ""}</span>`;
        li.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(li);
    });
}

function renderTopMovies(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach((movie, index) => {
        const li = document.createElement("li");
        const imagePath = movie.poster_url || movie.thumb_url;
        const imgUrl = getImageUrl(imageDomain, imagePath);
        const episodeCurrent = movie.episode_current || "HD";

        li.innerHTML = `
            <div class="rank-number">${index + 1}</div>
            <img src="${imgUrl}" class="rank-thumb skeleton" alt="${movie.name}" loading="lazy" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
            <div class="rank-info">
                <h4>${movie.name}</h4>
                <div class="rank-meta">
                    <span class="quality">${episodeCurrent}</span> <span class="rating"><i class="fa-solid fa-star"></i> 8.0</span> <span class="year">${movie.year || ""}</span>
                </div>
            </div>
        `;
        li.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(li);
    });
}

function renderTopSeries(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card small";
        
        const imagePath = movie.poster_url || movie.thumb_url;
        const imgUrl = getImageUrl(imageDomain, imagePath);
        const episodeCurrent = movie.episode_current || "Full";

        card.innerHTML = `
            <span class="badge badge-red">${episodeCurrent}</span>
            <div class="image-container">
               <img class="skeleton" src="${imgUrl}" alt="${movie.name}" loading="lazy" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
               <div class="card-overlay"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="info"><h4>${movie.name}</h4></div>
        `;
        card.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(card);
    });
}

async function showMovieDetails(slug) {
    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('filter-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'none';
    document.getElementById('video-player').src = "";
    document.getElementById('detail-view').style.display = 'block';
    document.getElementById('detail-view').style.backgroundImage = "none";
    document.querySelector('.main-container').classList.remove('with-hero');
    
    document.getElementById('detail-title').innerText = "Đang tải...";
    document.getElementById('episode-list').innerHTML = "";
    document.getElementById('server-list').innerHTML = "";
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        const json = await fetchWithCache(`${API_BASE_URL}/v1/api/phim/${slug}`);
        currentMovieData = json.status === 'success' ? json.data.item : json.movie;
        const eps = json.status === 'success' ? currentMovieData.episodes : json.episodes;
        currentMovieData.episodes = eps;
        
        const dImg = json.data?.APP_DOMAIN_CDN_IMAGE || json.pathImage || imageDomain;
        
        const posterEl = document.getElementById('detail-poster');
        const imagePath = currentMovieData.poster_url || currentMovieData.thumb_url;
        posterEl.src = getImageUrl(dImg, imagePath);
        posterEl.onerror = function() { handleImageError(this); };

        document.title = currentMovieData.name + " - Phim.tv";
        document.getElementById('detail-title').innerText = currentMovieData.name;
        document.getElementById('detail-origin-name').innerText = currentMovieData.origin_name || "Đang cập nhật";
        document.getElementById('detail-quality').innerText = currentMovieData.quality || "HD";
        document.getElementById('detail-lang').innerText = currentMovieData.lang || "Vietsub";
        document.getElementById('detail-year').innerText = currentMovieData.year || "Đang cập nhật";
        document.getElementById('detail-content').innerHTML = currentMovieData.content || "Chưa có nội dung mô tả.";
        
        const trailerBtn = document.getElementById('detail-trailer');
        if (currentMovieData.trailer_url) {
            trailerBtn.href = currentMovieData.trailer_url;
            trailerBtn.style.display = 'inline-flex';
        } else {
            trailerBtn.style.display = 'none';
        }

        const btnWatchNow = document.getElementById('btn-watch-now');
        if (eps && eps.length > 0 && eps[0].server_data && eps[0].server_data.length > 0) {
            btnWatchNow.style.display = 'inline-flex';
            btnWatchNow.onclick = () => openWatchView(eps[0].server_data[0]);
        } else {
            btnWatchNow.style.display = 'none';
        }
        
        const btnContinue = document.getElementById('btn-continue-watch');
        if (!watchHistoryCache) {
            watchHistoryCache = JSON.parse(localStorage.getItem('phimtv_history')) || {};
        }
        let lastWatchedEp = watchHistoryCache[slug];
        
        if (btnContinue) {
            if (lastWatchedEp) {
                btnContinue.style.display = 'inline-flex';
                btnContinue.innerHTML = `<i class="fa-solid fa-play"></i> TIẾP TỤC XEM TẬP ${lastWatchedEp.name}`;
                btnContinue.onclick = () => openWatchView(lastWatchedEp);
            } else {
                btnContinue.style.display = 'none';
            }
        }
        
        const categories = currentMovieData.category ? currentMovieData.category.map(c => c.name).join(', ') : "Đang cập nhật";
        document.getElementById('detail-categories').innerText = categories;
        const countries = currentMovieData.country ? currentMovieData.country.map(c => c.name).join(', ') : "Đang cập nhật";
        document.getElementById('detail-countries').innerText = countries;
        const directors = currentMovieData.director && currentMovieData.director.length > 0 ? currentMovieData.director.join(', ') : "Đang cập nhật";
        document.getElementById('detail-directors').innerText = directors;
        const actors = currentMovieData.actor && currentMovieData.actor.length > 0 ? currentMovieData.actor.join(', ') : "Đang cập nhật";
        document.getElementById('detail-actors').innerText = actors;

        const serverContainer = document.getElementById('server-list');
        
        if (eps && eps.length > 0) {
            eps.forEach((server, index) => {
                const sBtn = document.createElement("button");
                sBtn.className = "btn-server" + (index === 0 ? " active" : "");
                sBtn.innerText = "Server " + server.server_name;
                sBtn.onclick = (e) => {
                    document.querySelectorAll('.btn-server').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    renderEpisodesByServer(server.server_data, 'episode-list', false);
                };
                serverContainer.appendChild(sBtn);
            });
            renderEpisodesByServer(eps[0].server_data, 'episode-list', false);
        } else {
            document.getElementById('episode-list').innerHTML = "<p style='color: white;'>Phim đang được cập nhật tập mới.</p>";
        }

        loadTMDBImagesForDetail(slug);
    } catch (error) {
        document.getElementById('detail-title').innerText = "Lỗi khi lấy thông tin phim.";
    }
}

async function loadTMDBImagesForDetail(slug) {
    const gallerySection = document.getElementById('gallery-section');
    const galleryWrapper = document.getElementById('detail-gallery');
    const detailView = document.getElementById('detail-view');
    const posterEl = document.getElementById('detail-poster');
    
    galleryWrapper.innerHTML = "";
    gallerySection.style.display = 'none';
    try {
        const json = await fetchWithCache(`${API_BASE_URL}/v1/api/phim/${slug}/images`);
        if (json.success && json.data && json.data.images && json.data.images.length > 0) {
            const allImages = json.data.images;
            const tmdbPoster = allImages.find(img => img.type === "poster");
            if (tmdbPoster && tmdbPoster.file_path) {
                const newPosterUrl = TMDB_POSTER_BASE + tmdbPoster.file_path;
                const tempImg = new Image();
                tempImg.onload = () => { posterEl.src = newPosterUrl; };
                tempImg.src = newPosterUrl;
            }
            const tmdbBackdrops = allImages.filter(img => img.type === "backdrop");
            if (tmdbBackdrops.length > 0 && tmdbBackdrops[0].file_path) {
                const bgUrl = TMDB_BACKDROP_BASE + tmdbBackdrops[0].file_path;
                detailView.style.backgroundImage = `linear-gradient(to right, #050505 30%, rgba(5, 5, 5, 0.7) 100%), url('${bgUrl}')`;
                detailView.style.backgroundSize = "cover";
                detailView.style.backgroundPosition = "center top";
                detailView.style.backgroundAttachment = "fixed";
            }
            if (tmdbBackdrops.length > 1) {
                const galleryImages = tmdbBackdrops.slice(1);
                galleryImages.forEach(imgData => {
                    const img = document.createElement('img');
                    img.className = 'gallery-img';
                    img.src = TMDB_GALLERY_BASE + imgData.file_path;
                    img.loading = "lazy";
                    img.onerror = function() { this.style.display = 'none'; };
                    galleryWrapper.appendChild(img);
                });
                gallerySection.style.display = 'block';
            }
        }
    } catch (error) {}
}

function renderEpisodesByServer(serverData, containerId, isWatchView) {
    const episodeContainer = document.getElementById(containerId);
    episodeContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();

    serverData.forEach(ep => {
        const btn = document.createElement("button");
        btn.className = "btn-episode";
        btn.innerText = ep.name;
        btn.onclick = (e) => {
            if (!isWatchView) {
                openWatchView(ep);
            } else {
                updateWatchViewPlayer(ep, e.target);
            }
        };
        fragment.appendChild(btn);
    });

    episodeContainer.appendChild(fragment);
}

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
            renderEpisodesByServer(server.server_data, 'watch-episode-list', true);
        };
        watchServerContainer.appendChild(sBtn);
    });
    renderEpisodesByServer(currentMovieData.episodes[0].server_data, 'watch-episode-list', true);
    
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
    localStorage.setItem('phimtv_history', JSON.stringify(watchHistoryCache));

    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch(e){}
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
            fragLoadingMaxRetry: 5,
            manifestLoadingMaxRetry: 3
        };
        hlsInstance = new Hls(hlsConfig);
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(videoPlayer);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
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
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            console.log("HLS ERROR:", data);
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.warn("Lỗi mạng, đang thử tải lại luồng...");
                        hlsInstance.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.warn("Lỗi media, đang khôi phục video...");
                        hlsInstance.recoverMediaError();
                        break;
                    default:
                        console.error("Lỗi HLS nghiêm trọng, hủy tiến trình.");
                        try { hlsInstance.destroy(); } catch(e){}
                        hlsInstance = null;
                        alert("Không thể tải luồng phim này. Vui lòng thử đổi sang Server khác.");
                        break;
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