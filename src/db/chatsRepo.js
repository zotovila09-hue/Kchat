const db = require('./database');
const groupsRepo = require('./groupsRepo');

function getOrCreateChat(chatId, isGroup = 0) {
    db.prepare(`
        INSERT OR IGNORE INTO chats (chat_id, is_group, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `).run(chatId, isGroup ? 1 : 0, Date.now(), Date.now());
    return db.prepare('SELECT * FROM chats WHERE chat_id = ?').get(chatId);
}

function deleteChat(chatId) {
    db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
        db.prepare('DELETE FROM chats WHERE chat_id = ?').run(chatId);
    })();
}

function getMyChats(kId) {
    if (!kId) return [];
    const myChats = [];

    // 1-on-1 chats where kId is participant
    const directChats = db.prepare(`
        SELECT chat_id FROM chats
        WHERE is_group = 0 AND (chat_id LIKE ? OR chat_id LIKE ?)
    `).all(`${kId}_%`, `%_${kId}`);

    for (const row of directChats) {
        const chatKey = row.chat_id;
        let targetId = null;

        if (chatKey.startsWith(kId + '_')) {
            targetId = chatKey.slice(kId.length + 1);
        } else if (chatKey.endsWith('_' + kId)) {
            targetId = chatKey.slice(0, chatKey.length - kId.length - 1);
        }

        if (targetId) {
            const targetUser = db.prepare('SELECT k_id FROM users WHERE k_id = ?').get(targetId);
            if (targetUser) {
                const unreadRow = db.prepare(`
                    SELECT count(*) as unread FROM messages
                    WHERE chat_id = ? AND sender_id != ? AND status != 'read'
                `).get(chatKey, kId);
                const unread = unreadRow ? unreadRow.unread : 0;

                if (!myChats.some(c => c.id === targetId)) {
                    myChats.push({ id: targetId, isGroup: false, unread });
                }
            }
        }
    }

    // Group chats where kId is a member
    const userGroups = groupsRepo.getMemberGroups(kId);
    for (const g of userGroups) {
        if (!myChats.some(c => c.id === g.gId)) {
            myChats.push({ id: g.gId, isGroup: true, unread: 0 });
        }
    }

    return myChats;
}

module.exports = {
    getOrCreateChat,
    deleteChat,
    getMyChats
};
