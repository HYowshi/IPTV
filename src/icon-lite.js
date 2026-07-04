(() => {
    const shouldUseInlineIcons = () => {
        const platform = typeof Platform !== 'undefined' ? Platform.current : null;
        return !!(platform?.isAndroid || platform?.isLowMemory || (navigator.deviceMemory && navigator.deviceMemory <= 2));
    };

    const ICONS = {
        add_circle: '+',
        animation: '*',
        arrow_back: '<',
        casino: '?',
        category: '#',
        check_circle: '✓',
        check: '✓',
        chevron_left: '<',
        chevron_right: '>',
        cloud_off: '!',
        content_copy: '⧉',
        expand_more: '⌄',
        fiber_manual_record: '•',
        favorite: '♥',
        fullscreen: '□',
        fullscreen_exit: '□',
        group: '●',
        groups: '●',
        heart_broken: '♡',
        home: '⌂',
        info: 'i',
        live_tv: '▣',
        local_offer: '#',
        local_fire_department: '★',
        logout: '×',
        mic: '♪',
        movie: '▶',
        movie_creation: '▣',
        open_in_full: '□',
        picture_in_picture_alt: '▣',
        pip: '▣',
        play_arrow: '▶',
        play_circle: '▶',
        playlist_play: '≡',
        power_settings_new: '⏻',
        public: '◎',
        recommend: '★',
        record_voice_over: '♪',
        refresh: '↻',
        schedule: '◷',
        search: '⌕',
        settings: '⚙',
        skip_next: '»',
        skip_previous: '«',
        star: '★',
        subtitles: '▤',
        theaters: '▶',
        tv: '▣',
        view_list: '≡',
        volume_down: '♪',
        volume_mute: '♪',
        volume_off: '×',
        volume_up: '♪',
        warning: '!',
    };

    const replaceIcon = (el) => {
        if (!el || el.dataset.iconLiteDone === '1') return;
        const name = (el.textContent || '').trim();
        if (!name) return;
        el.textContent = ICONS[name] || '';
        el.classList.remove('material-symbols-rounded');
        el.classList.add('icon-inline');
        el.setAttribute('aria-hidden', 'true');
        el.dataset.iconLiteDone = '1';
    };

    const replaceAll = (root = document) => {
        if (!shouldUseInlineIcons()) return;
        root.querySelectorAll?.('.material-symbols-rounded').forEach(replaceIcon);
    };

    document.addEventListener('DOMContentLoaded', () => {
        replaceAll();
        if (!shouldUseInlineIcons() || !('MutationObserver' in window)) return;
        new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (node.classList?.contains('material-symbols-rounded')) replaceIcon(node);
                    replaceAll(node);
                });
            });
        }).observe(document.body, { childList: true, subtree: true });
    });
})();
