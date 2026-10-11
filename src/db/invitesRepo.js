const db = require('./database');
const config = require('../config');

function formatInvite(row) {
    if (!row) return null;
    return {
        code: row.code,
        description: row.description,
        title: row.title,
        tier: row.tier || 'beta',
        unlimited: row.unlimited === 1,
        maxUses: row.max_uses,
        usedCount: row.used_count,
        created: row.created_at
    };
}

function getInviteByCode(code) {
    if (!code) return null;
    const clean = String(code).trim().toUpperCase();
    const row = db.prepare('SELECT * FROM invites WHERE UPPER(code) = ?').get(clean);
    return formatInvite(row);
}

function getPrimaryInvite() {
    const row = db.prepare('SELECT * FROM invites ORDER BY rowid ASC LIMIT 1').get();
    if (row) return formatInvite(row);
    return config.DEFAULT_INVITES[0];
}

function incrementUsedCount(code) {
    const clean = String(code).trim().toUpperCase();
    db.prepare('UPDATE invites SET used_count = used_count + 1 WHERE UPPER(code) = ?').run(clean);
    return getInviteByCode(clean);
}

function saveInvite(inv) {
    db.prepare(`
        INSERT OR REPLACE INTO invites (code, description, title, tier, unlimited, max_uses, used_count, created_at)
        VALUES (@code, @description, @title, @tier, @unlimited, @max_uses, @used_count, @created_at)
    `).run({
        code: inv.code.toUpperCase(),
        description: inv.description || '',
        title: inv.title || 'Invite',
        tier: inv.tier || 'beta',
        unlimited: inv.unlimited ? 1 : 0,
        max_uses: inv.maxUses || 0,
        used_count: inv.usedCount || 0,
        created_at: inv.created || new Date().toISOString()
    });
    return getInviteByCode(inv.code);
}

module.exports = {
    getInviteByCode,
    getPrimaryInvite,
    incrementUsedCount,
    saveInvite
};
