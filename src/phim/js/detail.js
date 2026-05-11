// ==================== MOVIE DETAILS ====================
let detailGalleryImages = [];
let currentLightboxIndex = 0;
let descriptionExpanded = false;

async function showMovieDetails(slug) {
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

    document.getElementById('heroBanner').style.display = 'none';
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('filter-view').style.display = 'none';
    document.getElementById('watch-view').style.display = 'none';
    document.getElementById('advanced-filter-bar').style.display = 'none';
    document.getElementById('detail-view').style.display = 'block';
    document.getElementById('detail-view').style.backgroundImage = "none";
    document.querySelector('.main-container').classList.remove('with-hero');

    // Show skeleton, hide content
    const skeleton = document.getElementById('detail-skeleton');
    const contentWrapper = document.getElementById('detail-content-wrapper');
    if (skeleton) skeleton.style.display = 'block';
    if (contentWrapper) contentWrapper.style.display = 'none';

    // Reset related section
    const relatedSection = document.getElementById('related-section');
    if (relatedSection) relatedSection.style.display = 'none';

    document.getElementById('detail-title').innerText = "Đang tải...";
    document.getElementById('episode-list').innerHTML = "";
    document.getElementById('server-list').innerHTML = "";
    descriptionExpanded = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        const json = await fetchWithCache(`${API_BASE_URL}/v1/api/phim/${slug}`);
        currentMovieData = json.status === 'success' ? json.data.item : json.movie;
        const eps = json.status === 'success' ? currentMovieData.episodes : json.episodes;
        currentMovieData.episodes = eps;

        const dImg = json.data?.APP_DOMAIN_CDN_IMAGE || json.pathImage || imageDomain;

        // Hide skeleton, show content
        if (skeleton) skeleton.style.display = 'none';
        if (contentWrapper) contentWrapper.style.display = 'flex';

        const posterEl = document.getElementById('detail-poster');
        const imagePath = currentMovieData.poster_url || currentMovieData.thumb_url;
        posterEl.src = getImageUrl(dImg, imagePath);
        posterEl.decoding = 'async';
        posterEl.fetchPriority = 'high';
        posterEl.onerror = function () { handleImageError(this); };

        document.title = currentMovieData.name + " - Phim.tv";
        document.getElementById('detail-title').innerText = currentMovieData.name;
        document.getElementById('detail-origin-name').innerText = currentMovieData.origin_name || "Đang cập nhật";
        document.getElementById('detail-quality').innerText = currentMovieData.quality || "HD";
        document.getElementById('detail-lang').innerText = currentMovieData.lang || "Vietsub";
        document.getElementById('detail-year').innerText = currentMovieData.year || "Đang cập nhật";

        // Rating on poster
        const ratingEl = document.getElementById('detail-rating');
        const ratingValueEl = document.getElementById('detail-rating-value');
        const tmdbVote = currentMovieData.tmdb?.vote_average;
        const imdbVote = currentMovieData.imdb?.vote_average;
        const rating = tmdbVote || imdbVote;
        if (rating && rating > 0) {
            ratingValueEl.innerText = parseFloat(rating).toFixed(1);
            ratingEl.style.display = 'flex';
        } else {
            ratingEl.style.display = 'none';
        }

        // Status badge on poster
        const statusBadge = document.getElementById('detail-status-badge');
        const status = currentMovieData.status;
        if (status) {
            const statusMap = {
                'ongoing': 'Đang chiếu',
                'completed': 'Hoàn tất',
                'trailer': 'Sắp chiếu',
            };
            statusBadge.innerText = statusMap[status] || status;
            statusBadge.style.display = 'inline-block';
        } else {
            statusBadge.style.display = 'none';
        }

        // Episode count badge
        const epCountEl = document.getElementById('detail-ep-count');
        if (eps && eps.length > 0 && eps[0].server_data) {
            const totalEps = eps[0].server_data.length;
            if (totalEps > 0) {
                epCountEl.innerText = totalEps + ' tập';
                epCountEl.style.display = 'inline-block';
            } else {
                epCountEl.style.display = 'none';
            }
        } else {
            epCountEl.style.display = 'none';
        }

        // Content description with expand/collapse
        const contentHtml = currentMovieData.content || "Chưa có nội dung mô tả.";
        const detailContent = document.getElementById('detail-content');
        const descWrapper = document.getElementById('detail-description-wrapper');
        const expandBtn = document.getElementById('btn-expand-desc');
        detailContent.innerHTML = contentHtml;

        // Check if description is long enough to need expand
        requestAnimationFrame(() => {
            if (descWrapper && detailContent.scrollHeight > 120) {
                descWrapper.classList.add('collapsed');
                expandBtn.style.display = 'flex';
                expandBtn.classList.remove('expanded');
                expandBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">expand_more</span> Xem thêm';
            } else if (descWrapper) {
                descWrapper.classList.remove('collapsed');
                expandBtn.style.display = 'none';
            }
        });

        // Trailer button
        const trailerBtn = document.getElementById('detail-trailer');
        if (currentMovieData.trailer_url) {
            trailerBtn.href = currentMovieData.trailer_url;
            trailerBtn.style.display = 'inline-flex';
        } else {
            trailerBtn.style.display = 'none';
        }

        // Watch buttons
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
                btnContinue.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">play_arrow</span> TIẾP TỤC XEM TẬP ${lastWatchedEp.name}`;
                btnContinue.onclick = () => openWatchView(lastWatchedEp);
            } else {
                btnContinue.style.display = 'none';
            }
        }

        // Favorite button
        setupFavoriteButton(slug);

        // Info rows
        const categories = currentMovieData.category ? currentMovieData.category.map(c => c.name).join(', ') : "Đang cập nhật";
        document.getElementById('detail-categories').innerText = categories;
        const countries = currentMovieData.country ? currentMovieData.country.map(c => c.name).join(', ') : "Đang cập nhật";
        document.getElementById('detail-countries').innerText = countries;
        const directors = currentMovieData.director && currentMovieData.director.length > 0 ? currentMovieData.director.join(', ') : "Đang cập nhật";
        document.getElementById('detail-directors').innerText = directors;
        const actors = currentMovieData.actor && currentMovieData.actor.length > 0 ? currentMovieData.actor.join(', ') : "Đang cập nhật";
        document.getElementById('detail-actors').innerText = actors;

        // Servers and episodes
        const serverContainer = document.getElementById('server-list');

        if (eps && eps.length > 0) {
            eps.forEach((server, index) => {
                const sBtn = document.createElement("button");
                sBtn.className = "btn-server" + (index === 0 ? " active" : "");
                sBtn.innerText = "Server " + server.server_name;
                sBtn.onclick = (e) => {
                    document.querySelectorAll('.btn-server').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    renderEpisodesByServer(server.server_data, 'episode-list', false, slug);
                };
                serverContainer.appendChild(sBtn);
            });
            renderEpisodesByServer(eps[0].server_data, 'episode-list', false, slug);
        } else {
            document.getElementById('episode-list').innerHTML = "<p style='color: white;'>Phim đang được cập nhật tập mới.</p>";
        }

        // Load TMDB images
        loadTMDBImagesForDetail(slug);

        // Load related movies
        loadRelatedMovies(slug, currentMovieData);

    } catch (error) {
        if (skeleton) skeleton.style.display = 'none';
        if (contentWrapper) contentWrapper.style.display = 'flex';
        document.getElementById('detail-title').innerText = "Lỗi khi lấy thông tin phim.";
    }
}

// ==================== EXPAND/COLLAPSE DESCRIPTION ====================
document.addEventListener('DOMContentLoaded', () => {
    const expandBtn = document.getElementById('btn-expand-desc');
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            const wrapper = document.getElementById('detail-description-wrapper');
            descriptionExpanded = !descriptionExpanded;
            if (descriptionExpanded) {
                wrapper.classList.remove('collapsed');
                expandBtn.classList.add('expanded');
                expandBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">expand_more</span> Thu gọn';
            } else {
                wrapper.classList.add('collapsed');
                expandBtn.classList.remove('expanded');
                expandBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">expand_more</span> Xem thêm';
            }
        });
    }

    // Lightbox controls
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxPrev = document.getElementById('lightbox-prev');
    const lightboxNext = document.getElementById('lightbox-next');
    const lightbox = document.getElementById('gallery-lightbox');

    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightboxPrev) lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
    if (lightboxNext) lightboxNext.addEventListener('click', () => navigateLightbox(1));
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });
    }

    // Keyboard navigation for lightbox
    document.addEventListener('keydown', (e) => {
        const lightbox = document.getElementById('gallery-lightbox');
        if (!lightbox || lightbox.style.display === 'none') return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
    });
});

// ==================== FAVORITE BUTTON ====================
function setupFavoriteButton(slug) {
    const btnFav = document.getElementById('btn-favorite');
    if (!btnFav) return;

    const favorites = JSON.parse(localStorage.getItem('phimtv_favorites')) || {};
    const isFav = !!favorites[slug];

    btnFav.classList.toggle('active', isFav);
    btnFav.onclick = () => {
        const favorites = JSON.parse(localStorage.getItem('phimtv_favorites')) || {};
        if (favorites[slug]) {
            delete favorites[slug];
            btnFav.classList.remove('active');
            showToast('Đã xóa khỏi danh sách yêu thích');
        } else {
            favorites[slug] = {
                name: currentMovieData.name,
                thumb_url: currentMovieData.thumb_url || currentMovieData.poster_url,
                time: Date.now()
            };
            btnFav.classList.add('active');
            showToast('Đã thêm vào danh sách yêu thích');
        }
        localStorage.setItem('phimtv_favorites', JSON.stringify(favorites));
    };
}

// ==================== TOAST NOTIFICATION ====================
function showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.detail-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'detail-toast';
    toast.innerHTML = `<span class="material-symbols-rounded text-accent" style="font-size:18px;">check_circle</span> ${message}`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

// ==================== RELATED MOVIES ====================
async function loadRelatedMovies(slug, movieData) {
    const relatedSection = document.getElementById('related-section');
    const relatedGrid = document.getElementById('related-grid');
    if (!relatedSection || !relatedGrid) return;

    relatedGrid.innerHTML = '';
    relatedSection.style.display = 'none';

    try {
        // Try to get related movies from category
        const categorySlug = movieData.category && movieData.category.length > 0 ? movieData.category[0].slug : null;
        const countrySlug = movieData.country && movieData.country.length > 0 ? movieData.country[0].slug : null;

        let apiUrl = null;
        if (categorySlug) {
            apiUrl = `${API_BASE_URL}/v1/api/the-loai/${categorySlug}?page=1&limit=12`;
        } else if (countrySlug) {
            apiUrl = `${API_BASE_URL}/v1/api/quoc-gia/${countrySlug}?page=1&limit=12`;
        }

        if (!apiUrl) return;

        const json = await fetchWithCache(apiUrl);
        const formatted = formatResponse(json);
        const items = formatted.items.filter(item => item.slug !== slug).slice(0, 6);

        if (items.length > 0) {
            const domain = formatted.domain || imageDomain;
            items.forEach(item => {
                const card = createMovieCard(item, domain);
                relatedGrid.appendChild(card);
            });
            relatedSection.style.display = 'block';
        }
    } catch (error) { }
}

// ==================== TMDB IMAGES & GALLERY ====================
async function loadTMDBImagesForDetail(slug) {
    const gallerySection = document.getElementById('gallery-section');
    const galleryWrapper = document.getElementById('detail-gallery');
    const detailView = document.getElementById('detail-view');
    const posterEl = document.getElementById('detail-poster');

    galleryWrapper.innerHTML = "";
    gallerySection.style.display = 'none';
    detailGalleryImages = [];

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
                detailGalleryImages = galleryImages.map(img => TMDB_BACKDROP_BASE + img.file_path);

                galleryImages.forEach((imgData, index) => {
                    const img = document.createElement('img');
                    img.className = 'gallery-img';
                    img.src = TMDB_GALLERY_BASE + imgData.file_path;
                    img.loading = "lazy";
                    img.decoding = "async";
                    img.onerror = function () { this.style.display = 'none'; };
                    img.onclick = () => openLightbox(index);
                    galleryWrapper.appendChild(img);
                });
                gallerySection.style.display = 'block';
            }
        }
    } catch (error) { }
}

// ==================== GALLERY LIGHTBOX ====================
function openLightbox(index) {
    if (detailGalleryImages.length === 0) return;
    currentLightboxIndex = index;
    const lightbox = document.getElementById('gallery-lightbox');
    const img = document.getElementById('lightbox-img');
    const counter = document.getElementById('lightbox-counter');

    img.src = detailGalleryImages[currentLightboxIndex];
    counter.innerText = `${currentLightboxIndex + 1} / ${detailGalleryImages.length}`;
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    lightbox.style.display = 'none';
    document.body.style.overflow = '';
}

function navigateLightbox(direction) {
    if (detailGalleryImages.length === 0) return;
    currentLightboxIndex = (currentLightboxIndex + direction + detailGalleryImages.length) % detailGalleryImages.length;
    const img = document.getElementById('lightbox-img');
    const counter = document.getElementById('lightbox-counter');
    img.style.opacity = '0';
    setTimeout(() => {
        img.src = detailGalleryImages[currentLightboxIndex];
        counter.innerText = `${currentLightboxIndex + 1} / ${detailGalleryImages.length}`;
        img.style.opacity = '1';
    }, 150);
}

// ==================== EPISODES RENDERING ====================
function renderEpisodesByServer(serverData, containerId, isWatchView, movieSlug) {
    const episodeContainer = document.getElementById(containerId);
    episodeContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();

    // Get watched episodes for this movie
    const watchedEps = JSON.parse(localStorage.getItem('phimtv_watched_eps')) || {};
    const movieWatched = watchedEps[movieSlug || ''] || {};

    serverData.forEach(ep => {
        const btn = document.createElement("button");
        btn.className = "btn-episode";

        // Mark as watched if applicable
        const epKey = ep.slug || ep.name;
        if (!isWatchView && movieWatched[epKey]) {
            btn.classList.add('watched');
        }

        btn.innerText = ep.name;
        btn.onclick = (e) => {
            // Mark as watched
            markEpisodeWatched(movieSlug, epKey);

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

// ==================== MARK EPISODE AS WATCHED ====================
function markEpisodeWatched(movieSlug, epKey) {
    if (!movieSlug || !epKey) return;
    try {
        const watchedEps = JSON.parse(localStorage.getItem('phimtv_watched_eps')) || {};
        if (!watchedEps[movieSlug]) watchedEps[movieSlug] = {};
        watchedEps[movieSlug][epKey] = Date.now();

        // Limit storage - keep last 50 movies
        const keys = Object.keys(watchedEps);
        if (keys.length > 50) {
            const sorted = keys.sort((a, b) => {
                const maxA = Math.max(...Object.values(watchedEps[a]));
                const maxB = Math.max(...Object.values(watchedEps[b]));
                return maxA - maxB;
            });
            delete watchedEps[sorted[0]];
        }

        localStorage.setItem('phimtv_watched_eps', JSON.stringify(watchedEps));
    } catch (e) { }
}