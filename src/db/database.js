const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { saveBase64ToFile } = require('../services/cryptoService');

const db = new Database(config.DB_PATH, {
    // verbose: config.NODE_ENV === 'development' ? console.log : null
});

// Configure High-Performance & ACID PRAGMAs
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            k_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            avatar TEXT,
            header TEXT,
            chat_bg TEXT,
            bio TEXT,
            hobbies TEXT,
            birth_date TEXT,
            theme TEXT DEFAULT 'light',
            lang TEXT DEFAULT 'ru',
            sound_enabled INTEGER DEFAULT 1,
            searchable INTEGER DEFAULT 1,
            hide_avatar INTEGER DEFAULT 0,
            hide_header INTEGER DEFAULT 0,
            hide_bio INTEGER DEFAULT 0,
            hide_kid INTEGER DEFAULT 0,
            show_online_status INTEGER DEFAULT 1,
            read_receipts INTEGER DEFAULT 1,
            priv_phone TEXT DEFAULT 'all',
            priv_last TEXT DEFAULT 'all',
            priv_calls TEXT DEFAULT 'all',
            session_ttl INTEGER DEFAULT 30,
            screenshot_alerts INTEGER DEFAULT 1,
            two_factor_enabled INTEGER DEFAULT 0,
            two_factor_password TEXT,
            two_factor_hint TEXT,
            role TEXT DEFAULT 'beta',
            is_dev INTEGER DEFAULT 0,
            is_vip INTEGER DEFAULT 0,
            is_bot INTEGER DEFAULT 0,
            blocked TEXT DEFAULT '[]',
            folders TEXT DEFAULT '[]',
            archived TEXT DEFAULT '[]',
            installed_packs TEXT DEFAULT '[]',
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_k_id TEXT NOT NULL,
            token TEXT NOT NULL,
            name TEXT,
            app TEXT,
            icon TEXT,
            ip TEXT,
            location TEXT,
            login_date TEXT,
            last_active INTEGER,
            user_agent TEXT,
            FOREIGN KEY (user_k_id) REFERENCES users (k_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_k_id ON sessions (user_k_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);

        CREATE TABLE IF NOT EXISTS groups (
            g_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            desc TEXT,
            type TEXT NOT NULL,
            creator_id TEXT NOT NULL,
            avatar TEXT,
            header TEXT,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT NOT NULL,
            user_k_id TEXT NOT NULL,
            joined_at INTEGER,
            PRIMARY KEY (group_id, user_k_id),
            FOREIGN KEY (group_id) REFERENCES groups (g_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_k_id);

        CREATE TABLE IF NOT EXISTS chats (
            chat_id TEXT PRIMARY KEY,
            is_group INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            text TEXT NOT NULL,
            type TEXT DEFAULT 'text',
            timestamp INTEGER NOT NULL,
            status TEXT DEFAULT 'sent',
            reply_to TEXT,
            is_edited INTEGER DEFAULT 0,
            reactions TEXT DEFAULT '{}',
            file_name TEXT,
            caption TEXT,
            is_pinned INTEGER DEFAULT 0,
            inline_buttons TEXT,
            FOREIGN KEY (chat_id) REFERENCES chats (chat_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages (chat_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp);

        CREATE TABLE IF NOT EXISTS stickers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            creator_id TEXT NOT NULL,
            items TEXT NOT NULL,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS invites (
            code TEXT PRIMARY KEY,
            description TEXT,
            title TEXT,
            tier TEXT DEFAULT 'beta',
            unlimited INTEGER DEFAULT 1,
            max_uses INTEGER DEFAULT 0,
            used_count INTEGER DEFAULT 0,
            created_at TEXT
        );
    `);
}

function migrateFromJsonFiles() {
    const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;
    if (userCount > 0) {
        return; // Already initialized / migrated
    }

    console.log('🔄 [KNX DB] Начинается бесшовная миграция из JSON в SQLite...');

    const insertUser = db.prepare(`
        INSERT OR REPLACE INTO users (
            k_id, name, email, password, avatar, header, chat_bg, bio, hobbies, birth_date,
            theme, lang, sound_enabled, searchable, hide_avatar, hide_header, hide_bio, hide_kid,
            show_online_status, read_receipts, priv_phone, priv_last, priv_calls, session_ttl,
            screenshot_alerts, two_factor_enabled, two_factor_password, two_factor_hint,
            role, is_dev, is_vip, is_bot, blocked, folders, archived, installed_packs, created_at
        ) VALUES (
            @k_id, @name, @email, @password, @avatar, @header, @chat_bg, @bio, @hobbies, @birth_date,
            @theme, @lang, @sound_enabled, @searchable, @hide_avatar, @hide_header, @hide_bio, @hide_kid,
            @show_online_status, @read_receipts, @priv_phone, @priv_last, @priv_calls, @session_ttl,
            @screenshot_alerts, @two_factor_enabled, @two_factor_password, @two_factor_hint,
            @role, @is_dev, @is_vip, @is_bot, @blocked, @folders, @archived, @installed_packs, @created_at
        )
    `);

    const insertSession = db.prepare(`
        INSERT OR REPLACE INTO sessions (
            id, user_k_id, token, name, app, icon, ip, location, login_date, last_active, user_agent
        ) VALUES (
            @id, @user_k_id, @token, @name, @app, @icon, @ip, @location, @login_date, @last_active, @user_agent
        )
    `);

    const insertGroup = db.prepare(`
        INSERT OR REPLACE INTO groups (g_id, name, desc, type, creator_id, avatar, header, created_at)
        VALUES (@g_id, @name, @desc, @type, @creator_id, @avatar, @header, @created_at)
    `);

    const insertMember = db.prepare(`
        INSERT OR IGNORE INTO group_members (group_id, user_k_id, joined_at)
        VALUES (?, ?, ?)
    `);

    const insertChat = db.prepare(`
        INSERT OR IGNORE INTO chats (chat_id, is_group, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `);

    const insertMessage = db.prepare(`
        INSERT OR REPLACE INTO messages (
            id, chat_id, sender_id, text, type, timestamp, status, reply_to, is_edited, reactions, file_name, caption, is_pinned, inline_buttons
        ) VALUES (
            @id, @chat_id, @sender_id, @text, @type, @timestamp, @status, @reply_to, @is_edited, @reactions, @file_name, @caption, @is_pinned, @inline_buttons
        )
    `);

    const insertInvite = db.prepare(`
        INSERT OR REPLACE INTO invites (code, description, title, tier, unlimited, max_uses, used_count, created_at)
        VALUES (@code, @description, @title, @tier, @unlimited, @max_uses, @used_count, @created_at)
    `);

    const insertSticker = db.prepare(`
        INSERT OR REPLACE INTO stickers (id, name, creator_id, items, created_at)
        VALUES (@id, @name, @creator_id, @items, @created_at)
    `);

    const migrationTx = db.transaction(() => {
        // 1. Invites migration
        const invitesPath = path.join(config.DATA_DIR, 'invites.json');
        let invitesList = config.DEFAULT_INVITES;
        if (fs.existsSync(invitesPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(invitesPath, 'utf8'));
                if (Array.isArray(parsed.invites) && parsed.invites.length > 0) {
                    invitesList = parsed.invites;
                }
            } catch (e) {
                console.warn('Could not parse invites.json, using defaults');
            }
        }
        for (const inv of invitesList) {
            insertInvite.run({
                code: inv.code,
                description: inv.description || '',
                title: inv.title || 'Invite',
                tier: inv.tier || 'beta',
                unlimited: inv.unlimited ? 1 : 0,
                max_uses: inv.maxUses || 0,
                used_count: inv.usedCount || 0,
                created_at: inv.created || new Date().toISOString()
            });
        }

        // 2. Users migration
        const usersPath = path.join(config.DATA_DIR, 'users.json');
        if (fs.existsSync(usersPath)) {
            try {
                const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
                for (const kId in usersData) {
                    const u = usersData[kId];
                    const isDevUser = (u.email && u.email.toLowerCase() === config.DEV_EMAIL) || u.isDev === true || u.role === 'dev';
                    
                    let avatar = u.avatar || config.DEFAULT_AVATAR;
                    let header = u.header || config.DEFAULT_HEADER;
                    
                    // Convert heavy data URLs to static disk files for high performance
                    if (avatar && avatar.startsWith('data:') && avatar.length > 20000) {
                        avatar = saveBase64ToFile(avatar, `migrated_ava_${kId}`);
                    }
                    if (header && header.startsWith('data:') && header.length > 20000) {
                        header = saveBase64ToFile(header, `migrated_hdr_${kId}`);
                    }

                    insertUser.run({
                        k_id: u.kId || kId,
                        name: u.name || 'User',
                        email: u.email || `${kId}@knx`,
                        password: u.password || '',
                        avatar: avatar,
                        header: header,
                        chat_bg: u.chatBg || '',
                        bio: u.bio || 'Привет! Я использую KNX.',
                        hobbies: u.hobbies || '',
                        birth_date: u.birthDate || '',
                        theme: u.theme || 'light',
                        lang: u.lang || 'ru',
                        sound_enabled: u.soundEnabled === false ? 0 : 1,
                        searchable: u.searchable === false ? 0 : 1,
                        hide_avatar: u.hideAvatar ? 1 : 0,
                        hide_header: u.hideHeader ? 1 : 0,
                        hide_bio: u.hideBio ? 1 : 0,
                        hide_kid: u.hideKid ? 1 : 0,
                        show_online_status: u.showOnlineStatus === false ? 0 : 1,
                        read_receipts: u.readReceipts === false ? 0 : 1,
                        priv_phone: u.privPhone || 'all',
                        priv_last: u.privLast || 'all',
                        priv_calls: u.privCalls || 'all',
                        session_ttl: u.sessionTtl || 30,
                        screenshot_alerts: u.screenshotAlerts === false ? 0 : 1,
                        two_factor_enabled: u.twoFactorEnabled ? 1 : 0,
                        two_factor_password: u.twoFactorPassword || null,
                        two_factor_hint: u.twoFactorHint || '',
                        role: u.role || (isDevUser ? 'dev' : 'beta'),
                        is_dev: isDevUser ? 1 : 0,
                        is_vip: (u.isVip || u.role === 'vip') ? 1 : 0,
                        is_bot: u.isBot ? 1 : 0,
                        blocked: JSON.stringify(u.blocked || []),
                        folders: JSON.stringify(u.folders || []),
                        archived: JSON.stringify(u.archived || []),
                        installed_packs: JSON.stringify(u.installedPacks || []),
                        created_at: Date.now()
                    });

                    if (Array.isArray(u.sessions)) {
                        for (const s of u.sessions) {
                            if (s && s.id) {
                                insertSession.run({
                                    id: s.id,
                                    user_k_id: kId,
                                    token: s.token || s.id,
                                    name: s.name || 'Device',
                                    app: s.app || 'KNX Client',
                                    icon: s.icon || 'desktop',
                                    ip: s.ip || '127.0.0.1',
                                    location: s.location || 'Онлайн',
                                    login_date: s.loginDate || '',
                                    last_active: s.lastActive || Date.now(),
                                    user_agent: s.userAgent || ''
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error migrating users:', err);
            }
        }

        // 3. Groups migration
        const groupsPath = path.join(config.DATA_DIR, 'groups.json');
        if (fs.existsSync(groupsPath)) {
            try {
                const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
                for (const gId in groupsData) {
                    const g = groupsData[gId];
                    insertGroup.run({
                        g_id: g.gId || gId,
                        name: g.name || 'Group',
                        desc: g.desc || '',
                        type: g.type || 'group',
                        creator_id: g.creatorId || '',
                        avatar: g.avatar || config.DEFAULT_AVATAR,
                        header: g.header || config.DEFAULT_HEADER,
                        created_at: Date.now()
                    });
                    insertChat.run(g.gId || gId, 1, Date.now(), Date.now());

                    if (Array.isArray(g.members)) {
                        for (const mId of g.members) {
                            insertMember.run(g.gId || gId, mId, Date.now());
                        }
                    }
                }
            } catch (err) {
                console.error('Error migrating groups:', err);
            }
        }

        // 4. Stickers migration
        const stickersPath = path.join(config.DATA_DIR, 'stickers.json');
        if (fs.existsSync(stickersPath)) {
            try {
                const stickersData = JSON.parse(fs.readFileSync(stickersPath, 'utf8'));
                for (const pId in stickersData) {
                    const p = stickersData[pId];
                    insertSticker.run({
                        id: p.id || pId,
                        name: p.name || 'Sticker Pack',
                        creator_id: p.creatorId || '',
                        items: JSON.stringify(p.items || []),
                        created_at: Date.now()
                    });
                }
            } catch (err) {
                console.error('Error migrating stickers:', err);
            }
        }

        // 5. Chats and messages migration
        function importMessages(chatKey, msgList) {
            if (!Array.isArray(msgList) || msgList.length === 0) return;
            const isGroup = chatKey.startsWith('g-') ? 1 : 0;
            insertChat.run(chatKey, isGroup, Date.now(), Date.now());

            for (const m of msgList) {
                if (!m || !m.id) continue;
                insertMessage.run({
                    id: String(m.id),
                    chat_id: chatKey,
                    sender_id: m.senderId || '',
                    text: m.text || '',
                    type: m.type || 'text',
                    timestamp: m.timestamp || Date.now(),
                    status: m.status || 'sent',
                    reply_to: m.replyTo ? (typeof m.replyTo === 'object' ? JSON.stringify(m.replyTo) : m.replyTo) : null,
                    is_edited: m.isEdited ? 1 : 0,
                    reactions: m.reactions ? JSON.stringify(m.reactions) : '{}',
                    file_name: m.fileName || null,
                    caption: m.caption || null,
                    is_pinned: m.isPinned ? 1 : 0,
                    inline_buttons: m.inlineButtons ? JSON.stringify(m.inlineButtons) : null
                });
            }
        }

        const chatsPath = path.join(config.DATA_DIR, 'chats.json');
        if (fs.existsSync(chatsPath)) {
            try {
                const chatsData = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));
                for (const chatKey in chatsData) {
                    importMessages(chatKey, chatsData[chatKey]);
                }
            } catch (err) {
                console.error('Error migrating chats.json:', err);
            }
        }

        const chatsDbDir = path.join(config.DATA_DIR, 'chats_db');
        if (fs.existsSync(chatsDbDir)) {
            try {
                const files = fs.readdirSync(chatsDbDir);
                for (const f of files) {
                    if (f.endsWith('.json')) {
                        const originalKey = decodeURIComponent(f.replace(/\.json$/, '').replace(/_/g, '%'));
                        const content = JSON.parse(fs.readFileSync(path.join(chatsDbDir, f), 'utf8'));
                        importMessages(originalKey, content);
                    }
                }
            } catch (err) {
                console.error('Error migrating chats_db partitions:', err);
            }
        }
    });

    migrationTx();
    console.log('✅ [KNX DB] Миграция в SQLite успешно завершена!');
}

initSchema();
migrateFromJsonFiles();

module.exports = db;
