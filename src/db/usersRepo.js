const db = require('./database');
const config = require('../config');
const sessionsRepo = require('./sessionsRepo');

function formatUser(row, includeSessions = true) {
    if (!row) return null;
    let blocked = [];
    let folders = [];
    let archived = [];
    let installedPacks = [];

    try { blocked = JSON.parse(row.blocked || '[]'); } catch (e) {}
    try { folders = JSON.parse(row.folders || '[]'); } catch (e) {}
    try { archived = JSON.parse(row.archived || '[]'); } catch (e) {}
    try { installedPacks = JSON.parse(row.installed_packs || '[]'); } catch (e) {}

    const isDevFlag = isDev(row.email, row);
    const isVipFlag = !!row.is_vip || row.role === 'vip';

    const user = {
        kId: row.k_id,
        name: row.name,
        email: row.email,
        password: row.password,
        avatar: row.avatar || config.DEFAULT_AVATAR,
        header: row.header || config.DEFAULT_HEADER,
        chatBg: row.chat_bg || '',
        bio: row.bio || 'Привет! Я использую KNX.',
        hobbies: row.hobbies || '',
        birthDate: row.birth_date || '',
        theme: row.theme || 'light',
        lang: row.lang || 'ru',
        soundEnabled: row.sound_enabled === 1,
        searchable: row.searchable === 1,
        hideAvatar: row.hide_avatar === 1,
        hideHeader: row.hide_header === 1,
        hideBio: row.hide_bio === 1,
        hideKid: row.hide_kid === 1,
        showOnlineStatus: row.show_online_status === 1,
        readReceipts: row.read_receipts === 1,
        privPhone: row.priv_phone || 'all',
        privLast: row.priv_last || 'all',
        privCalls: row.priv_calls || 'all',
        sessionTtl: row.session_ttl || 30,
        screenshotAlerts: row.screenshot_alerts === 1,
        twoFactorEnabled: row.two_factor_enabled === 1,
        twoFactorPassword: row.two_factor_password,
        twoFactorHint: row.two_factor_hint || '',
        role: row.role || 'beta',
        isDev: isDevFlag,
        isVip: isVipFlag,
        isBot: row.is_bot === 1,
        blocked,
        folders,
        archived,
        installedPacks,
        createdAt: row.created_at
    };

    if (includeSessions) {
        user.sessions = sessionsRepo.getSessionsByUserId(row.k_id);
    }

    return user;
}

function isDev(email, user = null) {
    if (user && (user.isDev === true || user.is_dev === 1 || user.role === 'dev')) return true;
    return !!email && email.toLowerCase().trim() === config.DEV_EMAIL;
}

function getUserById(kId, includeSessions = true) {
    if (!kId) return null;
    const row = db.prepare('SELECT * FROM users WHERE k_id = ?').get(kId);
    return formatUser(row, includeSessions);
}

function getUserByEmail(email) {
    if (!email) return null;
    const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    return formatUser(row, true);
}

function getAllUsersMap() {
    const rows = db.prepare('SELECT * FROM users').all();
    const map = {};
    for (const row of rows) {
        map[row.k_id] = formatUser(row, false);
    }
    return map;
}

function generateID(prefix = '') {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const nums = '0123456789';
    const getRnd = (str, len) => Array.from({ length: len }, () => str[Math.floor(Math.random() * str.length)]).join('');
    let id;
    let exists = true;
    while (exists) {
        id = prefix + getRnd(chars, 3) + getRnd(nums, 3) + getRnd(chars, 3);
        const userFound = db.prepare('SELECT k_id FROM users WHERE k_id = ?').get(id);
        const groupFound = db.prepare('SELECT g_id FROM groups WHERE g_id = ?').get(id);
        exists = !!(userFound || groupFound);
    }
    return id;
}

function createUser(userData) {
    const isDevFlag = isDev(userData.email, userData);
    const stmt = db.prepare(`
        INSERT INTO users (
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

    stmt.run({
        k_id: userData.kId,
        name: userData.name,
        email: userData.email,
        password: userData.password,
        avatar: userData.avatar || config.DEFAULT_AVATAR,
        header: userData.header || config.DEFAULT_HEADER,
        chat_bg: userData.chatBg || '',
        bio: userData.bio || 'Привет! Я использую KNX.',
        hobbies: userData.hobbies || '',
        birth_date: userData.birthDate || '',
        theme: userData.theme || 'light',
        lang: userData.lang || 'ru',
        sound_enabled: userData.soundEnabled === false ? 0 : 1,
        searchable: userData.searchable === false ? 0 : 1,
        hide_avatar: userData.hideAvatar ? 1 : 0,
        hide_header: userData.hideHeader ? 1 : 0,
        hide_bio: userData.hideBio ? 1 : 0,
        hide_kid: userData.hideKid ? 1 : 0,
        show_online_status: userData.showOnlineStatus === false ? 0 : 1,
        read_receipts: userData.readReceipts === false ? 0 : 1,
        priv_phone: userData.privPhone || 'all',
        priv_last: userData.privLast || 'all',
        priv_calls: userData.privCalls || 'all',
        session_ttl: userData.sessionTtl || 30,
        screenshot_alerts: userData.screenshotAlerts === false ? 0 : 1,
        two_factor_enabled: userData.twoFactorEnabled ? 1 : 0,
        two_factor_password: userData.twoFactorPassword || null,
        two_factor_hint: userData.twoFactorHint || '',
        role: userData.role || (isDevFlag ? 'dev' : 'beta'),
        is_dev: isDevFlag ? 1 : 0,
        is_vip: (userData.isVip || userData.role === 'vip') ? 1 : 0,
        is_bot: userData.isBot ? 1 : 0,
        blocked: JSON.stringify(userData.blocked || []),
        folders: JSON.stringify(userData.folders || []),
        archived: JSON.stringify(userData.archived || []),
        installed_packs: JSON.stringify(userData.installedPacks || []),
        created_at: Date.now()
    });

    return getUserById(userData.kId);
}

function updateUser(kId, updates) {
    const existing = db.prepare('SELECT * FROM users WHERE k_id = ?').get(kId);
    if (!existing) return null;

    const fields = [];
    const values = {};

    const mapping = {
        name: 'name',
        avatar: 'avatar',
        header: 'header',
        chatBg: 'chat_bg',
        bio: 'bio',
        hobbies: 'hobbies',
        birthDate: 'birth_date',
        theme: 'theme',
        lang: 'lang',
        soundEnabled: 'sound_enabled',
        searchable: 'searchable',
        hideAvatar: 'hide_avatar',
        hideHeader: 'hide_header',
        hideBio: 'hide_bio',
        hideKid: 'hide_kid',
        showOnlineStatus: 'show_online_status',
        readReceipts: 'read_receipts',
        privPhone: 'priv_phone',
        privLast: 'priv_last',
        privCalls: 'priv_calls',
        sessionTtl: 'session_ttl',
        screenshotAlerts: 'screenshot_alerts',
        twoFactorEnabled: 'two_factor_enabled',
        twoFactorPassword: 'two_factor_password',
        twoFactorHint: 'two_factor_hint',
        blocked: 'blocked',
        folders: 'folders',
        archived: 'archived',
        installedPacks: 'installed_packs',
        role: 'role',
        isDev: 'is_dev',
        isVip: 'is_vip'
    };

    for (const key in updates) {
        if (mapping[key] !== undefined && updates[key] !== undefined) {
            const col = mapping[key];
            fields.push(`${col} = @${col}`);
            let val = updates[key];
            if (typeof val === 'boolean') val = val ? 1 : 0;
            if (['blocked', 'folders', 'archived', 'installed_packs'].includes(col)) {
                val = typeof val === 'string' ? val : JSON.stringify(val);
            }
            values[col] = val;
        }
    }

    if (fields.length > 0) {
        values.k_id = kId;
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE k_id = @k_id`;
        db.prepare(sql).run(values);
    }

    return getUserById(kId);
}

function updatePassword(kId, hashedPassword) {
    db.prepare('UPDATE users SET password = ? WHERE k_id = ?').run(hashedPassword, kId);
    return true;
}

function update2FA(kId, enabled, hashedPassword = null, hint = '') {
    db.prepare(`
        UPDATE users
        SET two_factor_enabled = ?, two_factor_password = ?, two_factor_hint = ?
        WHERE k_id = ?
    `).run(enabled ? 1 : 0, hashedPassword, hint, kId);
    return getUserById(kId);
}

function deleteUser(kId) {
    db.prepare('DELETE FROM users WHERE k_id = ?').run(kId);
}

module.exports = {
    getUserById,
    getUserByEmail,
    getAllUsersMap,
    generateID,
    createUser,
    updateUser,
    updatePassword,
    update2FA,
    deleteUser,
    isDev
};
