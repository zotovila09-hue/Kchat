const db = require('./database');

function formatPack(row) {
    if (!row) return null;
    let items = [];
    try {
        items = JSON.parse(row.items || '[]');
    } catch (e) {
        items = [];
    }
    return {
        id: row.id,
        name: row.name,
        creatorId: row.creator_id,
        items,
        createdAt: row.created_at
    };
}

function getAllPacks() {
    const rows = db.prepare('SELECT * FROM stickers').all();
    const map = {};
    for (const r of rows) {
        map[r.id] = formatPack(r);
    }
    return map;
}

function getPackById(pId) {
    const row = db.prepare('SELECT * FROM stickers WHERE id = ?').get(pId);
    return formatPack(row);
}

function createPack({ id, name, creatorId, items = [] }) {
    db.prepare(`
        INSERT OR REPLACE INTO stickers (id, name, creator_id, items, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, name, creatorId, JSON.stringify(items), Date.now());
    return getPackById(id);
}

function deletePack(pId) {
    const res = db.prepare('DELETE FROM stickers WHERE id = ?').run(pId);
    return res.changes > 0;
}

function addStickerToPack(pId, itemUrl) {
    const pack = getPackById(pId);
    if (!pack) return null;
    pack.items.push(itemUrl);
    db.prepare('UPDATE stickers SET items = ? WHERE id = ?').run(JSON.stringify(pack.items), pId);
    return pack;
}

module.exports = {
    getAllPacks,
    getPackById,
    createPack,
    deletePack,
    addStickerToPack
};
