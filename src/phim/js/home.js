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
let heroCarouselInterval = null;
let currentHeroIndex = 0;
let heroMovies = [];

async function fetchHomeData() {
    document.getElementById('loading-initial').style.display = 'flex';
    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';

    try {
        const endpoints = [
            `${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?page=1`,
            `${API_BASE_URL}/v1/api/danh-sach/phim-moi-cap-nhat?page=2`,
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

        heroMovies = formatted[0].items.slice(0, 5);
        if (heroMovies.length > 0) {
            setupHeroControls();
            buildHeroIndicators();
            renderHero(0);
            startHeroCarousel();
        }

        renderFavorites();

        renderMoviesCards(formatted[0].items.slice(0, 12), 'grid-new-update', false);
        renderMoviesCards(formatted[1].items.slice(0, 3), 'grid-theaters', true);
        renderMoviesCards(formatted[2].items.slice(0, 6), 'grid-series', false);
        renderMoviesCards(formatted[3].items.slice(0, 6), 'grid-movies', false);

        renderUpcoming(formatted[4].items.slice(0, 5), 'sidebar-upcoming');
        renderTopMovies(formatted[5].items.slice(0, 5), 'sidebar-top-movies');
        renderTopSeries(formatted[6].items.slice(0, 8), 'sidebar-top-series');

    } catch (e) {
    } finally {
        document.getElementById('loading-initial').style.display = 'none';
        document.getElementById('heroBanner').style.display = 'flex';
        document.getElementById('main-content').style.display = 'flex';
        document.getElementById('home-view').style.display = 'block';
    }
}

function buildHeroIndicators() {
    const indicatorsContainer = document.getElementById('hero-indicators');
    if (!indicatorsContainer) return;
    indicatorsContainer.innerHTML = '';
    heroMovies.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.className = 'hero-indicator-dot';
        dot.onclick = () => {
            currentHeroIndex = index;
            renderHero(currentHeroIndex);
            startHeroCarousel();
        };
        indicatorsContainer.appendChild(dot);
    });
}

function setupHeroControls() {
    const prevBtn = document.getElementById('hero-prev');
    const nextBtn = document.getElementById('hero-next');
    if (prevBtn) {
        prevBtn.onclick = () => {
            currentHeroIndex = (currentHeroIndex - 1 + heroMovies.length) % heroMovies.length;
            renderHero(currentHeroIndex);
            startHeroCarousel();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            currentHeroIndex = (currentHeroIndex + 1) % heroMovies.length;
            renderHero(currentHeroIndex);
            startHeroCarousel();
        };
    }
}

function renderHero(index) {
    if (heroMovies.length === 0) return;
    const heroMovie = heroMovies[index];
    const heroSection = document.getElementById('heroBanner');
    if (!heroSection || heroSection.style.display === 'none') return;

    const imgUrl = getImageUrl(imageDomain, heroMovie.thumb_url || heroMovie.poster_url);
    // Preload image for faster display
    const heroImg = new Image();
    heroImg.onload = () => {
        heroSection.style.backgroundImage = `url('${imgUrl}')`;
    };
    heroImg.onerror = () => {
        heroSection.style.backgroundImage = `url('${imgUrl}')`; // Fallback show anyway
    };
    heroImg.src = imgUrl;
    // If image already cached by browser, show immediately
    if (heroImg.complete) {
        heroSection.style.backgroundImage = `url('${imgUrl}')`;
    }

    const titleEl = document.getElementById('hero-title');
    const yearEl = document.getElementById('hero-year');
    const descEl = document.getElementById('hero-desc');
    const qualityEl = document.getElementById('hero-quality');
    const btnPlay = document.getElementById('hero-btn');
    const btnRandom = document.getElementById('btn-random-movie');

    const elementsToAnimate = [
        titleEl,
        document.querySelector('.hero-meta'),
        descEl,
        document.querySelector('.hero-info'),
        btnPlay,
        btnRandom
    ];
    elementsToAnimate.forEach(el => {
        if (el) {
            el.classList.remove('animate-fade-up');
            void el.offsetWidth;
            el.classList.add('animate-fade-up');
        }
    });
    
    if (titleEl) titleEl.innerText = heroMovie.name;
    if (yearEl) yearEl.innerText = heroMovie.year || new Date().getFullYear().toString();
    if (descEl) descEl.innerText = heroMovie.origin_name || "";
    if (qualityEl) qualityEl.innerText = heroMovie.quality || "FHD";
    
    const ratingElement = document.getElementById('hero-rating');
    const ratingWrapper = document.getElementById('hero-rating-wrapper');
    if (ratingElement && ratingWrapper) {
        const tmdbVote = heroMovie.tmdb?.vote_average || heroMovie.imdb?.vote_average;
        if (tmdbVote && tmdbVote > 0) {
            ratingElement.innerText = parseFloat(tmdbVote).toFixed(1);
            ratingWrapper.style.display = '';
        } else {
            ratingWrapper.style.display = 'none';
        }
    }

    if (btnPlay) btnPlay.onclick = () => showMovieDetails(heroMovie.slug);

    const indicators = document.querySelectorAll('.hero-indicator-dot');
    indicators.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });

    if (index === 0) {
        document.title = heroMovie.name + " - Phim.tv | Xem Phim Chất Lượng Cao";
        let ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.content = heroMovie.name + " - Phim Mới Cập Nhật";
        let ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.content = "Thưởng thức " + heroMovie.name + " (" + (heroMovie.year || "") + ") chất lượng HD. " + (heroMovie.origin_name || "");
        let ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) ogImg.content = imgUrl;
    }

    fetchWithCache(`${API_BASE_URL}/v1/api/phim/${heroMovie.slug}/images`).then(tmdbJson => {
        if (tmdbJson.success && tmdbJson.data && tmdbJson.data.images) {
            const tmdbBackdrops = tmdbJson.data.images.filter(img => img.type === "backdrop");
            if (tmdbBackdrops.length > 0 && tmdbBackdrops[0].file_path) {
                const bgUrl = TMDB_BACKDROP_BASE + tmdbBackdrops[0].file_path;
                heroSection.style.backgroundImage = `url('${bgUrl}')`;
                if (index === 0) {
                    let ogImg = document.querySelector('meta[property="og:image"]');
                    if (ogImg) ogImg.content = bgUrl;
                }
            }
        }
    }).catch(() => { });
}

function startHeroCarousel() {
    if (heroCarouselInterval) clearInterval(heroCarouselInterval);
    heroCarouselInterval = setInterval(() => {
        currentHeroIndex = (currentHeroIndex + 1) % heroMovies.length;
        renderHero(currentHeroIndex);
    }, 8000);
}

function renderFavorites() {
    const section = document.getElementById('favorites-section');
    const grid = document.getElementById('grid-favorites');
    if (!section || !grid) return;

    let favorites = JSON.parse(localStorage.getItem('phimtv_favorites')) || {};
    const keys = Object.keys(favorites);
    if (keys.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';
    
    const sortedKeys = keys.sort((a, b) => favorites[b].time - favorites[a].time).slice(0, 6);
    
    const movies = sortedKeys.map(key => {
        return {
            slug: key,
            name: favorites[key].name,
            thumb_url: favorites[key].thumb_url,
            poster_url: favorites[key].thumb_url,
            year: 'Yêu thích',
            quality: 'Đã lưu'
        };
    });

    renderMoviesCardsAppend(movies, grid, false, '');
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

    renderFilterUI();
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

    const mobileCatList = document.getElementById('mobile-category-list');
    const mobileCountryList = document.getElementById('mobile-country-list');
    if (mobileCatList) {
        mobileCatList.innerHTML = "";
        const sortedCats = Array.from(categoriesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        sortedCats.forEach(item => {
            const a = document.createElement('a');
            a.href = "#";
            a.onclick = (e) => { e.preventDefault(); closeMobileMenu(); loadFilterData('the-loai', item.slug, `Thể loại: ${item.name}`, 1); };
            a.innerHTML = `<span class="material-symbols-rounded">local_offer</span>${item.name}`;
            mobileCatList.appendChild(a);
        });
    }
    if (mobileCountryList) {
        mobileCountryList.innerHTML = "";
        const sortedCountries = Array.from(countriesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        sortedCountries.forEach(item => {
            const a = document.createElement('a');
            a.href = "#";
            a.onclick = (e) => { e.preventDefault(); closeMobileMenu(); loadFilterData('quoc-gia', item.slug, `Quốc gia: ${item.name}`, 1); };
            a.innerHTML = `<span class="material-symbols-rounded">public</span>${item.name}`;
            mobileCountryList.appendChild(a);
        });
    }

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

    if (typeof currentFilterEndpoint !== 'undefined') {
        filterCat.value = currentFilterEndpoint === 'the-loai' ? currentFilterSlug : "";
        filterCountry.value = currentFilterEndpoint === 'quoc-gia' ? currentFilterSlug : "";
        filterYear.value = currentFilterEndpoint === 'nam' ? currentFilterSlug.toString() : "";
    }
}

function navigateToHome(e) {
    if (e) e.preventDefault();
    document.title = "Phim.tv - Xem Phim Trực Tuyến Chất Lượng Cao";
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';

    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }
    if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) { }
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

    const filterCat = document.getElementById('filter-category');
    const filterCountry = document.getElementById('filter-country');
    const filterYear = document.getElementById('filter-year');
    if (filterCat) filterCat.value = "";
    if (filterCountry) filterCountry.value = "";
    if (filterYear) filterYear.value = "";

    document.getElementById('heroBanner').style.display = 'flex';
    document.getElementById('home-view').style.display = 'block';
    document.getElementById('filter-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'none';
    document.querySelector('.main-container').classList.add('with-hero');

    if (heroMovies.length > 0) {
        renderHero(0);
        startHeroCarousel();
    }
    renderFavorites();

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

function buildFilterUrl(endpointType, slug, page) {
    if (endpointType === 'search') {
        return `${API_BASE_URL}/v1/api/tim-kiem?keyword=${encodeURIComponent(slug)}&limit=24&page=${page}`;
    } else if (endpointType === 'nam') {
        return `${API_BASE_URL}/v1/api/nam-phat-hanh/${slug}?limit=24&page=${page}`;
    } else if (endpointType === 'new') {
        return `${API_BASE_URL}/danh-sach/phim-moi-cap-nhat?page=${page}`;
    } else if (endpointType === 'danh-sach') {
        return `${API_BASE_URL}/v1/api/danh-sach/${slug}?limit=24&page=${page}`;
    } else {
        return `${API_BASE_URL}/v1/api/${endpointType}/${slug}?limit=24&page=${page}`;
    }
}

async function loadFilterData(endpointType, slug, titleText, page) {
    if (heroCarouselInterval) clearInterval(heroCarouselInterval);
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
        const url = buildFilterUrl(endpointType, slug, page);
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
            const nextUrl = buildFilterUrl(endpointType, slug, page + 1);
            fetchWithCache(nextUrl).catch(() => { });
        }
    } catch (error) {
        if (searchId === currentSearchId) {
            gridElement.innerHTML = `<div style='color: #f91942; padding: 20px; width: 100%; text-align: center;'>Lỗi tải dữ liệu.</div>`;
        }
    }
}

function initVoiceSearch() {
    const voiceBtn = document.getElementById('voiceSearchBtn');
    const searchInput = document.getElementById('searchInput');
    if (!voiceBtn || (!window.SpeechRecognition && !window.webkitSpeechRecognition)) {
        if (voiceBtn) voiceBtn.style.display = 'none';
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    
    voiceBtn.addEventListener('click', () => {
        voiceBtn.classList.add('recording');
        recognition.start();
    });
    
    recognition.onresult = (event) => {
        const speechToText = event.results[0][0].transcript;
        searchInput.value = speechToText;
        if (typeof handleSearch === 'function') handleSearch();
    };
    
    recognition.onspeechend = () => {
        recognition.stop();
    };
    
    recognition.onend = () => {
        voiceBtn.classList.remove('recording');
    };
}

document.addEventListener('DOMContentLoaded', initVoiceSearch);