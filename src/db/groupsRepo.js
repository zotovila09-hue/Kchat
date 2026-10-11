const db = require('./database');
const config = require('../config');

function formatGroup(row) {
    if (!row) return null;
    const memberRows = db.prepare('SELECT user_k_id FROM group_members WHERE group_id = ?').all(row.g_id);
    const members = memberRows.map(m => m.user_k_id);

    return {
        gId: row.g_id,
        name: row.name,
        desc: row.desc || '',
        type: row.type || 'group',
        creatorId: row.creator_id,
        avatar: row.avatar || config.DEFAULT_AVATAR,
        header: row.header || config.DEFAULT_HEADER,
        members,
        isGroup: true,
        createdAt: row.created_at
    };
}

function getGroupById(gId) {
    if (!gId) return null;
    const row = db.prepare('SELECT * FROM groups WHERE g_id = ?').get(gId);
    return formatGroup(row);
}

function getAllGroupsMap() {
    const rows = db.prepare('SELECT * FROM groups').all();
    const map = {};
    for (const row of rows) {
        map[row.g_id] = formatGroup(row);
    }
    return map;
}

function createGroup({ gId, name, desc, type, creatorId, avatar, header }) {
    const insertGroup = db.prepare(`
        INSERT INTO groups (g_id, name, desc, type, creator_id, avatar, header, created_at)
        VALUES (@g_id, @name, @desc, @type, @creator_id, @avatar, @header, @created_at)
    `);

    const insertChat = db.prepare(`
        INSERT OR IGNORE INTO chats (chat_id, is_group, created_at, updated_at)
        VALUES (?, 1, ?, ?)
    `);

    const insertMember = db.prepare(`
        INSERT OR IGNORE INTO group_members (group_id, user_k_id, joined_at)
        VALUES (?, ?, ?)
    `);

    const now = Date.now();
    db.transaction(() => {
        insertGroup.run({
            g_id: gId,
            name,
            desc: desc || '',
            type: type || 'group',
            creator_id: creatorId,
            avatar: avatar || config.DEFAULT_AVATAR,
            header: header || config.DEFAULT_HEADER,
            created_at: now
        });
        insertChat.run(gId, now, now);
        insertMember.run(gId, creatorId, now);
    })();

    return getGroupById(gId);
}

function updateGroup(gId, updates) {
    const existing = db.prepare('SELECT * FROM groups WHERE g_id = ?').get(gId);
    if (!existing) return null;

    const fields = [];
    const values = {};
    const mapping = {
        name: 'name',
        desc: 'desc',
        avatar: 'avatar',
        header: 'header',
        type: 'type',
        creatorId: 'creator_id'
    };

    for (const key in updates) {
        if (mapping[key] !== undefined && updates[key] !== undefined) {
            const col = mapping[key];
            fields.push(`${col} = @${col}`);
            values[col] = updates[key];
        }
    }

    if (fields.length > 0) {
        values.g_id = gId;
        db.prepare(`UPDATE groups SET ${fields.join(', ')} WHERE g_id = @g_id`).run(values);
    }

    return getGroupById(gId);
}

function deleteGroup(gId) {
    db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE chat_id = ?').run(gId);
        db.prepare('DELETE FROM chats WHERE chat_id = ?').run(gId);
        db.prepare('DELETE FROM group_members WHERE group_id = ?').run(gId);
        db.prepare('DELETE FROM groups WHERE g_id = ?').run(gId);
    })();
}

function addMember(gId, kId) {
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_k_id, joined_at) VALUES (?, ?, ?)')
        .run(gId, kId, Date.now());
    return getGroupById(gId);
}

function removeMember(gId, kId) {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_k_id = ?').run(gId, kId);
    return getGroupById(gId);
}

function getMemberGroups(kId) {
    const rows = db.prepare(`
        SELECT g.* FROM groups g
        JOIN group_members gm ON g.g_id = gm.group_id
        WHERE gm.user_k_id = ?
    `).all(kId);
    return rows.map(formatGroup);
}

module.exports = {
    getGroupById,
    getAllGroupsMap,
    createGroup,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember,
    getMemberGroups
};
