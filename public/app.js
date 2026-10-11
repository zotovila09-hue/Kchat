let socket;
let currentUser = null;
let activeChat = null; 
const chats = {}; 
const knownUsers = {}; 

let pinnedChats = JSON.parse(localStorage.getItem('pinnedChats') || '[]');
let mutedChats = JSON.parse(localStorage.getItem('mutedChats') || '[]');
let unreadCounts = {}; 
let typingTimer;

let replyingToMsg = null;
let editingMsgId = null;

let mediaRecorder;
let audioChunks = [];
let pendingAttachment = null; 

let currentFolderId = 'all';
let activePinIndexes = {};

let tempLoginKId = null;
let tempLoginPass = null;
let sessionToken = localStorage.getItem('knx_session_token') || null;

const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    if (sessionToken && typeof url === 'string' && url.startsWith('/api/')) {
        options = options || {};
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            if (!options.headers.has('Authorization')) {
                options.headers.set('Authorization', `Bearer ${sessionToken}`);
            }
            if (!options.headers.has('x-session-token')) {
                options.headers.set('x-session-token', sessionToken);
            }
        } else {
            if (!options.headers['Authorization']) {
                options.headers['Authorization'] = `Bearer ${sessionToken}`;
            }
            if (!options.headers['x-session-token']) {
                options.headers['x-session-token'] = sessionToken;
            }
        }
    }
    return originalFetch.call(this, url, options);
};

function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
        headers['x-session-token'] = sessionToken;
    }
    return headers;
}

const SVG_TICK_SINGLE = `<svg class="tick" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`;
const SVG_TICK_DOUBLE = `<svg class="tick" viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/></svg>`;

let _scrollToBottomRaf = null;
window.scrollToBottom = function(force = false) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    if (!force) {
        const isNearBottom = (container.scrollHeight - container.scrollTop <= container.clientHeight + 120);
        if (!isNearBottom) return;
    }
    if (_scrollToBottomRaf) cancelAnimationFrame(_scrollToBottomRaf);
    _scrollToBottomRaf = requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        _scrollToBottomRaf = null;
    });
};

function updateConnectionPill(text, isOnline = false) {
    const pill = document.getElementById('knx-connection-pill');
    const textEl = document.getElementById('knx-conn-status-text');
    const retryBtn = document.getElementById('knx-conn-retry-btn');
    if (!pill || !textEl) return;
    textEl.textContent = text;
    if (isOnline) {
        pill.classList.remove('hidden');
        pill.classList.add('connected');
        if (retryBtn) retryBtn.classList.add('hidden');
        if (window._knxPillHideTimer) clearTimeout(window._knxPillHideTimer);
        window._knxPillHideTimer = setTimeout(() => {
            pill.classList.add('hidden');
            pill.classList.remove('connected');
        }, 1800);
    } else {
        if (window._knxPillHideTimer) clearTimeout(window._knxPillHideTimer);
        pill.classList.remove('hidden', 'connected');
        if (retryBtn) retryBtn.classList.remove('hidden');
    }
}

window.forceKnxReconnect = function() {
    if (socket) {
        updateConnectionPill('Повторное подключение...', false);
        try {
            socket.disconnect();
            socket.connect();
        } catch(e) {}
    }
};

document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) {
        return;
    }
    if (!e.target.closest('.msg') && !e.target.closest('.chat-item')) {
        e.preventDefault();
    }
});

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы')) {
        e.preventDefault();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyP' || e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З')) {
        e.preventDefault();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput && !document.getElementById('main-screen')?.classList.contains('hidden')) {
            searchInput.focus();
            searchInput.select();
        }
        return;
    }
    if (e.key === 'Escape') {
        const imgViewer = document.getElementById('image-viewer');
        if (imgViewer && !imgViewer.classList.contains('hidden')) {
            if (typeof closeImageViewer === 'function') closeImageViewer();
            return;
        }
        const msgCtx = document.getElementById('msg-context-menu');
        if (msgCtx && !msgCtx.classList.contains('hidden')) {
            msgCtx.classList.add('hidden');
            return;
        }
        const chatCtx = document.getElementById('chat-context-menu');
        if (chatCtx && !chatCtx.classList.contains('hidden')) {
            chatCtx.classList.add('hidden');
            return;
        }
        const chatActions = document.getElementById('chat-actions-dropdown');
        if (chatActions && !chatActions.classList.contains('hidden')) {
            if (typeof closeChatActionsMenu === 'function') closeChatActionsMenu();
            return;
        }
        const emojiPicker = document.getElementById('emoji-picker');
        if (emojiPicker && !emojiPicker.classList.contains('hidden')) {
            emojiPicker.classList.add('hidden');
            return;
        }
        const stickerPicker = document.getElementById('sticker-picker');
        if (stickerPicker && !stickerPicker.classList.contains('hidden')) {
            stickerPicker.classList.add('hidden');
            return;
        }
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) {
            const topModal = openModals[openModals.length - 1];
            if (typeof closeModal === 'function') {
                closeModal(topModal.id);
            } else {
                topModal.classList.add('hidden');
            }
            return;
        }
        const editGroupScreen = document.getElementById('edit-group-screen');
        if (editGroupScreen && !editGroupScreen.classList.contains('hidden')) {
            if (typeof closeEditGroupScreen === 'function') closeEditGroupScreen();
            return;
        }
        if (document.body.classList.contains('in-settings-sub')) {
            if (typeof window.backToSettingsMenu === 'function') {
                window.backToSettingsMenu();
                return;
            }
        }
        const settingsScreen = document.getElementById('settings-screen');
        if (settingsScreen && !settingsScreen.classList.contains('hidden')) {
            if (typeof window.closeSettingsScreen === 'function') {
                window.closeSettingsScreen();
                return;
            }
        }
        const profileScreen = document.getElementById('profile-screen');
        if (profileScreen && !profileScreen.classList.contains('hidden')) {
            if (typeof closeProfileScreen === 'function') {
                closeProfileScreen();
                return;
            }
        }
        const searchInput = document.getElementById('search-input');
        if (document.activeElement === searchInput || (searchInput && searchInput.value.trim())) {
            if (searchInput) {
                searchInput.value = '';
                searchInput.blur();
                if (typeof filterChats === 'function') filterChats();
                return;
            }
        }
        if (typeof isSelectMode !== 'undefined' && isSelectMode) {
            if (typeof exitSelectMode === 'function') exitSelectMode();
            return;
        }
        if (typeof editingMsgId !== 'undefined' && editingMsgId) {
            if (typeof cancelEdit === 'function') cancelEdit();
            return;
        }
        if (typeof replyingToMsg !== 'undefined' && replyingToMsg) {
            if (typeof cancelReply === 'function') cancelReply();
            return;
        }
        if (activeChat) {
            if (typeof closeMobileChat === 'function') {
                closeMobileChat();
                return;
            }
        }
        if (document.body.classList.contains('mobile-chat-open')) {
            if (typeof window.closeMobileChat === 'function') {
                window.closeMobileChat();
                return;
            }
        }
    }
});

document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG' || e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SVG') {
        e.preventDefault();
    }
});

window.addEventListener('offline', () => {
    updateConnectionPill('Сеть недоступна (автономный режим)', false);
});
window.addEventListener('online', () => {
    updateConnectionPill('Сеть восстановлена, подключение...', false);
    if (socket && !socket.connected) {
        socket.connect();
    }
});

window.addEventListener('error', (event) => {
    console.warn('🛡️ [KNX Client Shield] Handled script error:', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
    console.warn('🛡️ [KNX Client Shield] Handled promise rejection:', event.reason);
});

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, match => {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match];
    });
}

function getUserBadgeHtml(u) {
    if (!u) return '';
    if (u.isDev || u.role === 'dev') return `<span class="dev-badge">KNX</span>`;
    return '';
}

function loadChatsFromCache() {
    if (!currentUser) return;
    const cached = localStorage.getItem('knx_chats_cache_' + currentUser.kId);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            Object.assign(chats, parsed);
        } catch (e) { console.error('Ошибка чтения кэша чатов'); }
    }
}

let saveChatsCacheTimer = null;
function saveChatsToCache() {
    if (!currentUser) return;
    if (saveChatsCacheTimer) clearTimeout(saveChatsCacheTimer);
    saveChatsCacheTimer = setTimeout(() => {
        saveChatsCacheTimer = null;
        try {
            let cacheCopy = {};
            for (let k in chats) {
                cacheCopy[k] = chats[k].slice(-40);
            }
            localStorage.setItem('knx_chats_cache_' + currentUser.kId, JSON.stringify(cacheCopy));
        } catch (e) {
            localStorage.removeItem('knx_chats_cache_' + currentUser.kId);
        }
    }, 800);
}

let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playSound(type) {
    if (window.chatSettings && window.chatSettings.chatSounds === false) return;
    const soundEnabled = currentUser ? (currentUser.soundEnabled !== false) : true;
    if (!soundEnabled) return;

    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        if (type === 'send') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(500, now); 
            osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'receive') {
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(880, now); 
            gain1.gain.setValueAtTime(0, now);
            gain1.gain.linearRampToValueAtTime(0.15, now + 0.02);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc1.connect(gain1); gain1.connect(ctx.destination);
            osc1.start(now); osc1.stop(now + 0.4);

            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1174.66, now + 0.08); 
            gain2.gain.setValueAtTime(0, now + 0.08);
            gain2.gain.linearRampToValueAtTime(0.15, now + 0.1);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.start(now + 0.08); osc2.stop(now + 0.45);
        }
    } catch (e) {
        console.error('Audio error:', e);
    }
}

document.addEventListener('click', () => {
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { once: true });

(function initEarlyPreferences() {
    try {
        const savedTheme = localStorage.getItem('knx_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (document.body) document.body.setAttribute('data-theme', savedTheme);
    } catch(e) {}
})();

const i18n = {
    ru: {
        btnLogin: "Войти", btnReg: "Создать аккаунт", search: "Поиск (K-ID или g-...)", profile: "Профиль",
        settings: "Настройки", selectChat: "Выберите чат для начала общения", phKId: "Ваш K-ID",
        phPass: "Пароль", phName: "Имя", forgotKid: "Забыли K-ID?", goReg: "Регистрация",
        goLogin: "Уже есть аккаунт? Войти", sendFile: "Отправка файла", phCaption: "Добавить подпись...",
        btnSend: "Отправить", soundNotify: "Звуковые уведомления",
        account: "Аккаунт", accountSub: "Имя, ник и «О себе»",
        appearance: "Оформление", appearanceSub: "Тема, палитра и обои",
        chatSettings: "Настройки чатов", chatSettingsSub: "Шрифт, размер и жесты",
        privacy: "Конфиденциальность", privacySub: "Статус в сети и видимость",
        notifications: "Уведомления и звуки", notificationsSub: "Вибрация, мелодии и отклик",
        storage: "Данные и память", storageSub: "Кэш медиа и место на устройстве",
        devices: "Устройства и безопасность", devicesSub: "Сессии, вход и защита аккаунта",
        folders: "Папки с чатами", foldersSub: "Группировка и сортировка диалогов",
        language: "Язык", languageSub: "Русский",
        logout: "Выйти из аккаунта", logoutSub: "Завершить сеанс на этом устройстве",
        deleteAcc: "Удалить аккаунт навсегда", deleteAccSub: "Безвозвратное удаление всех данных",
        chats: "Чаты", archive: "Архив",
        setChatBgTitle: "ОБОИ ЧАТОВ", chooseWallpaper: "Выбрать фото из галереи",
        chooseWallpaperSub: "Любое изображение для фона", resetWallpaper: "Сбросить обои по умолчанию",
        clearCacheBtn: "Очистить весь кэш", memoryUsage: "Использование памяти"
    },
    uk: {
        btnLogin: "Увійти", btnReg: "Створити акаунт", search: "Пошук (K-ID або g-...)", profile: "Профіль",
        settings: "Налаштування", selectChat: "Оберіть чат для початку спілкування", phKId: "Ваш K-ID",
        phPass: "Пароль", phName: "Ім'я", forgotKid: "Забули K-ID?", goReg: "Реєстрація",
        goLogin: "Вже є акаунт? Увійти", sendFile: "Надсилання файлу", phCaption: "Додати підпис...",
        btnSend: "Надіслати", soundNotify: "Звукові сповіщення",
        account: "Акаунт", accountSub: "Ім'я, нік та «Про себе»",
        appearance: "Оформлення", appearanceSub: "Тема, палітра та шпалери",
        chatSettings: "Налаштування чатів", chatSettingsSub: "Шрифт, розмір та жести",
        privacy: "Конфіденційність", privacySub: "Статус у мережі та видимість",
        notifications: "Сповіщення та звуки", notificationsSub: "Вібрація, мелодії та відгук",
        storage: "Дані та пам'ять", storageSub: "Кеш медіа та місце на пристрої",
        devices: "Пристрої та безпека", devicesSub: "Сесії, вхід та захист акаунта",
        folders: "Папки з чатами", foldersSub: "Групування та сортування діалогів",
        language: "Мова", languageSub: "Українська",
        logout: "Вийти з акаунта", logoutSub: "Завершити сеанс на цьому пристрої",
        deleteAcc: "Видалити акаунт назавжди", deleteAccSub: "Безповоротне видалення всіх даних",
        chats: "Чати", archive: "Архів",
        setChatBgTitle: "ШПАЛЕРИ ЧАТІВ", chooseWallpaper: "Обрати фото з галереї",
        chooseWallpaperSub: "Будь-яке зображення для фону", resetWallpaper: "Скинути шпалери за замовчуванням",
        clearCacheBtn: "Очистити весь кеш", memoryUsage: "Використання пам'яті"
    },
    en: {
        btnLogin: "Log In", btnReg: "Create Account", search: "Search (K-ID or g-...)", profile: "Profile",
        settings: "Settings", selectChat: "Select a chat to start conversation", phKId: "Your K-ID",
        phPass: "Password", phName: "Name", forgotKid: "Forgot K-ID?", goReg: "Registration",
        goLogin: "Already have an account? Log In", sendFile: "Send File", phCaption: "Add caption...",
        btnSend: "Send", soundNotify: "Sound Notifications",
        account: "Account", accountSub: "Name, username & Bio",
        appearance: "Appearance", appearanceSub: "Theme, palette & wallpaper",
        chatSettings: "Chat Settings", chatSettingsSub: "Font size & swipe gestures",
        privacy: "Privacy", privacySub: "Online status & visibility",
        notifications: "Notifications & Sounds", notificationsSub: "Vibration, tones & haptics",
        storage: "Data & Storage", storageSub: "Media cache & device storage",
        devices: "Devices & Security", devicesSub: "Active sessions & account lock",
        folders: "Chat Folders", foldersSub: "Organize and group dialogues",
        language: "Language", languageSub: "English",
        logout: "Log Out", logoutSub: "Terminate session on this device",
        deleteAcc: "Delete Account Permanently", deleteAccSub: "Permanently wipe all account data",
        chats: "Chats", archive: "Archive",
        setChatBgTitle: "CHAT WALLPAPER", chooseWallpaper: "Choose photo from gallery",
        chooseWallpaperSub: "Any picture for chat background", resetWallpaper: "Reset wallpaper to default",
        clearCacheBtn: "Clear All Cache", memoryUsage: "Storage Usage"
    },
    be: {
        btnLogin: "Увайсці", btnReg: "Стварыць акаўнт", search: "Пошук (K-ID ці g-...)", profile: "Профіль",
        settings: "Налады", selectChat: "Выберыце чат для пачатку стасункаў", phKId: "Ваш K-ID",
        phPass: "Пароль", phName: "Імя", forgotKid: "Забыліся K-ID?", goReg: "Рэгістрацыя",
        goLogin: "Ужо ёсць акаўнт? Увайсці", sendFile: "Адпраўка файла", phCaption: "Дадаць подпіс...",
        btnSend: "Адправіць", soundNotify: "Гукавыя апавяшчэнні",
        account: "Акаўнт", accountSub: "Імя, нік і «Пра сябе»",
        appearance: "Афармленне", appearanceSub: "Тэма, палітра і шпалеры",
        chatSettings: "Налады чатаў", chatSettingsSub: "Шрыфт, памер і жэсты",
        privacy: "Канфідэнцыяльнасць", privacySub: "Статус у сетцы і бачнасць",
        notifications: "Апавяшчэнні і гукі", notificationsSub: "Вібрацыя, мелодыі і водгук",
        storage: "Дадзеныя і памяць", storageSub: "Кэш медыя і месца на прыладзе",
        devices: "Прылады і бяспека", devicesSub: "Сесіі, уваход і абарона акаўнта",
        folders: "Папкі з чатамі", foldersSub: "Групоўка і сартаванне дыялогаў",
        language: "Мова", languageSub: "Беларуская",
        logout: "Выйсці з акаўнта", logoutSub: "Скончыць сеанс на гэтай прыладзе",
        deleteAcc: "Выдаліць акаўнт назаўжды", deleteAccSub: "Беззваротнае выдаленне ўсіх дадзеных",
        chats: "Чаты", archive: "Архіў",
        setChatBgTitle: "ШПАЛЕРЫ ЧАТАЎ", chooseWallpaper: "Выбраць фота з галерэі",
        chooseWallpaperSub: "Любы відарыс для фону", resetWallpaper: "Скінуць шпалеры па змаўчанні",
        clearCacheBtn: "Ачысціць увесь кэш", memoryUsage: "Выкарыстанне памяці"
    }
};

function applyLanguage(lang) {
    if (!i18n[lang]) lang = 'ru';
    const t = i18n[lang];
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = t[key];
            else el.innerText = t[key];
        }
    });

    const dockChats = document.querySelector('.dock-item[data-tab="chats"] .dock-label');
    if (dockChats && t.chats) dockChats.innerText = t.chats;
    const dockArchive = document.querySelector('.dock-item[data-tab="archive"] .dock-label');
    if (dockArchive && t.archive) dockArchive.innerText = t.archive;
    const dockSettings = document.querySelector('.dock-item[data-tab="settings"] .dock-label');
    if (dockSettings && t.settings) dockSettings.innerText = t.settings;

    window.I18N_SUBTITLES = {
        'customization': t.account || 'Аккаунт',
        'chat-settings': t.chatSettings || 'Настройки чатов',
        'appearance': t.appearance || 'Оформление',
        'notifications': t.notifications || 'Уведомления и звуки',
        'folders': t.folders || 'Папки с чатами',
        'privacy': t.privacy || 'Конфиденциальность',
        'security': t.devices || 'Устройства и безопасность',
        'blocked': (lang === 'en' ? 'Blocked Users' : (lang === 'uk' ? 'Чорний список' : (lang === 'be' ? 'Чорны спіс' : 'Черный список'))),
        'storage': t.storage || 'Данные и память',
        'language': t.language || 'Язык'
    };

    const subTitle = document.getElementById('settings-sub-title');
    const activeTab = document.querySelector('.tab-content.active');
    if (subTitle && activeTab) {
        const tabKey = activeTab.id.replace('tab-', '');
        if (window.I18N_SUBTITLES[tabKey]) subTitle.innerText = window.I18N_SUBTITLES[tabKey];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            window.swRegistration = reg;
        }).catch((err) => {
            console.warn('SW registration warning:', err);
        });
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'OPEN_CHAT' && event.data.chatKId) {
                const u = knownUsers[event.data.chatKId];
                if (u && typeof openChat === 'function') openChat(u);
            }
        });
    }

    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('input, textarea, [contenteditable="true"]')) {
            return;
        }
        const msgEl = e.target.closest('.msg');
        if (!msgEl) {
            e.preventDefault();
        }
    }, { passive: false });

    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('sidebar');
    const msgContainer = document.getElementById('messages-container');
    if (msgContainer) {
        msgContainer.addEventListener('scroll', () => {
            if (msgContainer.scrollTop < 60 && typeof loadMoreHistory === 'function') {
                loadMoreHistory();
            }
        });
    }

    const msgInput = document.getElementById('message-input');
    if (msgInput) {
        msgInput.addEventListener('focus', () => {
            setTimeout(() => {
                if (typeof window.scrollToBottom === 'function') {
                    window.scrollToBottom(true);
                }
            }, 250);
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm && !document.getElementById('twofa-form')) {
        const twofaHtml = `
            <div id="twofa-form" class="hidden" style="width: 100%;">
                <div style="font-size: 45px; margin-bottom: 10px;">🛡️</div>
                <h2 style="margin-bottom: 15px;">Проверка безопасности</h2>
                <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 20px;">Мы отправили код с аккаунта KNX Support на ваше устройство с активной сессией.</p>
                <input type="text" id="twofa-code" placeholder="Код" maxlength="5" style="text-align: center; font-size: 24px; letter-spacing: 8px; font-weight: bold; width: 100%;">
                <button class="btn-primary" style="width: 100%; margin-bottom: 10px;" onclick="verify2FA()">Подтвердить вход</button>
                <div class="toggle-link" onclick="fallback2FA()">Нет доступа к устройству?</div>
                <div class="toggle-link" onclick="cancel2FA()" style="margin-top: 10px; color: var(--danger);">Отмена</div>
            </div>
        `;
        loginForm.parentNode.insertAdjacentHTML('beforeend', twofaHtml);
    }

    const chatMenu = document.getElementById('chat-context-menu');
    if (chatMenu && !document.getElementById('archive-chat-btn')) {
        const archiveBtn = document.createElement('div');
        archiveBtn.className = 'menu-item';
        archiveBtn.id = 'archive-chat-btn';
        archiveBtn.onclick = toggleArchiveChat;
        const deleteBtn = chatMenu.querySelector('.danger');
        if(deleteBtn) {
            chatMenu.insertBefore(archiveBtn, deleteBtn);
        } else {
            chatMenu.appendChild(archiveBtn);
        }
    }

    let isResizing = false;
    const savedSidebarWidth = localStorage.getItem('knx_sidebar_width');
    if (savedSidebarWidth) {
        document.documentElement.style.setProperty('--sidebar-width', savedSidebarWidth);
    }

    if (resizer && sidebar) {
        resizer.addEventListener('mousedown', (e) => {
            if (window.innerWidth <= 768) return;
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            resizer.classList.add('dragging');
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            let newWidth = e.clientX;
            if (newWidth < 320) newWidth = 320;
            if (newWidth > 480) newWidth = 480;
            document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
            localStorage.setItem('knx_sidebar_width', `${newWidth}px`);
        });
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                resizer.classList.remove('dragging');
            }
        });
    }

    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768) {
            if (activeChat) {
                document.body.classList.add('mobile-chat-open');
            } else {
                document.body.classList.remove('mobile-chat-open');
            }
        } else {
            document.body.classList.remove('mobile-chat-open');
        }
    });

    document.addEventListener('paste', function(e) {
        if (!activeChat || document.getElementById('input-area')?.classList.contains('hidden')) return;
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file') {
                const blob = item.getAsFile();
                if (blob) processFileForPreview(blob);
            }
        }
    });

    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
        if (!activeChat || document.getElementById('input-area')?.classList.contains('hidden')) return;
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            dragCounter++;
            document.getElementById('chat-drag-overlay')?.classList.remove('hidden');
        }
    });

    window.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            document.getElementById('chat-drag-overlay')?.classList.add('hidden');
        }
    });

    window.addEventListener('dragover', (e) => {
        if (!activeChat || document.getElementById('input-area')?.classList.contains('hidden')) return;
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });

    window.addEventListener('drop', (e) => {
        dragCounter = 0;
        document.getElementById('chat-drag-overlay')?.classList.add('hidden');
        if (!activeChat || document.getElementById('input-area')?.classList.contains('hidden')) return;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            processFileForPreview(file);
        }
    });

    let touchTimer;
    const msgsContainer = document.getElementById('messages-container');
    let swipeStartX = 0; let swipeCurrentY = 0; let swipeCurrentX = 0;
    let swipingMsg = null; let isSwiping = false;

    msgsContainer.addEventListener('touchstart', (e) => {
        const msgEl = e.target.closest('.msg');
        if (msgEl && !e.target.closest('.inline-buttons') && !e.target.closest('.reaction-badge')) {
            touchTimer = setTimeout(() => {
                if(isSwiping) return;
                window.getSelection().removeAllRanges();
                const msgId = msgEl.getAttribute('data-id');
                const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(msgId));
                if (msg) {
                    const touch = e.touches[0];
                    const pseudoEvent = { preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY };
                    openMsgContextMenu(pseudoEvent, msg);
                }
            }, 500); 

            swipeStartX = e.touches[0].clientX;
            swipeCurrentY = e.touches[0].clientY;
            swipingMsg = msgEl;
            isSwiping = false;
            swipingMsg.style.transition = 'none'; 

            const oldIcon = document.getElementById('global-reply-swipe-icon');
            if (oldIcon) oldIcon.remove();
        }
    }, { passive: true });

    msgsContainer.addEventListener('touchmove', (e) => {
        if (!swipingMsg) return;
        swipeCurrentX = e.touches[0].clientX;
        let currentY = e.touches[0].clientY;
        let deltaX = swipeCurrentX - swipeStartX;
        let deltaY = currentY - swipeCurrentY;

        if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
            isSwiping = true;
            clearTimeout(touchTimer); 
            if (e.cancelable) e.preventDefault(); 
        }

        if (isSwiping && deltaX < 0) {
            let moveX = deltaX;
            if (moveX < -60) {
                moveX = -60 - (Math.abs(moveX) - 60) * 0.2;
            }
            swipingMsg.style.setProperty('transform', `translateX(${moveX}px)`, 'important');

            let icon = document.getElementById('global-reply-swipe-icon');
            if (!icon) {
                icon = document.createElement('div');
                icon.id = 'global-reply-swipe-icon';
                icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`;
                icon.style.position = 'fixed';
                icon.style.color = 'var(--accent)';
                icon.style.opacity = '0';
                icon.style.transition = 'transform 0.2s, opacity 0.2s';
                icon.style.zIndex = '9999';
                icon.style.background = 'var(--bg-panel)';
                icon.style.borderRadius = '50%';
                icon.style.padding = '8px';
                icon.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
                icon.style.display = 'flex';
                icon.style.alignItems = 'center';
                icon.style.justifyContent = 'center';
                icon.style.pointerEvents = 'none';
                document.body.appendChild(icon);
            }

            const rect = swipingMsg.getBoundingClientRect();
            icon.style.right = '20px';
            icon.style.top = (rect.top + rect.height / 2) + 'px';

            let progress = Math.min(Math.abs(deltaX) / 60, 1);
            icon.style.opacity = progress;
            if (Math.abs(deltaX) >= 50) {
                icon.style.transform = 'translateY(-50%) scale(1.1)';
            } else {
                icon.style.transform = `translateY(-50%) scale(${progress})`;
            }
        }
    }, { passive: false });

    msgsContainer.addEventListener('touchend', (e) => {
        clearTimeout(touchTimer);
        if (swipingMsg) {
            let deltaX = swipeCurrentX - swipeStartX;
            swipingMsg.style.transition = 'transform 0.3s var(--spring)';
            swipingMsg.style.setProperty('transform', 'translateX(0)', 'important');

            const icon = document.getElementById('global-reply-swipe-icon');
            if (icon) {
                icon.style.transform = 'translateY(-50%) scale(0)';
                icon.style.opacity = '0';
                setTimeout(() => { if (icon && icon.parentNode) icon.remove(); }, 300);
            }

            if (isSwiping && deltaX < -50) {
                const msgId = swipingMsg.getAttribute('data-id');
                const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(msgId));
                if (msg) {
                    contextTargetMsg = msg; 
                    prepareReply();
                    if (navigator.vibrate) navigator.vibrate(40); 
                }
            }
            const cleanupMsg = swipingMsg;
            setTimeout(() => { 
                if (cleanupMsg) {
                    cleanupMsg.style.transition = ''; 
                    cleanupMsg.style.transform = '';
                } 
            }, 300);
            swipingMsg = null; swipeStartX = 0; swipeCurrentX = 0; isSwiping = false;
        }
    });

    msgsContainer.addEventListener('contextmenu', (e) => {
        const msgEl = e.target.closest('.msg');
        if (msgEl && !e.target.closest('.inline-buttons') && !e.target.closest('.reaction-badge')) {
            const hasSelection = window.getSelection() && window.getSelection().toString().trim().length > 0;
            if (hasSelection) {
                return;
            }
            e.preventDefault();
            const msgId = msgEl.getAttribute('data-id');
            const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(msgId));
            if (msg) openMsgContextMenu(e, msg);
        }
    });

    let lastMsgTapTime = 0;
    let lastMsgTapId = null;
    let singleTapTimer = null;

    msgsContainer.addEventListener('click', (e) => {
        if (window.isSelectMode) {
            const msgEl = e.target.closest('.msg');
            if (msgEl) {
                e.preventDefault();
                e.stopPropagation();
                const msgId = msgEl.getAttribute('data-id');
                toggleSelectMessage(msgId);
                return;
            }
        }

        const img = e.target.closest('img.chat-photo');
        if (img) { openImageViewer(img.src); return; }
        
        const reactBadge = e.target.closest('.reaction-badge');
        if (reactBadge) {
            e.stopPropagation();
            if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
            lastMsgTapId = null;
            const msgEl = reactBadge.closest('.msg');
            if (msgEl) {
                const msgId = msgEl.getAttribute('data-id');
                const emoji = reactBadge.getAttribute('data-emoji');
                sendReaction(emoji, msgId);
            }
            return;
        }

        const replyBlock = e.target.closest('.reply-block');
        if (replyBlock) {
            return;
        }

        const msgEl = e.target.closest('.msg');
        if (msgEl && !e.target.closest('.inline-buttons') && !e.target.closest('a') && !e.target.closest('button')) {
            const msgId = msgEl.getAttribute('data-id');
            const now = Date.now();
            const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(msgId));
            if (!msg) return;

            if (lastMsgTapId === msgId && (now - lastMsgTapTime) < 300) {
                if (singleTapTimer) {
                    clearTimeout(singleTapTimer);
                    singleTapTimer = null;
                }
                lastMsgTapId = null;
                lastMsgTapTime = 0;
                const emoji = (window.chatSettings && window.chatSettings.quickReaction) ? window.chatSettings.quickReaction : '❤️';
                sendReaction(emoji, msgId);
                showDoubleTapEffect(msgEl, emoji);
                return;
            }

            const isTouchDevice = e.pointerType === 'touch' || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
            if (isTouchDevice) {
                lastMsgTapId = msgId;
                lastMsgTapTime = now;
                if (singleTapTimer) clearTimeout(singleTapTimer);
                const clickPos = { clientX: e.clientX, clientY: e.clientY };
                singleTapTimer = setTimeout(() => {
                    openMsgContextMenu(clickPos, msg);
                    singleTapTimer = null;
                    lastMsgTapId = null;
                }, 280);
            }
        }
    });

    msgsContainer.addEventListener('scroll', () => {
        const btn = document.getElementById('scroll-down-btn');
        if (!btn) return;
        const distFromBottom = msgsContainer.scrollHeight - msgsContainer.scrollTop - msgsContainer.clientHeight;
        if (distFromBottom > 160) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
            const badge = document.getElementById('scroll-down-badge');
            if (badge) {
                badge.innerText = '0';
                badge.classList.add('hidden');
            }
        }
    });

    document.addEventListener('click', (e) => {
        const targetEl = (e.target && typeof e.target.closest === 'function') ? e.target : null;
        const msgMenu = document.getElementById('msg-context-menu');
        if (msgMenu && !msgMenu.classList.contains('hidden') && (!targetEl || !targetEl.closest('#msg-context-menu'))) {
            msgMenu.classList.add('hidden');
        }
        const chatMenu = document.getElementById('chat-context-menu');
        if (chatMenu && !chatMenu.classList.contains('hidden') && (!targetEl || !targetEl.closest('#chat-context-menu'))) {
            chatMenu.classList.add('hidden');
        }
        const swipedChat = document.querySelector('.chat-item.swiped-open');
        if (swipedChat && (!e.target || !swipedChat.contains(e.target))) {
            if (typeof closeChatSwipe === 'function') closeChatSwipe(swipedChat);
            else swipedChat.classList.remove('swiped-open');
        }
        const chatActions = document.getElementById('chat-actions-dropdown');
        if (chatActions && !chatActions.classList.contains('hidden') && (!targetEl || !targetEl.closest('#chat-actions-dropdown, #chat-menu-btn'))) {
            chatActions.classList.add('hidden');
        }
        const stickerPicker = document.getElementById('sticker-picker');
        if (stickerPicker && !stickerPicker.classList.contains('hidden') && (!targetEl || !targetEl.closest('#sticker-picker, [onclick*="toggleStickerPicker"]'))) {
            stickerPicker.classList.add('hidden');
        }
        if (document.body.classList.contains('panel-open') && window.innerWidth > 768) {
            const clickedInsidePanel = targetEl ? targetEl.closest('.fullscreen-panel, .modal, .toast, .image-viewer, .crop-modal') : false;
            if (!clickedInsidePanel) {
                const settingsScreen = document.getElementById('settings-screen');
                if (settingsScreen && !settingsScreen.classList.contains('hidden')) {
                    if (typeof window.closeSettingsScreen === 'function') window.closeSettingsScreen();
                }
                const profileScreen = document.getElementById('profile-screen');
                if (profileScreen && !profileScreen.classList.contains('hidden')) {
                    if (typeof closeProfileScreen === 'function') closeProfileScreen();
                }
                const editGroupScreen = document.getElementById('edit-group-screen');
                if (editGroupScreen && !editGroupScreen.classList.contains('hidden')) {
                    if (typeof closeEditGroupScreen === 'function') closeEditGroupScreen();
                }
            }
        }
    });

    const chatListContainer = document.getElementById('chat-list');
    let chatTouchTimer;

    chatListContainer.addEventListener('touchstart', (e) => {
        const chatEl = e.target.closest('.chat-item');
        if (chatEl) {
            chatTouchTimer = setTimeout(() => {
                window.getSelection().removeAllRanges();
                const kId = chatEl.id.replace('contact-', '');
                const touch = e.touches[0];
                const pseudoEvent = { preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY };
                openChatContextMenu(pseudoEvent, kId);
            }, 500);
        }
    }, { passive: true });

    chatListContainer.addEventListener('touchend', () => clearTimeout(chatTouchTimer));
    chatListContainer.addEventListener('touchmove', () => clearTimeout(chatTouchTimer));

    document.addEventListener('mousedown', (e) => {
        if(!e.target.closest('.context-menu')) {
            document.querySelectorAll('.context-menu').forEach(m => m.classList.add('hidden'));
        }
    });
    document.addEventListener('touchstart', (e) => {
        if(!e.target.closest('.context-menu') && !e.target.closest('.reaction-badge')) {
            document.querySelectorAll('.context-menu').forEach(m => m.classList.add('hidden'));
        }
    }, { passive: true });

    const isInviteActivated = localStorage.getItem('knx_invite_activated') === 'true';
    const savedKId = localStorage.getItem('kId');
    const savedPass = localStorage.getItem('password');
    const urlCode = getUrlInviteCode();

    if (savedKId && savedPass) {
        localStorage.setItem('knx_invite_activated', 'true');
        document.getElementById('invite-screen')?.classList.add('hidden');
        document.getElementById('auth-screen')?.classList.add('hidden'); 
        document.getElementById('login-kid').value = savedKId;
        document.getElementById('login-pass').value = savedPass;
        login(true); 
    } else if (isInviteActivated) {
        document.getElementById('invite-screen')?.classList.add('hidden');
        document.getElementById('auth-screen')?.classList.remove('hidden');
    } else {
        document.getElementById('auth-screen')?.classList.add('hidden');
        document.getElementById('invite-screen')?.classList.remove('hidden');

        if (urlCode) {
            const inviteInput = document.getElementById('invite-code-input');
            if (inviteInput) inviteInput.value = urlCode;
            setTimeout(() => {
                window.activateInvite(urlCode);
            }, 300);
        }
    }
});

function getUrlInviteCode() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        let code = urlParams.get('invite') || urlParams.get('code');
        if (!code && window.location.hash) {
            const hash = window.location.hash.substring(1);
            if (hash.includes('invite=')) code = hash.split('invite=')[1].split('&')[0];
            else if (hash.includes('code=')) code = hash.split('code=')[1].split('&')[0];
        }
        return code ? decodeURIComponent(code).trim() : null;
    } catch(e) {
        return null;
    }
}

window.activateInvite = async function(customCode = null) {
    const input = document.getElementById('invite-code-input');
    const rawVal = customCode || (input ? input.value : '');
    const statusBox = document.getElementById('invite-status-msg');
    const submitBtn = document.getElementById('invite-submit-btn');

    if (!rawVal || !rawVal.trim()) {
        if (statusBox) {
            statusBox.className = 'invite-status-box error';
            statusBox.innerText = 'Пожалуйста, введите код приглашения или ссылку.';
            statusBox.classList.remove('hidden');
        }
        if (input) input.focus();
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
    }

    try {
        const res = await fetch('/api/invite/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteCode: rawVal.trim() })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('knx_invite_activated', 'true');
            localStorage.setItem('knx_activated_code', data.code || rawVal.trim());

            if (statusBox) {
                statusBox.className = 'invite-status-box success';
                const tierName = data.title ? ` [${data.title}]` : '';
                statusBox.innerText = `Доступ${tierName} подтвержден! Открываем вход...`;
                statusBox.classList.remove('hidden');
            }

            if (window.history && window.history.replaceState) {
                const cleanUrl = window.location.pathname;
                window.history.replaceState({}, document.title, cleanUrl);
            }

            setTimeout(() => {
                const inviteScreen = document.getElementById('invite-screen');
                const authScreen = document.getElementById('auth-screen');
                if (inviteScreen) inviteScreen.classList.add('hidden');
                if (authScreen) {
                    authScreen.classList.remove('hidden');
                    authScreen.classList.add('animate-fade-in');
                }
                const welcomeTitle = data.title ? ` (${data.title})` : '';
                showToast(`Добро пожаловать в KNX${welcomeTitle}! Выберите вход или регистрацию.`, 'success');
            }, 600);
        } else {
            if (statusBox) {
                statusBox.className = 'invite-status-box error';
                statusBox.innerText = data.message || 'Неверный код приглашения.';
                statusBox.classList.remove('hidden');
            }
        }
    } catch (e) {
        if (statusBox) {
            statusBox.className = 'invite-status-box error';
            statusBox.innerText = 'Ошибка соединения с сервером. Попробуйте еще раз.';
            statusBox.classList.remove('hidden');
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
        }
    }
};

window.pasteInviteFromClipboard = async function() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            const input = document.getElementById('invite-code-input');
            if (input) {
                input.value = text.trim();
                window.activateInvite(text.trim());
            }
        }
    } catch(err) {
        showToast('Вставьте код вручную в поле ввода', 'info');
    }
};

window.openSettingsTab = function(keyword) {
    openSettingsScreen();
    setTimeout(() => {
        const tabs = document.querySelectorAll('.tab-btn');
        for(let t of tabs) {
            if(t.innerText.toLowerCase().includes(keyword.toLowerCase())) {
                t.click();
                return;
            }
        }
    }, 50); // небольшая задержка, чтобы модалка успела отрендериться
};



window.toggleThemeMode = function() {
    let current = (currentUser && currentUser.theme) || document.body.getAttribute('data-theme') || 'light';
    let newTheme = (current === 'dark') ? 'light' : 'dark';
    if (currentUser) currentUser.theme = newTheme;
    document.body.setAttribute('data-theme', newTheme);
    const selectEl = document.getElementById('set-theme');
    if (selectEl) selectEl.value = newTheme;
    if (currentUser) {
        fetch('/api/settings/customize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, theme: newTheme })
        });
    }
    showToast(newTheme === 'dark' ? 'Тёмная тема' : 'Светлая тема', 'success');
};

function showToast(msg, type = 'info') {
    if (type !== 'error' && type !== 'message') {
        return;
    }
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconSvg = '';
    if (type === 'error') {
        iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#ef4444" stroke-width="2.5" fill="none" style="flex-shrink:0"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else {
        iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#0084ff" stroke-width="2.5" fill="none" style="flex-shrink:0"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${escapeHTML(msg)}</span>`;
    container.appendChild(toast);

    setTimeout(() => { 
        toast.classList.add('fade-out'); 
        setTimeout(() => toast.remove(), 280);
    }, 3000);
}

function showIncomingMessageBanner(senderName, text, chatKId, avatar) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = 'toast message-toast';
    banner.onclick = () => {
        banner.remove();
        if (knownUsers[chatKId]) {
            openChat(knownUsers[chatKId]);
        }
    };

    const avatarHtml = avatar 
        ? `<img src="${avatar}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border);">`
        : `<div style="width: 34px; height: 34px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0;">${escapeHTML(senderName.charAt(0).toUpperCase())}</div>`;

    banner.innerHTML = `
        ${avatarHtml}
        <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0; flex: 1;">
            <div style="font-weight: 600; font-size: 13.5px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(senderName)}</div>
            <div style="font-size: 12.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">${escapeHTML(text)}</div>
        </div>
    `;

    container.appendChild(banner);

    setTimeout(() => {
        banner.classList.add('fade-out');
        setTimeout(() => banner.remove(), 280);
    }, 4500);
}
window.showIncomingMessageBanner = showIncomingMessageBanner;

function toggleAuth() {
    document.getElementById('login-form')?.classList.toggle('hidden');
    document.getElementById('reg-form')?.classList.toggle('hidden');
}

function openForgotKidModal() { document.getElementById('forgot-kid-modal')?.classList.remove('hidden'); }
function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden', 'modal-closing');
    el.classList.add('modal-opening');
    document.getElementById('floating-bottom-bar')?.classList.add('hidden');
    document.getElementById('mobile-bottom-nav')?.classList.add('hidden');
    if (id === 'qr-link-modal') {
        if (typeof startQRCamera === 'function') startQRCamera();
    }
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('modal-closing');
    el.classList.remove('modal-opening');
    if (id === 'setup-passcode-modal' || id === 'setup-2fa-modal') {
        if (typeof syncSecuritySettingsUI === 'function') syncSecuritySettingsUI();
    }
    setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('modal-closing');
        const settingsScreen = document.getElementById('settings-screen');
        const inSettingsSub = settingsScreen && !settingsScreen.classList.contains('hidden') && document.querySelector('#settings-screen .tab-content.active');
        const inChat = document.body.classList.contains('mobile-chat-open');
        if (!inSettingsSub && !inChat) {
            document.getElementById('floating-bottom-bar')?.classList.remove('hidden');
            document.getElementById('mobile-bottom-nav')?.classList.remove('hidden');
        }
    }, 200);
}
window.openModal = openModal;
window.closeModal = closeModal;

function openImageViewer(src) {
    const img = document.getElementById('image-viewer-img');
    const viewer = document.getElementById('image-viewer');
    if(img) img.src = src; 
    if(viewer) viewer.classList.remove('hidden');
}
function closeImageViewer() {
    document.getElementById('image-viewer')?.classList.add('hidden');
    setTimeout(() => { 
        const img = document.getElementById('image-viewer-img');
        if(img) img.src = ''; 
    }, 300);
}

let closeMobileChatTimer = null;
function openMobileChat() {
    if (closeMobileChatTimer) {
        clearTimeout(closeMobileChatTimer);
        closeMobileChatTimer = null;
    }
    if (window.innerWidth <= 768) {
        document.body.classList.add('mobile-chat-open');
    }
}
function closeMobileChat() { 
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    if (closeMobileChatTimer) {
        clearTimeout(closeMobileChatTimer);
        closeMobileChatTimer = null;
    }
    if (activeChat && activeChat.kId) {
        const c = document.getElementById('messages-container');
        if (c) {
            const isBottom = (c.scrollHeight - c.scrollTop <= c.clientHeight + 60);
            chatScrollState[activeChat.kId] = { top: c.scrollTop, wasAtBottom: isBottom };
        }
    }
    document.body.classList.remove('mobile-chat-open'); 
    document.querySelectorAll('.chat-item.active').forEach(el => el.classList.remove('active'));

    const finishClosing = () => {
        if (!document.body.classList.contains('mobile-chat-open')) {
            activeChat = null; 
            window.activeChat = null;
            document.getElementById('desktop-no-chat')?.classList.remove('hidden');
            document.getElementById('no-chat-selected')?.classList.remove('hidden');
            document.getElementById('chat-header')?.classList.add('hidden');
            document.getElementById('input-area')?.classList.add('hidden');
            document.getElementById('messages-container')?.classList.add('hidden');
            document.getElementById('pinned-bar')?.classList.add('hidden');
            document.getElementById('sticker-picker')?.classList.add('hidden');
            if (typeof window.closeInChatSearch === 'function') window.closeInChatSearch();
        }
    };

    if (window.innerWidth > 768) {
        finishClosing();
    } else {
        closeMobileChatTimer = setTimeout(() => {
            closeMobileChatTimer = null;
            finishClosing();
        }, 240);
    }
}

async function recoverKid() {
    const email = document.getElementById('forgot-email-input').value.trim();
    if (!email) return showToast('Введите почту', 'error');
    
    const res = await fetch('/api/forgot-kid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const result = await res.json();
    if (result.success) {
        showToast(`Ваш K-ID: ${result.kId}`, 'success');
        const lKid = document.getElementById('login-kid');
        if(lKid) lKid.value = result.kId; 
        closeModal('forgot-kid-modal');
    } else showToast(result.message, 'error');
}

async function register() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-pass').value.trim();
    if (!name || !email || !password) return showToast('Заполните все поля', 'error');

    if (password.length < 8 || !/\d/.test(password) || !/[a-zA-Zа-яА-Я]/.test(password)) {
        return showToast('Минимум 8 символов, нужны буквы и цифры.', 'error');
    }

    const existingSessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
    const activatedInviteCode = localStorage.getItem('knx_activated_code') || '';
    const res = await fetch('/api/register', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({name, email, password, sessionId: existingSessionId, inviteCode: activatedInviteCode}) 
    });
    const result = await res.json();
    if (result.success) {
        if (result.token) {
            sessionToken = result.token;
            localStorage.setItem('knx_session_token', result.token);
        }
        if (result.sessionId) {
            localStorage.setItem('knx_current_session_id', result.sessionId);
            window.currentSessionId = result.sessionId;
        }
        localStorage.setItem('knx_invite_activated', 'true');
        showToast(`Успешно! K-ID: ${result.user.kId}`, 'success');
        processLoginSuccess(result.user, result.user.kId, password, false, result.token);
        startOnboarding();
    } else showToast(result.message, 'error'); 
}

function processLoginSuccess(user, kId, password, isAutoLoginFlag, token = null) {
    currentUser = user;
    window.currentUser = user;
    if (token) {
        sessionToken = token;
        localStorage.setItem('knx_session_token', token);
    }
    if(!currentUser.archived) currentUser.archived = [];
    loadChatsFromCache();
    if(!currentUser.folders) currentUser.folders = [];
    if(!currentUser.installedPacks) currentUser.installedPacks = [];
    localStorage.setItem('kId', kId);
    localStorage.setItem('password', password);
    localStorage.setItem('knx_invite_activated', 'true');
    document.body.setAttribute('data-theme', currentUser.theme || 'light');
    applyLanguage(currentUser.lang || 'ru');
    
    getAudioContext().resume();
    
    if (!isAutoLoginFlag) showToast('Успешный вход', 'success');
    initMessenger(); 
}

async function login(isAuto = false) {
    const isAutoLogin = isAuto === true; 
    const kId = document.getElementById('login-kid').value.trim();
    const password = document.getElementById('login-pass').value.trim();
    
    if (!kId || !password) {
        if(isAutoLogin) document.getElementById('auth-screen')?.classList.remove('hidden');
        return showToast('Введите данные', 'error');
    }

    const existingSessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
    const res = await fetch('/api/login', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ kId, password, isAuto: isAutoLogin, sessionId: existingSessionId }) 
    });
    const result = await res.json();
    
    if (result.requiresCloud2FA) {
        window.pendingCloud2FA = { kId, password, isAutoLogin };
        const modal = document.getElementById('cloud-2fa-modal');
        const hintBox = document.getElementById('cloud-2fa-hint-box');
        const passInp = document.getElementById('input-cloud-login-pass');
        if (hintBox) {
            if (result.hint) {
                hintBox.innerText = `Подсказка: ${result.hint}`;
                hintBox.classList.remove('hidden');
            } else {
                hintBox.classList.add('hidden');
            }
        }
        if (passInp) passInp.value = '';
        if (modal) modal.classList.remove('hidden');
        setTimeout(() => passInp?.focus(), 150);
        return;
    }

    if (result.requires2FA) {
        tempLoginKId = kId;
        tempLoginPass = password;
        document.getElementById('login-form')?.classList.add('hidden');
        document.getElementById('reg-form')?.classList.add('hidden');
        document.getElementById('twofa-form')?.classList.remove('hidden');
        const codeInput = document.getElementById('twofa-code');
        if(codeInput) {
            codeInput.value = '';
            codeInput.focus();
        }
        showToast('Код отправлен в мессенджер', 'info');
        return;
    }

    if (result.success) {
        if (result.token) {
            sessionToken = result.token;
            localStorage.setItem('knx_session_token', result.token);
        }
        if (result.sessionId) {
            localStorage.setItem('knx_current_session_id', result.sessionId);
            window.currentSessionId = result.sessionId;
        }
        processLoginSuccess(result.user, kId, password, isAutoLogin, result.token);
    } else {
        if(isAutoLogin) document.getElementById('auth-screen')?.classList.remove('hidden');
        else showToast(result.message, 'error');
        localStorage.removeItem('kId'); localStorage.removeItem('password');
    }
}

async function submitCloud2FALogin() {
    if (!window.pendingCloud2FA) return;
    const cloudPass = document.getElementById('input-cloud-login-pass')?.value.trim();
    if (!cloudPass) return showToast('Введите облачный пароль', 'error');

    const existingSessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
    try {
        const res = await fetch('/api/login/cloud-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kId: window.pendingCloud2FA.kId,
                password: window.pendingCloud2FA.password,
                cloudPassword: cloudPass,
                sessionId: existingSessionId
            })
        });
        const result = await res.json();
        if (result.success) {
            document.getElementById('cloud-2fa-modal')?.classList.add('hidden');
            if (result.token) {
                sessionToken = result.token;
                localStorage.setItem('knx_session_token', result.token);
            }
            if (result.sessionId) {
                localStorage.setItem('knx_current_session_id', result.sessionId);
                window.currentSessionId = result.sessionId;
            }
            processLoginSuccess(result.user, window.pendingCloud2FA.kId, window.pendingCloud2FA.password, false, result.token);
            window.pendingCloud2FA = null;
        } else {
            showToast(result.message || 'Неверный облачный пароль', 'error');
        }
    } catch(e) {
        showToast('Ошибка проверки пароля', 'error');
    }
}

async function verify2FA() {
    const code = document.getElementById('twofa-code').value.trim();
    if (!code) return showToast('Введите код', 'error');
    
    const res = await fetch('/api/login/verify', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ kId: tempLoginKId, password: tempLoginPass, code }) 
    });
    const result = await res.json();
    
    if (result.success) {
        document.getElementById('twofa-form')?.classList.add('hidden');
        document.getElementById('login-form')?.classList.remove('hidden');
        processLoginSuccess(result.user, tempLoginKId, tempLoginPass, false);
    } else {
        showToast(result.message, 'error');
    }
}

async function fallback2FA() {
    const res = await fetch('/api/login/fallback', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ kId: tempLoginKId, password: tempLoginPass }) 
    });
    const result = await res.json();
    
    if (result.success) {
        document.getElementById('twofa-form')?.classList.add('hidden');
        document.getElementById('login-form')?.classList.remove('hidden');
        showToast('Вход разрешен (сессии не найдены)', 'success');
        processLoginSuccess(result.user, tempLoginKId, tempLoginPass, false);
    } else {
        showToast(result.message, 'error');
    }
}

function cancel2FA() {
    tempLoginKId = null;
    tempLoginPass = null;
    document.getElementById('twofa-form')?.classList.add('hidden');
    document.getElementById('login-form')?.classList.remove('hidden');
}

function logout() {
    localStorage.removeItem('kId');
    localStorage.removeItem('password');
    if (currentUser) localStorage.removeItem('knx_chats_cache_' + currentUser.kId);
    
    currentUser = null; activeChat = null;
    for (let key in chats) delete chats[key];
    if (socket) socket.disconnect();
    
    document.getElementById('settings-screen')?.classList.add('hidden');
    document.getElementById('profile-screen')?.classList.add('hidden');
    document.getElementById('main-screen')?.classList.add('hidden');
    document.body.classList.remove('mobile-chat-open');
    document.getElementById('auth-screen')?.classList.remove('hidden');
    document.getElementById('auth-screen')?.classList.add('animate-fade-in');
    document.getElementById('floating-bottom-bar')?.classList.add('hidden');
    document.getElementById('mobile-bottom-nav')?.classList.add('hidden');
    
    const lp = document.getElementById('login-pass');
    if(lp) lp.value = '';
    const cl = document.getElementById('chat-list');
    if(cl) cl.innerHTML = '';
    const mc = document.getElementById('messages-container');
    if(mc) mc.innerHTML = '';
    showToast('Вы вышли из аккаунта', 'info');
}

const obCards = [
    { title: "KNX Ecosystem", text: "Красивые анимации, шапки профилей и светлая тема." },
    { title: "Голос и Файлы", text: "Отправляй документы, голосовые и вставляй фото через Ctrl+V." },
    { title: "Группы и Папки", text: "Сортируй чаты по папкам или создавай каналы." },
    { title: "Стикеры", text: "Создавай стикеры через встроенного бота sti123cer!" },
    { title: "Всё готово", text: "Поехали!" }
];
let currentCard = 0;

function startOnboarding() {
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('onboarding-screen')?.classList.remove('hidden');
    currentCard = 0; updateCard();
}
function updateCard() {
    if(currentCard >= obCards.length) return skipOnboarding();
    const ot = document.getElementById('ob-title');
    if(ot) ot.innerText = obCards[currentCard].title;
    const ox = document.getElementById('ob-text');
    if(ox) ox.innerText = obCards[currentCard].text;
}
function nextCard() { currentCard++; updateCard(); }
function skipOnboarding() {
    document.getElementById('onboarding-screen')?.classList.add('hidden');
    initMessenger();
}

let installedStickerPacks = [];
let currentStickerPackId = null;

function loadStickers() {
    fetch(`/api/stickers/${currentUser.kId}`)
        .then(r => r.json())
        .then(res => {
            if(res.success) {
                installedStickerPacks = res.packs;
                renderStickerPicker();
            }
        });
}

function renderStickerPicker() {
    const tabs = document.getElementById('sticker-tabs');
    const grid = document.getElementById('sticker-grid');
    if(!tabs || !grid) return;
    
    tabs.innerHTML = '';
    grid.innerHTML = '';

    if (installedStickerPacks.length === 0) {
        grid.innerHTML = '<div class="no-stickers-text">Нет установленных стикеров. Напишите боту sti123cer, чтобы создать свои!</div>';
        return;
    }

    if (!currentStickerPackId || !installedStickerPacks.find(p => p.id === currentStickerPackId)) {
        currentStickerPackId = installedStickerPacks[0].id;
    }

    installedStickerPacks.forEach(pack => {
        const coverObj = pack.items && pack.items.length > 0 ? pack.items[0] : DEFAULT_AVATAR;
        tabs.innerHTML += `<img src="${coverObj}" class="sticker-tab ${pack.id === currentStickerPackId ? 'active' : ''}" onclick="selectStickerPack('${pack.id}')" title="${escapeHTML(pack.name)}">`;
    });

    const activePack = installedStickerPacks.find(p => p.id === currentStickerPackId);
    if (activePack && activePack.items) {
        activePack.items.forEach(st => {
            grid.innerHTML += `<img src="${st}" class="sticker-item" onclick="sendSticker('${st}')">`;
        });
    }
}

function selectStickerPack(id) {
    currentStickerPackId = id;
    renderStickerPicker();
}

function toggleStickerPicker() {
    const picker = document.getElementById('sticker-picker');
    if(picker) picker.classList.toggle('hidden');
    if(picker && !picker.classList.contains('hidden')) {
        loadStickers();
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom(false);
    }
}

window.scrollToBottom = function() {
    const c = document.getElementById('messages-container');
    if (c && (c.scrollHeight - c.scrollTop <= c.clientHeight + 160)) {
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom(false);
    }
};

function sendSticker(base64) {
    if(!activeChat) return;
    playSound('send');
    clearTimeout(typingTimer);
    socket.emit('stopTyping', { from: currentUser.kId, to: activeChat.kId });

    const msgId = Date.now().toString();
    const msgObj = { id: msgId, senderId: currentUser.kId, text: base64, type: 'sticker', timestamp: Date.now(), status: 'sent', isMine: true, replyTo: replyingToMsg, isEdited: false, reactions: {}, isPinned: false };
    
    if(!chats[activeChat.kId]) chats[activeChat.kId] = [];
    
    if (!chats[activeChat.kId].find(m => String(m.id) === String(msgId))) {
        chats[activeChat.kId].push(msgObj);
        saveChatsToCache();
        appendMessageToDOM(msgObj, activeChat.isGroup, activeChat.kId);
    }
    
    socket.emit('sendMessage', { id: msgId, from: currentUser.kId, to: activeChat.kId, text: base64, type: 'sticker', timestamp: Date.now(), replyTo: replyingToMsg });
    
    if (!document.getElementById(`contact-${activeChat.kId}`)) addContactToDOM(activeChat);
    
    cancelReply();
    toggleStickerPicker();
}

function handleInlineAction(action, payload) {
    socket.emit('botCommand', { kId: currentUser.kId, command: action, payload });
    if(action === 'install_pack') {
        showToast('Пак стикеров установлен/обновлен!', 'success');
        setTimeout(loadStickers, 500);
    }
}

function initMessenger() {
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('main-screen')?.classList.remove('hidden');
    document.getElementById('floating-bottom-bar')?.classList.remove('hidden');
    document.getElementById('mobile-bottom-nav')?.classList.remove('hidden');
    if (typeof updateDockBadges === 'function') updateDockBadges();
    updateUIProfile();
    renderFolderTabs();
    loadStickers();
    syncSecuritySettingsUI();

    const hasPasscode = localStorage.getItem('knx_passcode_' + currentUser.kId);
    if (hasPasscode) {
        lockAppNow();
    }

    socket = io({
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
    let hasConnectedOnce = false;

    socket.on('connect', () => {
        if (hasConnectedOnce) {
            updateConnectionPill('✓ Соединение восстановлено', true);
            if (currentUser) {
                fetch(`/api/mychats/${currentUser.kId}`).then(r => r.json()).then(res => {
                    if (res && res.success) {
                        res.chats.forEach(c => {
                            unreadCounts[c.id] = c.unread || 0;
                            fetchUserAndAddToSidebar(c.id, false, true);
                        });
                    }
                }).catch(() => {});

                if (activeChat && activeChat.kId) {
                    fetch(`/api/history?kId=${currentUser.kId}&targetId=${activeChat.kId}&isGroup=${activeChat.isGroup || false}&limit=50`)
                    .then(r => r.json())
                    .then(histRes => {
                        if (histRes && histRes.success) {
                            const fetchedChats = histRes.history.map(m => ({
                                id: m.id, senderId: m.senderId, text: m.text, type: m.type, 
                                timestamp: m.timestamp, status: m.status, replyTo: m.replyTo, 
                                fileName: m.fileName, caption: m.caption, isPinned: m.isPinned || false, inlineButtons: m.inlineButtons,
                                isEdited: m.isEdited, reactions: m.reactions || {},
                                isMine: m.senderId === currentUser.kId
                            }));
                            chats[activeChat.kId] = fetchedChats;
                            saveChatsToCache();
                            const targetBox = document.getElementById('chat-box-' + activeChat.kId);
                            if (targetBox) {
                                let fullHtml = '';
                                fetchedChats.forEach(m => {
                                    fullHtml += generateMessageHTML(m, activeChat.isGroup || false, false);
                                });
                                targetBox.innerHTML = fullHtml;
                            }
                        }
                    }).catch(() => {});
                }
            }
        } else {
            hasConnectedOnce = true;
            updateConnectionPill('✓ В сети', true);
        }

        if (window.KNXProto) {
            const authPacket = KNXProto.pack(KNXProto.OPCODES.AUTH, {
                kId: currentUser.kId,
                token: sessionToken
            });
            socket.emit('kp_packet', authPacket);

            if (window._knxHeartbeatTimer) clearInterval(window._knxHeartbeatTimer);
            window._knxHeartbeatTimer = setInterval(() => {
                if (socket && socket.connected && window.KNXProto) {
                    const pingPkt = KNXProto.pack(KNXProto.OPCODES.PING, { t: Date.now() });
                    socket.emit('kp_packet', pingPkt);
                }
            }, 20000);
        }
        socket.emit('auth', { kId: currentUser.kId, token: sessionToken });
    });

    socket.on('disconnect', () => {
        if (window._knxHeartbeatTimer) {
            clearInterval(window._knxHeartbeatTimer);
            window._knxHeartbeatTimer = null;
        }
        updateConnectionPill('Соединение с сервером...', false);
    });

    if (socket.io) {
        socket.io.on('reconnect_attempt', (attempt) => {
            updateConnectionPill(`Переподключение (${attempt})...`, false);
        });
        socket.io.on('reconnect_error', () => {
            updateConnectionPill('Сервер временно недоступен...', false);
        });
    }

    socket.on('authSuccess', () => {
        console.log('⚡ KNX-Proto v2.0: Сокет успешно авторизован!');
    });

    socket.on('securityAlert', (data) => {
        if (typeof showIncomingMessageBanner === 'function') {
            showIncomingMessageBanner('KNX Безопасность', (data.title || 'Вход с нового устройства') + ': ' + (data.message || data.device || ''), 'knx_support', null);
        }
        if (typeof playSound === 'function') playSound('msg');
    });

    socket.on('authError', (err) => {
        console.warn('⚠️ KNX-Proto auth warning:', err?.message);
    });

    fetch(`/api/mychats/${currentUser.kId}`).then(r => r.json()).then(res => {
        if (res.success) {
            res.chats.forEach(c => {
                unreadCounts[c.id] = c.unread || 0;
                fetchUserAndAddToSidebar(c.id, false, true);
            });
        }
    });

    socket.on('stickersUpdated', () => {
        loadStickers();
    });

    socket.on('profileUpdated', (data) => {
        if (knownUsers[data.kId]) {
            knownUsers[data.kId].name = data.name;
            knownUsers[data.kId].avatar = data.avatar;
            knownUsers[data.kId].header = data.header;
            knownUsers[data.kId].bio = data.bio;
            
            const chatItem = document.getElementById(`contact-${data.kId}`);
            if (chatItem) {
                const img = chatItem.querySelector('.avatar-img-small');
                if(img) img.src = data.avatar;
                const nm = chatItem.querySelector('.name');
                if(nm) nm.innerHTML = escapeHTML(data.name) + getUserBadgeHtml(data);
            }
            if (activeChat && activeChat.kId === data.kId) {
                const acn = document.getElementById('active-chat-name');
                if(acn) acn.innerHTML = escapeHTML(data.name) + getUserBadgeHtml(data);
                const aca = document.getElementById('active-chat-avatar');
                if(aca) aca.src = data.avatar;
            }
            if (currentProfileId === data.kId && !document.getElementById('profile-screen')?.classList.contains('hidden')) {
                loadProfileData(data.kId); 
            }
        }
    });

    const handledMsgIds = new Set();
    function dispatchNewMessage(data) {
        if (currentUser.blocked.find(b => b.kId === data.from)) return; 
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);

        if (data.from !== currentUser.kId) {
            if (currentUser.archived && currentUser.archived.includes(chatKId)) {
                if (!mutedChats.includes(chatKId)) {
                    currentUser.archived = currentUser.archived.filter(id => id !== chatKId);
                    saveCustomization();
                    renderFolderTabs();
                    sortChatList();
                }
            }
        }

        if (!chats[chatKId]) chats[chatKId] = [];
        const isFromMe = (data.from === currentUser.kId);
        const msgToPush = { 
            id: data.id, senderId: data.from, text: data.text, type: data.type, 
            timestamp: data.timestamp, status: data.status, replyTo: data.replyTo, 
            fileName: data.fileName, caption: data.caption, isPinned: false, inlineButtons: data.inlineButtons,
            isEdited: false, reactions: {}, isMine: isFromMe 
        };
        
        if (isFromMe) {
            const alreadyExists = chats[chatKId].some(m => String(m.id) === String(data.id));
            if (!alreadyExists) {
                chats[chatKId].push(msgToPush);
                saveChatsToCache();
                if (activeChat && activeChat.kId === chatKId) {
                    appendMessageToDOM(msgToPush, data.isGroup, chatKId);
                }
            }
            if (!knownUsers[chatKId]) {
                fetchUserAndAddToSidebar(chatKId, false, false);
            } else {
                addContactToDOM(knownUsers[chatKId]);
            }
            sortChatList();
            return;
        }

        chats[chatKId].push(msgToPush);
        saveChatsToCache();
        appendMessageToDOM(msgToPush, data.isGroup, chatKId);
        
        if (activeChat && activeChat.kId === chatKId) {
            if (window.chatSettings && window.chatSettings.readReceipts !== false) {
                if (window.KNXProto && socket) {
                    socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.MARK_READ, { from: currentUser.kId, to: activeChat.kId }));
                }
                socket.emit('markRead', { from: currentUser.kId, to: activeChat.kId });
            }
            document.getElementById('typing-indicator')?.classList.add('hidden');
            if(!data.isGroup && !(window.chatSettings && window.chatSettings.hideKidInChat)) {
                document.getElementById('active-chat-sub')?.classList.remove('hidden');
            }
            const inChatSound = window.chatSettings ? (window.chatSettings.notifSound !== false) : true;
            if (inChatSound) playSound('receive');

            const container = document.getElementById('messages-container');
            if (container) {
                const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (distFromBottom > 160) {
                    const badge = document.getElementById('scroll-down-badge');
                    if (badge) {
                        const cur = parseInt(badge.innerText || '0', 10) + 1;
                        badge.innerText = cur;
                        badge.classList.remove('hidden');
                    }
                    const btn = document.getElementById('scroll-down-btn');
                    if (btn) btn.classList.remove('hidden');
                }
            }
        } else {
            unreadCounts[chatKId] = (unreadCounts[chatKId] || 0) + 1;
            if (typeof updateDockBadges === 'function') updateDockBadges();
            
            if(!knownUsers[chatKId]) {
                fetchUserAndAddToSidebar(chatKId, false, true);
            } else {
                addContactToDOM(knownUsers[chatKId]); 
            }

            if(!mutedChats.includes(chatKId)) {
                const sender = knownUsers[chatKId] || { name: 'Собеседник' };
                const senderName = sender.name || 'Собеседник';
                const showPreview = window.chatSettings ? (window.chatSettings.previewNotificationText !== false) : true;
                const soundEnabled = window.chatSettings ? (window.chatSettings.notifSound !== false) : true;
                const vibrationEnabled = window.chatSettings ? (window.chatSettings.vibration !== false) : true;

                let snippet = '';
                if (showPreview) {
                    snippet = data.text ? (data.text.length > 50 ? data.text.substring(0, 50) + '...' : data.text) : (data.media ? '📷 Медиафайл' : 'Новое сообщение');
                } else {
                    snippet = 'Новое сообщение';
                }

                showIncomingMessageBanner(senderName, snippet, chatKId, sender.avatar);
                if (soundEnabled) playSound('receive');
                if (vibrationEnabled) {
                    if (typeof triggerHaptic === 'function') triggerHaptic('medium');
                    else if ('vibrate' in navigator) { try { navigator.vibrate(150); } catch(e) {} }
                }
                if (typeof dispatchSystemNotification === 'function') {
                    dispatchSystemNotification(senderName, {
                        body: snippet,
                        icon: sender.avatar || '/favicon.svg',
                        data: { chatKId: chatKId },
                        tag: `chat-${chatKId}`
                    });
                }
            }
        }
    }

    socket.on('kp_packet', (rawBuffer) => {
        try {
            if (!window.KNXProto) return;
            const packet = KNXProto.unpack(rawBuffer);
            if (!packet) return;

            switch (packet.opcode) {
                case KNXProto.OPCODES.PONG: {
                    const clientTime = (packet.payload && packet.payload.t) ? packet.payload.t : packet.timestamp;
                    const rtt = Date.now() - clientTime;
                    KNXProto.lastRTT = rtt;
                    break;
                }
                case KNXProto.OPCODES.ACK: {
                    if (packet.payload && packet.payload.id) {
                        const msgId = String(packet.payload.id);
                        const tickEl = document.querySelector(`.msg[data-id="${msgId}"] .msg-status`);
                        if (tickEl && !tickEl.innerHTML.includes('tick-double')) {
                            tickEl.innerHTML = SVG_TICK_SINGLE;
                        }
                    }
                    break;
                }
                case KNXProto.OPCODES.TYPING: {
                    if (packet.payload && activeChat && activeChat.kId === packet.payload.from) {
                        document.getElementById('typing-indicator')?.classList.remove('hidden');
                        if (!activeChat.isGroup) document.getElementById('active-chat-sub')?.classList.add('hidden');
                    }
                    break;
                }
                case KNXProto.OPCODES.STOP_TYPING: {
                    if (packet.payload && activeChat && activeChat.kId === packet.payload.from) {
                        document.getElementById('typing-indicator')?.classList.add('hidden');
                        if (!activeChat.isGroup) document.getElementById('active-chat-sub')?.classList.remove('hidden');
                    }
                    break;
                }
                case KNXProto.OPCODES.MSG_READ_ACK: {
                    if (packet.payload && activeChat && activeChat.kId === packet.payload.chatKId) {
                        document.querySelectorAll('.msg.my-msg .msg-status').forEach(el => {
                            el.innerHTML = SVG_TICK_DOUBLE;
                        });
                    }
                    break;
                }
                case KNXProto.OPCODES.MSG_RECV: {
                    if (packet.payload) {
                        const p = packet.payload;
                        if (!handledMsgIds.has(String(p.id))) {
                            handledMsgIds.add(String(p.id));
                            if (handledMsgIds.size > 500) {
                                const first = handledMsgIds.values().next().value;
                                handledMsgIds.delete(first);
                            }
                            dispatchNewMessage(p);
                        }
                    }
                    break;
                }
            }
        } catch(e) {
            console.error('Binary packet error:', e);
        }
    });

    socket.on('newMessage', (data) => {
        if (handledMsgIds.has(String(data.id))) return;
        handledMsgIds.add(String(data.id));
        if (handledMsgIds.size > 500) {
            const first = handledMsgIds.values().next().value;
            handledMsgIds.delete(first);
        }
        dispatchNewMessage(data);
    });

    socket.on('messageEdited', (data) => {
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);
        if (chats[chatKId]) {
            const msg = chats[chatKId].find(m => String(m.id) === String(data.id));
            if (msg) {
                msg.text = data.newText;
                msg.isEdited = true;
                saveChatsToCache();
                updateMessageDOM(data.id, chatKId);
                if (knownUsers[chatKId]) addContactToDOM(knownUsers[chatKId]);
                sortChatList();
            }
        }
    });

    socket.on('messageDeleted', (data) => {
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);
        if (chats[chatKId]) {
            chats[chatKId] = chats[chatKId].filter(m => String(m.id) !== String(data.id));
            saveChatsToCache();
            const el = document.querySelector(`.msg[data-id="${data.id}"]`);
            if(el) dissolveMessageElement(el);
            if (activeChat && activeChat.kId === chatKId) updatePinnedBar(chatKId);
            if (knownUsers[chatKId]) addContactToDOM(knownUsers[chatKId]);
            sortChatList();
        }
    });

    socket.on('messagesMultipleDeleted', (data) => {
        const { ids, from, to, isGroup } = data;
        const chatKId = isGroup ? to : (from === currentUser.kId ? to : from);
        if (chats[chatKId]) {
            const idSet = new Set(ids.map(String));
            chats[chatKId] = chats[chatKId].filter(m => !idSet.has(String(m.id)));
            saveChatsToCache();
            if (activeChat && activeChat.kId === chatKId) {
                ids.forEach(id => {
                    const el = document.querySelector(`.msg[data-id="${id}"]`);
                    if (el) dissolveMessageElement(el);
                });
            }
            if (knownUsers[chatKId]) addContactToDOM(knownUsers[chatKId]);
            sortChatList();
        }
    });

    socket.on('chatDeleted', (data) => {
        const chatKId = data?.chatKId;
        if (!chatKId) return;
        delete chats[chatKId];
        delete unreadCounts[chatKId];
        saveChatsToCache();
        document.getElementById(`contact-${chatKId}`)?.remove();
        if (typeof updateDockBadges === 'function') updateDockBadges();
        if (activeChat && activeChat.kId === chatKId) {
            closeMobileChat();
        }
    });

    socket.on('sessionTerminated', (data) => {
        const mySessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
        const isTerminated = (data.allOthers && data.exceptSessionId && data.exceptSessionId !== mySessionId) ||
                             (data.sessionId && data.sessionId === mySessionId) ||
                             (data.terminatedSessionIds && data.terminatedSessionIds.includes(mySessionId));
        if (isTerminated) {
            showToast('Ваш сеанс был завершен с другого устройства', 'error');
            setTimeout(logout, 1200);
        } else {
            if (typeof renderSessionsList === 'function') {
                renderSessionsList();
            }
        }
    });

    socket.on('accountDeleted', () => {
        showToast('Ваш аккаунт был удален', 'info');
        localStorage.clear();
        sessionStorage.clear();
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    });

    socket.on('messagePinned', (data) => {
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);
        if (chats[chatKId]) {
            const msg = chats[chatKId].find(m => String(m.id) === String(data.id));
            if (msg) {
                msg.isPinned = data.isPin;
                saveChatsToCache();
                if (activeChat && activeChat.kId === chatKId) {
                    if (data.isPin) {
                        const pinnedMsgs = chats[chatKId].filter(m => m.isPinned);
                        activePinIndexes[chatKId] = pinnedMsgs.length - 1;
                    }
                    updatePinnedBar(chatKId);
                }
                updateMessageDOM(data.id, chatKId);
            }
        }
    });

    function handleReactionSync(data) {
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);
        if (chats[chatKId]) {
            const msg = chats[chatKId].find(m => String(m.id) === String(data.id));
            if (msg) {
                msg.reactions = data.reactions;
                saveChatsToCache();
                if (activeChat && activeChat.kId === chatKId) {
                    updateReactionsOnly(data.id, chatKId);
                } 
            }
        }
    }
    socket.on('reactionAdded', handleReactionSync);
    socket.on('reactionUpdated', handleReactionSync);

    socket.on('messagesRead', (data) => {
        const { chatKId } = data;
        if (chats[chatKId]) {
            chats[chatKId].forEach(msg => { if (msg.isMine) msg.status = 'read'; });
            saveChatsToCache();
        }
        if (activeChat && activeChat.kId === chatKId) {
            document.querySelectorAll('.msg-status').forEach(el => el.innerHTML = SVG_TICK_DOUBLE);
        }
    });

    socket.on('chatReadSync', (data) => {
        const chatKId = data?.chatKId;
        if (!chatKId) return;
        unreadCounts[chatKId] = 0;
        if (typeof updateDockBadges === 'function') updateDockBadges();
        const contactEl = document.getElementById(`contact-${chatKId}`);
        if (contactEl) {
            contactEl.querySelector('.unread-badge')?.remove();
            contactEl.classList.remove('has-unread');
        }
    });

    socket.on('profileSync', (data) => {
        const u = data?.user || data;
        if (!u || !currentUser || (data.kId && data.kId !== currentUser.kId) || (u.kId && u.kId !== currentUser.kId)) return;
        Object.assign(currentUser, u);
        localStorage.setItem('user', JSON.stringify(currentUser));
        if (u.theme) {
            localStorage.setItem('knx_theme', u.theme);
            document.documentElement.setAttribute('data-theme', u.theme);
            document.body.setAttribute('data-theme', u.theme);
            if (typeof window.updateThemeToggleUI === 'function') window.updateThemeToggleUI(u.theme);
        }
        if (u.chatBg !== undefined && typeof applyChatBgDirectly === 'function') {
            applyChatBgDirectly(u.chatBg);
        }
        if (u.lang && typeof applyLanguage === 'function') {
            applyLanguage(u.lang);
        }
        if (typeof updateUIProfile === 'function') {
            updateUIProfile();
        }
        if (typeof renderFolderTabs === 'function') {
            renderFolderTabs();
        }
        if (typeof sortChatList === 'function') {
            sortChatList();
        }
        if (typeof renderSettingsFolders === 'function') {
            renderSettingsFolders();
        }
    });

    socket.on('userStatusChanged', (data) => {
        if(knownUsers[data.kId]) knownUsers[data.kId].isOnline = data.isOnline;
        if(activeChat && activeChat.kId === data.kId && !activeChat.isGroup) updateChatHeaderStatus(data.isOnline);
    });

    socket.on('typing', (data) => {
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);
        if (activeChat && activeChat.kId === chatKId && data.from !== currentUser.kId) {
            document.getElementById('typing-indicator')?.classList.remove('hidden');
            if(!data.isGroup) document.getElementById('active-chat-sub')?.classList.add('hidden');
        }
    });

    socket.on('stopTyping', (data) => {
        const chatKId = data.isGroup ? data.to : (data.from === currentUser.kId ? data.to : data.from);
        if (activeChat && activeChat.kId === chatKId) {
            document.getElementById('typing-indicator')?.classList.add('hidden');
            if(!data.isGroup) document.getElementById('active-chat-sub')?.classList.remove('hidden');
        }
    });
}

function renderFolderTabs() {
    const tabsContainer = document.getElementById('folder-tabs');
    if(!tabsContainer) return;
    let html = `<div class="folder-tab ${currentFolderId === 'all' ? 'active' : ''}" onclick="selectFolder('all')">Все чаты</div>`;

    if(currentUser.folders) {
        currentUser.folders.forEach(f => {
            html += `<div class="folder-tab ${currentFolderId === f.id ? 'active' : ''}" onclick="selectFolder('${f.id}')">${escapeHTML(f.name)}</div>`;
        });
    }

    const hasArchived = (currentUser.archived && currentUser.archived.length > 0) || currentFolderId === 'archived';
    if (hasArchived) {
        const count = currentUser.archived ? currentUser.archived.length : 0;
        html += `<div class="folder-tab ${currentFolderId === 'archived' ? 'active' : ''}" onclick="selectFolder('archived')">Архив ${count > 0 ? `(${count})` : ''}</div>`;
    }
    tabsContainer.innerHTML = html;
}

function selectFolder(folderId) {
    if (currentFolderId === folderId && document.getElementById('chat-list')?.children.length > 0) {
        return;
    }
    currentFolderId = folderId;
    renderFolderTabs();
    
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('archive-mode', folderId === 'archived');
    }

    const list = document.getElementById('chat-list');
    if(list) {
        list.classList.remove('chat-list-fade');
        void list.offsetWidth; 
        list.classList.add('chat-list-fade');
    }
    
    sortChatList();
    if (typeof updateDockActiveState === 'function') {
        updateDockActiveState(folderId === 'archived' ? 'archive' : 'chats');
    }
}

function updateUIProfile() {
    const mn = document.getElementById('my-name');
    if(mn) mn.innerHTML = escapeHTML(currentUser.name) + getUserBadgeHtml(currentUser);
    const mk = document.getElementById('my-kid');
    if(mk) {
        mk.innerText = currentUser.hideKid ? 'K-ID Скрыт' : `K-ID: ${currentUser.kId}`;
        if (!currentUser.hideKid && (currentUser.isVip || currentUser.role === 'vip')) {
            mk.classList.add('gold-kid');
        } else {
            mk.classList.remove('gold-kid');
        }
    }
    const ma = document.getElementById('my-avatar');
    if(ma) ma.src = currentUser.avatar;

    const dockAva = document.getElementById('dock-user-avatar');
    const dockGear = document.getElementById('dock-gear-fallback');
    if (dockAva) {
        if (currentUser.avatar) {
            dockAva.src = currentUser.avatar;
            dockAva.classList.remove('hidden');
            if (dockGear) dockGear.classList.add('hidden');
        } else {
            dockAva.classList.add('hidden');
            if (dockGear) dockGear.classList.remove('hidden');
        }
    }

    const setMyAva = document.getElementById('settings-my-avatar');
    if (setMyAva) setMyAva.src = currentUser.avatar;
    const setMyName = document.getElementById('settings-my-name');
    if (setMyName) setMyName.innerHTML = escapeHTML(currentUser.name) + getUserBadgeHtml(currentUser);
    const setMyKid = document.getElementById('settings-my-kid');
    if (setMyKid) {
        setMyKid.innerText = currentUser.hideKid ? 'K-ID Скрыт' : `K-ID: ${currentUser.kId}`;
        if (!currentUser.hideKid && (currentUser.isVip || currentUser.role === 'vip')) {
            setMyKid.classList.add('gold-kid');
        } else {
            setMyKid.classList.remove('gold-kid');
        }
    }
    const setMyBio = document.getElementById('settings-my-bio');
    if (setMyBio) setMyBio.innerText = currentUser.bio || 'Нажмите, чтобы настроить профиль';
    
    const sap = document.getElementById('settings-avatar-preview');
    if(sap) sap.src = currentUser.avatar;
    const shp = document.getElementById('settings-header-preview');
    if(shp) {
        const previewCover = currentUser.header || currentUser.avatar || '';
        shp.style.backgroundImage = previewCover ? `url("${previewCover}")` : 'none';
    }
    
    const sHeroBg = document.getElementById('settings-hero-bg');
    if (sHeroBg) {
        const heroBgImg = currentUser.header || currentUser.avatar || '';
        if (heroBgImg) {
            sHeroBg.style.backgroundImage = `url("${heroBgImg}")`;
            if (currentUser.header) {
                sHeroBg.style.filter = 'none';
                sHeroBg.style.opacity = '1';
                sHeroBg.style.transform = 'none';
            } else {
                sHeroBg.style.filter = 'none';
                sHeroBg.style.opacity = '0.78';
                sHeroBg.style.transform = 'none';
            }
        } else {
            sHeroBg.style.backgroundImage = 'none';
        }
    }
    
    const sideBg = document.getElementById('sidebar-profile-bg');
    const profHeader = document.querySelector('.profile-header');
    if (sideBg) {
        const bgImg = currentUser.header || currentUser.avatar || '';
        if (bgImg) {
            sideBg.style.backgroundImage = `url("${bgImg}")`;
            sideBg.style.display = 'block';
            if (currentUser.header) {
                sideBg.style.filter = 'none';
                sideBg.style.opacity = '0.95';
            } else {
                sideBg.style.filter = 'none';
                sideBg.style.opacity = '0.78';
            }
            if (profHeader) profHeader.classList.add('has-bg');
        } else {
            sideBg.style.backgroundImage = 'none';
            sideBg.style.display = 'none';
            if (profHeader) profHeader.classList.remove('has-bg');
        }
    }
    
    const sn = document.getElementById('set-name');
    if(sn && document.activeElement !== sn) sn.value = currentUser.name;
    const sb = document.getElementById('set-bio');
    if(sb && document.activeElement !== sb) sb.value = currentUser.bio || '';
    const shob = document.getElementById('set-hobbies');
    if(shob && document.activeElement !== shob) shob.value = currentUser.hobbies || '';
    const sbd = document.getElementById('set-birthdate');
    if(sbd && document.activeElement !== sbd) sbd.value = currentUser.birthDate || '';
    const st = document.getElementById('set-theme');
    if(st) st.value = currentUser.theme || 'light';
    const sl = document.getElementById('set-lang');
    if(sl) sl.value = currentUser.lang || 'ru';
    
    const sse = document.getElementById('set-searchable');
    if(sse) sse.checked = currentUser.searchable;
    const shk = document.getElementById('set-hide-kid');
    if(shk) shk.checked = currentUser.hideKid;
    const sha = document.getElementById('set-hide-avatar');
    if(sha) sha.checked = currentUser.hideAvatar;
    const shhe = document.getElementById('set-hide-header');
    if(shhe) shhe.checked = currentUser.hideHeader;
    const shb = document.getElementById('set-hide-bio');
    if(shb) shb.checked = currentUser.hideBio;
    const ssou = document.getElementById('set-sound');
    if(ssou) ssou.checked = currentUser.soundEnabled !== false;

    const chatArea = document.getElementById('chat-area');
    if (chatArea) {
        if (currentUser.chatBg) {
            chatArea.style.backgroundImage = `url(${currentUser.chatBg})`;
            chatArea.style.backgroundSize = 'cover';
            chatArea.style.backgroundPosition = 'center';
            chatArea.style.backgroundRepeat = 'no-repeat';
            const mc = document.getElementById('messages-container');
            if(mc) mc.style.background = 'transparent';
        } else {
            chatArea.style.backgroundImage = 'none';
        }
    }
    if (typeof window.syncPrivacySettingsUI === 'function') {
        window.syncPrivacySettingsUI();
    }
}

async function searchAndAddUser() {
    const searchInput = document.getElementById('search-input');
    if(!searchInput) return;
    const searchId = searchInput.value.trim();
    if (!searchId) return;
    if (searchId === currentUser.kId) return showToast('Это вы', 'error');

    await fetchUserAndAddToSidebar(searchId, true);
    searchInput.value = '';
    filterChats();
}

function filterChats() {
    const searchInput = document.getElementById('search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const items = document.querySelectorAll('#chat-list .chat-item');
    items.forEach(item => {
        if (!query) {
            item.style.display = '';
            return;
        }
        const nameEl = item.querySelector('.name');
        const kidEl = item.querySelector('.kid');
        const nameText = nameEl ? nameEl.textContent.toLowerCase() : '';
        const kidText = kidEl ? kidEl.textContent.toLowerCase() : '';
        const id = item.id.replace('contact-', '').toLowerCase();
        if (nameText.includes(query) || kidText.includes(query) || id.includes(query)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}
window.filterChats = filterChats;

async function fetchUserAndAddToSidebar(id, forceOpen = false, isIncomingMessage = false) {
    const res = await fetch(`/api/profile/${id}?requester=${currentUser.kId}`);
    const result = await res.json();
    
    if (result.success && (result.data.searchable !== false || isIncomingMessage)) {
        let chatData = result.data;
        chatData.isGroup = (result.type === 'group'); 
        
        knownUsers[chatData.kId] = chatData;
        
        if (chatData.isGroup && !chatData.members.includes(currentUser.kId)) {
            if (forceOpen) openProfileScreen(chatData.kId);
            return;
        }

        addContactToDOM(chatData);
        if (forceOpen) openChat(chatData);
    } else {
        if (forceOpen) showToast('Не найдено (или скрыто приватностью)', 'error');
    }
}

const SWIPE_ACTION_META = {
    'pin': { text: 'Закрепить', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-2l-2-3V6a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v6l-2 3v2z"></path></svg>', bg: '#007aff' },
    'read': { text: 'Прочитано', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>', bg: '#34c759' },
    'archive': { text: 'Архив', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>', bg: '#007aff' },
    'mute': { text: 'Без звука', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><line x1="1" y1="23" x2="23" y2="23"></line></svg>', bg: '#ff9500' },
    'delete': { text: 'Удалить', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>', bg: '#ff3b30' },
    'folders': { text: 'Папки', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>', bg: '#5856d6' }
};

function getChatLastMessagePreview(chatKId) {
    const list = chats[chatKId];
    if (!list || !Array.isArray(list) || list.length === 0) return null;
    const lastMsg = list[list.length - 1];
    if (!lastMsg) return null;

    const isMine = !!(lastMsg.isMine || (currentUser && lastMsg.senderId === currentUser.kId));
    let text = '';
    if (lastMsg.type === 'image') text = lastMsg.caption ? `📷 ${lastMsg.caption}` : '📷 Фотография';
    else if (lastMsg.type === 'audio') text = '🎤 Голосовое сообщение';
    else if (lastMsg.type === 'sticker') text = '🎭 Стикер';
    else if (lastMsg.type === 'file') text = `📁 ${lastMsg.fileName || 'Файл'}`;
    else text = (lastMsg.text || '').replace(/\r?\n/g, ' ');

    if (text.length > 40) {
        text = text.substring(0, 40).trim() + '...';
    }

    if (isMine) {
        return `Вы: ${text}`;
    }
    return text;
}
window.getChatLastMessagePreview = getChatLastMessagePreview;

function addContactToDOM(user) {
    const list = document.getElementById('chat-list');
    if(!list) return;
    let div = document.getElementById(`contact-${user.kId}`);
    const lastPreview = getChatLastMessagePreview(user.kId);
    const hasPreview = (lastPreview !== null && lastPreview !== undefined && lastPreview !== '');
    let subtext = hasPreview
        ? lastPreview
        : (user.isGroup ? (user.groupType === 'channel' ? 'Канал' : 'Группа') : (user.isBot ? 'Бот' : user.kId));
    
    const devHtml = getUserBadgeHtml(user);
    const isMuted = mutedChats.includes(user.kId);
    const muteHtml = isMuted ? `<div class="mute-icon"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg></div>` : '';
    const unread = unreadCounts[user.kId] || 0;
    const unreadHtml = unread > 0 ? `<div class="unread-badge">${unread}</div>` : '';
    const isVipUser = !hasPreview && !user.isGroup && !user.isBot && !user.hideKid && (user.isVip || user.role === 'vip');

    const isPinned = pinnedChats.includes(user.kId);
    const pinHtml = isPinned ? `<div class="pinned-chat-badge" title="Закреплено"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M16 9V4l1 0c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1l1 0v5c0 1.66-1.34 3-3 3v2h5.97v7l1.03 1 1.03-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg></div>` : '';
    const isArchived = currentUser.archived && currentUser.archived.includes(user.kId);
    const pinText = isPinned ? 'Открепить' : 'Закрепить';
    const archiveText = isArchived ? 'Из архива' : 'В архив';
    const muteText = isMuted ? 'Звук' : 'Без звука';

    const leftAction = (window.chatSettings && window.chatSettings.swipeAction) || 'archive';
    const leftMeta = SWIPE_ACTION_META[leftAction] || SWIPE_ACTION_META['archive'];
    const swipeLeftBgHtml = `
        <div class="chat-item-swipe-bg" id="swipe-bg-${user.kId}" style="background-color: ${leftMeta.bg};">
            <span class="swipe-bg-icon">${leftMeta.icon}</span>
            <span class="swipe-bg-text">${leftMeta.text}</span>
        </div>
    `;

    const swipeActionsHtml = `
        <div class="chat-swipe-actions">
            <button class="chat-swipe-btn swipe-btn-pin" onclick="handleSwipePin(event, '${user.kId}')" title="${pinText}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="17" x2="12" y2="22"></line>
                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"></path>
                </svg>
                <span>${pinText}</span>
            </button>
            <button class="chat-swipe-btn swipe-btn-archive" onclick="handleSwipeArchive(event, '${user.kId}')" title="${archiveText}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8"></polyline>
                    <rect x="1" y="3" width="22" height="5"></rect>
                    <line x1="10" y1="12" x2="14" y2="12"></line>
                </svg>
                <span>${archiveText}</span>
            </button>
            <button class="chat-swipe-btn swipe-btn-mute" onclick="handleSwipeMute(event, '${user.kId}')" title="${muteText}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${isMuted 
                        ? '<path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>'
                        : '<path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>'
                    }
                </svg>
                <span>${muteText}</span>
            </button>
        </div>
    `;

    const contentHtml = `
        <div class="chat-item-content">
            <img class="avatar-img-small" src="${user.avatar}" alt="">
            <div class="info">
                <div class="name">${escapeHTML(user.name)}${devHtml}</div>
                <div class="kid ${isVipUser ? 'gold-kid' : ''}">${escapeHTML(subtext)}</div>
            </div>
            <div class="chat-meta">${pinHtml}${muteHtml}${unreadHtml}</div>
        </div>
    `;

    if (!div) {
        div = document.createElement('div');
        div.className = 'chat-item';
        div.id = `contact-${user.kId}`;
        div.innerHTML = swipeActionsHtml + swipeLeftBgHtml + contentHtml;
        div.oncontextmenu = (e) => { e.preventDefault(); openChatContextMenu(e, user.kId); };
        div.onclick = (e) => {
            if (div.classList.contains('swiped-open')) {
                closeChatSwipe(div);
                return;
            }
            openChat(user);
        };
        list.appendChild(div);
        attachChatSwipe(div, user.kId);
    } else {
        let contentDiv = div.querySelector('.chat-item-content');
        if (!contentDiv) {
            div.innerHTML = swipeActionsHtml + swipeLeftBgHtml + contentHtml;
            attachChatSwipe(div, user.kId);
        } else {
            const img = contentDiv.querySelector('.avatar-img-small');
            if (img && user.avatar && img.src !== user.avatar) img.src = user.avatar;
            const nm = contentDiv.querySelector('.name');
            const expectedName = escapeHTML(user.name) + devHtml;
            if (nm && nm.innerHTML !== expectedName) nm.innerHTML = expectedName;
            const kd = contentDiv.querySelector('.kid');
            if (kd && kd.innerText !== subtext) {
                kd.innerText = subtext;
                if (isVipUser) kd.classList.add('gold-kid');
                else kd.classList.remove('gold-kid');
            }
            let metaDiv = contentDiv.querySelector('.chat-meta');
            if (!metaDiv) {
                metaDiv = document.createElement('div');
                metaDiv.className = 'chat-meta';
                contentDiv.appendChild(metaDiv);
            }
            const expectedMeta = pinHtml + muteHtml + unreadHtml;
            if (metaDiv.innerHTML !== expectedMeta) {
                metaDiv.innerHTML = expectedMeta;
            }
        }
    }
    
    if(pinnedChats.includes(user.kId)) div.classList.add('pinned'); else div.classList.remove('pinned');
    if(isMuted) div.classList.add('muted'); else div.classList.remove('muted');

    if (window._sortChatListRaf) cancelAnimationFrame(window._sortChatListRaf);
    window._sortChatListRaf = requestAnimationFrame(() => {
        window._sortChatListRaf = null;
        sortChatList();
    });
}

function closeChatSwipe(item) {
    if (!item) return;
    item.classList.remove('swiped-open', 'swiping');
    const content = item.querySelector('.chat-item-content');
    if (content) {
        content.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
        content.style.transform = '';
        setTimeout(() => {
            if (!item.classList.contains('swiped-open')) {
                content.style.transition = '';
            }
        }, 240);
    }
}

function closeAllChatSwipes() {
    document.querySelectorAll('.chat-item.swiped-open, .chat-item.swiping').forEach(el => {
        closeChatSwipe(el);
    });
}

function attachChatSwipe(div, kId) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwiping = false;
    let isHorizontal = false;

    const content = div.querySelector('.chat-item-content');
    if (!content) return;

    function onTouchStart(e) {
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = startX;
        isSwiping = true;
        isHorizontal = false;
    }

    function onTouchMove(e) {
        if (!isSwiping) return;
        const touch = e.touches ? e.touches[0] : e;
        currentX = touch.clientX;
        const diffX = currentX - startX;
        const diffY = touch.clientY - startY;

        if (!isHorizontal) {
            if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
                if (Math.abs(diffX) > Math.abs(diffY)) {
                    isHorizontal = true;
                    div.classList.add('swiping');
                } else {
                    isSwiping = false;
                    return;
                }
            }
        }

        if (isHorizontal) {
            const isOpen = div.classList.contains('swiped-open');
            if (isOpen) {
                let offset = 195 + diffX;
                if (offset < 0) offset = 0;
                content.style.transition = 'none';
                content.style.transform = `translateX(${offset}px)`;
            } else if (diffX > 0) {
                let offset = diffX;
                if (offset > 220) offset = 220 + (offset - 220) * 0.2;
                content.style.transition = 'none';
                content.style.transform = `translateX(${offset}px)`;
            } else {
                let offset = diffX;
                if (offset < -120) offset = -120 + (offset + 120) * 0.2;
                content.style.transition = 'none';
                content.style.transform = `translateX(${offset}px)`;

                const swipeBg = div.querySelector('.chat-item-swipe-bg');
                if (swipeBg) {
                    const act = (window.chatSettings && window.chatSettings.swipeAction) || 'archive';
                    const meta = SWIPE_ACTION_META[act] || SWIPE_ACTION_META['archive'];
                    swipeBg.style.backgroundColor = meta.bg;
                    const iconSpan = swipeBg.querySelector('.swipe-bg-icon');
                    if (iconSpan) iconSpan.innerHTML = meta.icon;
                    const textSpan = swipeBg.querySelector('.swipe-bg-text');
                    if (textSpan) textSpan.innerText = meta.text;
                }
            }
        }
    }

    function onTouchEnd() {
        if (!isSwiping && !isHorizontal) return;
        isSwiping = false;
        div.classList.remove('swiping');

        const diffX = currentX - startX;
        const isOpen = div.classList.contains('swiped-open');

        if (isOpen) {
            if (diffX < -30) {
                closeChatSwipe(div);
            } else {
                content.style.transition = 'transform 0.2s ease';
                content.style.transform = '';
            }
        } else {
            if (isHorizontal && diffX > 60) {
                closeAllChatSwipes();
                div.classList.add('swiped-open');
                content.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
                content.style.transform = '';
            } else if (isHorizontal && diffX < -65) {
                closeChatSwipe(div);
                const act = (window.chatSettings && window.chatSettings.swipeAction) || 'archive';
                executeSwipeAction(kId, act);
            } else {
                closeChatSwipe(div);
            }
        }
        isHorizontal = false;
    }

    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchmove', onTouchMove, { passive: true });
    content.addEventListener('touchend', onTouchEnd, { passive: true });
    content.addEventListener('touchcancel', onTouchEnd, { passive: true });

    let isMouseDown = false;
    content.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || window.innerWidth > 768) return;
        isMouseDown = true;
        onTouchStart(e);

        function onMouseMove(moveEvent) {
            if (!isMouseDown) return;
            onTouchMove(moveEvent);
        }

        function onMouseUp() {
            if (!isMouseDown) return;
            isMouseDown = false;
            onTouchEnd();
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

window.executeSwipeAction = function(kId, action) {
    if (!kId) return;
    const act = action || (window.chatSettings && window.chatSettings.swipeAction) || 'archive';
    if (typeof triggerHaptic === 'function') triggerHaptic('medium');

    switch(act) {
        case 'pin':
            if (typeof pinChat === 'function') pinChat(kId);
            break;
        case 'read':
            if (unreadCounts[kId]) {
                unreadCounts[kId] = 0;
                updateUnreadBadge(kId);
            }
            if (socket && socket.connected) {
                socket.emit('mark_read', { from: kId, to: currentUser.kId });
            }
            showToast('Чат отмечен как прочитанный', 'info');
            break;
        case 'archive':
            if (typeof handleSwipeArchive === 'function') {
                handleSwipeArchive(null, kId);
            }
            break;
        case 'mute':
            if (typeof muteChat === 'function') muteChat(kId);
            break;
        case 'delete':
            if (typeof confirmDeleteChat === 'function') confirmDeleteChat(kId);
            break;
        default:
            if (typeof handleSwipeArchive === 'function') {
                handleSwipeArchive(null, kId);
            }
            break;
    }
};

window.handleSwipePin = function(e, kId) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const item = document.getElementById(`contact-${kId}`);
    if (item) closeChatSwipe(item);
    pinChat(kId);
};

window.handleSwipeArchive = function(e, kId) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const item = document.getElementById(`contact-${kId}`);
    if (item) closeChatSwipe(item);
    toggleArchiveChat(kId);
};

window.handleSwipeMute = function(e, kId) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const item = document.getElementById(`contact-${kId}`);
    if (item) closeChatSwipe(item);
    muteChat(kId);
};

function sortChatList() {
    const list = document.getElementById('chat-list');
    if(!list) return;
    const items = Array.from(list.children).filter(el => !el.classList.contains('archive-empty-placeholder'));
    
    let visibleCount = 0;
    items.forEach(item => {
        const kId = item.id.replace('contact-', '');
        let show = true;
        const isArchived = currentUser.archived && currentUser.archived.includes(kId);

        if(currentFolderId === 'all') {
            if(isArchived) show = false;
        } else if (currentFolderId === 'archived') {
            if(!isArchived) show = false;
        } else {
            const folder = currentUser.folders.find(f => f.id === currentFolderId);
            if(folder && !folder.chats.includes(kId)) show = false;
            if(isArchived) show = false; 
        }
        item.style.display = show ? 'flex' : 'none';
        if (show) visibleCount++;
    });

    const oldPlaceholder = list.querySelector('.archive-empty-placeholder');
    if (oldPlaceholder) oldPlaceholder.remove();

    if (currentFolderId === 'archived' && visibleCount === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'archive-empty-placeholder';
        placeholder.innerHTML = `
            <div style="font-size: 34px; margin-bottom: 8px;">📦</div>
            <div style="font-weight: 700; font-size: 15px; margin-bottom: 5px; color: var(--text-main);">В архиве пусто</div>
            <div style="font-size: 12.5px; color: var(--text-muted); max-width: 220px; line-height: 1.4;">Нажмите правой кнопкой мыши по чату и выберите «В архив», чтобы скрыть диалог</div>
        `;
        list.appendChild(placeholder);
    }

    items.sort((a, b) => {
        const aId = a.id.replace('contact-', '');
        const bId = b.id.replace('contact-', '');
        const aPinned = pinnedChats.includes(aId);
        const bPinned = pinnedChats.includes(bId);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        if (aPinned && bPinned) {
            return pinnedChats.indexOf(bId) - pinnedChats.indexOf(aId);
        }
        const aList = chats[aId] || [];
        const bList = chats[bId] || [];
        const aTime = aList.length > 0 ? (aList[aList.length - 1].timestamp || 0) : 0;
        const bTime = bList.length > 0 ? (bList[bList.length - 1].timestamp || 0) : 0;
        return bTime - aTime;
    });
    let orderChanged = false;
    for (let i = 0; i < items.length; i++) {
        if (list.children[i] !== items[i]) {
            orderChanged = true;
            break;
        }
    }
    if (orderChanged) {
        const frag = document.createDocumentFragment();
        items.forEach(item => frag.appendChild(item));
        list.appendChild(frag);
    }
}

const chatScrollState = {};

async function openChat(user) {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    if (activeChat && activeChat.kId) {
        const c = document.getElementById('messages-container');
        if (c) {
            const isBottom = (c.scrollHeight - c.scrollTop <= c.clientHeight + 60);
            chatScrollState[activeChat.kId] = { top: c.scrollTop, wasAtBottom: isBottom };
        }
    }

    activeChat = user;
    window.activeChat = user;
    cancelReply(); 
    cancelEdit();
    openMobileChat();
    
    unreadCounts[user.kId] = 0;
    if (typeof updateDockBadges === 'function') updateDockBadges();
    const contactEl = document.getElementById(`contact-${user.kId}`);
    if (contactEl) {
        contactEl.querySelector('.unread-badge')?.remove();
        contactEl.classList.remove('has-unread');
    } else {
        addContactToDOM(user); 
    }

    document.querySelectorAll('.chat-item.active').forEach(el => el.classList.remove('active'));
    if(contactEl) contactEl.classList.add('active');

    document.getElementById('desktop-no-chat')?.classList.add('hidden');
    document.getElementById('no-chat-selected')?.classList.add('hidden');
    document.getElementById('chat-header')?.classList.remove('hidden');
    document.getElementById('messages-container')?.classList.remove('hidden');
    document.getElementById('sticker-picker')?.classList.add('hidden');
    document.getElementById('typing-indicator')?.classList.add('hidden');
    const acs = document.getElementById('active-chat-sub');
    if(acs) {
        acs.classList.remove('hidden');
        if (user.isGroup) {
            const isChannel = user.groupType === 'channel' || user.type === 'channel';
            const mCount = (user.members && Array.isArray(user.members)) ? user.members.length : 1;
            acs.innerText = formatMembersCount(mCount, isChannel);
            acs.style.color = 'var(--text-muted)';
            acs.classList.remove('gold-kid');
        } else if (user.isBot) {
            acs.innerText = 'бот';
            acs.style.color = 'var(--text-muted)';
            acs.classList.remove('gold-kid');
        } else {
            const hideKidInChat = user.hideKid || (window.chatSettings && window.chatSettings.hideKidInChat);
            if (user.isOnline) {
                acs.innerText = 'в сети';
                acs.style.color = 'var(--accent, #007aff)';
            } else if (!hideKidInChat) {
                acs.innerText = `K-ID: ${user.kId}`;
                acs.style.color = 'var(--text-muted)';
            } else {
                acs.innerText = 'был(а) недавно';
                acs.style.color = 'var(--text-muted)';
            }
            if (user.isVip || user.role === 'vip') {
                acs.classList.add('gold-kid');
            } else {
                acs.classList.remove('gold-kid');
            }
        }
    }
    
    const acn = document.getElementById('active-chat-name');
    if(acn) acn.innerHTML = escapeHTML(user.name) + getUserBadgeHtml(user);
    const aca = document.getElementById('active-chat-avatar');
    if(aca) aca.src = user.avatar;
    if (!user.isGroup) updateChatHeaderStatus(user.isOnline);
    else document.getElementById('active-chat-online')?.classList.add('hidden');
    updatePinnedBar(user.kId);

    const inputArea = document.getElementById('input-area');
    const readonlyBanner = document.getElementById('channel-readonly');
    if(inputArea) inputArea.classList.remove('hidden');
    if(readonlyBanner) readonlyBanner.classList.add('hidden');

    const container = document.getElementById('messages-container');
    let chatBox = document.getElementById('chat-box-' + user.kId);

    if (container) {
        container.style.scrollBehavior = 'auto';
        if (window.currentActiveChatBox && window.currentActiveChatBox.id !== 'chat-box-' + user.kId) {
            window.currentActiveChatBox.style.display = 'none';
        }
    }

    if (!chatBox) {
        chatBox = document.createElement('div');
        chatBox.id = 'chat-box-' + user.kId;
        chatBox.className = 'chat-box-inner';
        if (container) container.appendChild(chatBox);

        const cachedList = chats[user.kId] || [];
        if (cachedList.length > 0) {
            chatBox.innerHTML = cachedList.map(m => generateMessageHTML(m, user.isGroup || false, false)).join('');
        }
        requestAnimationFrame(() => {
            if (container && activeChat && activeChat.kId === user.kId) {
                container.scrollTop = container.scrollHeight;
            }
        });
    } else {
        chatBox.style.display = 'flex';
        const state = chatScrollState[user.kId];
        requestAnimationFrame(() => {
            if (container && activeChat && activeChat.kId === user.kId) {
                if (!state || state.wasAtBottom) {
                    container.scrollTop = container.scrollHeight;
                } else {
                    container.scrollTop = state.top;
                }
            }
        });
    }
    window.currentActiveChatBox = chatBox;

    const scrollBtn = document.getElementById('scroll-down-btn');
    const scrollBadge = document.getElementById('scroll-down-badge');
    if (scrollBtn) scrollBtn.classList.add('hidden');
    if (scrollBadge) {
        scrollBadge.innerText = '0';
        scrollBadge.classList.add('hidden');
    }

    fetch(`/api/history?kId=${currentUser.kId}&targetId=${user.kId}&isGroup=${user.isGroup || false}&limit=50`)
    .then(r => r.json())
    .then(histRes => {
        if (!histRes.success) return;
        activeChatHasMore = histRes.hasMore !== false;
        const fetchedChats = histRes.history.map(m => ({
            id: m.id, senderId: m.senderId, text: m.text, type: m.type, 
            timestamp: m.timestamp, status: m.status, replyTo: m.replyTo, 
            fileName: m.fileName, caption: m.caption, isPinned: m.isPinned || false, inlineButtons: m.inlineButtons,
            isEdited: m.isEdited, reactions: m.reactions || {},
            isMine: m.senderId === currentUser.kId
        }));

        chats[user.kId] = fetchedChats;
        saveChatsToCache();

        let targetBox = document.getElementById('chat-box-' + user.kId);
        if (!targetBox) return;

        if (targetBox.children.length === 0 && fetchedChats.length > 0) {
            targetBox.innerHTML = fetchedChats.map(m => generateMessageHTML(m, user.isGroup || false, false)).join('');
            if (container && activeChat && activeChat.kId === user.kId) {
                container.scrollTop = container.scrollHeight;
            }
        } else if (fetchedChats.length > 0) {
            const existingDomIds = new Set(Array.from(targetBox.children).map(c => c.getAttribute('data-id')));
            const lastDomMsg = targetBox.lastElementChild;
            const lastDomId = lastDomMsg ? lastDomMsg.getAttribute('data-id') : null;
            const newMsgs = fetchedChats.filter(m => !existingDomIds.has(String(m.id)) && (!lastDomId || String(m.id) > String(lastDomId)));

            if (newMsgs.length > 0) {
                const wasAtBottom = container ? (container.scrollHeight - container.scrollTop <= container.clientHeight + 80) : true;
                targetBox.insertAdjacentHTML('beforeend', newMsgs.map(m => generateMessageHTML(m, user.isGroup || false, false)).join(''));
                if (wasAtBottom && container && activeChat && activeChat.kId === user.kId) {
                    container.scrollTop = container.scrollHeight;
                }
            }

            fetchedChats.forEach(m => {
                if (existingDomIds.has(String(m.id))) {
                    updateReactionsOnly(m.id, user.kId);
                    if (m.isMine && m.status === 'read') {
                        const statusEl = targetBox.querySelector(`.msg[data-id="${m.id}"] .msg-status`);
                        if (statusEl && !statusEl.innerHTML.includes('polyline')) {
                            statusEl.innerHTML = SVG_TICK_DOUBLE;
                        }
                    }
                }
            });
        }
    });

    fetch(`/api/profile/${user.kId}?requester=${currentUser.kId}`)
    .then(resProf => resProf.json())
    .then(profData => {
        if (!activeChat || activeChat.kId !== user.kId) return;
        const isBlockedMe = profData.success && profData.data.isBlockedMe;
        const isDevUser = profData.success && profData.data.isDev;

        if (isBlockedMe) {
            if(readonlyBanner) {
                readonlyBanner.innerText = 'Вы заблокированы этим пользователем';
                readonlyBanner.classList.remove('hidden');
            }
        } else if (user.isGroup && user.groupType === 'channel' && user.creatorId !== currentUser.kId) {
            if(readonlyBanner) {
                readonlyBanner.innerText = 'Только администратор может публиковать сообщения';
                readonlyBanner.classList.remove('hidden');
            }
        } else {
            if(inputArea) inputArea.classList.remove('hidden');
        }

        const displayUser = isBlockedMe ? profData.data : user;

        const badgeHtml = getUserBadgeHtml(displayUser);
        const acn = document.getElementById('active-chat-name');
        if (acn) {
            acn.innerHTML = escapeHTML(displayUser.name) + badgeHtml;
        }
        if (displayUser.avatar && aca && aca.src !== displayUser.avatar) {
            aca.src = displayUser.avatar;
        }
        
        if (!displayUser.isGroup && !isBlockedMe) updateChatHeaderStatus(displayUser.isOnline);
        else document.getElementById('active-chat-online')?.classList.add('hidden');
        
        updatePinnedBar(user.kId);
    });

    if (window.chatSettings && window.chatSettings.readReceipts !== false) {
        if (window.KNXProto && socket && socket.connected) {
            socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.MARK_READ, { from: currentUser.kId, to: user.kId }));
        } else if (socket) {
            socket.emit('markRead', { from: currentUser.kId, to: user.kId });
        }
    }
}

let activeChatHasMore = false;
let isLoadingMoreHistory = false;

async function loadMoreHistory() {
    if (isLoadingMoreHistory || !activeChat || !activeChatHasMore) return;
    const container = document.getElementById('messages-container');
    if (!container) return;
    const chatBox = document.getElementById('chat-box-' + activeChat.kId);
    if (!chatBox) return;

    const currentList = chats[activeChat.kId] || [];
    if (currentList.length === 0) return;
    const earliestMsg = currentList[0];

    isLoadingMoreHistory = true;
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    try {
        const res = await fetch(`/api/history?kId=${currentUser.kId}&targetId=${activeChat.kId}&isGroup=${activeChat.isGroup || false}&limit=40&before=${earliestMsg.id}`);
        const histRes = await res.json();
        if (histRes.success && histRes.history && histRes.history.length > 0) {
            activeChatHasMore = histRes.hasMore !== false;
            const olderMsgs = histRes.history.map(m => ({
                id: m.id, senderId: m.senderId, text: m.text, type: m.type,
                timestamp: m.timestamp, status: m.status, replyTo: m.replyTo,
                fileName: m.fileName, caption: m.caption, isPinned: m.isPinned || false,
                inlineButtons: m.inlineButtons, isEdited: m.isEdited, reactions: m.reactions || {},
                isMine: m.senderId === currentUser.kId
            }));

            chats[activeChat.kId] = [...olderMsgs, ...currentList];
            saveChatsToCache();

            const frag = document.createDocumentFragment();
            olderMsgs.forEach(m => {
                const temp = document.createElement('div');
                temp.innerHTML = generateMessageHTML(m, activeChat.isGroup);
                if (temp.firstElementChild) frag.appendChild(temp.firstElementChild);
            });
            chatBox.insertBefore(frag, chatBox.firstElementChild);

            container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        } else {
            activeChatHasMore = false;
        }
    } catch(err) {
        console.error('Error loading earlier messages:', err);
    } finally {
        isLoadingMoreHistory = false;
    }
}

function formatMembersCount(count, isChannel = false) {
    const n = Math.abs(parseInt(count, 10)) || 1;
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (isChannel) {
        if (mod100 >= 11 && mod100 <= 19) return `${n} подписчиков`;
        if (mod10 === 1) return `${n} подписчик`;
        if (mod10 >= 2 && mod10 <= 4) return `${n} подписчика`;
        return `${n} подписчиков`;
    } else {
        if (mod100 >= 11 && mod100 <= 19) return `${n} участников`;
        if (mod10 === 1) return `${n} участник`;
        if (mod10 >= 2 && mod10 <= 4) return `${n} участника`;
        return `${n} участников`;
    }
}
window.formatMembersCount = formatMembersCount;

function updateChatHeaderStatus(isOnline) {
    const dot = document.getElementById('active-chat-online');
    if(dot) {
        dot.classList.remove('hidden', 'offline');
        if (!isOnline) dot.classList.add('offline');
    }
    const acs = document.getElementById('active-chat-sub');
    if (acs && activeChat && !activeChat.isGroup && !activeChat.isBot) {
        if (isOnline) {
            acs.innerText = 'в сети';
            acs.style.color = 'var(--accent, #007aff)';
        } else {
            const hideKidInChat = activeChat.hideKid || (window.chatSettings && window.chatSettings.hideKidInChat);
            acs.innerText = hideKidInChat ? 'был(а) недавно' : `K-ID: ${activeChat.kId}`;
            acs.style.color = 'var(--text-muted)';
        }
    }
}

function updatePinnedBar(kId) {
    const bar = document.getElementById('pinned-bar');
    if(!bar) return;
    if(!chats[kId]) return bar.classList.add('hidden');
    
    const pinnedMsgs = chats[kId].filter(m => m.isPinned);
    
    if(pinnedMsgs.length > 0) {
        bar.classList.remove('hidden');
        
        if (activePinIndexes[kId] === undefined || activePinIndexes[kId] >= pinnedMsgs.length || activePinIndexes[kId] < 0) {
            activePinIndexes[kId] = pinnedMsgs.length - 1;
        }
        
        const currentIndex = activePinIndexes[kId];
        const pinnedMsg = pinnedMsgs[currentIndex];
        bar.setAttribute('data-target-id', pinnedMsg.id);

        let prefix = pinnedMsgs.length > 1 ? `<span style="font-weight:600; opacity:0.8;">[${currentIndex + 1}/${pinnedMsgs.length}]</span> ` : '';
        let contentText = pinnedMsg.type === 'text' ? pinnedMsg.text : (pinnedMsg.type === 'image' ? 'Фотография' : (pinnedMsg.type === 'sticker' ? 'Стикер' : (pinnedMsg.type === 'audio' ? 'Голосовое сообщение' : 'Файл')));

        bar.innerHTML = `
            <div style="width: 3px; height: 34px; background: var(--accent); border-radius: 3px; margin-right: 12px; flex-shrink: 0;"></div>
            <div style="display:flex; flex-direction:column; overflow:hidden; flex-grow: 1;">
                <span style="font-size:13px; font-weight:600; color:var(--accent); margin-bottom: 2px;">Закреплённое сообщение ${prefix}</span>
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size:13px; color:var(--text-main);">${escapeHTML(contentText)}</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" stroke="var(--text-muted)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; opacity: 0.6; margin-left: 10px;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5c0-1.5-2-3.5-2-3.5v-7c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v7c0 0-2 2-2 3.5V17z"></path></svg>
        `;
    } else {
        bar.classList.add('hidden');
        activePinIndexes[kId] = -1;
    }
}

function scrollToPinned() {
    const bar = document.getElementById('pinned-bar');
    if(!bar) return;
    const msgId = bar.getAttribute('data-target-id');
    if(!msgId) return;
    
    const chatBox = document.getElementById('chat-box-' + activeChat.kId);
    if(chatBox) {
        const msgEl = chatBox.querySelector(`.msg[data-id="${msgId}"]`);
        if(msgEl) {
            msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            msgEl.classList.remove('pinned-msg-highlight');
            void msgEl.offsetWidth; 
            msgEl.classList.add('pinned-msg-highlight');
            setTimeout(() => msgEl.classList.remove('pinned-msg-highlight'), 2000);
        }
    }
    
    const pinnedMsgs = chats[activeChat.kId].filter(m => m.isPinned);
    if (pinnedMsgs.length > 1) {
        activePinIndexes[activeChat.kId]--;
        if (activePinIndexes[activeChat.kId] < 0) activePinIndexes[activeChat.kId] = pinnedMsgs.length - 1;
        updatePinnedBar(activeChat.kId);
    }
}

function updateReactionsOnly(msgId, chatKId) {
    if (!chats[chatKId]) return;
    const msg = chats[chatKId].find(m => String(m.id) === String(msgId));
    if (!msg) return;

    const div = document.querySelector(`.msg[data-id="${msgId}"]`);
    if (!div) return;

    const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;
    const newReactionsKey = hasReactions ? JSON.stringify(msg.reactions) : '';
    const currentReactionsKey = div.getAttribute('data-reactions-key') || '';
    if (currentReactionsKey === newReactionsKey) {
        return; // Полное совпадение — не трогаем DOM и исключаем любое мерцание
    }
    div.setAttribute('data-reactions-key', newReactionsKey);

    const oldReactions = div.querySelector('.msg-reactions');
    if (oldReactions) oldReactions.remove();

    if (hasReactions) {
        let rHtml = `<div class="msg-reactions">`;
        for (const [emoji, usersReacted] of Object.entries(msg.reactions)) {
            let extraClass = usersReacted.includes(currentUser.kId) ? 'my-reaction' : '';
            rHtml += `<span class="reaction-badge ${extraClass}" data-emoji="${emoji}">${emoji} ${usersReacted.length}</span>`;
        }
        rHtml += `</div>`;
        div.insertAdjacentHTML('beforeend', rHtml);
    }
}

function showDoubleTapEffect(msgEl, emoji) {
    if (!msgEl) return;
    const effect = document.createElement('div');
    effect.className = 'double-tap-heart-effect';
    effect.textContent = emoji || '❤️';
    msgEl.appendChild(effect);
    setTimeout(() => { if (effect.parentNode) effect.remove(); }, 800);
}

function scrollToRepliedMsg(targetId) {
    const id = targetId || (replyingToMsg ? replyingToMsg.id : null);
    if (!id) return;
    const msgEl = document.querySelector(`.msg[data-id="${id}"]`);
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        msgEl.classList.remove('highlight-reply-flash');
        void msgEl.offsetWidth;
        msgEl.classList.add('highlight-reply-flash');
        setTimeout(() => msgEl.classList.remove('highlight-reply-flash'), 1500);
    } else {
        showToast('Сообщение находится выше в истории', 'info');
    }
}

function generateMessageHTML(msg, isGroupChat, isNew = false) {
    let contentHtml = '';
    
    const isChannel = activeChat ? (activeChat.groupType === 'channel') : false;

    if (isGroupChat && !msg.isMine && !isChannel) {
        let senderName = knownUsers[msg.senderId] ? knownUsers[msg.senderId].name : 'Участник';
        let devBdg = knownUsers[msg.senderId] ? getUserBadgeHtml(knownUsers[msg.senderId]) : '';
        contentHtml += `<div class="msg-sender">${escapeHTML(senderName)}${devBdg}</div>`;
    }

    if (msg.replyTo) {
        contentHtml += `
            <div class="reply-block" onclick="event.stopPropagation(); scrollToRepliedMsg('${msg.replyTo.id}')">
                <div class="reply-sender">${escapeHTML(msg.replyTo.sender)}</div>
                <div class="reply-text">${escapeHTML(msg.replyTo.text)}</div>
            </div>`;
    }

    if (msg.type === 'image') {
        contentHtml += `<img src="${msg.text}" class="chat-photo" onclick="event.stopPropagation(); openImageViewer('${msg.text}')" onload="if(typeof scrollToBottom==='function')scrollToBottom()">`;
        if(msg.caption) contentHtml += `<div class="msg-caption">${escapeHTML(msg.caption)}</div>`;
    } else if (msg.type === 'file') {
        contentHtml += `<div class="file-attachment"><a href="${msg.text}" download="${escapeHTML(msg.fileName)}">📎 ${escapeHTML(msg.fileName)}</a></div>`;
        if(msg.caption) contentHtml += `<div class="msg-caption">${escapeHTML(msg.caption)}</div>`;
    } else if (msg.type === 'audio') {
        contentHtml += `<audio controls src="${msg.text}" style="max-width: 250px; height: 35px; margin-top: 5px;"></audio>`;
    } else if (msg.type === 'sticker') {
        contentHtml += `<img src="${msg.text}" class="chat-sticker" onload="if(typeof scrollToBottom==='function')scrollToBottom()">`;
    } else {
        contentHtml += `<div class="msg-text-content">${escapeHTML(msg.text)}</div>`;
    }
    
    if (msg.inlineButtons && msg.inlineButtons.length > 0) {
        contentHtml += `<div class="inline-buttons">`;
        msg.inlineButtons.forEach(btn => {
            contentHtml += `<button class="inline-btn" onclick="handleInlineAction('${btn.action}', '${escapeHTML(btn.payload)}')">${escapeHTML(btn.text)}</button>`;
        });
        contentHtml += `</div>`;
    }
    
    let timeString = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let editedHtml = msg.isEdited ? `<span style="margin-right: 5px;">изменено</span>` : '';
    
    let ticksHtml = '';
    if (msg.isMine) {
        if (msg.status === 'read') {
            ticksHtml = `<span class="msg-status">${SVG_TICK_DOUBLE}</span>`;
        } else {
            ticksHtml = `<span class="msg-status">${SVG_TICK_SINGLE}</span>`;
        }
    }
    
    let pinHtml = '';
    if (msg.isPinned) {
        const pinColor = msg.isMine ? '#ffffff' : 'var(--text-muted)';
        pinHtml = `<span style="margin-right: 4px; display: inline-flex; align-items: center; opacity: 0.9;">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="${pinColor}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5c0-1.5-2-3.5-2-3.5v-7c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v7c0 0-2 2-2 3.5V17z"></path></svg>
        </span>`;
    }

    contentHtml += `<div class="msg-meta">${pinHtml}${editedHtml}<span>${timeString}</span>${ticksHtml}</div>`;
    
    let dataReactionsKey = '';
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
        dataReactionsKey = escapeHTML(JSON.stringify(msg.reactions));
        contentHtml += `<div class="msg-reactions">`;
        for (const [emoji, usersReacted] of Object.entries(msg.reactions)) {
            let extraClass = usersReacted.includes(currentUser.kId) ? 'my-reaction' : '';
            contentHtml += `<span class="reaction-badge ${extraClass}" data-emoji="${emoji}">${emoji} ${usersReacted.length}</span>`;
        }
        contentHtml += `</div>`;
    }

    let msgClass = `msg ${msg.isMine ? 'my-msg' : 'their-msg'}`;
    if (isNew) msgClass += ' msg-new';
    if (msg.type === 'sticker') msgClass += ' msg-is-sticker';
    if (msg.type === 'image') {
        if (!msg.caption) msgClass += ' photo-only';
        else msgClass += ' photo-with-caption';
    }
    if (window.isSelectMode && window.selectedMsgIds && window.selectedMsgIds.has(String(msg.id))) {
        msgClass += ' selected';
    }

    const checkHtml = `<div class="msg-select-check"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>`;

    return `<div class="${msgClass}" data-id="${msg.id}" data-reactions-key="${dataReactionsKey}">${checkHtml}${contentHtml}</div>`;
}

function renderFullHistory(kId, isBackgroundSync = false) {
    const container = document.getElementById('messages-container');
    if(!container) return;
    
    Array.from(container.children).forEach(child => {
        if(child.classList.contains('chat-box-inner')) {
            child.style.display = (child.id === 'chat-box-' + kId) ? 'flex' : 'none';
        }
    });

    let chatBox = document.getElementById('chat-box-' + kId);
    if (!chatBox) {
        chatBox = document.createElement('div');
        chatBox.id = 'chat-box-' + kId;
        chatBox.className = 'chat-box-inner';
        container.appendChild(chatBox);
    } else {
        chatBox.style.display = 'flex';
    }

    const messages = chats[kId] || [];
    const currentDomCount = chatBox.children.length;

    if (currentDomCount === 0 || (!isBackgroundSync && currentDomCount !== messages.length)) {
        let fullHtml = '';
        messages.forEach(msg => { 
            fullHtml += generateMessageHTML(msg, activeChat ? activeChat.isGroup : false, false); 
        });
        chatBox.innerHTML = fullHtml;
        if (!isBackgroundSync) {
            container.scrollTop = container.scrollHeight;
        }
    } else if (isBackgroundSync && messages.length > 0) {
        const existingIds = new Set(Array.from(chatBox.children).map(c => c.getAttribute('data-id')));
        let hasNew = false;
        messages.forEach(msg => {
            if (!existingIds.has(String(msg.id))) {
                const temp = document.createElement('div');
                temp.innerHTML = generateMessageHTML(msg, activeChat ? activeChat.isGroup : false, false);
                if (temp.firstElementChild) {
                    chatBox.appendChild(temp.firstElementChild);
                    hasNew = true;
                }
            }
        });
        if (hasNew) {
            const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
            if (isAtBottom) container.scrollTop = container.scrollHeight;
        }
    }
}

function appendMessageToDOM(msg, isGroupChat, targetKId = null) {
    const kId = targetKId || (activeChat ? activeChat.kId : null);
    if (!kId) return; 

    let box = document.getElementById('chat-box-' + kId);
    if (!box) return;
    
    box.insertAdjacentHTML('beforeend', generateMessageHTML(msg, isGroupChat, true));
    if (activeChat && activeChat.kId === kId) {
        const container = document.getElementById('messages-container');
        if(!container) return;
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 160;
        if (isAtBottom || msg.senderId === currentUser.kId) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
    }
}

function updateMessageDOM(msgId, chatKId) {
    if (!chats[chatKId]) return;
    const msg = chats[chatKId].find(m => String(m.id) === String(msgId));
    if (!msg) return;

    const div = document.querySelector(`.msg[data-id="${msgId}"]`);
    if (!div) return;

    const isGroup = chatKId.startsWith('g-');
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = generateMessageHTML(msg, isGroup, false);
    
    if (tempDiv.firstElementChild) {
        div.className = tempDiv.firstElementChild.className;
        div.innerHTML = tempDiv.firstElementChild.innerHTML;
        div.setAttribute('data-reactions-key', tempDiv.firstElementChild.getAttribute('data-reactions-key') || '');
    }
}

let audioRecordTimer = null;
let audioRecordSeconds = 0;

function startAudioRecord() {
    if (!activeChat) return;
    const inputWrapper = document.getElementById('standard-input-ui');
    const recUI = document.getElementById('recording-ui');
    const timeEl = document.getElementById('recording-time');
    
    getAudioContext().resume();
    
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
            clearInterval(audioRecordTimer);
            if (timeEl) timeEl.innerText = '0:00';
            
            // Stop media stream tracks to release microphone
            try {
                stream.getTracks().forEach(track => track.stop());
            } catch(e) {}

            if(mediaRecorder.isCancelled) {
                audioChunks = [];
            } else {
                playSound('send');
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = [];
                (async () => {
                    let audioUrl = null;
                    try {
                        audioUrl = await uploadMediaFile(audioBlob, `voice_${Date.now()}.webm`);
                    } catch (e) {
                        console.error('Audio upload error:', e);
                    }
                    if (!audioUrl) {
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                            sendFinalAudio(evt.target.result);
                        };
                        reader.readAsDataURL(audioBlob);
                        return;
                    }
                    sendFinalAudio(audioUrl);

                    function sendFinalAudio(finalText) {
                        const msgId = Date.now().toString();
                        const msgObj = { id: msgId, senderId: currentUser.kId, text: finalText, type: 'audio', timestamp: Date.now(), status: 'sent', isMine: true, replyTo: replyingToMsg, isEdited: false, reactions: {}, isPinned: false };
                        if (!chats[activeChat.kId]) chats[activeChat.kId] = [];
                        chats[activeChat.kId].push(msgObj);
                        saveChatsToCache();
                        appendMessageToDOM(msgObj, activeChat.isGroup, activeChat.kId);
                        socket.emit('sendMessage', { id: msgId, from: currentUser.kId, to: activeChat.kId, text: finalText, type: 'audio', timestamp: Date.now(), replyTo: replyingToMsg });
                        cancelReply();
                        if (!document.getElementById(`contact-${activeChat.kId}`)) addContactToDOM(activeChat);
                    }
                })();
            }
            
            if(inputWrapper) inputWrapper.style.display = 'flex';
            if(recUI) recUI.classList.add('hidden');
        };
        mediaRecorder.start();
        
        audioRecordSeconds = 0;
        if (timeEl) timeEl.innerText = '0:00';
        clearInterval(audioRecordTimer);
        audioRecordTimer = setInterval(() => {
            audioRecordSeconds++;
            const mins = Math.floor(audioRecordSeconds / 60);
            const secs = String(audioRecordSeconds % 60).padStart(2, '0');
            if (timeEl) timeEl.innerText = `${mins}:${secs}`;
        }, 1000);

        if(inputWrapper) inputWrapper.style.display = 'none';
        if(recUI) recUI.classList.remove('hidden');
        
    }).catch(e => {
        clearInterval(audioRecordTimer);
        showToast('Нет доступа к микрофону', 'error');
    });
}

function cancelAudioRecord() {
    clearInterval(audioRecordTimer);
    if(mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.isCancelled = true;
        mediaRecorder.stop();
    }
}
function sendAudioRecord() {
    clearInterval(audioRecordTimer);
    if(mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.isCancelled = false;
        mediaRecorder.stop();
    }
}

async function uploadMediaFile(mediaData, filename = 'attachment') {
    try {
        const token = sessionToken || localStorage.getItem('knx_session_token') || (currentUser && currentUser.token) || '';
        if (mediaData instanceof Blob || mediaData instanceof File) {
            const formData = new FormData();
            formData.append('file', mediaData, filename || 'file');
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                body: formData
            });
            const data = await res.json();
            if (data && data.success && data.url) return data.url;
        } else if (typeof mediaData === 'string' && mediaData.startsWith('data:')) {
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': 'Bearer ' + token } : {})
                },
                body: JSON.stringify({ base64: mediaData, filename: filename })
            });
            const data = await res.json();
            if (data && data.success && data.url) return data.url;
        }
    } catch(err) {
        console.warn('Upload API error, falling back:', err);
    }
    return mediaData;
}
window.uploadMediaFile = uploadMediaFile;

function handleFileSelect(inputElement) {
    const file = inputElement.files[0];
    if (!file || !activeChat) return;
    processFileForPreview(file);
    inputElement.value = '';
}

function compressPhotoIfNeeded(base64, maxDim, quality, callback) {
    const img = new Image();
    img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w <= maxDim && h <= maxDim && base64.length < 500000) {
            return callback(base64);
        }
        if (w > maxDim || h > maxDim) {
            if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
            } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
            }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => callback(base64);
    img.src = base64;
}

function processFileForPreview(file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
        const isImg = file.type.startsWith('image/');
        const finalize = (finalBase64) => {
            pendingAttachment = {
                base64: finalBase64,
                file: file,
                fileName: file.name,
                isImage: isImg
            };
            
            const previewBox = document.getElementById('attachment-preview-box');
            if(!previewBox) return;
            if (pendingAttachment.isImage) {
                previewBox.innerHTML = `<img src="${pendingAttachment.base64}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius: 8px;">`;
            } else {
                previewBox.innerHTML = `<svg viewBox="0 0 24 24" width="60" height="60" stroke="var(--accent)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
            }
            
            const afn = document.getElementById('attachment-filename');
            if(afn) afn.innerText = file.name;
            const ac = document.getElementById('attachment-caption');
            if(ac) ac.value = '';
            document.getElementById('attachment-modal')?.classList.remove('hidden');
        };

        if (isImg && window.chatSettings && window.chatSettings.compressPhotos !== false) {
            compressPhotoIfNeeded(evt.target.result, 1280, 0.82, finalize);
        } else {
            finalize(evt.target.result);
        }
    };
    reader.readAsDataURL(file);
}

function closeAttachmentModal() {
    pendingAttachment = null;
    document.getElementById('attachment-modal')?.classList.add('hidden');
}

async function confirmSendAttachment() {
    if (!pendingAttachment || !activeChat) return;
    
    playSound('send');
    const ac = document.getElementById('attachment-caption');
    const caption = ac ? ac.value.trim() : '';
    const type = pendingAttachment.isImage ? 'image' : 'file';
    const msgId = Date.now().toString();
    const targetChat = activeChat;
    const attachmentData = pendingAttachment;
    
    closeAttachmentModal();
    cancelReply();

    let mediaUrl = attachmentData.base64;
    try {
        mediaUrl = await uploadMediaFile(attachmentData.file || attachmentData.base64, attachmentData.fileName);
    } catch (e) {
        console.error('Upload failed, falling back:', e);
    }

    const msgObj = { 
        id: msgId, senderId: currentUser.kId, text: mediaUrl, type: type, 
        timestamp: Date.now(), status: 'sent', isMine: true, replyTo: replyingToMsg, 
        isEdited: false, reactions: {}, fileName: attachmentData.fileName, caption: caption, isPinned: false 
    };
    
    if (!chats[targetChat.kId]) chats[targetChat.kId] = [];
    chats[targetChat.kId].push(msgObj);
    saveChatsToCache();
    appendMessageToDOM(msgObj, targetChat.isGroup, targetChat.kId);
    
    socket.emit('sendMessage', { 
        id: msgId, from: currentUser.kId, to: targetChat.kId, 
        text: mediaUrl, type: type, timestamp: Date.now(), 
        replyTo: replyingToMsg, fileName: attachmentData.fileName, caption: caption 
    });
    
    if (!document.getElementById(`contact-${targetChat.kId}`)) addContactToDOM(targetChat);
}

let contextTargetMsg = null;

function openMsgContextMenu(e, msg) {
    contextTargetMsg = msg;
    const menu = document.getElementById('msg-context-menu');
    if (!menu) return;
    
    if (typeof triggerHaptic === 'function') triggerHaptic('medium');

    const reactionsBar = document.getElementById('reactions-bar');
    if (reactionsBar) {
        reactionsBar.classList.remove('expanded');
    }
    
    const editBtn = document.getElementById('msg-edit-btn');
    const delBtn = document.getElementById('msg-delete-btn');
    const pinBtn = document.getElementById('msg-pin-btn');
    
    const isMine = !!(msg.isMine || (currentUser && msg.senderId === currentUser.kId));
    let canEdit = isMine && msg.type === 'text';
    let canDelete = isMine;
    let canPin = activeChat ? (activeChat.isGroup ? (activeChat.creatorId === currentUser.kId) : true) : true;
    
    if (activeChat && activeChat.isGroup && activeChat.creatorId === currentUser.kId) {
        canDelete = true; 
    }

    if(editBtn) editBtn.style.display = canEdit ? 'flex' : 'none';
    if(delBtn) delBtn.style.display = canDelete ? 'flex' : 'none';
    if(pinBtn) {
        pinBtn.style.display = canPin ? 'flex' : 'none';
        pinBtn.innerHTML = msg.isPinned ? `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5c0-1.5-2-3.5-2-3.5v-7c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v7c0 0-2 2-2 3.5V17z"></path></svg> Открепить` : `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5c0-1.5-2-3.5-2-3.5v-7c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v7c0 0-2 2-2 3.5V17z"></path></svg> Закрепить`;
    }

    menu.classList.remove('hidden');
    menu.style.transform = 'scale(1)';
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    menu.style.transform = ''; 
    
    let y = (e && e.clientY) || (e && e.touches && e.touches[0] ? e.touches[0].clientY : null);
    let x = (e && e.clientX) || (e && e.touches && e.touches[0] ? e.touches[0].clientX : null);
    
    if ((!x || !y) && msg) {
        const msgEl = document.querySelector(`.msg[data-id="${msg.id}"]`);
        if (msgEl) {
            const rect = msgEl.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
    }
    x = x || 100;
    y = y || 100;
    
    let originY = 'top';
    let originX = 'left';

    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 15;
        originY = 'bottom';
    }
    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 15;
        originX = 'right';
    }

    menu.style.transformOrigin = `${originX} ${originY}`;
    menu.style.top = `${y}px`; 
    menu.style.left = `${x}px`;
}

function togglePinMessage() {
    if(!contextTargetMsg || !activeChat) return;
    const newPinStatus = !contextTargetMsg.isPinned;
    
    const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(contextTargetMsg.id));
    if(msg) msg.isPinned = newPinStatus;
    
    if (newPinStatus) {
        const pinnedMsgs = chats[activeChat.kId]?.filter(m => m.isPinned) || [];
        activePinIndexes[activeChat.kId] = pinnedMsgs.length - 1;
    }
    
    saveChatsToCache();
    updatePinnedBar(activeChat.kId);
    updateMessageDOM(contextTargetMsg.id, activeChat.kId);

    const pinPayload = { id: contextTargetMsg.id, from: currentUser.kId, to: activeChat.kId, isPin: newPinStatus };
    if (window.KNXProto && socket && socket.connected) {
        socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.MSG_PIN, pinPayload));
    } else if (socket) {
        socket.emit('pinMessage', pinPayload);
    }
    document.getElementById('msg-context-menu')?.classList.add('hidden');
}

function sendReaction(emoji, overrideMsgId = null) {
    const msgId = overrideMsgId || (contextTargetMsg ? contextTargetMsg.id : null);
    if (!msgId || !activeChat) return;

    if (typeof triggerHaptic === 'function') triggerHaptic('light');

    const reactPayload = { id: msgId, from: currentUser.kId, to: activeChat.kId, emoji };
    if (window.KNXProto && socket && socket.connected) {
        socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.REACTION, reactPayload));
    } else if (socket) {
        socket.emit('addReaction', reactPayload);
    }

    const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(msgId));
    if (msg) {
        if (!msg.reactions) msg.reactions = {};

        let existingEmoji = null;
        for (const key in msg.reactions) {
            if (msg.reactions[key].includes(currentUser.kId)) {
                existingEmoji = key;
                msg.reactions[key] = msg.reactions[key].filter(u => u !== currentUser.kId);
                if (msg.reactions[key].length === 0) delete msg.reactions[key];
                break;
            }
        }

        if (existingEmoji !== emoji) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            msg.reactions[emoji].push(currentUser.kId);
        }

        saveChatsToCache();
        updateReactionsOnly(msgId, activeChat.kId);
    }

    document.getElementById('msg-context-menu')?.classList.add('hidden');
}

function toggleReactionsExpand(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const bar = document.getElementById('reactions-bar');
    const menu = document.getElementById('msg-context-menu');
    if (!bar) return;

    if (typeof triggerHaptic === 'function') triggerHaptic('light');

    const wasExpanded = bar.classList.contains('expanded');
    bar.classList.toggle('expanded');

    if (menu) {
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth - 12) {
                const newLeft = Math.max(10, window.innerWidth - rect.width - 12);
                menu.style.left = `${newLeft}px`;
            }
            if (rect.left < 10) {
                menu.style.left = '10px';
            }
            if (!wasExpanded && rect.bottom > window.innerHeight - 12) {
                const overflow = rect.bottom - (window.innerHeight - 12);
                const currentTop = parseFloat(menu.style.top) || rect.top;
                menu.style.top = `${Math.max(12, currentTop - overflow)}px`;
            }
        });
    }
}
window.toggleReactionsExpand = toggleReactionsExpand;

function prepareReply() {
    if(!contextTargetMsg) return;
    replyingToMsg = {
        id: contextTargetMsg.id,
        sender: contextTargetMsg.isMine ? currentUser.name : (knownUsers[contextTargetMsg.senderId] ? knownUsers[contextTargetMsg.senderId].name : 'Участник'),
        text: contextTargetMsg.type === 'image' ? 'Фотография' : (contextTargetMsg.type === 'file' ? 'Файл' : (contextTargetMsg.type === 'audio' ? 'Голосовое' : (contextTargetMsg.type === 'sticker' ? 'Стикер' : contextTargetMsg.text)))
    };
    const rpt = document.getElementById('reply-preview-title');
    if(rpt) rpt.innerText = `В ответ: ${escapeHTML(replyingToMsg.sender)}`;
    const rpx = document.getElementById('reply-preview-text');
    if(rpx) rpx.innerText = escapeHTML(replyingToMsg.text);
    document.getElementById('reply-preview')?.classList.remove('hidden');
    document.getElementById('telegram-input-pill')?.classList.add('has-reply');
    document.getElementById('msg-context-menu')?.classList.add('hidden');
    
    document.getElementById('message-input')?.focus();
    checkInputState();
}

function cancelReply() {
    replyingToMsg = null;
    document.getElementById('reply-preview')?.classList.add('hidden');
    document.getElementById('telegram-input-pill')?.classList.remove('has-reply');
    checkInputState();
}

function prepareEditMessageObj(msg) {
    if(!msg) return;
    contextTargetMsg = msg;
    editingMsgId = msg.id;
    const input = document.getElementById('message-input');
    if (input) {
        input.value = msg.text || '';
        input.focus();
        if (typeof autoResizeMessageInput === 'function') autoResizeMessageInput();
        input.selectionStart = input.selectionEnd = input.value.length;
    }
    const rpt = document.getElementById('reply-preview-title');
    if (rpt) rpt.innerText = 'Редактирование';
    const rpx = document.getElementById('reply-preview-text');
    if (rpx) rpx.innerText = msg.text || '';
    document.getElementById('reply-preview')?.classList.remove('hidden');
    document.getElementById('telegram-input-pill')?.classList.add('has-reply');

    const send = document.getElementById('btn-send');
    const mic = document.getElementById('btn-mic');
    const bes = document.getElementById('btn-edit-save');
    if(send) { send.style.display = 'none'; send.classList.add('hidden'); }
    if(mic) { mic.style.display = 'none'; mic.classList.add('hidden'); }
    if(bes) { bes.style.display = 'inline-flex'; bes.classList.remove('hidden'); }
    
    document.getElementById('msg-context-menu')?.classList.add('hidden');
}

function prepareEdit() {
    if(!contextTargetMsg) return;
    prepareEditMessageObj(contextTargetMsg);
}

function cancelEdit() {
    editingMsgId = null;
    document.getElementById('reply-preview')?.classList.add('hidden');
    document.getElementById('telegram-input-pill')?.classList.remove('has-reply');
    const mi = document.getElementById('message-input');
    if(mi) {
        mi.value = '';
        mi.style.height = '38px';
        mi.style.overflowY = 'hidden';
    }
    const bes = document.getElementById('btn-edit-save');
    if(bes) { bes.style.display = 'none'; bes.classList.add('hidden'); }
    
    checkInputState();
}

function saveEditedMessage() {
    const input = document.getElementById('message-input');
    const newText = input ? input.value.trim() : '';
    if (!newText || !editingMsgId || !activeChat) return cancelEdit();

    const editPayload = { id: editingMsgId, from: currentUser.kId, to: activeChat.kId, newText };
    if (window.KNXProto && socket && socket.connected) {
        socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.MSG_EDIT, editPayload));
    } else if (socket) {
        socket.emit('editMessage', editPayload);
    }

    const msg = chats[activeChat.kId]?.find(m => String(m.id) === String(editingMsgId));
    if (msg) {
        msg.text = newText; 
        msg.isEdited = true;
        saveChatsToCache();
        updateMessageDOM(editingMsgId, activeChat.kId);
        addContactToDOM(activeChat);
        sortChatList();
    }
    cancelEdit();
}

function dissolveMessageElement(msgEl, onDone) {
    if (!msgEl) {
        if (onDone) onDone();
        return;
    }

    const rect = msgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !document.body.contains(msgEl)) {
        msgEl.remove();
        if (onDone) onDone();
        return;
    }

    const isMine = msgEl.classList.contains('my-msg');
    const isDark = document.body.getAttribute('data-theme') === 'dark';

    const baseColors = isMine 
        ? ['#0084ff', '#29b6f6', '#60a5fa', '#93c5fd', '#ffffff'] 
        : (isDark 
            ? ['#1e293b', '#334155', '#475569', '#94a3b8', '#cbd5e1'] 
            : ['#ffffff', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b']);

    const canvas = document.createElement('canvas');
    canvas.className = 'knx-dust-canvas';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.left = rect.left + 'px';
    canvas.style.top = rect.top + 'px';
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const particleCount = Math.min(Math.floor((rect.width * rect.height) / 80), 320);
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
        const x = Math.random() * rect.width;
        const y = Math.random() * rect.height;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.6 + 0.8;
        const color = baseColors[Math.floor(Math.random() * baseColors.length)];

        particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed + (isMine ? 0.9 : -0.9),
            vy: Math.sin(angle) * speed - (Math.random() * 2.4 + 0.8), // Floating upwards
            size: Math.random() * 3.4 + 1.2,
            alpha: 1,
            fadeSpeed: Math.random() * 0.024 + 0.018,
            color
        });
    }

    const initialHeight = msgEl.offsetHeight;
    msgEl.style.maxHeight = initialHeight + 'px';
    msgEl.classList.add('dissolving');
    
    requestAnimationFrame(() => {
        msgEl.style.maxHeight = '0px';
        msgEl.style.margin = '0px';
        msgEl.style.padding = '0px';
        msgEl.style.border = 'none';
    });

    let startTime = performance.now();
    const duration = 580;

    function animateParticles(now) {
        const elapsed = now - startTime;
        ctx.clearRect(0, 0, rect.width, rect.height);

        let aliveCount = 0;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            if (p.alpha <= 0) continue;

            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.055;
            p.alpha -= p.fadeSpeed;
            p.size *= 0.985;

            if (p.alpha > 0 && p.size > 0.3) {
                aliveCount++;
                ctx.save();
                ctx.globalAlpha = Math.max(p.alpha, 0);
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        if (aliveCount > 0 && elapsed < duration) {
            requestAnimationFrame(animateParticles);
        } else {
            canvas.remove();
        }
    }

    requestAnimationFrame(animateParticles);

    setTimeout(() => {
        if (msgEl.parentNode) msgEl.remove();
        if (onDone) onDone();
    }, 420);
}

function deleteTargetMessage() {
    if(!contextTargetMsg || !activeChat) return;
    const delPayload = { id: contextTargetMsg.id, from: currentUser.kId, to: activeChat.kId };
    if (window.KNXProto && socket && socket.connected) {
        socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.MSG_DELETE, delPayload));
    } else if (socket) {
        socket.emit('deleteMessage', delPayload);
    }
    
    chats[activeChat.kId] = (chats[activeChat.kId] || []).filter(m => String(m.id) !== String(contextTargetMsg.id));
    saveChatsToCache();
    const el = document.querySelector(`.msg[data-id="${contextTargetMsg.id}"]`);
    if(el) dissolveMessageElement(el);
    updatePinnedBar(activeChat.kId);

    document.getElementById('msg-context-menu')?.classList.add('hidden');
}

function checkInputState() {
    const mi = document.getElementById('message-input');
    const val = mi ? mi.value.trim() : '';
    const mic = document.getElementById('btn-mic');
    const send = document.getElementById('btn-send');
    const editSave = document.getElementById('btn-edit-save');
    
    if (editingMsgId) {
        if(mic) { mic.style.display = 'none'; mic.classList.add('hidden'); }
        if(send) { send.style.display = 'none'; send.classList.add('hidden'); }
        if(editSave) { editSave.style.display = 'inline-flex'; editSave.classList.remove('hidden'); }
        return;
    }

    if(editSave) { editSave.style.display = 'none'; editSave.classList.add('hidden'); }

    if(val.length > 0) {
        if(mic) { mic.style.display = 'none'; mic.classList.add('hidden'); }
        if(send) { send.style.display = 'inline-flex'; send.classList.remove('hidden'); }
    } else {
        if(send) { send.style.display = 'none'; send.classList.add('hidden'); }
        if(mic) { mic.style.display = 'inline-flex'; mic.classList.remove('hidden'); }
    }
}
function autoResizeMessageInput() {
    const mi = document.getElementById('message-input');
    if (!mi) return;
    mi.style.height = 'auto';
    const newHeight = Math.min(Math.max(mi.scrollHeight, 38), 120);
    mi.style.height = newHeight + 'px';
    mi.style.overflowY = mi.scrollHeight > 120 ? 'auto' : 'hidden';

    const inputArea = document.getElementById('input-area');
    const container = document.getElementById('messages-container');
    if (inputArea && container) {
        const h = inputArea.offsetHeight || 60;
        container.style.paddingBottom = `calc(${h + 16}px + env(safe-area-inset-bottom, 0px))`;
    }
}

function handleTyping() {
    if(!activeChat || document.getElementById('input-area')?.classList.contains('hidden')) return;
    autoResizeMessageInput();
    checkInputState();
    if (window.chatSettings && window.chatSettings.typingIndicator !== false) {
        if (window.KNXProto && socket) {
            socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.TYPING, { from: currentUser.kId, to: activeChat.kId }));
        }
        socket.emit('typing', { from: currentUser.kId, to: activeChat.kId });
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { 
        if (window.chatSettings && window.chatSettings.typingIndicator !== false) {
            if (window.KNXProto && socket) {
                socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.STOP_TYPING, { from: currentUser.kId, to: activeChat.kId }));
            }
            socket.emit('stopTyping', { from: currentUser.kId, to: activeChat.kId }); 
        }
    }, 1500);
}

function handleKeyPress(e) { 
    if (e.key === 'Enter' && !e.shiftKey) {
        if (window.chatSettings && window.chatSettings.sendByEnter === false) {
            return;
        }
        e.preventDefault();
        if (editingMsgId) saveEditedMessage();
        else sendMessage();
        return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const input = document.getElementById('message-input');
        if (input && input.value.trim() === '' && !editingMsgId && activeChat && chats[activeChat.kId]) {
            const list = chats[activeChat.kId];
            for (let i = list.length - 1; i >= 0; i--) {
                const m = list[i];
                if ((m.isMine || (currentUser && m.senderId === currentUser.kId)) && m.type === 'text') {
                    e.preventDefault();
                    prepareEditMessageObj(m);
                    break;
                }
            }
        }
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    if(!input) return;
    const text = input.value.trim();
    if (!text || !activeChat) return;

    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) {
        sendBtn.classList.remove('sending-plane');
        void sendBtn.offsetWidth;
        sendBtn.classList.add('sending-plane');
        setTimeout(() => sendBtn.classList.remove('sending-plane'), 400);
    }

    playSound('send');
    if (typeof triggerHaptic === 'function') triggerHaptic('medium');
    clearTimeout(typingTimer);
    if (window.KNXProto && socket) {
        socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.STOP_TYPING, { from: currentUser.kId, to: activeChat.kId }));
    }
    socket.emit('stopTyping', { from: currentUser.kId, to: activeChat.kId });

    const msgId = Date.now().toString();
    const msgObj = { id: msgId, senderId: currentUser.kId, text: text, type: 'text', timestamp: Date.now(), status: 'sent', isMine: true, replyTo: replyingToMsg, isEdited: false, reactions: {}, isPinned: false };
    
    chats[activeChat.kId].push(msgObj);
    saveChatsToCache();
    appendMessageToDOM(msgObj, activeChat.isGroup, activeChat.kId);
    
    const sendData = { id: msgId, from: currentUser.kId, to: activeChat.kId, text: text, type: 'text', timestamp: Date.now(), replyTo: replyingToMsg };
    if (window.KNXProto && socket) {
        socket.emit('kp_packet', KNXProto.pack(KNXProto.OPCODES.MSG_SEND, sendData));
    }
    socket.emit('sendMessage', sendData);
    
    addContactToDOM(activeChat);
    sortChatList();

    input.value = '';
    input.style.height = '38px';
    input.style.overflowY = 'hidden';
    cancelReply();
    checkInputState();
    input.focus();
}

let contextMenuTargetId = null;

function openChatContextMenu(e, kId) {
    contextMenuTargetId = kId;
    const menu = document.getElementById('chat-context-menu');
    if(!menu) return;
    
    const archBtn = document.getElementById('archive-chat-btn');
    if (archBtn) {
        const isArch = currentUser.archived && currentUser.archived.includes(kId);
        const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px;"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`;
        archBtn.innerHTML = isArch ? `${icon} Вернуть из архива` : `${icon} В архив`;
    }

    menu.classList.remove('hidden');
    menu.style.transform = 'scale(1)';
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    menu.style.transform = ''; 

    let y = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 100);
    let x = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 100);
    
    let originY = 'top';
    let originX = 'left';

    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 15;
        originY = 'bottom';
    }
    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 15;
        originX = 'right';
    }

    menu.style.transformOrigin = `${originX} ${originY}`;
    menu.style.top = `${y}px`; 
    menu.style.left = `${x}px`;
}

function toggleArchiveChat(targetId = null) {
    const kId = targetId || contextMenuTargetId;
    if(!kId) return;
    if(!currentUser.archived) currentUser.archived = [];
    
    if(currentUser.archived.includes(kId)) {
        currentUser.archived = currentUser.archived.filter(id => id !== kId);
        showToast('Чат возвращен из архива', 'success');
    } else {
        currentUser.archived.push(kId);
        showToast('Чат скрыт в архив', 'info');
    }
    
    saveCustomization();
    renderFolderTabs();
    
    const list = document.getElementById('chat-list');
    if(list) {
        list.classList.remove('chat-list-fade');
        void list.offsetWidth; 
        list.classList.add('chat-list-fade');
    }
    sortChatList();
    if (typeof updateDockBadges === 'function') updateDockBadges();
    
    document.getElementById('chat-context-menu')?.classList.add('hidden');
}

function pinChat(targetId = null) {
    const kId = targetId || contextMenuTargetId;
    if(!kId) return;
    const item = document.getElementById(`contact-${kId}`);
    if (item) closeChatSwipe(item);
    if(pinnedChats.includes(kId)) pinnedChats = pinnedChats.filter(id => id !== kId);
    else pinnedChats.push(kId);
    localStorage.setItem('pinnedChats', JSON.stringify(pinnedChats));
    if (item) {
        if (pinnedChats.includes(kId)) item.classList.add('pinned');
        else item.classList.remove('pinned');
    }
    if(knownUsers[kId]) addContactToDOM(knownUsers[kId]);
    sortChatList();
    document.getElementById('chat-context-menu')?.classList.add('hidden');
}

function muteChat(targetId = null) {
    const kId = targetId || contextMenuTargetId;
    if(!kId) return;
    const item = document.getElementById(`contact-${kId}`);
    if (item) closeChatSwipe(item);
    if(mutedChats.includes(kId)) mutedChats = mutedChats.filter(id => id !== kId);
    else mutedChats.push(kId);
    localStorage.setItem('mutedChats', JSON.stringify(mutedChats));
    if (item) {
        if (mutedChats.includes(kId)) item.classList.add('muted');
        else item.classList.remove('muted');
    }
    if(knownUsers[kId]) addContactToDOM(knownUsers[kId]);
    sortChatList();
    document.getElementById('chat-context-menu')?.classList.add('hidden');
}

function confirmDeleteChat(targetId = null) {
    document.getElementById('chat-context-menu')?.classList.add('hidden');
    const kId = targetId || contextMenuTargetId;
    if(!kId) return;
    contextMenuTargetId = kId;
    openModal('confirm-delete-modal');
}

function executeDeleteChat() {
    closeModal('confirm-delete-modal');
    if(!contextMenuTargetId) return;
    
    const isGrp = contextMenuTargetId.startsWith('g-');
    fetch('/api/history/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kId: currentUser.kId, targetId: contextMenuTargetId, isGroup: isGrp })
    });

    delete chats[contextMenuTargetId];
    saveChatsToCache();
    delete unreadCounts[contextMenuTargetId];
    
    const el = document.getElementById(`contact-${contextMenuTargetId}`);
    if(el) el.remove();
    
    if(activeChat && activeChat.kId === contextMenuTargetId) {
        document.getElementById('chat-header')?.classList.add('hidden');
        document.getElementById('messages-container')?.classList.add('hidden');
        document.getElementById('input-area')?.classList.add('hidden');
        document.getElementById('channel-readonly')?.classList.add('hidden');
        document.getElementById('pinned-bar')?.classList.add('hidden');
        document.getElementById('desktop-no-chat')?.classList.remove('hidden');
        document.getElementById('no-chat-selected')?.classList.remove('hidden');
        activeChat = null;
    }
}

const fullscreenCloseTimers = {};

function closeFullscreen(id) {
    const el = document.getElementById(id);
    if(!el) return;
    if (el.classList.contains('hidden') && !el.classList.contains('animate-slide-out-right')) return;
    
    if (fullscreenCloseTimers[id]) {
        clearTimeout(fullscreenCloseTimers[id]);
        delete fullscreenCloseTimers[id];
    }
    
    document.body.classList.remove('panel-open');
    el.classList.remove('animate-slide-in-right');
    el.classList.add('animate-slide-out-right');
    
    fullscreenCloseTimers[id] = setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('animate-slide-out-right');
        delete fullscreenCloseTimers[id];
    }, 250);
}

let currentProfileId = null;

function openProfileScreen(kId) {
    const screen = document.getElementById('profile-screen');
    if(!screen) return;
    if (fullscreenCloseTimers['profile-screen']) {
        clearTimeout(fullscreenCloseTimers['profile-screen']);
        delete fullscreenCloseTimers['profile-screen'];
    }
    document.body.classList.add('panel-open');
    screen.classList.remove('hidden', 'animate-slide-out-right');
    screen.classList.add('animate-slide-in-right');
    setTimeout(() => {
        if (!screen.classList.contains('hidden')) {
            screen.classList.remove('animate-slide-in-right');
        }
    }, 280);
    loadProfileData(kId);
}
function closeProfileScreen() { closeFullscreen('profile-screen'); }

function openSettingsScreen() {
    const screen = document.getElementById('settings-screen');
    if(!screen) return;
    if (fullscreenCloseTimers['settings-screen']) {
        clearTimeout(fullscreenCloseTimers['settings-screen']);
        delete fullscreenCloseTimers['settings-screen'];
    }
    document.body.classList.add('panel-open');
    document.body.classList.remove('in-settings-sub');
    screen.classList.remove('hidden', 'animate-slide-out-right');
    screen.classList.add('animate-slide-in-right');
    
    setTimeout(() => {
        if (!screen.classList.contains('hidden')) {
            screen.classList.remove('animate-slide-in-right');
        }
    }, 280);
    
    const subViewport = document.getElementById('settings-sub-viewport');
    if (subViewport) {
        subViewport.classList.remove('open');
        subViewport.classList.add('hidden');
        subViewport.style.transform = '';
        subViewport.style.transition = '';
    }
    const mainContainer = document.getElementById('settings-main-container');
    if (mainContainer) {
        mainContainer.classList.remove('slide-back');
        mainContainer.style.transform = '';
        mainContainer.style.opacity = '1';
        mainContainer.style.transition = '';
    }
    document.querySelectorAll('.settings-sub-viewport .tab-content').forEach(c => {
        c.classList.add('hidden');
        c.classList.remove('active');
        c.style.transform = '';
        c.style.opacity = '';
    });
    document.getElementById('floating-bottom-bar')?.classList.remove('hidden');
    document.getElementById('mobile-bottom-nav')?.classList.remove('hidden');

    try { updateUIProfile(); } catch(e) { console.error('updateUIProfile error:', e); }
    if (typeof window.syncPrivacySettingsUI === 'function') {
        try { window.syncPrivacySettingsUI(); } catch(e) {}
    }
    requestAnimationFrame(() => {
        if (typeof window.applyChatSettings === 'function') {
            try { window.applyChatSettings(); } catch(e) { console.error('applyChatSettings error:', e); }
        }
    });
    if (typeof window.updateDockActiveState === 'function') {
        try { window.updateDockActiveState('settings'); } catch(e) {}
    }
}
window.openSettingsScreen = openSettingsScreen;

function closeSettingsScreen() { 
    if (typeof window.finishBackToSettings === 'function') {
        try { window.finishBackToSettings(); } catch(e) {}
    }
    document.body.classList.remove('in-settings-sub');
    closeFullscreen('settings-screen'); 
    if (typeof window.updateDockActiveState === 'function') {
        window.updateDockActiveState(currentFolderId === 'archived' ? 'archive' : 'chats');
    }
}
window.closeSettingsScreen = closeSettingsScreen;

async function loadProfileData(kId) {
    currentProfileId = kId;
    const res = await fetch(`/api/profile/${kId}?requester=${currentUser.kId}`);
    const result = await res.json();
    if(!result.success) return;

    const data = result.data;
    data.isGroup = (result.type === 'group'); 

    const pa = document.getElementById('prof-avatar');
    if(pa) pa.src = data.avatar;
    const pn = document.getElementById('prof-name');
    if(pn) pn.innerHTML = escapeHTML(data.name) + getUserBadgeHtml(data);
    const pi = document.getElementById('prof-id');
    if(pi) {
        pi.innerText = data.isGroup ? `ID: ${data.kId}` : `K-ID: ${data.kId}`;
        if (!data.isGroup && (data.isVip || data.role === 'vip')) {
            pi.classList.add('gold-kid');
        } else {
            pi.classList.remove('gold-kid');
        }
    }
    const pb = document.getElementById('prof-bio');
    if(pb) pb.innerText = escapeHTML(data.bio) || 'Не указано';
    
    const phBox = document.getElementById('prof-hobbies-box');
    const phVal = document.getElementById('prof-hobbies');
    if (phBox && phVal) {
        if (!data.isGroup && data.hobbies && data.hobbies.trim()) {
            phVal.innerText = escapeHTML(data.hobbies);
            phBox.classList.remove('hidden');
        } else {
            phBox.classList.add('hidden');
        }
    }

    const pbDateBox = document.getElementById('prof-birthdate-box');
    const pbDateVal = document.getElementById('prof-birthdate');
    if (pbDateBox && pbDateVal) {
        if (!data.isGroup && data.birthDate && data.birthDate.trim()) {
            try {
                const parts = data.birthDate.split('-');
                if (parts.length === 3) {
                    pbDateVal.innerText = `${parts[2]}.${parts[1]}.${parts[0]}`;
                } else {
                    pbDateVal.innerText = escapeHTML(data.birthDate);
                }
            } catch(e) {
                pbDateVal.innerText = escapeHTML(data.birthDate);
            }
            pbDateBox.classList.remove('hidden');
        } else {
            pbDateBox.classList.add('hidden');
        }
    }
    
    const headerBg = document.getElementById('prof-header-bg');
    if(headerBg) {
        const coverBg = data.header || data.avatar || '';
        if(coverBg) {
            headerBg.style.backgroundImage = `url("${coverBg}")`;
            headerBg.style.backgroundColor = 'transparent';
            if (data.header) {
                headerBg.style.filter = 'none';
                headerBg.style.opacity = '1';
            } else {
                headerBg.style.filter = 'none';
                headerBg.style.opacity = '0.78';
            }
        } else {
            headerBg.style.backgroundImage = 'none';
            headerBg.style.backgroundColor = 'var(--accent)';
        }
    }
    
    const statusEl = document.getElementById('prof-status');
    const editBtn = document.getElementById('prof-edit-group-btn');
    const joinBtn = document.getElementById('prof-join-group-btn');
    const blockBtn = document.getElementById('prof-block-btn');
    const chatBtn = document.getElementById('prof-chat-btn');
    
    if(editBtn) editBtn.classList.add('hidden');
    if(joinBtn) joinBtn.classList.add('hidden');
    if(chatBtn) chatBtn.classList.add('hidden');
    
    if (data.isGroup) {
        if(statusEl) {
            statusEl.innerText = `${data.members.length} участника(ов) • ${data.groupType === 'channel' ? 'Канал' : 'Группа'}`;
            statusEl.style.color = 'var(--text-muted)';
        }
        
        if (data.creatorId === currentUser.kId) {
            if(editBtn) editBtn.classList.remove('hidden'); 
            if(chatBtn) chatBtn.classList.remove('hidden');
        } else {
            if (!data.members.includes(currentUser.kId)) { if(joinBtn) joinBtn.classList.remove('hidden'); }
            else { if(chatBtn) chatBtn.classList.remove('hidden'); }
        }
        if(blockBtn) blockBtn.classList.add('hidden');
    } else {
        if(data.isBlockedMe) {
            if(statusEl) {
                statusEl.innerText = 'Был(а) давно';
                statusEl.style.color = 'var(--text-muted)';
            }
        } else {
            if(statusEl) {
                statusEl.innerText = data.isOnline ? 'В сети' : 'Был(а) недавно';
                statusEl.style.color = data.isOnline ? 'var(--success)' : 'var(--text-muted)';
            }
        }

        if (kId === currentUser.kId || data.isBot) {
            if(blockBtn) blockBtn.classList.add('hidden');
        } else {
            if(chatBtn) chatBtn.classList.remove('hidden');
            if(blockBtn) {
                blockBtn.classList.remove('hidden');
                blockBtn.setAttribute('data-target-id', kId);
                blockBtn.innerText = currentUser.blocked.find(b => b.kId === kId) ? 'Разблокировать' : 'Заблокировать';
            }
        }
        if (data.isBot && chatBtn) chatBtn.classList.remove('hidden');
    }
}

function startChatFromProfile() {
    closeProfileScreen();
    setTimeout(() => { openChat(knownUsers[currentProfileId]); }, 300);
}

async function joinGroup() {
    const res = await fetch('/api/group/join', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ kId: currentUser.kId, gId: currentProfileId })
    });
    const r = await res.json();
    if(r.success) {
        showToast('Вы присоединились!', 'success');
        loadProfileData(currentProfileId); 
        fetchUserAndAddToSidebar(currentProfileId, false);
    } else showToast(r.message, 'error');
}

async function syncBlockedList() {
    await fetch('/api/settings/block', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kId: currentUser.kId, blockedList: currentUser.blocked })
    });
}

function confirmBlockUser() {
    const btn = document.getElementById('prof-block-btn');
    if(!btn) return;
    const bId = btn.getAttribute('data-target-id');
    const isBlocked = currentUser.blocked.find(b => b.kId === bId);
    
    if (isBlocked) {
        executeBlockUser(bId, true);
    } else {
        document.getElementById('confirm-block-modal')?.classList.remove('hidden');
        document.getElementById('confirm-block-modal')?.setAttribute('data-target', bId);
    }
}

function executeBlockUser(targetId = null, forceUnblock = false) {
    closeModal('confirm-block-modal');
    const cb = document.getElementById('confirm-block-modal');
    const bId = targetId || (cb ? cb.getAttribute('data-target') : null);
    if(!bId) return;
    const userToBlock = knownUsers[bId];
    if(!userToBlock) return;

    const btn = document.getElementById('prof-block-btn');

    if (forceUnblock || currentUser.blocked.find(b => b.kId === bId)) {
        currentUser.blocked = currentUser.blocked.filter(b => b.kId !== bId);
        if(btn) btn.innerText = 'Заблокировать';
        showToast('Разблокирован', 'info');
    } else {
        currentUser.blocked.push({ kId: bId, name: userToBlock.name, avatar: userToBlock.avatar });
        if(btn) btn.innerText = 'Разблокировать';
        showToast('Заблокирован', 'info');
        
        if (activeChat && activeChat.kId === bId) {
            document.getElementById('chat-header')?.classList.add('hidden');
            document.getElementById('messages-container')?.classList.add('hidden');
            document.getElementById('input-area')?.classList.add('hidden');
            document.getElementById('pinned-bar')?.classList.add('hidden');
            document.getElementById('desktop-no-chat')?.classList.remove('hidden');
            document.getElementById('no-chat-selected')?.classList.remove('hidden');
            activeChat = null;
        }
    }
    syncBlockedList();
}
window.executeBlockUser = executeBlockUser;
window.confirmBlockUser = confirmBlockUser;

window.blockUserByKid = async function() {
    const input = document.getElementById('input-block-kid');
    if (!input) return;
    const kid = input.value.trim();
    if (!kid) {
        showToast('Введите K-ID пользователя', 'error');
        return;
    }
    if (currentUser && currentUser.kId === kid) {
        showToast('Нельзя заблокировать самого себя', 'error');
        return;
    }
    if (!currentUser) return;
    if (!currentUser.blocked) currentUser.blocked = [];
    if (currentUser.blocked.some(b => b.kId === kid)) {
        showToast('Пользователь уже в черном списке', 'info');
        input.value = '';
        return;
    }

    let userToBlock = knownUsers[kid];
    if (!userToBlock) {
        try {
            const res = await fetch(`/api/profile/${encodeURIComponent(kid)}?requester=${encodeURIComponent(currentUser.kId)}`);
            const data = await res.json();
            if (data.success && data.data) {
                userToBlock = data.data;
                knownUsers[kid] = data.data;
            }
        } catch (e) {
            console.error('Failed to fetch user by kId:', e);
        }
    }

    const name = userToBlock?.name || kid;
    const avatar = userToBlock?.avatar || (typeof DEFAULT_AVATAR !== 'undefined' ? DEFAULT_AVATAR : '');

    currentUser.blocked.push({ kId: kid, name, avatar });
    input.value = '';
    await syncBlockedList();
    renderBlockedList();
    showToast(`Пользователь ${name} добавлен в черный список`, 'success');

    if (activeChat && activeChat.kId === kid) {
        document.getElementById('chat-header')?.classList.add('hidden');
        document.getElementById('messages-container')?.classList.add('hidden');
        document.getElementById('input-area')?.classList.add('hidden');
        document.getElementById('pinned-bar')?.classList.add('hidden');
        document.getElementById('desktop-no-chat')?.classList.remove('hidden');
        document.getElementById('no-chat-selected')?.classList.remove('hidden');
        activeChat = null;
    }
};

function renderSettingsFolders() {
    const list = document.getElementById('settings-folders-list');
    if(!list) return;
    list.innerHTML = '';
    if(currentUser.folders) {
        currentUser.folders.forEach((f, idx) => {
            const div = document.createElement('div');
            div.className = 'blocked-item';
            div.innerHTML = `<span>📂 ${escapeHTML(f.name)} (${f.chats.length} чатов)</span> <button class="btn-primary" onclick="deleteFolder(${idx})">Удалить</button>`;
            list.appendChild(div);
        });
    }
}
window.renderSettingsFolders = renderSettingsFolders;

function openFolderModal() {
    const fni = document.getElementById('folder-name-input');
    if(fni) fni.value = '';
    const sel = document.getElementById('folder-chats-selection');
    if(!sel) return;
    sel.innerHTML = '';
    
    document.querySelectorAll('.chat-item').forEach(item => {
        const kId = item.id.replace('contact-', '');
        const nm = item.querySelector('.name');
        const name = nm ? nm.innerText : '';
        sel.innerHTML += `<div class="checkbox-group"><input type="checkbox" id="fchk-${kId}" value="${kId}"><label for="fchk-${kId}">${escapeHTML(name)}</label></div>`;
    });
    
    document.getElementById('folder-modal')?.classList.remove('hidden');
}
window.openFolderModal = openFolderModal;

function saveNewFolder() {
    const fni = document.getElementById('folder-name-input');
    const name = fni ? fni.value.trim() : '';
    if(!name) return showToast('Введите название папки', 'error');
    
    const selectedChats = [];
    document.querySelectorAll('#folder-chats-selection input[type="checkbox"]:checked').forEach(chk => {
        selectedChats.push(chk.value);
    });
    
    if(selectedChats.length === 0) return showToast('Выберите хотя бы 1 чат', 'error');
    
    if(!currentUser.folders) currentUser.folders = [];
    currentUser.folders.push({ id: 'f-' + Date.now(), name: name, chats: selectedChats });
    saveCustomization();
    
    closeModal('folder-modal');
    renderSettingsFolders();
    renderFolderTabs();
}
window.saveNewFolder = saveNewFolder;

function deleteFolder(idx) {
    currentUser.folders.splice(idx, 1);
    saveCustomization();
    renderSettingsFolders();
    renderFolderTabs();
    selectFolder('all');
}
window.deleteFolder = deleteFolder;


let selectedCommunityType = 'group';
let newCommunityAvatarBase64 = null;

function selectCommunityType(type) {
    selectedCommunityType = type;
    const cardGroup = document.getElementById('type-card-group');
    const cardChannel = document.getElementById('type-card-channel');
    const titleEl = document.getElementById('create-community-title');
    const btnText = document.getElementById('create-btn-text');

    if (type === 'channel') {
        cardChannel?.classList.add('active');
        cardGroup?.classList.remove('active');
        if (titleEl) titleEl.textContent = 'Создать канал';
        if (btnText) btnText.textContent = 'Создать канал';
    } else {
        cardGroup?.classList.add('active');
        cardChannel?.classList.remove('active');
        if (titleEl) titleEl.textContent = 'Создать группу';
        if (btnText) btnText.textContent = 'Создать группу';
    }
}

function handleNewGroupAvatarSelect(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        const preview = document.getElementById('create-group-avatar-preview');
        const placeholder = document.getElementById('create-avatar-placeholder');
        if (preview) {
            preview.src = e.target.result;
            preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
        try {
            newCommunityAvatarBase64 = await uploadMediaFile(file, `group_ava_${file.name}`);
        } catch (err) {
            newCommunityAvatarBase64 = e.target.result;
        }
    };
    reader.readAsDataURL(file);
}

function openCreateGroupModal() {
    selectedCommunityType = 'group';
    newCommunityAvatarBase64 = null;
    selectCommunityType('group');
    const preview = document.getElementById('create-group-avatar-preview');
    const placeholder = document.getElementById('create-avatar-placeholder');
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    if (placeholder) placeholder.classList.remove('hidden');
    const nameInput = document.getElementById('group-name');
    const descInput = document.getElementById('group-desc');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';

    const modal = document.getElementById('group-modal');
    if (modal) {
        modal.classList.remove('hidden');
        nameInput?.focus();
    }
}

async function createGroup() {
    const type = selectedCommunityType || 'group';
    const gni = document.getElementById('group-name');
    const name = gni ? gni.value.trim() : '';
    const gdi = document.getElementById('group-desc');
    const desc = gdi ? gdi.value.trim() : '';
    if (!name) return showToast('Введите название сообщества', 'error');

    const submitBtn = document.getElementById('btn-submit-create-group');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
    }

    try {
        const payload = { 
            creatorId: currentUser.kId, 
            name, 
            desc, 
            type,
            avatar: newCommunityAvatarBase64 || null
        };

        const res = await fetch('/api/group/create', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        const result = await res.json();
        if (result.success) {
            showToast(`✨ ${type === 'channel' ? 'Канал' : 'Группа'} «${name}» успешно создан!`, 'success');
            document.getElementById('group-modal')?.classList.add('hidden');
            
            knownUsers[result.group.gId] = result.group;
            fetchUserAndAddToSidebar(result.group.gId, true);
            
            setTimeout(() => {
                openChat(result.group);
            }, 100);
        } else {
            showToast(result.message || 'Ошибка создания', 'error');
        }
    } catch(err) {
        showToast('Сетевая ошибка при создании', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
        }
    }
}

let pendingGroupAvatar = null;
let pendingGroupHeader = null;

function openEditGroupScreen() {
    const group = knownUsers[currentProfileId];
    if(!group) return;

    const screen = document.getElementById('edit-group-screen');
    if(!screen) return;
    screen.classList.remove('hidden'); 
    screen.classList.add('animate-slide-in-right');

    const eap = document.getElementById('edit-group-avatar-preview');
    if(eap) eap.src = group.avatar;
    const ehp = document.getElementById('edit-group-header-preview');
    if(ehp) ehp.style.backgroundImage = group.header ? `url(${group.header})` : 'none';
    const egn = document.getElementById('edit-group-name');
    if(egn) egn.value = group.name;
    const egd = document.getElementById('edit-group-desc');
    if(egd) egd.value = group.bio || '';
    
    pendingGroupAvatar = null; pendingGroupHeader = null;
}

function closeEditGroupScreen() {
    const screen = document.getElementById('edit-group-screen');
    if(!screen) return;
    screen.classList.remove('animate-slide-in-right');
    screen.classList.add('animate-slide-out-right');
    setTimeout(() => {
        screen.classList.add('hidden');
        screen.classList.remove('animate-slide-out-right');
    }, 300);
}

document.getElementById('edit-group-avatar-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) { 
        const eap = document.getElementById('edit-group-avatar-preview'); 
        if(eap) eap.src = evt.target.result;
        try {
            pendingGroupAvatar = await uploadMediaFile(file, `group_edit_ava_${file.name}`);
        } catch(err) {
            pendingGroupAvatar = evt.target.result;
        }
    };
    reader.readAsDataURL(file);
});
document.getElementById('edit-group-header-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) { 
        const ehp = document.getElementById('edit-group-header-preview'); 
        if(ehp) ehp.style.backgroundImage = `url(${evt.target.result})`; 
        try {
            pendingGroupHeader = await uploadMediaFile(file, `group_edit_hdr_${file.name}`);
        } catch(err) {
            pendingGroupHeader = evt.target.result;
        }
    };
    reader.readAsDataURL(file);
});

async function saveGroupEdit() {
    const egn = document.getElementById('edit-group-name');
    const name = egn ? egn.value.trim() : '';
    const egd = document.getElementById('edit-group-desc');
    const desc = egd ? egd.value.trim() : '';
    if(!name) return showToast('Название обязательно', 'error');

    const res = await fetch('/api/group/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterId: currentUser.kId, gId: currentProfileId, name, desc, avatar: pendingGroupAvatar, header: pendingGroupHeader })
    });
    const result = await res.json();
    if (result.success) {
        showToast('Изменения сохранены', 'success');
        closeEditGroupScreen();
        loadProfileData(currentProfileId); 
        fetchUserAndAddToSidebar(currentProfileId, false); 
    } else showToast(result.message, 'error');
}

let settingsBackTimer = null;

window.switchTab = function(tabId) {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    if (settingsBackTimer) {
        clearTimeout(settingsBackTimer);
        settingsBackTimer = null;
    }

    document.body.classList.add('in-settings-sub');
    const subViewport = document.getElementById('settings-sub-viewport');
    const mainContainer = document.getElementById('settings-main-container');
    const tab = document.getElementById(`tab-${tabId}`);
    if (!tab || !subViewport) return;
    
    const subTitles = window.I18N_SUBTITLES || {
        'customization': 'Аккаунт',
        'chat-settings': 'Настройки чатов',
        'appearance': 'Оформление',
        'notifications': 'Уведомления и звуки',
        'folders': 'Папки с чатами',
        'privacy': 'Конфиденциальность',
        'security': 'Устройства и безопасность',
        'language': 'Язык',
        'blocked': 'Черный список',
        'storage': 'Данные и память'
    };
    const subTitle = document.getElementById('settings-sub-title');
    if (subTitle && subTitles[tabId]) subTitle.innerText = subTitles[tabId];

    document.querySelectorAll('.settings-sub-viewport .tab-content').forEach(c => {
        if (c !== tab) {
            c.classList.remove('active');
            c.classList.add('hidden');
        }
    });
    tab.classList.remove('hidden');
    tab.classList.add('active');

    const subScroll = document.getElementById('settings-sub-scroll');
    if (subScroll) subScroll.scrollTop = 0;

    subViewport.classList.remove('hidden');
    subViewport.style.transform = '';
    subViewport.style.transition = '';

    if (mainContainer) {
        mainContainer.style.transform = '';
        mainContainer.style.transition = '';
        mainContainer.classList.add('slide-back');
    }

    requestAnimationFrame(() => {
        subViewport.classList.add('open');
    });

    if (tabId === 'chat-settings' || tabId === 'appearance') {
        if (typeof window.applyChatSettings === 'function') window.applyChatSettings();
    } else if (tabId === 'privacy') {
        if (typeof window.syncPrivacySettingsUI === 'function') window.syncPrivacySettingsUI();
    } else if (tabId === 'notifications') {
        if (typeof window.syncNotificationSettingsUI === 'function') window.syncNotificationSettingsUI();
    } else if (tabId === 'storage') {
        if (typeof window.syncStorageTabUI === 'function') window.syncStorageTabUI();
    } else if (tabId === 'customization') {
        if (typeof updateUIProfile === 'function') updateUIProfile();
    }

    setTimeout(() => {
        if (!document.body.classList.contains('in-settings-sub')) return;
        if (tabId === 'security') {
            if (typeof renderSessionsList === 'function') renderSessionsList();
            if (typeof syncSecuritySettingsUI === 'function') syncSecuritySettingsUI();
        } else if (tabId === 'folders') {
            if (typeof renderSettingsFolders === 'function') renderSettingsFolders();
        } else if (tabId === 'blocked') {
            if (typeof window.renderBlockedList === 'function') window.renderBlockedList();
        } else if (tabId === 'storage') {
            if (typeof window.calculateRealStorage === 'function') window.calculateRealStorage();
        }
    }, 240);
};

function finishBackToSettings() {
    if (settingsBackTimer) {
        clearTimeout(settingsBackTimer);
        settingsBackTimer = null;
    }
    document.body.classList.remove('in-settings-sub');
    const subViewport = document.getElementById('settings-sub-viewport');
    const mainContainer = document.getElementById('settings-main-container');
    if (subViewport) {
        subViewport.classList.remove('open');
        subViewport.classList.add('hidden');
        subViewport.style.transform = '';
        subViewport.style.transition = '';
    }
    if (mainContainer) {
        mainContainer.classList.remove('slide-back');
        mainContainer.style.transform = '';
        mainContainer.style.opacity = '';
        mainContainer.style.transition = '';
    }
    const dock = document.getElementById('floating-bottom-bar');
    if (dock) {
        dock.style.transform = '';
        dock.style.opacity = '';
        dock.style.transition = '';
    }
    document.querySelectorAll('.settings-sub-viewport .tab-content').forEach(c => {
        c.classList.remove('active');
        c.classList.add('hidden');
    });
}
window.finishBackToSettings = finishBackToSettings;

window.backToSettingsMenu = function() {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    if (settingsBackTimer) {
        clearTimeout(settingsBackTimer);
        settingsBackTimer = null;
    }

    const subViewport = document.getElementById('settings-sub-viewport');
    const mainContainer = document.getElementById('settings-main-container');
    if (!subViewport || !subViewport.classList.contains('open')) {
        finishBackToSettings();
        return;
    }

    document.body.classList.remove('in-settings-sub');
    subViewport.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
    subViewport.style.transform = 'translate3d(100%, 0, 0)';

    if (mainContainer) {
        mainContainer.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease';
        mainContainer.style.transform = 'translate3d(0, 0, 0)';
        mainContainer.style.opacity = '1';
    }

    const dock = document.getElementById('floating-bottom-bar');
    if (dock) {
        dock.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease';
        dock.style.transform = '';
        dock.style.opacity = '';
    }

    settingsBackTimer = setTimeout(() => {
        settingsBackTimer = null;
        finishBackToSettings();
    }, 240);
};

function initSettingsSwipeGesture() {
    const subViewport = document.getElementById('settings-sub-viewport');
    const mainContainer = document.getElementById('settings-main-container');
    if (!subViewport) return;

    let isSwiping = false;
    let isLocked = false;
    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let gestureRaf = null;

    function handleStart(x, y) {
        if (!subViewport.classList.contains('open')) return false;
        if (x <= 70) {
            isSwiping = true;
            isLocked = false;
            startX = x;
            startY = y;
            deltaX = 0;
            return true;
        }
        return false;
    }

    function handleMove(x, y, e) {
        if (!isSwiping) return;
        const diffX = x - startX;
        const diffY = y - startY;

        if (!isLocked) {
            if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
                if (diffX > 0 && diffX > Math.abs(diffY) * 0.7) {
                    isLocked = true;
                } else {
                    isSwiping = false;
                    return;
                }
            }
        }

        if (isLocked) {
            if (e && e.cancelable) e.preventDefault();
            deltaX = Math.max(0, diffX);

            if (!gestureRaf) {
                gestureRaf = requestAnimationFrame(() => {
                    gestureRaf = null;
                    if (!isLocked) return;
                    subViewport.style.transition = 'none';
                    if (mainContainer) mainContainer.style.transition = 'none';

                    subViewport.style.transform = `translate3d(${deltaX}px, 0, 0)`;
                    if (mainContainer) {
                        const w = window.innerWidth || 360;
                        const progress = Math.min(deltaX / w, 1);
                        mainContainer.style.transform = `translate3d(${-20 + progress * 20}%, 0, 0)`;
                        mainContainer.style.opacity = `${0.5 + progress * 0.5}`;
                    }

                    const dock = document.getElementById('floating-bottom-bar');
                    if (dock) {
                        const w = window.innerWidth || 360;
                        const progress = Math.min(deltaX / w, 1);
                        dock.style.transition = 'none';
                        dock.style.transform = `translate(-50%, ${75 - progress * 75}px) scale(${0.92 + progress * 0.08})`;
                        dock.style.opacity = `${progress}`;
                    }
                });
            }
        }
    }

    function handleEnd() {
        if (gestureRaf) {
            cancelAnimationFrame(gestureRaf);
            gestureRaf = null;
        }
        if (!isSwiping && !isLocked) return;
        isSwiping = false;
        if (!isLocked) return;
        isLocked = false;

        const w = window.innerWidth || 360;
        const threshold = Math.max(75, w * 0.22);

        if (deltaX >= threshold) {
            document.body.classList.remove('in-settings-sub');
            subViewport.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1)';
            if (mainContainer) {
                mainContainer.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.26s ease';
                mainContainer.style.transform = 'translate3d(0, 0, 0)';
                mainContainer.style.opacity = '1';
            }
            const dock = document.getElementById('floating-bottom-bar');
            if (dock) {
                dock.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.26s ease';
                dock.style.transform = 'translate(-50%, 0) scale(1)';
                dock.style.opacity = '1';
            }
            subViewport.style.transform = 'translate3d(100%, 0, 0)';
            setTimeout(() => {
                if (dock) {
                    dock.style.transform = '';
                    dock.style.opacity = '';
                    dock.style.transition = '';
                }
                finishBackToSettings();
            }, 260);
        } else {
            subViewport.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
            if (mainContainer) {
                mainContainer.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease';
                mainContainer.style.transform = 'translate3d(-20%, 0, 0)';
                mainContainer.style.opacity = '0.5';
            }
            const dock = document.getElementById('floating-bottom-bar');
            if (dock) {
                dock.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease';
                dock.style.transform = 'translate(-50%, 75px) scale(0.92)';
                dock.style.opacity = '0';
                setTimeout(() => {
                    dock.style.transform = '';
                    dock.style.opacity = '';
                    dock.style.transition = '';
                }, 220);
            }
            subViewport.style.transform = 'translate3d(0, 0, 0)';
        }
    }

    subViewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    subViewport.addEventListener('touchmove', (e) => {
        if (isSwiping && e.touches.length === 1) handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });

    subViewport.addEventListener('touchend', handleEnd, { passive: true });
    subViewport.addEventListener('touchcancel', handleEnd, { passive: true });

    let isMouseDown = false;
    subViewport.addEventListener('mousedown', (e) => {
        if (e.button === 0 && handleStart(e.clientX, e.clientY)) {
            isMouseDown = true;
            const onMouseMove = (moveE) => {
                if (isMouseDown) handleMove(moveE.clientX, moveE.clientY, moveE);
            };
            const onMouseUp = () => {
                if (isMouseDown) {
                    isMouseDown = false;
                    handleEnd();
                }
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsSwipeGesture);
} else {
    initSettingsSwipeGesture();
}

let pendingUserAvatar = null;
let pendingUserHeader = null;
let pendingChatBg = null;

let customizationDebounceTimer = null;
function triggerAutoSaveCustomization(delay = 400) {
    clearTimeout(customizationDebounceTimer);
    customizationDebounceTimer = setTimeout(() => {
        saveCustomization(true);
    }, delay);
}
window.triggerAutoSaveCustomization = triggerAutoSaveCustomization;

document.getElementById('set-avatar-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) { 
        const sap = document.getElementById('settings-avatar-preview'); 
        if(sap) sap.src = evt.target.result;
        try {
            pendingUserAvatar = await uploadMediaFile(file, `avatar_${currentUser?.kId || 'user'}_${file.name}`);
        } catch (err) {
            pendingUserAvatar = evt.target.result;
        }
        saveCustomization(true);
    };
    reader.readAsDataURL(file);
});
document.getElementById('set-header-file')?.addEventListener('change', function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) { 
        const shp = document.getElementById('settings-header-preview'); 
        if(shp) shp.style.backgroundImage = `url(${evt.target.result})`; 
        try {
            pendingUserHeader = await uploadMediaFile(file, `header_${currentUser?.kId || 'user'}_${file.name}`);
        } catch (err) {
            pendingUserHeader = evt.target.result;
        }
        saveCustomization(true);
    };
    reader.readAsDataURL(file);
});
window.handleChatBgFileSelect = function(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) { 
        const bgData = evt.target.result;
        applyChatBgDirectly(bgData);
        try {
            pendingChatBg = await uploadMediaFile(file, `chatbg_${currentUser?.kId || 'user'}_${file.name}`);
        } catch (err) {
            pendingChatBg = bgData;
        }
        saveCustomization(true);
        showToast('Обои чата установлены', 'success');
    };
    reader.readAsDataURL(file);
};

const WALLPAPER_PRESETS = {
    'dark-mesh': 'radial-gradient(at 0% 0%, rgba(20, 30, 48, 0.95) 0, transparent 60%), radial-gradient(at 100% 100%, rgba(36, 59, 85, 0.95) 0, transparent 60%), #0c0d10',
    'neon-gradient': 'linear-gradient(135deg, #181926 0%, #2e2640 50%, #1a1b26 100%)',
    'minimal-dots': 'radial-gradient(rgba(255, 255, 255, 0.12) 1.5px, transparent 1.5px), #17181c',
    'aurora': 'linear-gradient(135deg, #09203f 0%, #537895 100%)'
};

window.applyWallpaperPreset = function(presetKey) {
    const bg = WALLPAPER_PRESETS[presetKey];
    if (!bg) return;
    pendingChatBg = bg;
    applyChatBgDirectly(bg);
    saveCustomization(true);
    showToast('Обои чата обновлены', 'success');
};

function applyChatBgDirectly(bgVal) {
    const chatArea = document.getElementById('chat-area');
    if (!chatArea) return;
    if (bgVal) {
        if (bgVal.startsWith('data:') || bgVal.startsWith('http') || bgVal.startsWith('/')) {
            chatArea.style.backgroundImage = `url("${bgVal}")`;
        } else {
            chatArea.style.backgroundImage = bgVal;
        }
        chatArea.style.backgroundSize = 'cover';
        chatArea.style.backgroundPosition = 'center';
        chatArea.style.backgroundRepeat = 'no-repeat';
        const mc = document.getElementById('messages-container');
        if (mc) mc.style.background = 'transparent';
    } else {
        chatArea.style.backgroundImage = '';
        chatArea.style.backgroundColor = 'var(--bg-main)';
        const mc = document.getElementById('messages-container');
        if (mc) mc.style.background = '';
    }
}
window.applyChatBgDirectly = applyChatBgDirectly;

window.clearChatBg = function() { 
    pendingChatBg = ''; 
    applyChatBgDirectly('');
    saveCustomization(true);
    showToast('Обои сброшены', 'info');
};

document.addEventListener('DOMContentLoaded', () => {
    const bgInput = document.getElementById('set-chatbg-file');
    if (bgInput) {
        bgInput.addEventListener('change', window.handleChatBgFileSelect);
    }
});

async function saveCustomization(silent = true) {
    if (!currentUser) return;
    const sn = document.getElementById('set-name');
    const name = sn ? sn.value.trim() : (currentUser.name || '');
    const st = document.getElementById('set-theme');
    const currentActiveTheme = (currentUser && currentUser.theme) || document.body.getAttribute('data-theme') || localStorage.getItem('knx_theme') || 'dark';
    const theme = (st && st.value) ? st.value : currentActiveTheme;
    const sl = document.getElementById('set-lang');
    const lang = sl ? sl.value : ((currentUser && currentUser.lang) || localStorage.getItem('knx_lang') || 'ru');
    const sb = document.getElementById('set-bio');
    const bio = sb ? sb.value : (currentUser.bio || '');
    const shob = document.getElementById('set-hobbies');
    const hobbies = shob ? shob.value.trim() : (currentUser.hobbies || '');
    const sbd = document.getElementById('set-birthdate');
    const birthDate = sbd ? sbd.value.trim() : (currentUser.birthDate || '');
    const ss = document.getElementById('set-sound');
    const soundEnabled = ss ? ss.checked : (currentUser.soundEnabled !== false);
    
    const avatar = pendingUserAvatar || currentUser.avatar;
    const header = pendingUserHeader !== null ? pendingUserHeader : currentUser.header;
    const chatBg = pendingChatBg !== null ? pendingChatBg : currentUser.chatBg;

    if(!name) {
        if (!silent) showToast('Имя не может быть пустым', 'error');
        return;
    }

    try {
        const res = await fetch('/api/settings/customize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, name, theme, lang, avatar, header, bio, hobbies, birthDate, chatBg, soundEnabled, folders: currentUser.folders, archived: currentUser.archived })
        });
        if (res.ok) {
            currentUser.name = name;
            currentUser.avatar = avatar;
            currentUser.header = header;
            currentUser.theme = theme;
            currentUser.lang = lang;
            currentUser.bio = bio;
            currentUser.hobbies = hobbies;
            currentUser.birthDate = birthDate;
            currentUser.chatBg = chatBg;
            currentUser.soundEnabled = soundEnabled;
            
            localStorage.setItem('knx_theme', theme);
            document.documentElement.setAttribute('data-theme', theme);
            document.body.setAttribute('data-theme', theme);
            window.updateThemeToggleUI(theme);
            applyLanguage(lang);
            updateUIProfile();
            if (!silent) showToast('Профиль сохранен', 'success');
        }
    } catch(e) {
        console.error('Silent auto-save error:', e);
    }
}
window.saveCustomization = saveCustomization;

async function savePassword() {
    const sop = document.getElementById('set-old-pass');
    const oldPassword = sop ? sop.value : '';
    const snp = document.getElementById('set-new-pass');
    const newPassword = snp ? snp.value : '';
    if(!oldPassword || !newPassword) return showToast('Заполните оба поля', 'error');

    if (newPassword.length < 8 || !/\d/.test(newPassword) || !/[a-zA-Zа-яА-Я]/.test(newPassword)) {
        return showToast('Ненадежный пароль! Минимум 8 символов, буквы и цифры.', 'error');
    }

    const res = await fetch('/api/settings/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kId: currentUser.kId, oldPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
        showToast('Пароль успешно изменен', 'success');
        localStorage.setItem('password', newPassword);
        if(sop) sop.value = ''; 
        if(snp) snp.value = '';
    } else showToast(data.message, 'error');
}
window.savePassword = savePassword;

async function savePrivacy(silent = true) {
    if (!currentUser) return;
    const ss = document.getElementById('set-searchable');
    const searchable = ss ? ss.checked : (currentUser.searchable !== false);
    const shk = document.getElementById('set-hide-kid');
    const hideKid = shk ? shk.checked : (currentUser.hideKid === true);
    const sha = document.getElementById('set-hide-avatar');
    const hideAvatar = sha ? sha.checked : (currentUser.hideAvatar === true);
    const shh = document.getElementById('set-hide-header');
    const hideHeader = shh ? shh.checked : (currentUser.hideHeader === true);
    const shb = document.getElementById('set-hide-bio');
    const hideBio = shb ? shb.checked : (currentUser.hideBio === true);

    const toggleOnline = document.getElementById('toggle-online-status');
    const showOnlineStatus = toggleOnline ? toggleOnline.checked : (currentUser.showOnlineStatus !== false);

    const toggleReceipts = document.getElementById('toggle-read-receipts');
    const readReceipts = toggleReceipts ? toggleReceipts.checked : true;

    const phoneSel = document.getElementById('set-priv-phone');
    const privPhone = phoneSel ? phoneSel.value : (currentUser.privPhone || 'contacts');
    const lastSel = document.getElementById('set-priv-last');
    const privLast = lastSel ? lastSel.value : (currentUser.privLast || 'everybody');
    const callsSel = document.getElementById('set-priv-calls');
    const privCalls = callsSel ? callsSel.value : (currentUser.privCalls || 'everybody');

    const ssToggle = document.getElementById('toggle-screenshot-alerts');
    const screenshotAlerts = ssToggle ? ssToggle.checked : (currentUser.screenshotAlerts !== false);

    try {
        const res = await fetch('/api/settings/privacy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                kId: currentUser.kId, 
                searchable, 
                hideKid, 
                hideAvatar, 
                hideHeader, 
                hideBio,
                showOnlineStatus,
                hideOnline: !showOnlineStatus,
                readReceipts,
                privPhone,
                privLast,
                privCalls,
                screenshotAlerts
            })
        });
        if (res.ok) {
            currentUser.searchable = searchable;
            currentUser.hideKid = hideKid;
            currentUser.hideAvatar = hideAvatar;
            currentUser.hideHeader = hideHeader;
            currentUser.hideBio = hideBio;
            currentUser.showOnlineStatus = showOnlineStatus;
            currentUser.hideOnline = !showOnlineStatus;
            currentUser.readReceipts = readReceipts;
            currentUser.privPhone = privPhone;
            currentUser.privLast = privLast;
            currentUser.privCalls = privCalls;
            currentUser.screenshotAlerts = screenshotAlerts;
            updateUIProfile();
            if (!silent) showToast('Приватность обновлена', 'success');
        }
    } catch(e) {
        console.error('Silent privacy save error:', e);
    }
}
window.savePrivacy = savePrivacy;

window.syncPrivacySettingsUI = function() {
    if (!currentUser) return;
    const s = window.chatSettings || (typeof DEFAULT_CHAT_SETTINGS !== 'undefined' ? DEFAULT_CHAT_SETTINGS : {});

    const phoneSel = document.getElementById('set-priv-phone');
    if (phoneSel) phoneSel.value = currentUser.privPhone || 'contacts';
    const lastSel = document.getElementById('set-priv-last');
    if (lastSel) lastSel.value = currentUser.privLast || 'everybody';
    const callsSel = document.getElementById('set-priv-calls');
    if (callsSel) callsSel.value = currentUser.privCalls || 'everybody';

    const onlineToggle = document.getElementById('toggle-online-status');
    if (onlineToggle) onlineToggle.checked = currentUser.showOnlineStatus !== false;

    const ssToggle = document.getElementById('toggle-screenshot-alerts');
    if (ssToggle) ssToggle.checked = currentUser.screenshotAlerts !== undefined ? currentUser.screenshotAlerts !== false : (s.screenshotAlerts !== false);

    const isVipUser = currentUser.isVip || currentUser.role === 'vip' || currentUser.role === 'admin' || currentUser.role === 'dev' || currentUser.email === 'knx_dev@knx.im';
    const rrToggle = document.getElementById('toggle-read-receipts');
    if (rrToggle) {
        if (!isVipUser && s.readReceipts === false) s.readReceipts = true;
        rrToggle.checked = s.readReceipts !== false;
    }

    const typingToggle = document.getElementById('toggle-typing-status');
    if (typingToggle) typingToggle.checked = s.typingIndicator !== false;

    const hideKidChatToggle = document.getElementById('toggle-hide-kid-chat');
    if (hideKidChatToggle) hideKidChatToggle.checked = s.hideKidInChat === true;

    const previewNotifToggle = document.getElementById('toggle-preview-notif');
    if (previewNotifToggle) previewNotifToggle.checked = s.previewNotificationText !== false;

    const searchableToggle = document.getElementById('set-searchable');
    if (searchableToggle) searchableToggle.checked = currentUser.searchable !== false;

    const hideKidToggle = document.getElementById('set-hide-kid');
    if (hideKidToggle) hideKidToggle.checked = currentUser.hideKid === true;

    const hideAvatarToggle = document.getElementById('set-hide-avatar');
    if (hideAvatarToggle) hideAvatarToggle.checked = currentUser.hideAvatar === true;

    const hideBioToggle = document.getElementById('set-hide-bio');
    if (hideBioToggle) hideBioToggle.checked = currentUser.hideBio === true;

    const hasPasscode = !!localStorage.getItem('knx_passcode_' + currentUser.kId);
    const pillPass = document.getElementById('privacy-passcode-status-pill');
    if (pillPass) pillPass.innerText = hasPasscode ? 'Вкл.' : 'Выкл.';

    const blockedCount = (currentUser.blocked && Array.isArray(currentUser.blocked)) ? currentUser.blocked.length : 0;
    const statusText = document.getElementById('blocked-status-text');
    if (statusText) {
        statusText.innerText = blockedCount > 0 ? `Заблокировано пользователей: ${blockedCount}` : 'Вы никого не заблокировали.';
    }
    const blockedLabel = document.getElementById('settings-blocked-count-label');
    if (blockedLabel) {
        blockedLabel.innerText = blockedCount > 0 ? `Заблокировано: ${blockedCount}` : 'Заблокированные пользователи';
    }
};

function renderBlockedList() {
    const list = document.getElementById('blocked-users-list');
    const statusText = document.getElementById('blocked-status-text');
    const blockedCount = (currentUser && currentUser.blocked) ? currentUser.blocked.length : 0;
    if (statusText) {
        statusText.innerText = blockedCount > 0 ? `Заблокировано пользователей: ${blockedCount}` : 'Вы никого не заблокировали.';
    }
    const blockedCountMenu = document.getElementById('settings-blocked-count-label');
    if (blockedCountMenu) {
        blockedCountMenu.innerText = blockedCount > 0 ? `Заблокировано: ${blockedCount}` : 'Заблокированные пользователи';
    }
    if (!list) return;
    list.innerHTML = '';
    if (currentUser && currentUser.blocked && currentUser.blocked.length > 0) {
        currentUser.blocked.forEach(user => {
            const div = document.createElement('div');
            div.className = 'blocked-item';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.style.padding = '10px 0';
            div.style.borderBottom = '1px solid var(--border)';
            
            const avatar = user.avatar || DEFAULT_AVATAR;
            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                    <img src="${avatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border);">
                    <div style="min-width: 0;">
                        <div style="font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(user.name || user.kId)}</div>
                        <div style="font-size: 12px; color: var(--text-muted); font-family: monospace;">K-ID: ${escapeHTML(user.kId)}</div>
                    </div>
                </div>
                <button class="btn-primary" style="padding: 6px 14px; font-size: 13px; border-radius: 8px; flex-shrink: 0; background: rgba(255,59,48,0.12); color: #ff3b30; border: none; cursor: pointer;" onclick="unblockUser('${user.kId}')">Разблокировать</button>
            `;
            list.appendChild(div);
        });
    } else {
        list.innerHTML = `
            <div style="padding: 24px 0; text-align: center; color: var(--text-muted); font-size: 14px;">
                В чёрном списке пока никого нет
            </div>
        `;
    }
}
window.renderBlockedList = renderBlockedList;

function unblockUser(bId) {
    if (!currentUser || !currentUser.blocked) return;
    currentUser.blocked = currentUser.blocked.filter(user => user.kId !== bId);
    syncBlockedList();
    renderBlockedList();
    showToast('Пользователь разблокирован', 'info');
}
window.unblockUser = unblockUser;

document.addEventListener('DOMContentLoaded', () => {
    });

window.switchNav = function(tab, el) {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    const settingsScreen = document.getElementById('settings-screen');
    const isSettingsClosing = !!(fullscreenCloseTimers && fullscreenCloseTimers['settings-screen']);
    const isSettingsVisible = !!(settingsScreen && !settingsScreen.classList.contains('hidden') && !isSettingsClosing);

    if (tab === 'chats') {
        if (isSettingsVisible || isSettingsClosing) {
            closeSettingsScreen();
        }
        document.getElementById('profile-screen')?.classList.add('hidden');
        if (typeof closeMobileChat === 'function') closeMobileChat();
        if (currentFolderId === 'archived') {
            if (typeof selectFolder === 'function') selectFolder('all');
        }
    } else if (tab === 'archive') {
        if (isSettingsVisible || isSettingsClosing) {
            closeSettingsScreen();
        }
        document.getElementById('profile-screen')?.classList.add('hidden');
        if (typeof closeMobileChat === 'function') closeMobileChat();
        if (currentFolderId !== 'archived') {
            if (typeof selectFolder === 'function') selectFolder('archived');
        }
    } else if (tab === 'settings') {
        document.getElementById('profile-screen')?.classList.add('hidden');
        if (!isSettingsVisible || isSettingsClosing) {
            if (typeof openSettingsScreen === 'function') openSettingsScreen();
        }
    } else if (tab === 'profile') {
        if (isSettingsVisible || isSettingsClosing) closeSettingsScreen();
        if (currentUser && currentUser.kId && typeof openProfileScreen === 'function') {
            openProfileScreen(currentUser.kId);
        }
    }
    window.updateDockActiveState(tab);
};

window.updateDockActiveState = function(tab) {
    if (!tab) return;
    document.querySelectorAll('.dock-item').forEach(item => {
        if (item.getAttribute('data-tab') === tab) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick')?.includes(`'${tab}'`)) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
};

window.updateDockBadges = function() {
    if (!currentUser) return;
    
    const archivedList = currentUser.archived || [];
    let totalUnread = 0;
    if (typeof unreadCounts === 'object' && unreadCounts !== null) {
        for (const [id, count] of Object.entries(unreadCounts)) {
            if (!archivedList.includes(id) && typeof count === 'number' && count > 0) {
                totalUnread += count;
            }
        }
    }
    const chatsBadge = document.getElementById('dock-badge-chats');
    if (chatsBadge) {
        if (totalUnread > 0) {
            chatsBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            chatsBadge.classList.remove('hidden');
        } else {
            chatsBadge.classList.add('hidden');
        }
    }

    const archiveCount = archivedList.length;
    const archiveBadge = document.getElementById('dock-badge-archive');
    if (archiveBadge) {
        if (archiveCount > 0) {
            archiveBadge.textContent = archiveCount > 99 ? '99+' : archiveCount;
            archiveBadge.classList.remove('hidden');
        } else {
            archiveBadge.classList.add('hidden');
        }
    }

    const avatarImg = document.getElementById('dock-user-avatar');
    const gearFallback = document.getElementById('dock-gear-fallback');
    if (avatarImg) {
        if (currentUser.avatar) {
            avatarImg.src = currentUser.avatar;
            avatarImg.classList.remove('hidden');
            if (gearFallback) gearFallback.classList.add('hidden');
        } else {
            avatarImg.classList.add('hidden');
            if (gearFallback) gearFallback.classList.remove('hidden');
        }
    }
};

window.updateNavSlider = function(el) {
    if(!el) return;
    const slider = document.getElementById('nav-slider');
    const nav = document.getElementById('mobile-bottom-nav') || document.getElementById('floating-bottom-bar');
    if(!slider || !nav) return;
    slider.style.width = el.offsetWidth + 'px';
    slider.style.transform = `translateX(${el.offsetLeft}px)`; 
};
document.addEventListener('DOMContentLoaded', () => {
    const themeSelect = document.getElementById('set-theme');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            document.body.setAttribute('data-theme', e.target.value);
        });
    }
});


window.fetchedSessionsList = [];

async function renderSessionsList() {
    const currentBox = document.getElementById('current-session-box');
    const listContainer = document.getElementById('active-sessions-list');
    if (!currentBox || !listContainer || !currentUser) return;

    try {
        const res = await fetch(`/api/sessions/${currentUser.kId}`);
        const data = await res.json();
        if (data.success && data.sessions) {
            window.fetchedSessionsList = data.sessions;
            const mySessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
            const current = data.sessions.find(s => s.id === mySessionId) || data.sessions[0];
            const others = data.sessions.filter(s => s.id !== current?.id);

            if (current) {
                currentBox.innerHTML = `
                    <div class="session-item" style="cursor: pointer;" onclick="showSessionDetails('${current.id}')">
                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex-grow: 1;">
                            <div class="session-icon" style="background: rgba(52, 199, 89, 0.15); color: #34C759;">
                                ${current.icon === 'desktop' ? 
                                    '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>' :
                                    '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
                                }
                            </div>
                            <div style="min-width: 0;">
                                <div style="font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 6px;">
                                    <span>${escapeHTML(current.name)}</span>
                                    <span class="ios-badge-active">● Текущее устройство</span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${escapeHTML(current.app)} • ${escapeHTML(current.ip)}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">📍 ${escapeHTML(current.location)}</div>
                            </div>
                        </div>
                        <div style="color: var(--text-muted); opacity: 0.5;">
                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </div>
                `;
            }

            if (others.length === 0) {
                listContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 14px;">
                        Нет других активных устройств
                    </div>
                `;
            } else {
                listContainer.innerHTML = others.map(s => `
                    <div class="session-item" id="session-row-${s.id}">
                        <div style="display: flex; align-items: center; min-width: 0; flex-grow: 1; gap: 12px; cursor: pointer;" onclick="showSessionDetails('${s.id}')">
                            <div class="session-icon">
                                ${s.icon === 'desktop' ? 
                                    '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>' :
                                    '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
                                }
                            </div>
                            <div style="min-width: 0;">
                                <div style="font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(s.name)}</div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${escapeHTML(s.app)} • ${escapeHTML(s.ip)}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">📍 ${escapeHTML(s.location)} • ${escapeHTML(s.date)}</div>
                            </div>
                        </div>
                        <div style="margin-left: 10px;">
                            <button class="session-terminate-btn" onclick="event.stopPropagation(); terminateSession('${s.id}')">Завершить</button>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch(e) {
        console.error('Error fetching sessions:', e);
    }
}

window.showSessionDetails = function(sessionId) {
    const s = window.fetchedSessionsList.find(item => item.id === sessionId);
    if (!s) return;

    const mySessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
    const isCurrent = (s.id === mySessionId);

    const content = document.getElementById('session-details-content');
    if (!content) return;

    content.innerHTML = `
        <div class="modal-header">
            <h3 style="margin: 0; font-size: 18px;">Информация об устройстве</h3>
            <button class="icon-btn close-btn" onclick="closeModal('session-details-modal')">
                <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div style="padding: 10px 0 20px 0; text-align: center;">
            <div style="width: 64px; height: 64px; border-radius: 16px; background: var(--bg-input); display: inline-flex; align-items: center; justify-content: center; color: var(--accent); margin-bottom: 12px; border: 1px solid var(--border);">
                ${s.icon === 'desktop' ? 
                    '<svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>' :
                    '<svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="2" fill="none"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
                }
            </div>
            <div style="font-size: 18px; font-weight: 600;">${escapeHTML(s.name)}</div>
            <div style="font-size: 13px; color: var(--accent); margin-top: 4px;">${escapeHTML(s.app)}</div>
            ${isCurrent ? '<div style="margin-top: 6px;"><span class="ios-badge-active">● Текущее устройство</span></div>' : ''}
        </div>

        <div class="ios-group-card" style="margin-bottom: 20px; font-size: 14px;">
            <div class="ios-row">
                <span style="color: var(--text-muted);">IP-адрес:</span>
                <span style="font-family: monospace; font-weight: 500;">${escapeHTML(s.ip)}</span>
            </div>
            <div class="ios-row">
                <span style="color: var(--text-muted);">Местоположение:</span>
                <span style="font-weight: 500;">📍 ${escapeHTML(s.location)}</span>
            </div>
            <div class="ios-row">
                <span style="color: var(--text-muted);">Время входа:</span>
                <span>${escapeHTML(s.loginDate || s.date)}</span>
            </div>
            <div class="ios-row">
                <span style="color: var(--text-muted);">Последняя активность:</span>
                <span>${escapeHTML(s.date)}</span>
            </div>
        </div>

        ${!isCurrent ? `
            <button class="btn-danger" style="width: 100%; border-radius: 12px; padding: 13px; font-size: 15px; font-weight: 600; margin-bottom: 10px;" onclick="closeModal('session-details-modal'); terminateSession('${s.id}')">
                Завершить этот сеанс
            </button>
        ` : ''}
        <button class="btn-secondary" style="width: 100%; border-radius: 12px; padding: 12px; font-size: 15px;" onclick="closeModal('session-details-modal')">
            Закрыть
        </button>
    `;
    openModal('session-details-modal');
};

window.terminateSession = async function(sessionId) {
    if (!currentUser) return;
    try {
        const res = await fetch('/api/sessions/terminate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, sessionId, allOthers: false })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Сеанс завершен', 'success');
            renderSessionsList();
        } else {
            showToast(data.message || 'Ошибка', 'error');
        }
    } catch(e) {
        showToast('Ошибка при завершении сеанса', 'error');
    }
};

window.terminateAllOtherSessions = async function() {
    if (!currentUser) return;
    try {
        const mySessionId = window.currentSessionId || localStorage.getItem('knx_current_session_id');
        const res = await fetch('/api/sessions/terminate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, sessionId: mySessionId, allOthers: true })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Все другие сеансы успешно завершены', 'success');
            renderSessionsList();
        } else {
            showToast(data.message || 'Ошибка', 'error');
        }
    } catch(e) {
        showToast('Ошибка завершения сеансов', 'error');
    }
};

async function syncSecuritySettingsUI() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/security/2fa/status/${currentUser.kId}`);
        const data = await res.json();
        const sw2fa = document.getElementById('set-2fa');
        const lbl2fa = document.getElementById('label-2fa-status');
        if (sw2fa && data.success) {
            sw2fa.checked = !!data.twoFactorEnabled;
            if (lbl2fa) {
                lbl2fa.innerText = data.twoFactorEnabled ? 'Включена (Облачный пароль активен)' : 'Дополнительный облачный пароль при входе';
            }
        }
    } catch(e) {}

    const hasPasscode = !!localStorage.getItem('knx_passcode_' + currentUser.kId);
    const swPass = document.getElementById('set-passcode');
    const lblPass = document.getElementById('label-passcode-status');
    if (swPass) swPass.checked = hasPasscode;
    if (lblPass) lblPass.innerText = hasPasscode ? 'Код-пароль установлен' : 'Блокировка экрана приложения';
    const pillPass = document.getElementById('privacy-passcode-status-pill');
    if (pillPass) pillPass.innerText = hasPasscode ? 'Вкл.' : 'Выкл.';
    document.querySelectorAll('.lock-app-btn').forEach(btn => btn.classList.toggle('hidden', !hasPasscode));

    const ttlSelect = document.getElementById('set-session-ttl');
    if (ttlSelect) {
        const savedTTL = (currentUser && currentUser.sessionTtl) || localStorage.getItem('knx_session_ttl_' + (currentUser ? currentUser.kId : '')) || '1m';
        ttlSelect.value = savedTTL;
    }
}
window.syncSecuritySettingsUI = syncSecuritySettingsUI;

window.updateSessionTTL = async function(val) {
    if (!currentUser) return;
    currentUser.sessionTtl = val;
    localStorage.setItem('knx_session_ttl_' + currentUser.kId, val);
    try {
        await fetch('/api/settings/privacy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, sessionTtl: val })
        });
        showToast('Период автозавершения сессий обновлен', 'success');
    } catch(e) {}
};

function handle2FAToggle(switchEl) {
    const isEnabling = switchEl.checked;
    if (!isEnabling) {
        disable2FASettings();
        return;
    }
    const modal = document.getElementById('setup-2fa-modal');
    const title = document.getElementById('setup-2fa-title');
    const btnDisable = document.getElementById('btn-disable-2fa');
    const pass1 = document.getElementById('input-2fa-pass');
    const pass2 = document.getElementById('input-2fa-confirm');
    const hint = document.getElementById('input-2fa-hint');

    if (pass1) pass1.value = '';
    if (pass2) pass2.value = '';
    if (hint) hint.value = '';

    if (title) title.innerText = 'Включение двухфакторной защиты';
    if (btnDisable) btnDisable.classList.add('hidden');
    openModal('setup-2fa-modal');
}

async function save2FASettings() {
    const pass1 = document.getElementById('input-2fa-pass')?.value.trim();
    const pass2 = document.getElementById('input-2fa-confirm')?.value.trim();
    const hint = document.getElementById('input-2fa-hint')?.value.trim();

    if (!pass1) return showToast('Введите облачный пароль', 'error');
    if (pass1.length < 6) return showToast('Пароль должен быть не менее 6 символов', 'error');
    if (pass1 !== pass2) return showToast('Пароли не совпадают', 'error');

    try {
        const res = await fetch('/api/security/2fa/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, enabled: true, cloudPassword: pass1, hint })
        });
        const data = await res.json();
        if (data.success) {
            currentUser.twoFactorEnabled = true;
            closeModal('setup-2fa-modal');
            showToast('Двухфакторная защита активирована!', 'success');
            syncSecuritySettingsUI();
        } else {
            showToast(data.message || 'Ошибка сохранения', 'error');
            syncSecuritySettingsUI();
        }
    } catch(e) {
        showToast('Ошибка сети', 'error');
        syncSecuritySettingsUI();
    }
}

async function disable2FASettings() {
    try {
        const res = await fetch('/api/security/2fa/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kId: currentUser.kId, enabled: false })
        });
        const data = await res.json();
        if (data.success) {
            currentUser.twoFactorEnabled = false;
            closeModal('setup-2fa-modal');
            showToast('Облачный пароль отключен', 'info');
            syncSecuritySettingsUI();
        } else {
            showToast(data.message || 'Ошибка', 'error');
            syncSecuritySettingsUI();
        }
    } catch(e) {
        showToast('Ошибка сети', 'error');
        syncSecuritySettingsUI();
    }
}
window.save2FASettings = save2FASettings;
window.disable2FASettings = disable2FASettings;
window.handle2FAToggle = handle2FAToggle;

window.openDeleteAccountModal = function() {
    if (!currentUser) return;
    const passInput = document.getElementById('input-delete-acc-pass');
    const cloud2faBox = document.getElementById('delete-acc-2fa-box');
    const cloud2faInput = document.getElementById('input-delete-acc-2fa');

    if (passInput) passInput.value = '';
    if (cloud2faInput) cloud2faInput.value = '';

    const has2FA = currentUser.twoFactorEnabled;
    if (cloud2faBox) {
        cloud2faBox.classList.toggle('hidden', !has2FA);
    }
    openModal('delete-account-modal');
    setTimeout(() => passInput?.focus(), 150);
};

window.executeDeleteAccount = async function() {
    if (!currentUser) return;
    const passInput = document.getElementById('input-delete-acc-pass');
    const cloud2faInput = document.getElementById('input-delete-acc-2fa');

    const password = passInput ? passInput.value.trim() : '';
    const cloudPassword = cloud2faInput ? cloud2faInput.value.trim() : '';

    if (!password) {
        return showToast('Введите пароль от аккаунта для подтверждения', 'error');
    }
    if (currentUser.twoFactorEnabled && !cloudPassword) {
        return showToast('Введите облачный 2FA пароль', 'error');
    }

    const token = sessionToken || localStorage.getItem('knx_session_token');

    showToast('Удаление профиля и данных...', 'info');

    try {
        const res = await fetch('/api/user/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kId: currentUser.kId,
                password,
                cloudPassword,
                token
            })
        });

        const data = await res.json();
        if (data.success) {
            closeModal('delete-account-modal');
            showToast('✅ Аккаунт и все данные успешно удалены навсегда', 'success');

            localStorage.clear();
            sessionToken = null;
            currentUser = null;
            activeChat = null;
            if (socket) socket.disconnect();

            setTimeout(() => {
                document.getElementById('settings-screen')?.classList.add('hidden');
                document.getElementById('profile-screen')?.classList.add('hidden');
                document.getElementById('main-screen')?.classList.add('hidden');
                document.body.classList.remove('mobile-chat-open');
                document.getElementById('auth-screen')?.classList.remove('hidden');
                document.getElementById('auth-screen')?.classList.add('animate-fade-in');
                const lp = document.getElementById('login-pass');
                if (lp) lp.value = '';
                const lk = document.getElementById('login-kid');
                if (lk) lk.value = '';
                const cl = document.getElementById('chat-list');
                if (cl) cl.innerHTML = '';
                const mc = document.getElementById('messages-container');
                if (mc) mc.innerHTML = '';
            }, 600);
        } else {
            showToast(data.message || 'Ошибка удаления аккаунта', 'error');
        }
    } catch (err) {
        console.error('Delete account error:', err);
        showToast('Сетевая ошибка при удалении аккаунта', 'error');
    }
};

window.currentPasscodeBuffer = '';

function lockAppNow() {
    if (!currentUser) return;
    const hasPasscode = localStorage.getItem('knx_passcode_' + currentUser.kId);
    if (!hasPasscode) {
        return showToast('Код-пароль не установлен', 'info');
    }
    window.currentPasscodeBuffer = '';
    updatePasscodeDotsUI();
    const lockScreen = document.getElementById('passcode-lock-screen');
    if (lockScreen) {
        lockScreen.classList.remove('hidden');
    }
}

function updatePasscodeDotsUI(shake = false) {
    const dotsContainer = document.getElementById('passcode-dots');
    if (!dotsContainer) return;
    const dots = dotsContainer.querySelectorAll('.pdot');
    dots.forEach((dot, index) => {
        dot.classList.toggle('filled', index < window.currentPasscodeBuffer.length);
    });
    if (shake) {
        dotsContainer.classList.add('shake');
        setTimeout(() => dotsContainer.classList.remove('shake'), 450);
    }
}

function pressPasscodeDigit(digit) {
    if (window.currentPasscodeBuffer.length >= 4) return;
    window.currentPasscodeBuffer += digit;
    updatePasscodeDotsUI();

    if (window.currentPasscodeBuffer.length === 4) {
        setTimeout(verifyPasscodeAttempt, 120);
    }
}

function deletePasscodeDigit() {
    if (window.currentPasscodeBuffer.length > 0) {
        window.currentPasscodeBuffer = window.currentPasscodeBuffer.slice(0, -1);
        updatePasscodeDotsUI();
    }
}

function verifyPasscodeAttempt() {
    const savedPin = localStorage.getItem('knx_passcode_' + currentUser.kId);
    if (window.currentPasscodeBuffer === savedPin) {
        playSound('receive');
        const lockScreen = document.getElementById('passcode-lock-screen');
        if (lockScreen) lockScreen.classList.add('hidden');
        window.currentPasscodeBuffer = '';
        updatePasscodeDotsUI();
    } else {
        playSound('send');
        updatePasscodeDotsUI(true);
        window.currentPasscodeBuffer = '';
        setTimeout(() => updatePasscodeDotsUI(), 400);
        showToast('Неверный код-пароль', 'error');
    }
}

function emergencyPasscodeLogout() {
    const lockScreen = document.getElementById('passcode-lock-screen');
    if (lockScreen) lockScreen.classList.add('hidden');
    logout();
}

function handlePasscodeToggle(switchEl) {
    const isEnabling = switchEl.checked;
    if (!isEnabling) {
        disablePasscode();
        return;
    }
    const modal = document.getElementById('setup-passcode-modal');
    const title = document.getElementById('setup-passcode-title');
    const btnDisable = document.getElementById('btn-disable-passcode');
    const p1 = document.getElementById('input-new-passcode');
    const p2 = document.getElementById('input-confirm-passcode');

    if (p1) p1.value = '';
    if (p2) p2.value = '';

    if (title) title.innerText = 'Установка код-пароля';
    if (btnDisable) btnDisable.classList.add('hidden');
    openModal('setup-passcode-modal');
}

function saveNewPasscode() {
    const p1 = document.getElementById('input-new-passcode')?.value.trim();
    const p2 = document.getElementById('input-confirm-passcode')?.value.trim();

    if (!p1 || p1.length !== 4 || !/^\d{4}$/.test(p1)) {
        return showToast('Код-пароль должен состоять ровно из 4 цифр', 'error');
    }
    if (p1 !== p2) {
        return showToast('Введенные коды не совпадают', 'error');
    }

    localStorage.setItem('knx_passcode_' + currentUser.kId, p1);
    closeModal('setup-passcode-modal');
    showToast('Код-пароль успешно сохранен', 'success');
    syncSecuritySettingsUI();
}

function disablePasscode() {
    localStorage.removeItem('knx_passcode_' + currentUser.kId);
    closeModal('setup-passcode-modal');
    showToast('Код-пароль отключен', 'info');
    syncSecuritySettingsUI();
}
window.saveNewPasscode = saveNewPasscode;
window.disablePasscode = disablePasscode;
window.handlePasscodeToggle = handlePasscodeToggle;
window.lockAppNow = lockAppNow;
window.pressPasscodeDigit = pressPasscodeDigit;
window.deletePasscodeDigit = deletePasscodeDigit;
window.emergencyPasscodeLogout = emergencyPasscodeLogout;

window.addEventListener('keydown', (e) => {
    const lockScreen = document.getElementById('passcode-lock-screen');
    if (lockScreen && !lockScreen.classList.contains('hidden')) {
        if (e.key >= '0' && e.key <= '9') {
            pressPasscodeDigit(e.key);
        } else if (e.key === 'Backspace') {
            deletePasscodeDigit();
        }
    }
});

window.isSelectMode = false;
window.selectedMsgIds = new Set();

function prepareSelectMode() {
    document.getElementById('msg-context-menu')?.classList.add('hidden');
    if (contextTargetMsg) {
        enterSelectMode(contextTargetMsg.id);
    } else {
        enterSelectMode();
    }
}

function enterSelectMode(initialMsgId = null) {
    window.isSelectMode = true;
    window.selectedMsgIds = new Set();
    if (initialMsgId) {
        window.selectedMsgIds.add(String(initialMsgId));
    }
    document.getElementById('messages-container')?.classList.add('select-mode');
    document.getElementById('input-area')?.classList.add('hidden');
    document.getElementById('messages-selection-bar')?.classList.remove('hidden');
    updateSelectionUI();
}

function toggleSelectMessage(msgId) {
    const sId = String(msgId);
    if (window.selectedMsgIds.has(sId)) {
        window.selectedMsgIds.delete(sId);
    } else {
        window.selectedMsgIds.add(sId);
    }

    if (window.selectedMsgIds.size === 0) {
        exitSelectMode();
    } else {
        updateSelectionUI();
    }
}

function exitSelectMode() {
    window.isSelectMode = false;
    window.selectedMsgIds.clear();
    document.getElementById('messages-container')?.classList.remove('select-mode');
    document.querySelectorAll('.msg.selected').forEach(el => el.classList.remove('selected'));
    document.getElementById('messages-selection-bar')?.classList.add('hidden');
    document.getElementById('input-area')?.classList.remove('hidden');
}

function updateSelectionUI() {
    const countEl = document.getElementById('selected-messages-count');
    if (countEl) {
        countEl.innerText = `Выбрано: ${window.selectedMsgIds.size}`;
    }
    document.querySelectorAll('.msg').forEach(el => {
        const id = el.getAttribute('data-id');
        el.classList.toggle('selected', window.selectedMsgIds.has(String(id)));
    });
}

function copyTextToClipboard(text) {
    if (text === undefined || text === null) return Promise.resolve(false);
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text)
            .then(() => true)
            .catch(() => fallbackCopyText(text));
    }
    return Promise.resolve(fallbackCopyText(text));
}

function fallbackCopyText(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, 99999);
        const res = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!res;
    } catch (e) {
        console.error('Fallback copy error:', e);
        return false;
    }
}

function copySelectedMessages() {
    if (!activeChat || window.selectedMsgIds.size === 0) return;
    
    const allChatMsgs = chats[activeChat.kId] || [];
    const selectedList = [];
    
    allChatMsgs.forEach(m => {
        if (window.selectedMsgIds.has(String(m.id))) {
            selectedList.push(m);
        }
    });

    if (selectedList.length === 0) {
        window.selectedMsgIds.forEach(id => {
            const el = document.querySelector(`.msg[data-id="${id}"]`);
            if (el) {
                const textEl = el.querySelector('.msg-text-content') || el.querySelector('.msg-caption');
                const rawText = textEl ? textEl.innerText.trim() : el.innerText.trim();
                selectedList.push({
                    id,
                    text: rawText,
                    type: 'text',
                    isMine: el.classList.contains('my-msg'),
                    senderId: currentUser.kId
                });
            }
        });
    }

    if (selectedList.length === 0) {
        showToast('Нет текста для копирования', 'error');
        return;
    }

    let textToCopy = '';
    if (selectedList.length === 1) {
        const m = selectedList[0];
        textToCopy = m.text || m.fileName || (m.type === 'image' ? '[Фото]' : '');
    } else {
        textToCopy = selectedList.map(m => {
            const sender = m.isMine ? 'Я' : (knownUsers[m.senderId]?.name || 'Собеседник');
            const content = m.text || m.fileName || (m.type === 'image' ? '[Фото]' : '');
            return `${sender}: ${content}`;
        }).join('\n\n');
    }

    copyTextToClipboard(textToCopy).then((ok) => {
        if (ok) {
            showToast(`Скопировано (${selectedList.length})`, 'success');
            exitSelectMode();
        } else {
            showToast('Ошибка при копировании', 'error');
        }
    });
}

function copyTargetMessage() {
    document.getElementById('msg-context-menu')?.classList.add('hidden');
    if (!contextTargetMsg) return;
    const text = contextTargetMsg.type === 'text' ? contextTargetMsg.text : (contextTargetMsg.fileName || contextTargetMsg.text);
    copyTextToClipboard(text).then((ok) => {
        if (ok) {
            showToast('Сообщение скопировано', 'success');
            if (typeof triggerHaptic === 'function') triggerHaptic('success');
        } else {
            showToast('Ошибка копирования', 'error');
            if (typeof triggerHaptic === 'function') triggerHaptic('error');
        }
    });
}

function forwardSelectedMessages() {
    if (!activeChat || window.selectedMsgIds.size === 0) return;
    const msgs = (chats[activeChat.kId] || []).filter(m => window.selectedMsgIds.has(String(m.id)));
    if (msgs.length === 0) return;

    const fwdText = msgs.map(m => m.text).filter(Boolean).join('\n');
    const input = document.getElementById('message-input');
    if (input && fwdText) {
        input.value = (input.value ? input.value + '\n' : '') + fwdText;
        input.focus();
    }
    exitSelectMode();
    showToast('Текст сообщений скопирован в поле ввода', 'info');
}

function deleteSelectedMessages() {
    if (!activeChat || window.selectedMsgIds.size === 0) return;
    const ids = Array.from(window.selectedMsgIds);
    if (!confirm(`Удалить выбранные сообщения (${ids.length})?`)) return;

    socket.emit('deleteMultipleMessages', {
        ids,
        from: currentUser.kId,
        to: activeChat.kId
    });

    const idSet = new Set(ids.map(String));
    chats[activeChat.kId] = chats[activeChat.kId].filter(m => !idSet.has(String(m.id)));
    saveChatsToCache();

    ids.forEach(id => {
        const el = document.querySelector(`.msg[data-id="${id}"]`);
        if (el) dissolveMessageElement(el);
    });

    exitSelectMode();
    showToast(`Удалено сообщений: ${ids.length}`, 'success');
}

function scrollChatToBottom(smooth = true) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    if (smooth) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
        container.scrollTop = container.scrollHeight;
    }
    const btn = document.getElementById('scroll-down-btn');
    if (btn) btn.classList.add('hidden');
    const badge = document.getElementById('scroll-down-badge');
    if (badge) {
        badge.innerText = '0';
        badge.classList.add('hidden');
    }
}


const DEFAULT_CHAT_SETTINGS = {
    bubbleRadius: 17,
    fontSize: 16,
    palette: 'blue',
    msgOutColor: '#007aff',
    swipeAction: 'archive',
    language: 'ru',
    autoNightMode: false,
    raiseToListen: true,
    sendByEnter: true,
    quickReaction: '❤️',
    chatSounds: true,
    notifSound: true,
    vibration: true,
    vibrationIntensity: 'normal',
    hapticFeedback: true,
    autoDownloadMedia: true,
    compressPhotos: true,
    readReceipts: true,
    typingIndicator: true,
    hideKidInChat: false,
    previewNotificationText: true,
    screenshotAlerts: true
};

let _lastAppliedRadius = null;
let _lastAppliedFontSize = null;
let _lastAppliedMsgColor = null;

window.chatSettings = { ...DEFAULT_CHAT_SETTINGS };

window.loadChatSettings = function() {
    try {
        const saved = localStorage.getItem('knx_chat_settings');
        if (saved) {
            window.chatSettings = { ...DEFAULT_CHAT_SETTINGS, ...JSON.parse(saved) };
        }
    } catch(e) {
        window.chatSettings = { ...DEFAULT_CHAT_SETTINGS };
    }
    window.applyChatSettings();
};

window.saveChatSettings = function() {
    try {
        localStorage.setItem('knx_chat_settings', JSON.stringify(window.chatSettings));
    } catch(e) {}
};

window.updateBubbleCornerRadius = function(val) {
    const r = parseInt(val, 10);
    window.chatSettings.bubbleRadius = r;
    if (_lastAppliedRadius !== r) {
        _lastAppliedRadius = r;
        document.documentElement.style.setProperty('--bubble-radius', `${r}px`);
    }
    const valEl = document.getElementById('slider-corner-val');
    if (valEl) valEl.textContent = `${r} px`;
    
    const inBubble = document.querySelector('.chat-preview-bubble-in');
    const outBubble = document.querySelector('.chat-preview-bubble-out');
    if (inBubble) {
        inBubble.style.borderRadius = `${r}px`;
        inBubble.style.borderBottomLeftRadius = '4px';
    }
    if (outBubble) {
        outBubble.style.borderRadius = `${r}px`;
        outBubble.style.borderBottomRightRadius = '4px';
    }
    window.saveChatSettings();
};

window.updateChatFontSize = function(val) {
    const fs = parseInt(val, 10);
    window.chatSettings.fontSize = fs;
    if (_lastAppliedFontSize !== fs) {
        _lastAppliedFontSize = fs;
        document.documentElement.style.setProperty('--bubble-font-size', `${fs}px`);
    }
    const valEl = document.getElementById('slider-font-val');
    if (valEl) valEl.textContent = `${fs} пт`;
    
    const inBubble = document.querySelector('.chat-preview-bubble-in');
    const outBubble = document.querySelector('.chat-preview-bubble-out');
    if (inBubble) inBubble.style.fontSize = `${fs}px`;
    if (outBubble) outBubble.style.fontSize = `${fs}px`;
    
    window.saveChatSettings();
};

const CHAT_PALETTE_COLORS = {
    'blue': '#007aff',
    'green': '#34c759',
    'navy': '#2b5278',
    'purple': '#af52de',
    'orange': '#ff9500'
};

window.selectChatPalette = function(preset) {
    const color = CHAT_PALETTE_COLORS[preset] || '#007aff';
    window.chatSettings.palette = preset;
    window.chatSettings.msgOutColor = color;
    
    if (_lastAppliedMsgColor !== color) {
        _lastAppliedMsgColor = color;
        document.documentElement.style.setProperty('--msg-out-bg', color);
    }
    
    const outBubble = document.querySelector('.chat-preview-bubble-out');
    if (outBubble) outBubble.style.background = color;
    
    document.querySelectorAll('.chat-theme-palette-card').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-preset') === preset);
    });

    window.saveChatSettings();
};

window.toggleAppTheme = function(e) {
    window.triggerThemeCircleTransition(e);
};

window.triggerThemeCircleTransition = function(event) {
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    let x = window.innerWidth - 45;
    let y = 60;
    if (event && event.clientX !== undefined) {
        x = event.clientX;
        y = event.clientY;
    } else {
        const moonSlot = document.getElementById('appearance-moon-slot');
        if (moonSlot) {
            const rect = moonSlot.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
    }

    const maxDist = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    ) + 40;

    const ripple = document.createElement('div');
    ripple.className = 'theme-circle-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.width = `${maxDist * 2}px`;
    ripple.style.height = `${maxDist * 2}px`;
    ripple.style.backgroundColor = newTheme === 'dark' ? '#0e1621' : '#f5f7fb';

    document.body.appendChild(ripple);
    if (typeof triggerHaptic === 'function') triggerHaptic('light');

    requestAnimationFrame(() => {
        ripple.classList.add('expanding');
    });

    setTimeout(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('knx_theme', newTheme);
        if (currentUser) currentUser.theme = newTheme;
        window.updateThemeToggleUI(newTheme);
        const setTh = document.getElementById('set-theme');
        if (setTh) setTh.value = newTheme;
        if (typeof saveCustomization === 'function') saveCustomization(true);
        showToast(newTheme === 'dark' ? 'Тёмная тема' : 'Светлая тема', 'info');
    }, 280);

    setTimeout(() => {
        ripple.remove();
    }, 650);
};

window.updateThemeToggleUI = function(theme) {
    const label = document.getElementById('theme-toggle-label');
    const iconBox = document.getElementById('theme-toggle-icon-box');
    const moonSlot = document.getElementById('appearance-moon-slot');
    const isDark = theme === 'dark';

    if (label) {
        label.innerText = isDark ? 'Дневной режим' : 'Ночной режим';
    }
    const sunSvg = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const moonSvg = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

    if (iconBox) {
        iconBox.innerHTML = isDark ? sunSvg : moonSvg;
        iconBox.style.background = isDark ? '#ff9500' : '#5856d6';
    }
    if (moonSlot) {
        moonSlot.innerHTML = isDark ? sunSvg : moonSvg;
        moonSlot.style.color = isDark ? '#ff9500' : '#5856d6';
    }
};

window.selectSwipeAction = function(action, updateSidebar = true) {
    window.chatSettings.swipeAction = action;
    
    document.querySelectorAll('.swipe-action-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-action') === action);
    });

    const meta = SWIPE_ACTION_META[action] || SWIPE_ACTION_META['archive'];
    const textEl = document.getElementById('swipe-preview-action-text');
    const iconEl = document.getElementById('swipe-preview-action-icon');
    const blockEl = document.getElementById('swipe-preview-action-block');
    
    if (textEl) textEl.innerText = meta.text;
    if (iconEl && meta.icon) {
        iconEl.outerHTML = meta.icon.replace('<svg ', '<svg id="swipe-preview-action-icon" ');
    }
    if (blockEl && meta.bg) {
        blockEl.style.backgroundColor = meta.bg;
    }

    if (updateSidebar) {
        document.querySelectorAll('.chat-item-swipe-bg').forEach(bg => {
            bg.style.backgroundColor = meta.bg;
            const iconSpan = bg.querySelector('.swipe-bg-icon');
            if (iconSpan) iconSpan.innerHTML = meta.icon;
            const textSpan = bg.querySelector('.swipe-bg-text');
            if (textSpan) textSpan.innerText = meta.text;
        });
    }

    window.saveChatSettings();
};

window.selectAppLanguage = function(lang) {
    window.chatSettings.language = lang;
    localStorage.setItem('knx_lang', lang);
    document.querySelectorAll('.lang-row').forEach(row => {
        row.classList.toggle('active', row.id === `lang-row-${lang}`);
    });
    const currentLangLabel = document.getElementById('settings-current-lang-label');
    const langNames = { 'ru': 'Русский', 'uk': 'Українська', 'en': 'English', 'be': 'Беларуская' };
    if (currentLangLabel && langNames[lang]) currentLangLabel.innerText = langNames[lang];
    const langSelect = document.getElementById('set-lang');
    if (langSelect) langSelect.value = lang;
    window.saveChatSettings();
    if (typeof applyLanguage === 'function') {
        applyLanguage(lang);
    }
    if (currentUser) {
        currentUser.lang = lang;
        if (typeof saveCustomization === 'function') saveCustomization(true);
    }
    showToast(lang === 'ru' ? 'Язык изменен на Русский' : (lang === 'uk' ? 'Мову змінено на Українську' : (lang === 'be' ? 'Мову зменена на Беларускую' : 'Language set to English')), 'success');
};

window.applyAutoNightModeCheck = function() {
    if (!window.chatSettings || !window.chatSettings.autoNightMode) return;
    const hour = new Date().getHours();
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = (hour >= 21 || hour < 7) || systemPrefersDark;
    const targetTheme = shouldBeDark ? 'dark' : 'light';
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    if (targetTheme !== currentTheme) {
        document.documentElement.setAttribute('data-theme', targetTheme);
        document.body.setAttribute('data-theme', targetTheme);
        localStorage.setItem('knx_theme', targetTheme);
        if (currentUser) currentUser.theme = targetTheme;
        window.updateThemeToggleUI(targetTheme);
        const setTh = document.getElementById('set-theme');
        if (setTh) setTh.value = targetTheme;
    }
};

window.toggleAutoNightMode = function() {
    const isAuto = !window.chatSettings.autoNightMode;
    window.chatSettings.autoNightMode = isAuto;
    const label = document.getElementById('auto-night-status-label');
    if (label) label.innerText = isAuto ? 'Включена' : 'Выключена';
    window.saveChatSettings();
    if (isAuto) {
        window.applyAutoNightModeCheck();
        showToast('Автоночной режим включён', 'info');
    } else {
        showToast('Автоночной режим выключен', 'info');
    }
};

window.toggleRaiseToListen = function(checked) {
    window.chatSettings.raiseToListen = checked;
    window.saveChatSettings();
};

window.toggleScreenshotAlerts = function(checked) {
    window.chatSettings.screenshotAlerts = checked;
    window.saveChatSettings();
    const t = document.getElementById('toggle-screenshot-alerts');
    if (t) t.checked = checked;
    if (typeof savePrivacy === 'function') savePrivacy(true);
};

window.updateSendByEnter = function(checked) {
    window.chatSettings.sendByEnter = checked;
    window.saveChatSettings();
};

window.updateChatSounds = function(checked) {
    window.chatSettings.chatSounds = checked;
    window.saveChatSettings();
    if (checked && typeof playSound === 'function') playSound('send');
};

window.updateAutoMedia = function(checked) {
    window.chatSettings.autoDownloadMedia = checked;
    window.saveChatSettings();
    const t = document.getElementById('toggle-auto-download-media');
    if (t) t.checked = checked;
};

window.updateCompressPhotos = function(checked) {
    window.chatSettings.compressPhotos = checked;
    window.saveChatSettings();
    const t = document.getElementById('toggle-compress-photos');
    if (t) t.checked = checked;
};

window.updateReadReceipts = function(checked) {
    if (checked === false) {
        const isVip = currentUser && (currentUser.isVip || currentUser.role === 'vip' || currentUser.role === 'admin' || currentUser.role === 'dev' || currentUser.email === 'knx_dev@knx.im');
        if (!isVip) {
            const toggle = document.getElementById('toggle-read-receipts');
            if (toggle) toggle.checked = true;
            window.chatSettings.readReceipts = true;
            window.saveChatSettings();
            showToast('Доступно только пользователям KNX VIP и разработчикам', 'error');
            if (typeof triggerHaptic === 'function') triggerHaptic('medium');
            return;
        }
    }
    window.chatSettings.readReceipts = checked;
    window.saveChatSettings();
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
};

window.updateTypingIndicator = function(checked) {
    window.chatSettings.typingIndicator = checked;
    window.saveChatSettings();
};

window.updateHideKidInChat = function(checked) {
    window.chatSettings.hideKidInChat = checked;
    window.saveChatSettings();
    if (typeof activeChat !== 'undefined' && activeChat) {
        const acs = document.getElementById('active-chat-sub');
        if (acs) {
            if (checked && !activeChat.isGroup) {
                acs.innerText = '';
                acs.classList.add('hidden');
            } else {
                acs.classList.remove('hidden');
                acs.innerText = activeChat.isGroup ? (activeChat.groupType === 'channel' ? 'Канал' : 'Группа') : (activeChat.isBot ? 'Бот' : (activeChat.hideKid ? '' : activeChat.kId));
            }
        }
    }
};

window.updatePreviewNotificationText = function(checked) {
    window.chatSettings.previewNotificationText = checked;
    window.saveChatSettings();
};

window.triggerHaptic = function(type = 'light') {
    if (!('vibrate' in navigator)) return;
    if (window.chatSettings && window.chatSettings.vibration === false) return;
    try {
        switch (type) {
            case 'light':
                navigator.vibrate(12);
                break;
            case 'medium':
                navigator.vibrate(28);
                break;
            case 'heavy':
                navigator.vibrate(50);
                break;
            case 'success':
                navigator.vibrate([15, 50, 25]);
                break;
            case 'error':
                navigator.vibrate([40, 60, 40]);
                break;
            default:
                navigator.vibrate(15);
        }
    } catch(e) {}
};

window.triggerNotificationVibration = function() {
    window.triggerHaptic('medium');
};

window.toggleVibration = function(checked) {
    window.chatSettings.vibration = checked;
    window.saveChatSettings();
    if (checked) {
        window.triggerHaptic('success');
    }
};

window.dispatchSystemNotification = function(title, options = {}) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (window.chatSettings && window.chatSettings.notifSound === false && window.chatSettings.previewNotificationText === false) return;

    const notifOptions = {
        icon: options.icon || '/favicon.svg',
        badge: '/favicon.svg',
        renotify: true,
        tag: options.tag || ('knx-' + Date.now()),
        body: options.body || 'Новое сообщение',
        data: options.data || {},
        vibrate: (window.chatSettings && window.chatSettings.vibration !== false) ? [120, 60, 120] : undefined
    };

    try {
        if (window.swRegistration && 'showNotification' in window.swRegistration) {
            window.swRegistration.showNotification(title, notifOptions);
        } else {
            const n = new Notification(title, notifOptions);
            n.onclick = function() {
                window.focus();
                if (options.data && options.data.chatKId && knownUsers[options.data.chatKId]) {
                    openChat(knownUsers[options.data.chatKId]);
                }
                n.close();
            };
        }
    } catch(err) {
        console.warn('dispatchSystemNotification failed:', err);
    }
};

window.requestNotificationPermission = async function() {
    window.triggerHaptic('medium');
    if (!('Notification' in window)) {
        showToast('Браузер не поддерживает системные уведомления', 'warning');
        return;
    }
    try {
        const perm = await Notification.requestPermission();
        window.updateNotificationUIState();
        if (perm === 'granted') {
            showToast('Уведомления успешно включены!', 'success');
            window.triggerHaptic('success');
            window.dispatchSystemNotification('KNX Мессенджер', {
                body: 'Уведомления на телефон успешно подключены! Теперь вы не пропустите сообщения.',
                tag: 'welcome-notification'
            });
        } else if (perm === 'denied') {
            showToast('Уведомления отклонены. Разрешите их в настройках сайта.', 'error');
            window.triggerHaptic('error');
        }
    } catch (e) {
        console.error('requestNotificationPermission error:', e);
    }
};

window.sendTestNotification = function() {
    window.triggerHaptic('medium');
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        window.requestNotificationPermission();
        return;
    }
    window.dispatchSystemNotification('KNX Мессенджер (Тест)', {
        body: 'Звук, вибрация и доставка уведомлений работают отлично!',
        tag: 'test-' + Date.now()
    });
    if (window.chatSettings && window.chatSettings.notifSound !== false) {
        playSound('receive');
    }
    showToast('Тестовое уведомление отправлено!', 'info');
};

window.updateNotificationUIState = function() {
    const statusLabel = document.getElementById('notif-permission-status');
    const actionBtn = document.getElementById('btn-request-notif-perm');
    const testRow = document.getElementById('notif-test-row');
    const hintLabel = document.getElementById('notif-permission-hint');
    if (!statusLabel || !actionBtn) return;

    if (!('Notification' in window)) {
        statusLabel.innerText = 'Не поддерживается';
        statusLabel.style.color = 'var(--text-muted)';
        actionBtn.style.display = 'none';
        if (testRow) testRow.style.display = 'none';
        return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
        statusLabel.innerText = 'Разрешены (активно)';
        statusLabel.style.color = '#34C759';
        actionBtn.innerText = 'Включено';
        actionBtn.disabled = true;
        actionBtn.style.opacity = '0.7';
        actionBtn.style.cursor = 'default';
        if (testRow) testRow.style.display = 'flex';
        if (hintLabel) hintLabel.innerText = 'Уведомления активны. Вы будете получать сообщения на телефон в фоне.';
    } else if (perm === 'denied') {
        statusLabel.innerText = 'Заблокировано браузером';
        statusLabel.style.color = '#FF3B30';
        actionBtn.innerText = 'Заблокировано';
        actionBtn.disabled = true;
        actionBtn.style.opacity = '0.7';
        actionBtn.style.cursor = 'default';
        if (testRow) testRow.style.display = 'none';
        if (hintLabel) hintLabel.innerText = 'Уведомления заблокированы. Чтобы включить их, нажмите на иконку настроек сайта в строке браузера и разрешите уведомления.';
    } else {
        statusLabel.innerText = 'Требуется разрешение';
        statusLabel.style.color = 'var(--text-muted)';
        actionBtn.innerText = 'Включить';
        actionBtn.disabled = false;
        actionBtn.style.opacity = '1';
        actionBtn.style.cursor = 'pointer';
        if (testRow) testRow.style.display = 'none';
        if (hintLabel) hintLabel.innerText = 'Включите системные уведомления, чтобы мгновенно получать сообщения на телефон при свернутом окне.';
    }
};

window.saveNotificationSettings = function() {
    const notifSound = document.getElementById('toggle-notif-sound');
    if (notifSound) window.chatSettings.notifSound = notifSound.checked;
    const notifVibrate = document.getElementById('toggle-vibration');
    if (notifVibrate) window.chatSettings.vibration = notifVibrate.checked;
    const notifPreview = document.getElementById('toggle-notif-preview');
    if (notifPreview) window.chatSettings.previewNotificationText = notifPreview.checked;
    window.saveChatSettings();
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
};

window.syncNotificationSettingsUI = function() {
    const s = window.chatSettings || DEFAULT_CHAT_SETTINGS;
    const notifSound = document.getElementById('toggle-notif-sound');
    if (notifSound) notifSound.checked = s.notifSound !== false;
    const notifPreview = document.getElementById('toggle-notif-preview');
    if (notifPreview) notifPreview.checked = s.previewNotificationText !== false;
    const vibToggle = document.getElementById('toggle-vibration');
    if (vibToggle) vibToggle.checked = s.vibration !== false;
    if (typeof window.updateNotificationUIState === 'function') {
        window.updateNotificationUIState();
    }
};

window.openStorageModal = async function() {
    openModal('storage-modal');
    await window.calculateRealStorage();
};

window.syncStorageTabUI = function() {
    const s = window.chatSettings || (typeof DEFAULT_CHAT_SETTINGS !== 'undefined' ? DEFAULT_CHAT_SETTINGS : {});
    const autoMedia = document.getElementById('toggle-auto-download-media');
    if (autoMedia) autoMedia.checked = s.autoDownloadMedia !== false;
    const compPhotos = document.getElementById('toggle-compress-photos');
    if (compPhotos) compPhotos.checked = s.compressPhotos !== false;
};

window.calculateRealStorage = async function() {
    let lsBytes = 0;
    try {
        for (let k in localStorage) {
            if (localStorage.hasOwnProperty(k)) {
                lsBytes += (localStorage[k].length + k.length) * 2;
            }
        }
    } catch(e) {}

    let chatMsgCount = 0;
    let imgCount = 0;
    let voiceCount = 0;
    if (typeof chats !== 'undefined') {
        for (let k in chats) {
            if (Array.isArray(chats[k])) {
                chatMsgCount += chats[k].length;
                chats[k].forEach(m => {
                    if (m.type === 'image') imgCount++;
                    if (m.type === 'voice' || m.type === 'audio') voiceCount++;
                });
            }
        }
    }

    const mediaMB = Math.max(1.2, +(imgCount * 0.85 + (lsBytes / (1024 * 1024) * 0.3)).toFixed(1));
    const voiceMB = Math.max(0.4, +(voiceCount * 0.45).toFixed(1));
    const docsMB = 0.8;
    const dbMB = Math.max(0.6, +(chatMsgCount * 0.05 + (lsBytes / (1024 * 1024))).toFixed(1));
    const totalMB = +(mediaMB + voiceMB + docsMB + dbMB).toFixed(1);

    const sumLabel = document.getElementById('storage-summary-label');
    if (sumLabel) sumLabel.innerText = `Занято: ${totalMB} МБ`;
    const tabSumLabel = document.getElementById('storage-tab-summary-label');
    if (tabSumLabel) tabSumLabel.innerText = `Занято: ${totalMB} МБ`;

    const valMedia = document.getElementById('storage-val-media');
    if (valMedia) valMedia.innerText = `${mediaMB} МБ`;
    const tabValMedia = document.getElementById('storage-tab-val-media');
    if (tabValMedia) tabValMedia.innerText = `${mediaMB} МБ`;

    const valVoice = document.getElementById('storage-val-voice');
    if (valVoice) valVoice.innerText = `${voiceMB} МБ`;
    const tabValVoice = document.getElementById('storage-tab-val-voice');
    if (tabValVoice) tabValVoice.innerText = `${voiceMB} МБ`;

    const valDocs = document.getElementById('storage-val-docs');
    if (valDocs) valDocs.innerText = `${docsMB} МБ`;
    const tabValDocs = document.getElementById('storage-tab-val-docs');
    if (tabValDocs) tabValDocs.innerText = `${docsMB} МБ`;

    const valDb = document.getElementById('storage-val-db');
    if (valDb) valDb.innerText = `${dbMB} МБ`;
    const tabValDb = document.getElementById('storage-tab-val-db');
    if (tabValDb) tabValDb.innerText = `${dbMB} МБ`;

    const segMedia = document.getElementById('storage-bar-media');
    const segVoice = document.getElementById('storage-bar-voice');
    const segDocs = document.getElementById('storage-bar-docs');
    const segDb = document.getElementById('storage-bar-db');

    const tabSegMedia = document.getElementById('storage-tab-bar-media');
    const tabSegVoice = document.getElementById('storage-tab-bar-voice');
    const tabSegDocs = document.getElementById('storage-tab-bar-docs');
    const tabSegDb = document.getElementById('storage-tab-bar-db');

    const wMedia = `${Math.round((mediaMB / totalMB) * 100)}%`;
    const wVoice = `${Math.round((voiceMB / totalMB) * 100)}%`;
    const wDocs = `${Math.round((docsMB / totalMB) * 100)}%`;
    const wDb = `${Math.round((dbMB / totalMB) * 100)}%`;

    if (segMedia) segMedia.style.width = wMedia;
    if (tabSegMedia) tabSegMedia.style.width = wMedia;

    if (segVoice) segVoice.style.width = wVoice;
    if (tabSegVoice) tabSegVoice.style.width = wVoice;

    if (segDocs) segDocs.style.width = wDocs;
    if (tabSegDocs) tabSegDocs.style.width = wDocs;

    if (segDb) segDb.style.width = wDb;
    if (tabSegDb) tabSegDb.style.width = wDb;
};

window.clearAppCache = async function() {
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            for (let k of keys) await caches.delete(k);
        }
    } catch(e) {}

    try {
        const preserveKeys = new Set([
            'knx_session_token', 'knx_current_session_id', 'knx_chat_settings',
            'knx_theme', 'knx_lang', 'kId', 'password', 'pinnedChats', 'mutedChats'
        ]);
        if (currentUser && currentUser.kId) {
            preserveKeys.add('knx_passcode_' + currentUser.kId);
            preserveKeys.add('knx_2fa_enabled_' + currentUser.kId);
            preserveKeys.add('knx_session_ttl_' + currentUser.kId);
        }
        const keysToRemove = [];
        for (let k in localStorage) {
            if (localStorage.hasOwnProperty(k) && !preserveKeys.has(k) && !k.startsWith('knx_passcode_')) {
                if (k.startsWith('knx_chats_cache_') || k.startsWith('knx_cached_') || k.startsWith('knx_draft_')) {
                    keysToRemove.push(k);
                }
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch(e) {}

    if (typeof chats !== 'undefined') {
        for (let k in chats) {
            if (Array.isArray(chats[k])) {
                chats[k] = chats[k].slice(-5);
            }
        }
    }

    try {
        const activeId = (typeof activeChat !== 'undefined' && activeChat) ? 'chat-box-' + activeChat.kId : null;
        document.querySelectorAll('.chat-box-inner').forEach(box => {
            if (box.id !== activeId) {
                box.remove();
            }
        });
    } catch(e) {}

    if (typeof window.calculateRealStorage === 'function') {
        await window.calculateRealStorage();
    }

    if (typeof window.triggerHaptic === 'function') window.triggerHaptic('double');
    showToast('Кэш KNX успешно очищен', 'success');
};

window.applyChatSettings = function() {
    const s = window.chatSettings || DEFAULT_CHAT_SETTINGS;
    const r = parseInt(s.bubbleRadius, 10) || 17;
    if (_lastAppliedRadius !== r) {
        _lastAppliedRadius = r;
        document.documentElement.style.setProperty('--bubble-radius', `${r}px`);
    }
    
    const fs = parseInt(s.fontSize, 10) || 16;
    if (_lastAppliedFontSize !== fs) {
        _lastAppliedFontSize = fs;
        document.documentElement.style.setProperty('--bubble-font-size', `${fs}px`);
    }
    
    if (s.msgOutColor && _lastAppliedMsgColor !== s.msgOutColor) {
        _lastAppliedMsgColor = s.msgOutColor;
        document.documentElement.style.setProperty('--msg-out-bg', s.msgOutColor);
    }

    const radiusSlider = document.getElementById('chat-corner-radius-slider');
    const radiusVal = document.getElementById('slider-corner-val');
    if (radiusSlider) radiusSlider.value = r;
    if (radiusVal) radiusVal.textContent = `${r} px`;

    const fontSlider = document.getElementById('chat-font-size-slider');
    const fontVal = document.getElementById('slider-font-val');
    if (fontSlider) fontSlider.value = fs;
    if (fontVal) fontVal.textContent = `${fs} пт`;

    const inBubble = document.querySelector('.chat-preview-bubble-in');
    const outBubble = document.querySelector('.chat-preview-bubble-out');
    if (inBubble) {
        inBubble.style.fontSize = `${fs}px`;
        inBubble.style.borderRadius = `${r}px`;
        inBubble.style.borderBottomLeftRadius = '4px';
    }
    if (outBubble) {
        outBubble.style.fontSize = `${fs}px`;
        outBubble.style.borderRadius = `${r}px`;
        outBubble.style.borderBottomRightRadius = '4px';
        if (s.msgOutColor) outBubble.style.background = s.msgOutColor;
    }

    if (s.palette) {
        document.querySelectorAll('.chat-theme-palette-card').forEach(card => {
            card.classList.toggle('active', card.getAttribute('data-preset') === s.palette);
        });
    }

    if (s.swipeAction) {
        window.selectSwipeAction(s.swipeAction, false);
    }

    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    window.updateThemeToggleUI(currentTheme);

    const autoNightLabel = document.getElementById('auto-night-status-label');
    if (autoNightLabel) autoNightLabel.innerText = s.autoNightMode ? 'Включена' : 'Выключена';

    const enterToggle = document.getElementById('toggle-send-enter');
    if (enterToggle) enterToggle.checked = s.sendByEnter !== false;

    const soundsToggle = document.getElementById('toggle-chat-sounds');
    if (soundsToggle) soundsToggle.checked = s.chatSounds !== false;

    const raiseToggle = document.getElementById('toggle-raise-to-listen');
    if (raiseToggle) raiseToggle.checked = s.raiseToListen !== false;

    const ssToggle = document.getElementById('toggle-screenshot-alerts');
    if (ssToggle) ssToggle.checked = s.screenshotAlerts !== false;

    const isVipUser = currentUser && (currentUser.isVip || currentUser.role === 'vip' || currentUser.role === 'admin' || currentUser.role === 'dev' || currentUser.email === 'knx_dev@knx.im');
    const rrToggle = document.getElementById('toggle-read-receipts');
    if (rrToggle) {
        if (!isVipUser && s.readReceipts === false) {
            s.readReceipts = true;
        }
        rrToggle.checked = s.readReceipts !== false;
    }

    const typingToggle = document.getElementById('toggle-typing-status');
    if (typingToggle) typingToggle.checked = s.typingIndicator !== false;

    const hideKidChatToggle = document.getElementById('toggle-hide-kid-chat');
    if (hideKidChatToggle) hideKidChatToggle.checked = s.hideKidInChat === true;

    const previewNotifToggle = document.getElementById('toggle-preview-notif');
    if (previewNotifToggle) previewNotifToggle.checked = s.previewNotificationText !== false;

    const autoMediaToggle = document.getElementById('toggle-auto-download-media');
    if (autoMediaToggle) autoMediaToggle.checked = s.autoDownloadMedia !== false;

    const compressToggle = document.getElementById('toggle-compress-photos');
    if (compressToggle) compressToggle.checked = s.compressPhotos !== false;

    const currentLang = s.language || 'ru';
    document.querySelectorAll('.lang-row').forEach(row => {
        row.classList.toggle('active', row.id === `lang-row-${currentLang}`);
    });

    if (typeof currentUser !== 'undefined' && currentUser) {
        const hasPasscode = !!localStorage.getItem('knx_passcode_' + currentUser.kId);
        const pillPass = document.getElementById('privacy-passcode-status-pill');
        if (pillPass) pillPass.innerText = hasPasscode ? 'Вкл.' : 'Выкл.';
    }

    window.syncNotificationSettingsUI();
    window.syncStorageTabUI();
};

window.loadChatSettings();

if (window.visualViewport) {
    const handleViewportChange = () => {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        const mainScreen = document.getElementById('main-screen');
        const chatArea = document.getElementById('chat-area');
        if (window.innerWidth <= 768) {
            const h = window.visualViewport.height;
            if (mainScreen) mainScreen.style.height = `${h}px`;
            if (chatArea) chatArea.style.height = `${h}px`;

            const mc = document.getElementById('messages-container');
            if (mc && !mc.classList.contains('hidden')) {
                const isNearBottom = (mc.scrollHeight - mc.scrollTop <= mc.clientHeight + 280);
                if (isNearBottom) {
                    requestAnimationFrame(() => {
                        mc.scrollTop = mc.scrollHeight;
                    });
                }
            }
        }
    };
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', () => {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
    });
}



let qrMediaStream = null;
let qrScanAnimId = null;
let qrScanInterval = null;
let activeLoginQRToken = null;
let loginQRCountdownTimer = null;
let loginQRPollingTimer = null;

window.switchQRTab = function(tab) {
    const btnScan = document.getElementById('btn-qr-tab-scan');
    const btnShow = document.getElementById('btn-qr-tab-show');
    const viewScan = document.getElementById('qr-view-scan');
    const viewShow = document.getElementById('qr-view-show');

    if (tab === 'scan') {
        btnScan?.classList.add('active');
        btnShow?.classList.remove('active');
        viewScan?.classList.remove('hidden');
        viewShow?.classList.add('hidden');
        startQRCamera();
    } else {
        btnShow?.classList.add('active');
        btnScan?.classList.remove('active');
        viewShow?.classList.remove('hidden');
        viewScan?.classList.add('hidden');
        stopQRCamera();
        const qrImg = document.getElementById('my-device-qr');
        if (qrImg && typeof currentUser !== 'undefined' && currentUser) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=KNX_AUTH_${currentUser.kId}_${Date.now()}`;
        }
    }
};

window.startQRCamera = async function() {
    stopQRCamera();
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-scan-canvas') || document.createElement('canvas');
    const status = document.getElementById('qr-scan-status');
    if (!video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (status) status.innerText = '⚠️ Камера недоступна в этом браузере или по HTTP';
        return;
    }

    try {
        if (status) status.innerText = 'Подключение камеры...';
        qrMediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        video.srcObject = qrMediaStream;
        await video.play();
        if (status) status.innerText = 'Наведите камеру на QR-код для входа';

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let scanning = true;

        const scanFrame = () => {
            if (!scanning || !qrMediaStream) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                if (typeof jsQR === 'function') {
                    try {
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const code = jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: 'dontInvert'
                        });
                        if (code && code.data) {
                            scanning = false;
                            handleScannedQR(code.data);
                            return;
                        }
                    } catch(e) {}
                }
            }
            qrScanAnimId = requestAnimationFrame(scanFrame);
        };

        qrScanAnimId = requestAnimationFrame(scanFrame);

        if ('BarcodeDetector' in window) {
            try {
                const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
                qrScanInterval = setInterval(async () => {
                    if (!video.videoWidth || !scanning) return;
                    try {
                        const barcodes = await barcodeDetector.detect(video);
                        if (barcodes.length > 0 && barcodes[0].rawValue) {
                            scanning = false;
                            handleScannedQR(barcodes[0].rawValue);
                        }
                    } catch(e) {}
                }, 250);
            } catch(e) {}
        }
    } catch(err) {
        console.error('Camera access error:', err);
        if (status) status.innerText = '⚠️ Доступ к камере отклонен или заблокирован';
    }
};

window.stopQRCamera = function() {
    if (qrScanAnimId) {
        cancelAnimationFrame(qrScanAnimId);
        qrScanAnimId = null;
    }
    if (qrScanInterval) {
        clearInterval(qrScanInterval);
        qrScanInterval = null;
    }
    if (qrMediaStream) {
        qrMediaStream.getTracks().forEach(track => track.stop());
        qrMediaStream = null;
    }
    const video = document.getElementById('qr-video');
    if (video) video.srcObject = null;
};

window.closeQRModal = function() {
    stopQRCamera();
    closeModal('qr-link-modal');
};

async function handleScannedQR(rawData) {
    stopQRCamera();
    try { navigator.vibrate?.([100, 50, 100]); } catch(e) {}

    let token = String(rawData).trim();
    if (token.includes('token=')) {
        token = token.split('token=')[1].split('&')[0];
    }
    if (!token) {
        showToast('Не удалось распознать QR-код', 'error');
        return;
    }

    await confirmQRLogin(token);
}

window.submitManualQRToken = async function() {
    const input = document.getElementById('manual-qr-token-input');
    let token = input ? input.value.trim() : '';
    if (!token) return showToast('Введите токен QR', 'error');
    if (token.includes('token=')) {
        token = token.split('token=')[1].split('&')[0];
    }
    await confirmQRLogin(token);
};

async function confirmQRLogin(token) {
    if (!currentUser) {
        return showToast('Ошибка: необходимо войти в аккаунт', 'error');
    }

    const currentToken = sessionToken || localStorage.getItem('knx_session_token');
    showToast('Авторизация устройства...', 'info');

    try {
        const res = await fetch('/api/qr/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qrToken: token,
                kId: currentUser.kId,
                sessionToken: currentToken
            })
        });

        const result = await res.json();
        if (result.success) {
            closeQRModal();
            const input = document.getElementById('manual-qr-token-input');
            if (input) input.value = '';
            showToast('🎉 ' + (result.message || 'Устройство успешно авторизовано!'), 'success');
            if (typeof renderSessionsList === 'function') {
                renderSessionsList();
            }
        } else {
            showToast(result.message || 'Ошибка подтверждения входа', 'error');
        }
    } catch(err) {
        console.error('QR Confirm error:', err);
        showToast('Сетевая ошибка при подтверждении входа', 'error');
    }
}

window.switchAuthTab = function(tab) {
    const btnPass = document.getElementById('auth-tab-pass');
    const btnQr = document.getElementById('auth-tab-qr');
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('reg-form');
    const qrBox = document.getElementById('qr-login-box');

    if (tab === 'qr') {
        btnQr?.classList.add('active');
        btnPass?.classList.remove('active');
        qrBox?.classList.remove('hidden');
        loginForm?.classList.add('hidden');
        regForm?.classList.add('hidden');
        initLoginQR();
    } else {
        btnPass?.classList.add('active');
        btnQr?.classList.remove('active');
        qrBox?.classList.add('hidden');
        loginForm?.classList.remove('hidden');
        regForm?.classList.add('hidden');
        stopLoginQRTimers();
    }
};

function stopLoginQRTimers() {
    if (loginQRCountdownTimer) {
        clearInterval(loginQRCountdownTimer);
        loginQRCountdownTimer = null;
    }
    if (loginQRPollingTimer) {
        clearInterval(loginQRPollingTimer);
        loginQRPollingTimer = null;
    }
}

window.refreshLoginQR = function() {
    initLoginQR();
};

window.copyQRLoginToken = function() {
    if (!activeLoginQRToken) return showToast('QR-код еще не сгенерирован', 'error');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(activeLoginQRToken).then(() => {
            showToast('Токен скопирован: ' + activeLoginQRToken, 'success');
        }).catch(() => {
            prompt('Скопируйте токен QR вручную:', activeLoginQRToken);
        });
    } else {
        prompt('Скопируйте токен QR вручную:', activeLoginQRToken);
    }
};

window.initLoginQR = async function() {
    stopLoginQRTimers();
    activeLoginQRToken = null;

    const overlay = document.getElementById('login-qr-overlay');
    const timerEl = document.getElementById('qr-time-left');
    const container = document.getElementById('login-qr-container');

    if (overlay) overlay.classList.add('hidden');
    if (timerEl) timerEl.innerText = '02:00';
    if (container) {
        container.innerHTML = '<div style="font-size: 13px; color: var(--text-muted); padding: 20px;">Генерация QR-кода...</div>';
    }

    try {
        const res = await fetch('/api/qr/create', { method: 'POST' });
        const data = await res.json();
        if (!data.success || !data.qrToken) {
            if (container) container.innerHTML = '<div style="font-size: 13px; color: var(--danger); padding: 20px;">Ошибка генерации QR</div>';
            return;
        }

        activeLoginQRToken = data.qrToken;
        let remainingSeconds = data.ttl || 120;

        if (container) {
            container.innerHTML = '';
            if (typeof QRCode === 'function') {
                new QRCode(container, {
                    text: data.qrUrl || data.qrToken,
                    width: 176,
                    height: 176,
                    colorDark: '#0f172a',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } else {
                container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=176x176&data=${encodeURIComponent(data.qrUrl || data.qrToken)}" style="width:176px;height:176px;border-radius:8px;">`;
            }
        }

        const updateTimerDisplay = () => {
            const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
            const secs = String(remainingSeconds % 60).padStart(2, '0');
            if (timerEl) timerEl.innerText = `${mins}:${secs}`;
        };
        updateTimerDisplay();

        loginQRCountdownTimer = setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds <= 0) {
                stopLoginQRTimers();
                if (overlay) overlay.classList.remove('hidden');
                if (timerEl) timerEl.innerText = '00:00';
            } else {
                updateTimerDisplay();
            }
        }, 1000);

        if (!window.qrSocket && typeof io === 'function') {
            window.qrSocket = io();
        }
        if (window.qrSocket) {
            window.qrSocket.emit('qr_listen', { qrToken: data.qrToken });
            
            window.qrSocket.off('qr_login_success');
            window.qrSocket.on('qr_login_success', (result) => {
                handleSuccessfulQRLogin(result);
            });
        }

        loginQRPollingTimer = setInterval(async () => {
            if (!activeLoginQRToken) return;
            try {
                const checkRes = await fetch(`/api/qr/check/${activeLoginQRToken}`);
                const checkData = await checkRes.json();
                if (checkData.status === 'confirmed' && checkData.user) {
                    handleSuccessfulQRLogin(checkData);
                } else if (checkData.status === 'expired') {
                    stopLoginQRTimers();
                    if (overlay) overlay.classList.remove('hidden');
                }
            } catch(e) {}
        }, 1200);

    } catch(err) {
        console.error('Failed to init login QR:', err);
        if (container) container.innerHTML = '<div style="font-size: 13px; color: var(--danger); padding: 20px;">Сетевая ошибка</div>';
    }
};

function handleSuccessfulQRLogin(data) {
    if (!data || !data.user) return;
    stopLoginQRTimers();
    activeLoginQRToken = null;

    if (data.token) {
        sessionToken = data.token;
        localStorage.setItem('knx_session_token', data.token);
    }
    if (data.sessionId) {
        window.currentSessionId = data.sessionId;
        localStorage.setItem('knx_current_session_id', data.sessionId);
    }

    const btnPass = document.getElementById('auth-tab-pass');
    const btnQr = document.getElementById('auth-tab-qr');
    const qrBox = document.getElementById('qr-login-box');
    const loginForm = document.getElementById('login-form');
    btnPass?.classList.add('active');
    btnQr?.classList.remove('active');
    qrBox?.classList.add('hidden');
    loginForm?.classList.remove('hidden');

    processLoginSuccess(data.user, data.user.kId, '', false, data.token);
    showToast('🎉 Вход по QR-коду успешно выполнен!', 'success');
}

let inChatSearchResults = [];
let currentSearchMatchIndex = -1;

window.toggleInChatSearch = function() {
    const bar = document.getElementById('in-chat-search-bar');
    if (!bar) return;
    const isHidden = bar.classList.contains('hidden');
    if (isHidden) {
        bar.classList.remove('hidden');
        const inp = document.getElementById('in-chat-search-input');
        if (inp) {
            inp.value = '';
            inp.focus();
        }
        inChatSearchResults = [];
        currentSearchMatchIndex = -1;
        updateSearchCounter();
    } else {
        window.closeInChatSearch();
    }
};

window.closeInChatSearch = function() {
    const bar = document.getElementById('in-chat-search-bar');
    if (bar) bar.classList.add('hidden');
    clearSearchHighlights();
    inChatSearchResults = [];
    currentSearchMatchIndex = -1;
};

window.performInChatSearch = function(query) {
    clearSearchHighlights();
    inChatSearchResults = [];
    currentSearchMatchIndex = -1;

    const q = (query || '').trim().toLowerCase();
    if (!q || !activeChat) {
        updateSearchCounter();
        return;
    }

    const currentChatBox = document.getElementById('chat-box-' + activeChat.kId);
    if (!currentChatBox) return;

    const msgTexts = currentChatBox.querySelectorAll('.msg-text');
    msgTexts.forEach(el => {
        const text = el.textContent || '';
        const lower = text.toLowerCase();
        if (lower.includes(q)) {
            const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            el.innerHTML = escapeHTML(text).replace(regex, '<mark class="search-highlight">$1</mark>');
            const marks = el.querySelectorAll('.search-highlight');
            marks.forEach(m => inChatSearchResults.push(m));
        }
    });

    if (inChatSearchResults.length > 0) {
        currentSearchMatchIndex = inChatSearchResults.length - 1; // start with latest match (bottom)
        highlightCurrentMatch();
    }
    updateSearchCounter();
};

function highlightCurrentMatch() {
    inChatSearchResults.forEach(el => el.classList.remove('active'));
    if (currentSearchMatchIndex >= 0 && currentSearchMatchIndex < inChatSearchResults.length) {
        const target = inChatSearchResults[currentSearchMatchIndex];
        target.classList.add('active');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

window.nextSearchMatch = function() {
    if (inChatSearchResults.length === 0) return;
    currentSearchMatchIndex = (currentSearchMatchIndex + 1) % inChatSearchResults.length;
    highlightCurrentMatch();
    updateSearchCounter();
};

window.prevSearchMatch = function() {
    if (inChatSearchResults.length === 0) return;
    currentSearchMatchIndex = (currentSearchMatchIndex - 1 + inChatSearchResults.length) % inChatSearchResults.length;
    highlightCurrentMatch();
    updateSearchCounter();
};

function updateSearchCounter() {
    const counter = document.getElementById('in-chat-search-counter');
    if (!counter) return;
    if (inChatSearchResults.length === 0) {
        counter.classList.add('hidden');
        counter.innerText = '0/0';
    } else {
        counter.classList.remove('hidden');
        counter.innerText = `${currentSearchMatchIndex + 1}/${inChatSearchResults.length}`;
    }
}

function clearSearchHighlights() {
    if (!activeChat) return;
    const currentChatBox = document.getElementById('chat-box-' + activeChat.kId);
    if (!currentChatBox) return;
    const marks = currentChatBox.querySelectorAll('.search-highlight');
    marks.forEach(m => {
        const parent = m.parentNode;
        if (parent) parent.replaceChild(document.createTextNode(m.textContent), m);
    });
}

window.toggleChatActionsMenu = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('chat-actions-dropdown');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
        const isMuted = activeChat && mutedChats.includes(activeChat.kId);
        const muteLbl = document.getElementById('chat-actions-mute-label');
        if (muteLbl) muteLbl.innerText = isMuted ? 'Включить звук' : 'Без звука';
        
        const profLbl = document.getElementById('chat-actions-profile-label');
        if (profLbl && activeChat) {
            profLbl.innerText = activeChat.isGroup ? (activeChat.groupType === 'channel' ? 'О канале' : 'О группе') : 'Профиль';
        }
        
        const menuBtn = document.getElementById('chat-menu-btn');
        if (menuBtn && window.innerWidth > 768) {
            const rect = menuBtn.getBoundingClientRect();
            menu.style.top = `${rect.bottom + 8}px`;
            menu.style.left = `${Math.max(10, rect.right - 210)}px`;
            menu.style.right = 'auto';
        } else {
            menu.style.top = '';
            menu.style.left = '';
            menu.style.right = '';
        }
        
        menu.classList.remove('hidden');
    } else {
        menu.classList.add('hidden');
    }
};

window.closeChatActionsMenu = function() {
    document.getElementById('chat-actions-dropdown')?.classList.add('hidden');
};

window.toggleMuteActiveChat = function() {
    if (!activeChat) return;
    muteChat(activeChat.kId);
};

window.confirmClearActiveChat = function() {
    if (!activeChat) return;
    confirmDeleteChat(activeChat.kId);
};

document.addEventListener('click', (e) => {
    const menu = document.getElementById('chat-actions-dropdown');
    const menuBtn = document.getElementById('chat-menu-btn');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !menuBtn?.contains(e.target)) {
        menu.classList.add('hidden');
    }
});


