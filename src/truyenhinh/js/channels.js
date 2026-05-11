// ==================== FILTER SYSTEM ====================
function applyFilters() {
    const searchInput = document.getElementById('tv-search-input');
    const keyword = searchInput ? normalizeChannelName(searchInput.value) : "";
    let filtered = allChannels;

    if (keyword) {
        filtered = filtered.filter(c => normalizeChannelName(c.name).includes(keyword));
    }

    renderChannels(filtered);
}

// ==================== M3U LOADING ====================
async function fetchAllM3UFiles(urls) {
    const container = document.getElementById('channels-container');
    container.innerHTML = "<div style='color: white; text-align: center; padding: 20px;'>Đang tải tổng hợp danh sách kênh...</div>";

    const cacheKey = 'm3u_combined';
    const cached = tvGetCached(cacheKey);

    let combinedRawData = "";

    try {
        if (cached && !cached.stale) {
            combinedRawData = cached.data;
        } else {
            const fetchPromises = urls.map((url, i) =>
                tvFetchWithCache(`m3u_${i}`, url).catch(() => "")
            );

            const results = await Promise.all(fetchPromises);

            results.forEach(data => {
                if (data) combinedRawData += "\n" + data;
            });

            if (combinedRawData.trim()) {
                tvSetCache(cacheKey, combinedRawData);
            }
        }

        const parsedChannels = parseM3U(combinedRawData);
        const uniqueChannelsMap = new Map();

        parsedChannels.forEach(channel => {
            const normalizedName = normalizeChannelName(channel.name);
            if (!uniqueChannelsMap.has(normalizedName)) {
                uniqueChannelsMap.set(normalizedName, channel);
            }
        });

        allChannels = Array.from(uniqueChannelsMap.values());

        if (allChannels.length === 0) {
            container.innerHTML = "<div style='color: #f91942; text-align: center; padding: 20px;'>Không tìm thấy kênh nào.</div>";
            return;
        }

        // Render channels
        renderChannels(allChannels);

        setTimeout(() => {
            const firstCard = document.querySelector('.channel-card');
            if (firstCard) {
                firstCard.focus();
                firstCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        }, 100);
    } catch (error) {
        container.innerHTML = "<div style='color: #f91942; text-align: center; padding: 20px;'>Lỗi tải danh sách kênh.</div>";
    }
}

function parseM3U(data) {
    const lines = data.split(M3U_LINE_SPLIT);
    const channels = [];
    let currentChannel = {};
    let pendingProps = {};

    for (let idx = 0; idx < lines.length; idx++) {
        let line = lines[idx].trim();
        if (line.length === 0) continue;

        if (line.charCodeAt(0) === 35) { // starts with '#'
            if (line.startsWith('#EXTINF:')) {
                pendingProps = {};
                const groupMatch = M3U_GROUP_REGEX.exec(line);
                currentChannel.group = groupMatch ? groupMatch[1] : "Khác";

                const logoMatch = M3U_LOGO_REGEX.exec(line);
                currentChannel.logo = logoMatch ? logoMatch[1] : "";

                const idMatch = M3U_ID_REGEX.exec(line);
                currentChannel.id = idMatch ? idMatch[1] : "";

                const commaIdx = line.indexOf(',');
                currentChannel.name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : "Kênh không tên";
            } else if (line.startsWith('#EXTGRP:')) {
                currentChannel.group = line.substring(8).trim();
            } else if (line.startsWith('#KODIPROP:')) {
                const propValue = line.substring(10);
                const eqIdx = propValue.indexOf('=');
                if (eqIdx !== -1) {
                    const key = propValue.substring(0, eqIdx);
                    const val = propValue.substring(eqIdx + 1);
                    if (key === 'inputstream.adaptive.license_type') {
                        pendingProps.licenseType = val;
                    } else if (key === 'inputstream.adaptive.license_key') {
                        pendingProps.licenseKey = val;
                    }
                }
            } else if (line.startsWith('#EXTVLCOPT:')) {
                const optValue = line.substring(11);
                if (optValue.startsWith('http-referrer=')) {
                    pendingProps.referrer = optValue.substring(14);
                } else if (optValue.startsWith('http-user-agent=')) {
                    pendingProps.userAgent = optValue.substring(16);
                }
            }
        } else if (line.startsWith('http') || line.startsWith('udp://') || line.startsWith('rtmp') || line.startsWith('rtsp') || line.startsWith('mms')) {
            currentChannel.url = line;
            if (!currentChannel.group) currentChannel.group = "Khác";
            // Merge DRM license and HTTP header properties
            if (pendingProps.licenseType) currentChannel.licenseType = pendingProps.licenseType;
            if (pendingProps.licenseKey) currentChannel.licenseKey = pendingProps.licenseKey;
            if (pendingProps.referrer) currentChannel.referrer = pendingProps.referrer;
            if (pendingProps.userAgent) currentChannel.userAgent = pendingProps.userAgent;
            channels.push({ ...currentChannel });
            currentChannel = {};
            pendingProps = {};
        }
    }
    return channels;
}

/**
 * Parse DRM license keys from M3U #KODIPROP format into dashjs protection data.
 * Supports both JSON format {"keyId":"key",...} and simple "keyId:key" format.
 */
function parseDashLicenseKeys(licenseType, licenseKey) {
    const schemeMap = {
        'clearkey': 'org.w3.clearkey',
        'org.w3.clearkey': 'org.w3.clearkey',
        'widevine': 'com.widevine.alpha',
        'com.widevine.alpha': 'com.widevine.alpha',
        'playready': 'com.microsoft.playready',
        'com.microsoft.playready': 'com.microsoft.playready'
    };
    const scheme = schemeMap[(licenseType || '').toLowerCase()];
    if (!scheme) return null;

    let keys = {};
    try {
        const parsed = JSON.parse(licenseKey);
        if (typeof parsed === 'object' && parsed !== null) {
            keys = parsed;
        }
    } catch (e) {
        // Fallback: parse "keyId:key" format
        const parts = licenseKey.split(':');
        if (parts.length === 2) {
            keys[parts[0].trim()] = parts[1].trim();
        }
    }

    if (Object.keys(keys).length === 0) return null;

    return {
        [scheme]: {
            clearkeys: keys
        }
    };
}

// ==================== CHANNEL RENDERING ====================
function renderChannels(channels) {
    currentChannelList = channels;
    const container = document.getElementById('channels-container');

    if (!channels || channels.length === 0) {
        container.innerHTML = '<div style="color: #aaa; text-align: center; padding: 50px 20px; width: 100%; font-size: 18px;">Không tìm thấy kênh phù hợp.</div>';
        return;
    }

    let favorites;
    try {
        favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];
    } catch (e) {
        favorites = [];
    }
    const favoritesSet = new Set(favorites);

    // Build groups
    const groups = {};
    const playingUrl = currentPlayingChannel ? currentPlayingChannel.url : null;

    // Favorites group
    const favoriteChannels = channels.filter(c => favoritesSet.has(c.url));
    if (favoriteChannels.length > 0) {
        groups["❤️ Kênh Yêu Thích"] = favoriteChannels;
    }

    // Regular groups
    channels.forEach(channel => {
        const groupName = channel.group || 'Khác';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(channel);
    });

    // Build DOM
    const fragment = document.createDocumentFragment();

    for (const groupName in groups) {
        const groupChannels = groups[groupName];
        if (groupChannels.length === 0) continue;

        const rowDiv = document.createElement('div');
        rowDiv.className = 'channel-row';

        const titleElement = document.createElement('h2');
        titleElement.className = 'row-title';
        titleElement.innerText = `${groupName} (${groupChannels.length})`;
        rowDiv.appendChild(titleElement);

        const scrollWrapper = document.createElement('div');
        scrollWrapper.className = 'channel-scroll-wrapper';

        for (let i = 0; i < groupChannels.length; i++) {
            const channel = groupChannels[i];
            const card = document.createElement('div');
            card.className = 'channel-card';
            card.tabIndex = 0;
            card.setAttribute('data-url', channel.url || '');
            card.setAttribute('data-group', groupName);

            if (playingUrl && channel.url === playingUrl) {
                card.classList.add('playing');
            }

            const logoHTML = buildLogoHTML(channel);
            const isFav = favoritesSet.has(channel.url);
            const favHTML = isFav ? '<span class="material-symbols-rounded" style="position:absolute;top:10px;right:10px;color:#f91942;z-index:10;font-size:18px;pointer-events:none;">favorite</span>' : '';
            const safeName = escapeHtml(channel.name);

            card.innerHTML = `
                ${favHTML}
                <div class="logo-container">${logoHTML}</div>
                <span class="channel-name" style="font-weight:700;color:#eee;font-size:14px;">${safeName}</span>
            `;

            const ch = channel;
            const gn = groupName;
            card.addEventListener('mouseenter', () => updateHeroBanner(ch, gn));
            card.addEventListener('focus', () => updateHeroBanner(ch, gn));
            card.addEventListener('click', () => playChannel(ch));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playChannel(ch);
                }
            });

            scrollWrapper.appendChild(card);
        }

        rowDiv.appendChild(scrollWrapper);
        fragment.appendChild(rowDiv);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
}

// ==================== HERO BANNER ====================
function updateHeroBanner(channel, category) {
    const heroTitle = document.getElementById('hero-title');
    const heroCategory = document.getElementById('hero-category');
    const btnWatch = document.getElementById('btn-watch-channel');
    const heroDesc = document.getElementById('hero-desc');
    const heroBackdrop = document.getElementById('hero-backdrop');

    if (heroTitle) heroTitle.innerText = channel.name;
    if (heroCategory) heroCategory.innerText = category.toUpperCase();

    if (heroBackdrop) {
        if (channel.logo && channel.logo.trim() !== "") {
            heroBackdrop.style.backgroundImage = `url('${channel.logo}')`;
            heroBackdrop.style.opacity = '0.3';
        } else {
            heroBackdrop.style.backgroundImage = 'none';
        }
    }

    let currentProgram = "Đang cập nhật lịch phát sóng...";
    if (channel.id && epgData[channel.id]) {
        const now = getCurrentEpgTime();
        const programs = epgData[channel.id];
        const playing = programs.find(p => now >= p.start && now <= p.stop);

        if (playing) {
            currentProgram = `Đang phát (${formatTime(playing.start)} - ${formatTime(playing.stop)}): ${playing.title}`;
            if (playing.desc) currentProgram += `\n${playing.desc}`;
        } else {
            if (programs.length > 0) {
                currentProgram = `Sắp chiếu (${formatTime(programs[0].start)}): ${programs[0].title}`;
                if (programs[0].desc) currentProgram += `\n${programs[0].desc}`;
            }
        }
    }

    if (heroDesc) heroDesc.innerText = currentProgram;

    if (btnWatch) {
        btnWatch.onclick = () => playChannel(channel);
    }

    const btnFav = document.getElementById('btn-favorite-channel');
    if (btnFav) {
        let favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];
        let isFav = favorites.includes(channel.url);

        if (isFav) {
            btnFav.innerHTML = '<span class="material-symbols-rounded">heart_broken</span> Bỏ Thích';
            btnFav.style.color = '#f91942';
            btnFav.style.borderColor = '#f91942';
        } else {
            btnFav.innerHTML = '<span class="material-symbols-rounded">favorite</span> Yêu Thích';
            btnFav.style.color = 'white';
            btnFav.style.borderColor = 'rgba(255,255,255,0.2)';
        }

        btnFav.onclick = () => {
            favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];
            if (favorites.includes(channel.url)) {
                favorites = favorites.filter(url => url !== channel.url);
            } else {
                favorites.push(channel.url);
            }
            localStorage.setItem('tv_favorites', JSON.stringify(favorites));

            applyFilters();
            updateHeroBanner(channel, category);
        };
    }
}

// ==================== QUICK SIDEBAR (OPTIMIZED) ====================
function populateQuickList() {
    const listContent = document.getElementById('quick-channel-list');
    if (!listContent) return;

    // Only rebuild DOM when channel list changed
    if (quickListDirty || listContent.children.length !== currentChannelList.length) {
        listContent.innerHTML = '';
        const fragment = document.createDocumentFragment();

        currentChannelList.forEach(channel => {
            const item = document.createElement('div');
            item.className = 'quick-channel-item';
            item.tabIndex = 0;
            item.setAttribute('data-url', channel.url);

            let logoHTML = '';
            if (channel.logo && channel.logo.trim() !== "") {
                logoHTML = `<img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'">`;
            } else {
                logoHTML = `<span class="material-symbols-rounded">tv</span>`;
            }

            item.innerHTML = `${logoHTML}<span>${escapeHtml(channel.name)}</span>`;

            item.onclick = () => {
                document.querySelectorAll('.quick-channel-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                playChannel(channel);
            };

            fragment.appendChild(item);
        });

        listContent.appendChild(fragment);
        quickListDirty = false;
    }

    // Update active state only
    listContent.querySelectorAll('.quick-channel-item').forEach(item => {
        const isActive = currentPlayingChannel && item.getAttribute('data-url') === currentPlayingChannel.url;
        item.classList.toggle('active', isActive);
        const existingBadge = item.querySelector('.playing-badge');
        if (isActive && !existingBadge) {
            const badge = document.createElement('span');
            badge.className = 'playing-badge';
            badge.style.cssText = 'margin-left:auto;font-size:10px;background:#00f2fe;color:#000;padding:3px 6px;border-radius:4px;font-weight:900;letter-spacing:1px;';
            badge.textContent = 'ĐANG XEM';
            item.appendChild(badge);
        } else if (!isActive && existingBadge) {
            existingBadge.remove();
        }
    });
}

// ==================== EPG ====================
function parseEPGTime(timeStr) {
    if (!timeStr || timeStr.length < 14) return 0;
    const y = +timeStr.slice(0, 4);
    const M = +timeStr.slice(4, 6) - 1;
    const d = +timeStr.slice(6, 8);
    const h = +timeStr.slice(8, 10);
    const m = +timeStr.slice(10, 12);
    const s = +timeStr.slice(12, 14);
    return new Date(y, M, d, h, m, s).getTime();
}

async function fetchAndParseEPG(url) {
    const epgCacheKey = 'epg_parsed';
    const cachedEpg = tvGetCached(epgCacheKey);
    if (cachedEpg) {
        epgData = cachedEpg;
        console.log("EPG loaded from cache!");
        return;
    }

    try {
        const text = await tvFetchWithCache('epg_raw', url, 2, 30000);

        let match;
        while ((match = EPG_BLOCK_REGEX.exec(text)) !== null) {
            const channelId = match[1];
            const start = parseEPGTime(match[2]);
            const stop = parseEPGTime(match[3]);
            const innerXml = match[4];

            const titleMatch = EPG_TITLE_REGEX.exec(innerXml);
            const descMatch = EPG_DESC_REGEX.exec(innerXml);

            const title = titleMatch ? titleMatch[1].trim() : "Không có tên";
            const desc = descMatch ? descMatch[1].trim() : "";

            if (!epgData[channelId]) {
                epgData[channelId] = [];
            }
            epgData[channelId].push({ start, stop, title, desc });
        }

        if (Object.keys(epgData).length > 0) {
            tvSetCache(epgCacheKey, epgData);
            console.log("Tải EPG thành công!");
        } else {
            console.warn("EPG: Không có dữ liệu lịch phát sóng khả dụng.");
        }
    } catch (error) {
        console.warn("EPG: Không thể tải lịch phát sóng (file không tồn tại hoặc lỗi mạng). Kênh vẫn hoạt động bình thường.");
    }
}