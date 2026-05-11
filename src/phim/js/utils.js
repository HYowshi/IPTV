// ==================== CONSTANTS ====================
const ERROR_IMAGE = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22 viewBox=%220 0 300 450%22%3E%3Crect width=%22300%22 height=%22450%22 fill=%22%231a1a1a%22/%3E%3Crect width=%22300%22 height=%22450%22 fill=%22none%22 stroke=%22%23333%22 stroke-width=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%23666%22 font-family=%22sans-serif%22 font-size=%2220%22 font-weight=%22bold%22 text-anchor=%22middle%22 dy=%22.3em%22%3ELỗi Ảnh%3C/text%3E%3C/svg%3E";
const MAX_HISTORY_ENTRIES = 150;

// Intersection Observer for lazy loading
let imageObserver = null;
function getImageObserver() {
    if (imageObserver) return imageObserver;
    if (!('IntersectionObserver' in window)) return null;
    imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const dataSrc = img.dataset.src;
                if (dataSrc) {
                    img.src = dataSrc;
                    img.removeAttribute('data-src');
                }
                imageObserver.unobserve(img);
            }
        });
    }, {
        rootMargin: '200px 0px',
        threshold: 0.01
    });
    return imageObserver;
}

// ==================== IMAGE HELPERS ====================
function handleImageError(imgElement) {
    imgElement.onerror = null;
    imgElement.src = ERROR_IMAGE;
}

const CDN_FALLBACKS = [
    'https://img.ophim.live/uploads/movies',
    'https://phimimg.com/uploads/movies'
];

function getImageUrl(domain, path) {
    if (!path || path.trim() === "") return ERROR_IMAGE;

    if (path.startsWith("http://") || path.startsWith("https://")) {
        let url = path.replace("http://", "https://");
        url = url.replace("img.ophim.cc", "phimimg.com").replace("ophim.cc", "phimimg.com");
        return url;
    }

    let cleanDomain = "";
    if (domain && domain.trim() !== "") {
        cleanDomain = domain.trim();
    } else if (imageDomain && imageDomain.trim() !== "") {
        cleanDomain = imageDomain;
    } else {
        cleanDomain = IMAGE_BASE_URL;
    }

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

function handleImageErrorWithFallback(imgElement, originalSrc) {
    imgElement.onerror = null;
    for (const cdn of CDN_FALLBACKS) {
        if (originalSrc && !originalSrc.includes(cdn)) {
            const path = originalSrc.split('/uploads/movies/')[1];
            if (path) {
                const fallbackUrl = cdn + '/' + path;
                if (fallbackUrl !== originalSrc) {
                    imgElement.onerror = () => { imgElement.onerror = null; imgElement.src = ERROR_IMAGE; };
                    imgElement.src = fallbackUrl;
                    return;
                }
            }
        }
    }
    imgElement.src = ERROR_IMAGE;
}

// ==================== FORMATTING ====================
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

function trimWatchHistory(history) {
    const keys = Object.keys(history);
    if (keys.length > MAX_HISTORY_ENTRIES) {
        const excess = keys.length - MAX_HISTORY_ENTRIES;
        for (let i = 0; i < excess; i++) {
            delete history[keys[i]];
        }
    }
    return history;
}

async function toggleFullscreen(container) {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    try {
        if (!isFs) {
            if (container.requestFullscreen) await container.requestFullscreen();
            else if (container.webkitRequestFullscreen) await container.webkitRequestFullscreen();
            else if (container.msRequestFullscreen) await container.msRequestFullscreen();
        } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            else if (document.msExitFullscreen) await document.msExitFullscreen();
        }
    } catch (e) { }
}