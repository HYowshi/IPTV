document.addEventListener("DOMContentLoaded", () => {
    let isNavigating = false;
    let isModalOpen = true;

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

    if (entryBoxes.length > 0 && !isModalOpen) {
        if (!document.activeElement || document.activeElement === document.body) {
            entryBoxes[0]?.focus();
        }
    }

    const modalOverlay = document.getElementById('disclaimer-modal');
    const btnAccept = document.getElementById('btn-accept-disclaimer');

    if (modalOverlay && btnAccept) {
        btnAccept.focus();

        safeAddListener(btnAccept, 'click', (e) => {
            e.preventDefault();
            modalOverlay.classList.add('hidden');
            isModalOpen = false;
            
            setTimeout(() => {
                modalOverlay.style.display = 'none';
                if (entryBoxes.length > 0) {
                    entryBoxes[0]?.focus();
                }
            }, 500);
        });
    }
});