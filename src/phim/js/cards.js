// ==================== MOVIE CARD RENDERING ====================
function createMovieCard(movie, domain = imageDomain, isHorizontal = false) {
    const card = document.createElement("div");
    card.className = `movie-card ${isHorizontal ? 'horizontal' : ''}`;
    card.tabIndex = 0;

    const imagePath = isHorizontal ? (movie.thumb_url || movie.poster_url) : (movie.poster_url || movie.thumb_url);
    const imgUrl = getImageUrl(domain, imagePath);
    card.innerHTML = `
        <span class="badge badge-red">${getMovieBadge(movie)}</span>
        <div class="image-container">
            <img class="skeleton" data-src="${imgUrl}" alt="${movie.name}" decoding="async" fetchpriority="low" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
            <div class="card-overlay"><span class="material-symbols-rounded" style="font-size:40px;">play_arrow</span></div>
        </div>
        <div class="info">
            <h3>${movie.name}</h3>
            <p>${isHorizontal ? (movie.origin_name || "") : (movie.year || movie.origin_name || "")}</p>
        </div>
    `;

    card.onclick = () => showMovieDetails(movie.slug);
    card.onkeydown = (e) => { if (e.key === 'Enter') showMovieDetails(movie.slug); };

    // Trigger lazy loading for the image
    const img = card.querySelector('img[data-src]');
    if (img) {
        const observer = getImageObserver();
        if (observer) {
            observer.observe(img);
        } else {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        }
    }

    return card;
}

function renderMoviesCards(movies, containerId, isHorizontal = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    renderMoviesCardsAppend(movies, container, isHorizontal);
}

function renderMoviesCardsAppend(movies, container, isHorizontal = false, domain = imageDomain) {
    const fragment = document.createDocumentFragment();
    const observer = getImageObserver();

    movies.forEach(movie => {
        const card = document.createElement("div");
        card.className = `movie-card ${isHorizontal ? 'horizontal' : ''}`;
        card.tabIndex = 0;

        const imagePath = isHorizontal ? (movie.thumb_url || movie.poster_url) : (movie.poster_url || movie.thumb_url);
        const imgUrl = getImageUrl(domain, imagePath);
        card.innerHTML = `
            <span class="badge badge-red">${getMovieBadge(movie)}</span>
            <div class="image-container">
                <img class="skeleton" data-src="${imgUrl}" alt="${movie.name}" decoding="async" fetchpriority="low" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
                <div class="card-overlay"><span class="material-symbols-rounded" style="font-size:40px;">play_arrow</span></div>
            </div>
            <div class="info">
                <h3>${movie.name}</h3>
            <p>${isHorizontal ? (movie.origin_name || "") : (movie.year || movie.origin_name || "")}</p>
            </div>
        `;

        card.onclick = () => showMovieDetails(movie.slug);
        card.onkeydown = (e) => { if (e.key === 'Enter') showMovieDetails(movie.slug); };
        fragment.appendChild(card);
    });

    container.appendChild(fragment);

    if (observer) {
        container.querySelectorAll('img[data-src]').forEach(img => {
            observer.observe(img);
        });
    } else {
        container.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        });
    }
}

function getMovieBadge(movie) {
    if (movie.episode_current && movie.episode_current.trim() !== "") {
        if (movie.episode_current.toLowerCase() === "full") {
            return movie.quality || "Hoàn thành";
        }
        return movie.episode_current;
    }
    if (movie.type === "single") return movie.quality || "Phim lẻ";
    if (movie.type === "hoathinh") return movie.quality || "Hoạt hình";
    return movie.quality || "";
}

function renderUpcoming(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    movies.forEach(movie => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="bullet"><span class="material-symbols-rounded" style="font-size:12px;">fiber_manual_record</span></span> <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${movie.name}</span> <span class="year">${movie.year || ""}</span>`;
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
            <img src="${imgUrl}" class="rank-thumb skeleton" alt="${movie.name}" loading="lazy" decoding="async" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
            <div class="rank-info">
                <h4>${movie.name}</h4>
                <div class="rank-meta">
                    <span class="quality">${episodeCurrent}</span> <span class="rating"><span class="material-symbols-rounded" style="font-size:14px;color:#ffc107;">star</span> 8.0</span> <span class="year">${movie.year || ""}</span>
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

        card.innerHTML = `
            <span class="badge badge-red">${getMovieBadge(movie)}</span>
            <div class="image-container">
               <img class="skeleton" src="${imgUrl}" alt="${movie.name}" loading="lazy" decoding="async" onload="this.classList.remove('skeleton')" onerror="handleImageError(this); this.classList.remove('skeleton');">
               <div class="card-overlay"><span class="material-symbols-rounded" style="font-size:40px;">play_arrow</span></div>
            </div>
            <div class="info"><h4>${movie.name}</h4></div>
        `;
        card.onclick = () => showMovieDetails(movie.slug);
        container.appendChild(card);
    });
}