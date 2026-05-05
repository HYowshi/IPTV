let epgData = {};
let allChannels = [];
let currentChannelList = [];
let tvHlsInstance = null;
let currentPlayingChannel = null;
let tvDashInstance = null;
let osdTimer = null;

const REMOTE_DATA_SERVER = 'https://raw.githubusercontent.com/HYowshi/IPTV/main';

const M3U_FILES = [
    `${REMOTE_DATA_SERVER}/IPTV_Master.m3u`,
    `${REMOTE_DATA_SERVER}/Vietnam_HBO_Final.m3u`
];

document.addEventListener("DOMContentLoaded", () => {
    initUIEvents();
    initSpatialNavigation();
    fetchAndParseEPG(`${REMOTE_DATA_SERVER}/epg.xml`).then(() => {
        fetchAllM3UFiles(M3U_FILES);
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
        
        const ytPlayer = document.getElementById('yt-iframe-player');
        if (ytPlayer) {
            ytPlayer.src = "";
            ytPlayer.style.display = 'none';
        }
        
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
        
        if (tvHlsInstance) {
            tvHlsInstance.destroy();
            tvHlsInstance = null;
        }

        if (tvDashInstance) {
            tvDashInstance.destroy();
            tvDashInstance = null;
        }
        
        document.getElementById('tv-quality-selector').style.display = 'none';

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
            const ytPlayer = document.getElementById('yt-iframe-player');
            const isYt = ytPlayer && ytPlayer.style.display === 'block';
            
            if (isYt) {
                isPlaying = !isPlaying;
                const icon = btnPlayPause.querySelector('span');
                if (icon) {
                    icon.innerText = isPlaying ? 'pause' : 'play_arrow';
                }
                const action = isPlaying ? 'playVideo' : 'pauseVideo';
                ytPlayer.contentWindow.postMessage(JSON.stringify({event: 'command', func: action, args: []}), '*');
            } else {
                if (videoPlayer.paused) {
                    videoPlayer.play().catch(()=>{});
                } else {
                    videoPlayer.pause();
                }
            }
        });
    }

    videoPlayer.addEventListener('play', () => {
        isPlaying = true;
        if (btnPlayPause) {
            const icon = btnPlayPause.querySelector('span');
            if (icon) {
                icon.innerText = 'pause';
            }
        }
    });

    videoPlayer.addEventListener('pause', () => {
        isPlaying = false;
        if (btnPlayPause) {
            const icon = btnPlayPause.querySelector('span');
            if (icon) {
                icon.innerText = 'play_arrow';
            }
        }
    });

    videoPlayer.addEventListener('waiting', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'flex';
    });

    videoPlayer.addEventListener('playing', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
    });

    videoPlayer.addEventListener('error', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
    });

    videoPlayer.addEventListener('stalled', () => {
        const tvLoader = document.getElementById('tv-loader');
        if (tvLoader) tvLoader.style.display = 'none';
    });

    const updateVolumeUI = (vol) => {
        if (!btnMute) return;
        const icon = btnMute.querySelector('span');
        if (icon) {
            if (vol === 0) icon.innerText = 'volume_off';
            else if (vol < 0.5) icon.innerText = 'volume_down';
            else icon.innerText = 'volume_up';
        }
    };

    if (volumeSlider) {
        volumeSlider.style.background = `linear-gradient(to right, #00f2fe ${volumeSlider.value * 100}%, rgba(255,255,255,0.3) ${volumeSlider.value * 100}%)`;
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value);
            videoPlayer.volume = vol;
            e.target.style.background = `linear-gradient(to right, #00f2fe ${vol * 100}%, rgba(255,255,255,0.3) ${vol * 100}%)`;
            updateVolumeUI(vol);
            const ytPlayer = document.getElementById('yt-iframe-player');
            if (ytPlayer && ytPlayer.style.display === 'block') {
                ytPlayer.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'setVolume', args: [vol * 100]}), '*');
            }
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
            
            const ytPlayer = document.getElementById('yt-iframe-player');
            if (ytPlayer && ytPlayer.style.display === 'block') {
                if (videoPlayer.volume === 0) {
                    ytPlayer.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'mute', args: []}), '*');
                } else {
                    ytPlayer.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'unMute', args: []}), '*');
                    ytPlayer.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'setVolume', args: [videoPlayer.volume * 100]}), '*');
                }
            }
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
    }

    const searchContainer = document.getElementById('tv-search-container');
    const searchInput = document.getElementById('tv-search-input');
    let searchTimer;
    
    if (searchContainer && searchInput) {
        searchContainer.addEventListener('click', () => {
            searchInput.focus();
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                const keyword = normalizeChannelName(e.target.value);
                if (keyword === "") {
                    renderChannels(allChannels);
                } else {
                    const filtered = allChannels.filter(c => normalizeChannelName(c.name).includes(keyword));
                    renderChannels(filtered);
                }
            }, 500);
        });
    }

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
                            const activeItem = document.querySelector(`.quick-channel-item[data-url="${currentPlayingChannel.url}"]`);
                            if (activeItem) {
                                activeItem.focus();
                                activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            } else {
                                const firstItem = document.querySelector('.quick-channel-item');
                                if (firstItem) firstItem.focus();
                            }
                        }, 100);
                    }
                } else if (e.code === 'Space' || e.key === 'Enter') {
                    e.preventDefault();
                    if (videoPlayer.paused) videoPlayer.play().catch(()=>{});
                    else videoPlayer.pause();
                }
            }
        }
    });
    
    startClock();
}

function populateQuickList() {
    const listContent = document.getElementById('quick-channel-list');
    if (!listContent) return;
    listContent.innerHTML = '';
    
    currentChannelList.forEach(channel => {
        const item = document.createElement('div');
        item.className = 'quick-channel-item';
        
        let isActive = false;
        if (currentPlayingChannel && currentPlayingChannel.url === channel.url) {
            item.classList.add('active');
            isActive = true;
        }
        
        item.tabIndex = 0;
        item.setAttribute('data-url', channel.url);
        
        let logoHTML = '';
        if (channel.logo && channel.logo.trim() !== "") {
            logoHTML = `<img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'">`;
        } else {
            logoHTML = `<span class="material-symbols-rounded">tv</span>`;
        }
        
        let playingBadge = isActive ? `<span style="margin-left: auto; font-size: 10px; background: #00f2fe; color: #000; padding: 3px 6px; border-radius: 4px; font-weight: 900; letter-spacing: 1px;">ĐANG XEM</span>` : '';
        
        item.innerHTML = `${logoHTML}<span>${channel.name}</span>${playingBadge}`;
        
        item.onclick = () => {
            document.querySelectorAll('.quick-channel-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            playChannel(channel);
        };
        
        listContent.appendChild(item);
    });
}

function startClock() {
    const clockEl = document.getElementById('tv-clock');
    if (!clockEl) return;
    
    const updateTime = () => {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        clockEl.innerText = `${hours}:${minutes}`;
    };
    
    updateTime();
    setInterval(updateTime, 1000);
}

function normalizeChannelName(name) {
    let clean = name.toLowerCase();
    
    clean = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    clean = clean.replace(/đ/g, "d");
    clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');
    
    const noiseWords = [
        'hd', 'fhd', 'uhd', '4k', 'sd', '1080p', '720p', '1080i', '50fps', '60fps', 
        'hevc', 'h264', 'h265', 'vip', 'premium', 'vietsub', 'thuyet minh', 'raw',
        'bao va ptth', 'bao', 'ptth', 'channel', 'tv', 'truyen hinh'
    ];
    
    const regex = new RegExp('\\b(' + noiseWords.join('|') + ')\\b', 'g');
    clean = clean.replace(regex, '');
    clean = clean.replace(/[^a-z0-9]/g, '');
    
    return clean;
}

async function fetchAllM3UFiles(urls) {
    const container = document.getElementById('channels-container');
    container.innerHTML = "<div style='color: white; text-align: center; padding: 20px;'>Đang tải tổng hợp danh sách kênh...</div>";
    
    let combinedRawData = "";
    
    try {
        // Tải tất cả các tệp cùng lúc (Bất đồng bộ)
        const fetchPromises = urls.map(url => fetch(url).then(res => {
            if(res.ok) return res.text();
            return "";
        }).catch(() => ""));
        
        const results = await Promise.all(fetchPromises);
        
        results.forEach(data => {
            if (data) combinedRawData += "\n" + data;
        });
        
        const parsedChannels = parseM3U(combinedRawData);
        const uniqueChannelsMap = new Map();
        
        // Lọc trùng lặp: Nếu tên kênh đã tồn tại trong Map, nó sẽ bỏ qua để ưu tiên kênh nạp vào trước
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
    const lines = data.split(/\r?\n/);
    const channels = [];
    let currentChannel = {};

    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            const groupMatch = line.match(/group-title="([^"]+)"/);
            currentChannel.group = groupMatch ? groupMatch[1] : "Khác";

            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            currentChannel.logo = logoMatch ? logoMatch[1] : "";
            
            const idMatch = line.match(/tvg-id="([^"]*)"/);
            currentChannel.id = idMatch ? idMatch[1] : "";

            const nameParts = line.split(',');
            currentChannel.name = nameParts.length > 1 ? nameParts[1].trim() : "Kênh không tên";
        } else if (line.startsWith('#EXTGRP:')) {
            currentChannel.group = line.replace('#EXTGRP:', '').trim();
        } else if (line.startsWith('http') || line.startsWith('rtmp') || line.startsWith('rtsp') || line.startsWith('mms')) {
            currentChannel.url = line;
            if (!currentChannel.group) currentChannel.group = "Khác";
            channels.push({ ...currentChannel });
            currentChannel = {}; 
        }
    });
    return channels;
}

function renderChannels(channels) {
    currentChannelList = channels;
    const container = document.getElementById('channels-container');
    container.innerHTML = '';

    if (channels.length === 0) {
        container.innerHTML = '<div style="color: #aaa; text-align: center; padding: 50px 20px; width: 100%; font-size: 18px;">Không tìm thấy kênh phù hợp.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    
    let favorites = JSON.parse(localStorage.getItem('tv_favorites')) || [];

    const groups = {};
    
    let favoriteChannels = channels.filter(c => favorites.includes(c.url));
    if (favoriteChannels.length > 0) {
        groups["Kênh Yêu Thích"] = favoriteChannels;
    }
    
    channels.forEach(channel => {
        if (!groups[channel.group]) {
            groups[channel.group] = [];
        }
        groups[channel.group].push(channel);
    });

    for (const groupName in groups) {
        const groupChannels = groups[groupName];

        const rowDiv = document.createElement('div');
        rowDiv.className = 'channel-row';

        const titleElement = document.createElement('h2');
        titleElement.className = 'row-title';
        titleElement.innerText = groupName;
        rowDiv.appendChild(titleElement);

        const scrollWrapper = document.createElement('div');
        scrollWrapper.className = 'channel-scroll-wrapper';

        groupChannels.forEach(channel => {
            const card = document.createElement('div');
            card.className = 'channel-card';
            
            card.tabIndex = 0; 
            
            card.onmouseenter = () => updateHeroBanner(channel, groupName);
            card.onfocus = () => updateHeroBanner(channel, groupName);

            card.onclick = () => playChannel(channel);
            card.onkeydown = (e) => { if(e.key === 'Enter') playChannel(channel); };

            let logoHTML = '';
            if (channel.logo && channel.logo.trim() !== "") {
                logoHTML = `<img src="${channel.logo}" alt="${channel.name}" loading="lazy" style="width: 60px; height: 60px; object-fit: contain; z-index: 2;" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=141414&color=fff'">`;
            } else {
                logoHTML = `<span class="material-symbols-rounded channel-logo" style="font-size: 32px;">tv</span>`;
            }

            let favIcon = favorites.includes(channel.url) ? '<span class="material-symbols-rounded" style="position: absolute; top: 10px; right: 10px; color: #f91942; z-index: 10; font-size: 18px; text-shadow: 0 2px 5px rgba(0,0,0,0.8);">favorite</span>' : '';

            card.setAttribute('data-url', channel.url);
            card.innerHTML = `
                ${favIcon}
                <div class="logo-container">
                    ${logoHTML}
                </div>
                <span class="channel-name" style="font-weight: 700; color: #eee; font-size: 14px;">${channel.name}</span>
            `;
            scrollWrapper.appendChild(card);
        });

        rowDiv.appendChild(scrollWrapper);
        fragment.appendChild(rowDiv);
    }
    
    container.appendChild(fragment);
}

function formatTime(ms) {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getCurrentEpgTime() {
    return Date.now();
}

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
    
    if (heroDesc) {
        heroDesc.innerText = currentProgram;
    }

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
            
            const searchInput = document.getElementById('tv-search-input');
            const keyword = searchInput ? searchInput.value.toLowerCase().trim() : "";
            if (keyword === "") {
                renderChannels(allChannels);
            } else {
                const filtered = allChannels.filter(c => c.name.toLowerCase().includes(keyword));
                renderChannels(filtered);
            }
            
            updateHeroBanner(channel, category);
        };
    }
}

function playChannel(channel) {
    currentPlayingChannel = channel;
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

    document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('playing'));
    const activeCard = document.querySelector(`.channel-card[data-url="${channel.url}"]`);
    if (activeCard) activeCard.classList.add('playing');

    if (osd && osdLogo && osdName && osdNow) {
        osdLogo.onerror = function() {
            this.onerror = null;
            this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(channel.name) + '&background=141414&color=fff';
        };
        osdLogo.src = channel.logo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(channel.name) + '&background=141414&color=fff';
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

    let streamUrl = channel.url;
    
    let ytPlayer = document.getElementById('yt-iframe-player');
    if (!ytPlayer) {
        ytPlayer = document.createElement('iframe');
        ytPlayer.id = 'yt-iframe-player';
        ytPlayer.style.width = '100%';
        ytPlayer.style.height = '100%';
        ytPlayer.style.border = 'none';
        ytPlayer.style.position = 'absolute';
        ytPlayer.style.top = '0';
        ytPlayer.style.left = '0';
        ytPlayer.style.zIndex = '1';
        ytPlayer.allow = "autoplay; encrypted-media";
        videoPlayer.parentNode.appendChild(ytPlayer);
    }

    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();

    if (tvHlsInstance) {
        if (typeof tvHlsInstance.stopLoad === 'function') tvHlsInstance.stopLoad();
        tvHlsInstance.destroy();
        tvHlsInstance = null;
    }
    if (tvDashInstance) {
        tvDashInstance.destroy();
        tvDashInstance = null;
    }

    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const ytMatch = streamUrl.match(ytRegex);

    if (ytMatch && ytMatch[1]) {
        videoPlayer.style.display = 'none';
        ytPlayer.style.pointerEvents = 'none';
        ytPlayer.style.display = 'block';
        ytPlayer.onload = () => {
            if (tvLoader) tvLoader.style.display = 'none';
        };
        ytPlayer.src = `https://www.youtube.com/embed/${ytMatch[1]}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1`;
        const btnPlayPause = document.getElementById('btn-play-pause');
        if (btnPlayPause) {
            const icon = btnPlayPause.querySelector('span');
            if (icon) icon.innerText = 'pause';
        }
        return; 
    } else {
        ytPlayer.style.display = 'none';
        ytPlayer.src = '';
        videoPlayer.style.display = 'block';
    }

    if (streamUrl.startsWith("http://") && (!window.__TAURI__ || !Hls.isSupported())) {
        streamUrl = streamUrl.replace("http://", "https://");
    }
    
    qualitySelector.style.display = 'none';
    qualitySelector.innerHTML = '<option value="-1" style="background: #111;">Tự động</option>';

    if (streamUrl.includes('.mpd')) {
        if (typeof dashjs !== 'undefined') {
            tvDashInstance = dashjs.MediaPlayer().create();
            
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
                    console.error("Lỗi tải luồng mạng DASH:", e);
                    alert("Không thể tải kênh này do máy chủ nguồn từ chối kết nối hoặc đường truyền bị đứt.");
                    tvDashInstance.destroy();
                    tvDashInstance = null;
                }
            });
        } else {
             alert("Trình duyệt không hỗ trợ phát định dạng DASH.");
             if (tvLoader) tvLoader.style.display = 'none';
        }
    } else {
        if (Hls.isSupported()) {
            tvHlsInstance = new Hls({
                xhrSetup: function(xhr, url) {
                    xhr.withCredentials = false;
                },
                liveSyncDurationCount: 3,
                liveMaxLatencyDurationCount: 10,
                enableWorker: true,
                lowLatencyMode: true
            });
            const proxiedUrl = `http://127.0.0.1:1420/proxy?url=${encodeURIComponent(streamUrl)}`;
            tvHlsInstance.loadSource(proxiedUrl);
            tvHlsInstance.attachMedia(videoPlayer); 
            
            tvHlsInstance.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                const levels = data.levels;
                if (levels && levels.length > 1) {
                    levels.forEach((level, index) => {
                        const option = document.createElement('option');
                        option.value = index;
                        option.style.background = '#111';
                        option.innerText = level.height ? `${level.height}p` : `Chất lượng ${index + 1}`;
                        qualitySelector.appendChild(option);
                    });
                    qualitySelector.style.display = 'block';
                    
                    qualitySelector.onchange = (e) => {
                        tvHlsInstance.currentLevel = parseInt(e.target.value);
                    };
                }
                if (tvLoader) tvLoader.style.display = 'none';
                videoPlayer.play().catch(()=>{}); 
            });
            
            tvHlsInstance.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            tvHlsInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            tvHlsInstance.recoverMediaError();
                            break;
                        default:
                            if (tvLoader) tvLoader.style.display = 'none';
                            tvHlsInstance.destroy();
                            break;
                    }
                }
            });
            
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = streamUrl; 
            videoPlayer.onloadedmetadata = () => {
                if (tvLoader) tvLoader.style.display = 'none';
                videoPlayer.play().catch(()=>{});
            };
        }
    }
}

function initSpatialNavigation() {
    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        if (watchView && watchView.style.display === 'block') return;

        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (!arrowKeys.includes(e.key)) return;

        if (document.activeElement && document.activeElement.id === 'tv-search-input') {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                return;
            }
        }

        const focusables = Array.from(document.querySelectorAll('.switch-item, .btn-exit-header, .btn-watch, .channel-card, #tv-search-input'));
        const currentFocus = document.activeElement;

        if (!currentFocus || !focusables.includes(currentFocus)) {
            e.preventDefault();
            const startElement = document.querySelector('.switch-item.active') || focusables[0];
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
            
            let isMatch = false;
            let distance = Infinity;
            
            const dx = (rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2);
            const dy = (rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2);

            if (e.key === 'ArrowRight' && rect.left >= currentRect.right - 20) {
                isMatch = true;
                distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (e.key === 'ArrowLeft' && rect.right <= currentRect.left + 20) {
                isMatch = true;
                distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (e.key === 'ArrowDown' && rect.top >= currentRect.bottom - 20) {
                isMatch = true;
                distance = Math.abs(dy) + Math.abs(dx) * 3;
            } else if (e.key === 'ArrowUp' && rect.bottom <= currentRect.top + 20) {
                isMatch = true;
                distance = Math.abs(dy) + Math.abs(dx) * 3;
            }

            if (isMatch && distance < minDistance) {
                minDistance = distance;
                bestMatch = el;
            }
        });

        if (bestMatch) {
            bestMatch.focus();
            bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    });
}

function parseEPGTime(timeStr) {
    if (!timeStr) return 0;
    const y = timeStr.slice(0, 4);
    const M = timeStr.slice(4, 6) - 1;
    const d = timeStr.slice(6, 8);
    const h = timeStr.slice(8, 10);
    const m = timeStr.slice(10, 12);
    const s = timeStr.slice(12, 14);
    return new Date(y, M, d, h, m, s).getTime();
}

async function fetchAndParseEPG(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();

        const blockRegex = /<programme channel="([^"]+)"[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*>(.*?)<\/programme>/gs;
        const titleRegex = /<title[^>]*>([^<]*)<\/title>/;
        const descRegex = /<desc[^>]*>([^<]*)<\/desc>/;

        let match;
        while ((match = blockRegex.exec(text)) !== null) {
            const channelId = match[1];
            const start = parseEPGTime(match[2]);
            const stop = parseEPGTime(match[3]);
            const innerXml = match[4];

            const titleMatch = titleRegex.exec(innerXml);
            const descMatch = descRegex.exec(innerXml);

            const title = titleMatch ? titleMatch[1].trim() : "Không có tên";
            const desc = descMatch ? descMatch[1].trim() : "";

            if (!epgData[channelId]) {
                epgData[channelId] = [];
            }
            epgData[channelId].push({ start, stop, title, desc });
        }
        console.log("Tải EPG thành công!");
    } catch (error) {
        console.error("Lỗi khi tải epg.xml:", error);
    }
}