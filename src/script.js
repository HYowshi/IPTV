document.addEventListener("DOMContentLoaded", () => {
    let isNavigating = false;
    let isModalOpen = true;
    let idleTime = 0;
    let particleInterval = null;
    let currentSeasonEffect = -1;

    // Greeting based on time of day with animated text
    const greetingEl = document.getElementById('greeting-text');
    if (greetingEl) {
        const hour = new Date().getHours();
        let greeting;
        if (hour >= 5 && hour < 12) greeting = 'Chào buổi sáng ☀️';
        else if (hour >= 12 && hour < 18) greeting = 'Chào buổi chiều 🌤️';
        else if (hour >= 18 && hour < 22) greeting = 'Chào buổi tối 🌙';
        else greeting = 'Khuya rồi, nghỉ ngơi sớm nhé 🌌';
        const fullText = greeting + ' — Chọn nền tảng để bắt đầu';
        
        // Typewriter effect
        greetingEl.textContent = '';
        greetingEl.style.borderRight = '2px solid rgba(255,255,255,0.4)';
        let charIndex = 0;
        const typeInterval = setInterval(() => {
            if (charIndex < fullText.length) {
                greetingEl.textContent += fullText[charIndex];
                charIndex++;
            } else {
                clearInterval(typeInterval);
                // Blink cursor then remove
                setTimeout(() => {
                    greetingEl.style.borderRight = 'none';
                }, 1500);
            }
        }, 35);
    }

    const getBaseSeason = () => {
        const m = new Date().getMonth();
        if (m >= 0 && m <= 2) return 0;
        if (m >= 3 && m <= 5) return 1;
        if (m >= 6 && m <= 8) return 2;
        return 3;
    };

    const seasonsMap = ['spring', 'summer', 'autumn', 'winter'];

    setInterval(() => {
        if (isNavigating) return;
        idleTime++;

        let targetSeasonLevel = -1;
        if (idleTime >= 240) targetSeasonLevel = 3;
        else if (idleTime >= 180) targetSeasonLevel = 2;
        else if (idleTime >= 120) targetSeasonLevel = 1;
        else if (idleTime >= 60) targetSeasonLevel = 0;

        if (targetSeasonLevel !== -1 && targetSeasonLevel !== currentSeasonEffect) {
            currentSeasonEffect = targetSeasonLevel;
            const baseSeason = getBaseSeason();
            const activeSeason = seasonsMap[(baseSeason + targetSeasonLevel) % 4];
            
            const container = document.getElementById('easter-egg-container');
            if (!container) return;
            container.innerHTML = '';
            if (particleInterval) clearInterval(particleInterval);

            const MAX_PARTICLES = 40;
            const seasonVariants = {
                spring: ['petal-pink', 'petal-white', 'petal-light'],
                summer: ['firefly-yellow', 'firefly-green', 'firefly-white'],
                autumn: ['leaf-orange', 'leaf-red', 'leaf-gold', 'leaf-brown'],
                winter: ['snow-white', 'snow-sparkle', 'snow-small']
            };

            particleInterval = setInterval(() => {
                const currentParticles = container.childElementCount;
                if (currentParticles >= MAX_PARTICLES) return;

                const el = document.createElement('div');
                const variants = seasonVariants[activeSeason];
                const variant = variants[Math.floor(Math.random() * variants.length)];

                el.classList.add('particle', `particle-${activeSeason}`, variant);

                if (activeSeason === 'summer') {
                    el.style.left = (Math.random() * 80 + 10) + '%';
                    el.style.bottom = (Math.random() * 20) + '%';
                } else {
                    el.style.left = Math.random() * 100 + 'vw';
                }

                if (activeSeason === 'spring') {
                    const size = Math.random() * 12 + 10;
                    el.style.width = size + 'px';
                    el.style.height = (size * 0.7) + 'px';
                    el.style.animationDuration = (Math.random() * 4 + 5) + 's';
                } else if (activeSeason === 'summer') {
                    const size = Math.random() * 6 + 4;
                    el.style.width = el.style.height = size + 'px';
                    el.style.animationDuration = (Math.random() * 5 + 5) + 's';
                } else if (activeSeason === 'autumn') {
                    const size = Math.random() * 12 + 10;
                    el.style.width = (size * 1.3) + 'px';
                    el.style.height = (size * 0.8) + 'px';
                    el.style.animationDuration = (Math.random() * 4 + 5) + 's';
                } else {
                    const size = Math.random() * 6 + 3;
                    el.style.width = el.style.height = size + 'px';
                    el.style.animationDuration = (Math.random() * 5 + 6) + 's';
                }

                container.appendChild(el);
                const duration = parseFloat(el.style.animationDuration) * 1000;
                setTimeout(() => {
                    if (el.parentNode) el.remove();
                }, duration + 500);
            }, activeSeason === 'summer' ? 500 : 250);
        }
    }, 1000);

    const safeAddListener = (element, event, handler) => {
        if (element) {
            element.addEventListener(event, handler);
        }
    };

    const exitTauriApp = async () => {
        if (isNavigating) return;
        try {
            if (window.__TAURI__) {
                await window.__TAURI__.core.invoke('exit_app');
            } else {
                alert("Bạn đang chạy trên trình duyệt web, không thể thoát app.");
            }
        } catch (error) {
            console.error("Lỗi khi gọi lệnh thoát app:", error);
        }
    };

    const btnExitMain = document.getElementById('btn-exit-main');
    safeAddListener(btnExitMain, 'click', (e) => {
        e.preventDefault();
        exitTauriApp();
    });

    const entryBoxes = Array.from(document.querySelectorAll('.entry-box'));

    document.addEventListener('keydown', (e) => {
        if (isNavigating) return;

        if (isModalOpen) {
            if (e.key === 'Escape') {
                e.preventDefault();
                exitTauriApp();
            }
            return; 
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            exitTauriApp();
            return;
        }

        if (entryBoxes.length === 0) return;
        
        const activeEl = document.activeElement;
        const activeIndex = entryBoxes.findIndex(box => box.contains(activeEl));
        const total = entryBoxes.length;
        
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % total : 0;
            entryBoxes[nextIndex].focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = activeIndex >= 0 ? (activeIndex - 1 + total) % total : total - 1;
            entryBoxes[prevIndex].focus();
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            entryBoxes[activeIndex].click();
        }
    });

    entryBoxes.forEach(box => {
        let isTicking = false;
        let cachedRect = null;

        safeAddListener(box, 'click', (e) => {
            e.preventDefault();
            if (isNavigating) return;
            isNavigating = true;
            box.dataset.loading = 'true';
            document.body.classList.add('is-navigating');
            
            const targetUrl = box.getAttribute('href');
            document.body.classList.add('fade-out');
            
            const onTransitionEnd = (event) => {
                if (event.propertyName === 'opacity' && event.target === document.body) {
                    document.body.removeEventListener('transitionend', onTransitionEnd);
                    window.location.href = targetUrl;
                }
            };

            document.body.addEventListener('transitionend', onTransitionEnd);
        });

        safeAddListener(box, 'mouseenter', () => {
            if (isNavigating) return;
            box.focus();
            cachedRect = box.getBoundingClientRect();
            box.style.transition = 'none'; 
            box.style.willChange = 'transform';
        });

        safeAddListener(box, 'mousemove', (e) => {
            if (isNavigating || !cachedRect) return;
            if (!isTicking) {
                window.requestAnimationFrame(() => {
                    if (!cachedRect) {
                        isTicking = false;
                        return;
                    }
                    const x = e.clientX - cachedRect.left;
                    const y = e.clientY - cachedRect.top;
                    
                    const centerX = cachedRect.width / 2;
                    const centerY = cachedRect.height / 2;
                    
                    const rotateX = ((y - centerY) / centerY) * -8;
                    const rotateY = ((x - centerX) / centerX) * 8;
                    
                    box.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
                    
                    box.style.setProperty('--mouse-x', `${x}px`);
                    box.style.setProperty('--mouse-y', `${y}px`);
                    
                    isTicking = false;
                });
                isTicking = true;
            }
        });

        safeAddListener(box, 'mouseleave', () => {
            if (isNavigating) return;
            cachedRect = null;
            
            if (document.activeElement === box) {
                box.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1.05, 1.05, 1.05)`;
            } else {
                box.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
            }
            
            box.style.transition = `transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)`;

            setTimeout(() => {
                if (!box.matches(':hover') && document.activeElement !== box) {
                    box.style.willChange = 'auto';
                }
            }, 500);
        });

        safeAddListener(box, 'focus', () => {
            if (isNavigating) return;
            box.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1.05, 1.05, 1.05)`;
            box.style.transition = `transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)`;
            box.style.boxShadow = `0 30px 60px rgba(0, 0, 0, 0.6)`;
        });

        safeAddListener(box, 'blur', () => {
            if (isNavigating) return;
            box.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
            box.style.transition = `transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)`;
            box.style.boxShadow = `0 20px 40px rgba(0, 0, 0, 0.5)`;
        });
        
        window.addEventListener('resize', () => {
            if (box.matches(':hover')) {
                cachedRect = box.getBoundingClientRect();
            }
        });
    });

    const modalOverlay = document.getElementById('disclaimer-modal');
    const btnAccept = document.getElementById('btn-accept-disclaimer');
    const btnDecline = document.getElementById('btn-decline-disclaimer');
    const disclaimerCheckbox = document.getElementById('disclaimer-checkbox');
    const btnAcceptTimer = document.getElementById('btn-accept-timer');

    // Check if disclaimer already accepted
    if (localStorage.getItem('phimtv_disclaimer_accepted') === 'true') {
        isModalOpen = false;
        if (modalOverlay) {
            modalOverlay.style.display = 'none';
        }
    }

    if (entryBoxes.length > 0 && !isModalOpen) {
        if (!document.activeElement || document.activeElement === document.body) {
            entryBoxes[0]?.focus();
        }
    }

    if (modalOverlay && btnAccept && isModalOpen) {
        // Countdown timer logic
        let countdown = 5;
        const updateAcceptButton = () => {
            const checked = disclaimerCheckbox && disclaimerCheckbox.checked;
            if (countdown > 0) {
                btnAccept.disabled = true;
                if (btnAcceptTimer) btnAcceptTimer.textContent = `(${countdown}s)`;
            } else if (!checked) {
                btnAccept.disabled = true;
                if (btnAcceptTimer) btnAcceptTimer.textContent = '';
            } else {
                btnAccept.disabled = false;
                if (btnAcceptTimer) btnAcceptTimer.textContent = '';
            }
        };

        // Start countdown
        updateAcceptButton();
        const countdownInterval = setInterval(() => {
            countdown--;
            updateAcceptButton();
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                updateAcceptButton();
            }
        }, 1000);

        // Checkbox change handler
        if (disclaimerCheckbox) {
            disclaimerCheckbox.addEventListener('change', updateAcceptButton);
        }

        // Focus the checkbox first (user needs to read and check)
        if (disclaimerCheckbox) {
            disclaimerCheckbox.focus();
        }

        if (btnDecline) {
            safeAddListener(btnDecline, 'click', (e) => {
                e.preventDefault();
                exitTauriApp();
            });
        }

        safeAddListener(btnAccept, 'click', (e) => {
            e.preventDefault();
            if (btnAccept.disabled) return;

            // Audit trail: store acceptance time
            localStorage.setItem('phimtv_disclaimer_accepted', 'true');
            localStorage.setItem('phimtv_disclaimer_time', new Date().toISOString());

            modalOverlay.classList.add('hidden');
            isModalOpen = false;
            
            setTimeout(() => {
                modalOverlay.style.display = 'none';
                if (entryBoxes.length > 0) {
                    entryBoxes[0]?.focus();
                }
            }, 500);
        });

        // Enter key on checkbox to accept when ready
        if (disclaimerCheckbox) {
            disclaimerCheckbox.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !btnAccept.disabled) {
                    btnAccept.click();
                }
            });
        }
    }

    // Ripple effect on entry boxes
    entryBoxes.forEach(box => {
        safeAddListener(box, 'click', (e) => {
            const ripple = document.createElement('span');
            ripple.className = 'ripple-effect';
            const rect = box.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
            box.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    });

    // Pre-fetch on hover for faster navigation
    entryBoxes.forEach(box => {
        let prefetched = false;
        safeAddListener(box, 'mouseenter', () => {
            if (prefetched || isNavigating) return;
            const href = box.getAttribute('href');
            if (href && href !== '#') {
                const link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = href;
                document.head.appendChild(link);
                prefetched = true;
            }
        });
    });
});