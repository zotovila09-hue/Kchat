const db = require('./database');
const config = require('../config');

const stmtGetByUserId = db.prepare('SELECT * FROM sessions WHERE user_k_id = ? ORDER BY last_active DESC');
const stmtGetById = db.prepare('SELECT * FROM sessions WHERE id = ?');
const stmtInsertSession = db.prepare(`
    INSERT INTO sessions (id, user_k_id, token, name, app, icon, ip, location, login_date, last_active, user_agent)
    VALUES (@id, @user_k_id, @token, @name, @app, @icon, @ip, @location, @login_date, @last_active, @user_agent)
`);
const stmtUpdateSession = db.prepare(`
    UPDATE sessions
    SET last_active = @last_active, ip = @ip, name = @name, app = @app, icon = @icon, user_agent = @user_agent
    WHERE id = @id
`);
const stmtDeleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
const stmtDeleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_k_id = ? AND id != ?');
const stmtCountSessions = db.prepare('SELECT count(*) as count FROM sessions WHERE user_k_id = ?');
const stmtDeleteOldestSessions = db.prepare(`
    DELETE FROM sessions WHERE id IN (
        SELECT id FROM sessions WHERE user_k_id = ? ORDER BY last_active ASC LIMIT ?
    )
`);

function formatSession(s) {
    if (!s) return null;
    return {
        id: s.id,
        userKId: s.user_k_id,
        token: s.token,
        name: s.name,
        app: s.app,
        icon: s.icon,
        ip: s.ip,
        location: s.location,
        loginDate: s.login_date,
        date: s.login_date,
        lastActive: s.last_active,
        userAgent: s.user_agent
    };
}

function getSessionsByUserId(kId) {
    if (!kId) return [];
    const rows = stmtGetByUserId.all(kId);
    return rows.map(formatSession);
}

function getSessionById(sessionId) {
    if (!sessionId) return null;
    return formatSession(stmtGetById.get(sessionId));
}

function getSessionByToken(token) {
    if (!token || typeof token !== 'string') return null;
    const cleanToken = token.trim();
    if (!cleanToken) return null;

    const row = db.prepare('SELECT * FROM sessions WHERE token = ? OR id = ? LIMIT 1').get(cleanToken, cleanToken);
    if (!row) return null;

    const ttlMs = (config.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;
    if (row.last_active && (Date.now() - row.last_active > ttlMs)) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
        return null;
    }

    // Refresh last active
    try {
        db.prepare('UPDATE sessions SET last_active = ? WHERE id = ?').run(Date.now(), row.id);
    } catch (e) {}

    return formatSession(row);
}

function verifyUserToken(kId, token) {
    if (!kId || !token || typeof token !== 'string') return false;
    const cleanToken = token.trim();
    if (!cleanToken) return false;

    const row = db.prepare('SELECT id, last_active FROM sessions WHERE user_k_id = ? AND (token = ? OR id = ?) LIMIT 1').get(kId, cleanToken, cleanToken);
    if (!row) return false;

    const ttlMs = (config.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;
    if (row.last_active && (Date.now() - row.last_active > ttlMs)) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
        return false;
    }

    return true;
}

function createSession(session) {
    stmtInsertSession.run({
        id: session.id,
        user_k_id: session.userKId || session.user_k_id,
        token: session.token,
        name: session.name || 'Web Device',
        app: session.app || 'KNX Web',
        icon: session.icon || 'desktop',
        ip: session.ip || '127.0.0.1',
        location: session.location || 'Онлайн',
        login_date: session.loginDate || session.login_date || new Date().toISOString(),
        last_active: session.lastActive || session.last_active || Date.now(),
        user_agent: session.userAgent || session.user_agent || ''
    });

    // Keep maximum 25 sessions per user
    const total = stmtCountSessions.get(session.userKId || session.user_k_id).count;
    if (total > 25) {
        stmtDeleteOldestSessions.run(session.userKId || session.user_k_id, total - 25);
    }

    return getSessionById(session.id);
}

function updateSession(sessionId, updates) {
    stmtUpdateSession.run({
        id: sessionId,
        last_active: updates.lastActive || Date.now(),
        ip: updates.ip || '127.0.0.1',
        name: updates.name || 'Device',
        app: updates.app || 'KNX Client',
        icon: updates.icon || 'desktop',
        user_agent: updates.userAgent || ''
    });
    return getSessionById(sessionId);
}

function deleteSession(kId, sessionId) {
    stmtDeleteSession.run(sessionId);
    return getSessionsByUserId(kId);
}

function deleteAllOtherSessions(kId, keepSessionId) {
    const existing = stmtGetByUserId.all(kId);
    const safeKeepId = String(keepSessionId || '');
    const terminatedIds = existing.filter(s => s.id !== safeKeepId).map(s => s.id);

    if (safeKeepId) {
        stmtDeleteOtherSessions.run(kId, safeKeepId);
    } else {
        db.prepare('DELETE FROM sessions WHERE user_k_id = ?').run(kId);
    }

    return {
        terminatedIds,
        remainingSessions: getSessionsByUserId(kId)
    };
}

module.exports = {
    getSessionsByUserId,
    getSessionById,
    getSessionByToken,
    verifyUserToken,
    createSession,
    updateSession,
    deleteSession,
    deleteAllOtherSessions
};
