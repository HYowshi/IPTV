// ==================== SPATIAL NAVIGATION ====================
function initSpatialNavigation() {
    document.addEventListener('keydown', (e) => {
        const watchView = document.getElementById('watch-view');
        if (watchView && watchView.style.display === 'block') return;

        let key = e.key;
        if (!key || key === 'Unidentified') {
            if (e.keyCode === 38) key = 'ArrowUp';
            else if (e.keyCode === 40) key = 'ArrowDown';
            else if (e.keyCode === 37) key = 'ArrowLeft';
            else if (e.keyCode === 39) key = 'ArrowRight';
        }

        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (!arrowKeys.includes(key)) return;

        if (document.activeElement && document.activeElement.id === 'tv-search-input') {
            if (key === 'ArrowLeft' || key === 'ArrowRight') return;
            if (key === 'ArrowUp') {
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

            if (key === 'ArrowRight' && rect.left >= currentRect.right - 20) {
                isMatch = true;
                distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (key === 'ArrowLeft' && rect.right <= currentRect.left + 20) {
                isMatch = true;
                distance = Math.abs(dx) + Math.abs(dy) * 3;
            } else if (key === 'ArrowDown' && rect.top >= currentRect.bottom - 20) {
                isMatch = true;
                distance = Math.abs(dy) + Math.abs(dx) * 3;
            } else if (key === 'ArrowUp' && rect.bottom <= currentRect.top + 20) {
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