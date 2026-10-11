const db = require('./database');
const { decrypt } = require('../services/cryptoService');
const chatsRepo = require('./chatsRepo');

function formatMessage(row, shouldDecrypt = true) {
    if (!row) return null;
    let replyTo = null;
    let reactions = {};
    let inlineButtons = null;

    try {
        if (row.reply_to) {
            replyTo = (typeof row.reply_to === 'object') ? row.reply_to : JSON.parse(row.reply_to);
        }
    } catch (e) {
        replyTo = row.reply_to;
    }

    try {
        if (row.reactions) {
            reactions = (typeof row.reactions === 'object') ? row.reactions : JSON.parse(row.reactions);
        }
    } catch (e) {
        reactions = {};
    }

    try {
        if (row.inline_buttons) {
            inlineButtons = (typeof row.inline_buttons === 'object') ? row.inline_buttons : JSON.parse(row.inline_buttons);
        }
    } catch (e) {
        inlineButtons = null;
    }

    const textContent = shouldDecrypt ? decrypt(row.text) : row.text;

    return {
        id: row.id,
        chatId: row.chat_id,
        senderId: row.sender_id,
        text: textContent,
        rawText: row.text,
        type: row.type || 'text',
        timestamp: row.timestamp,
        status: row.status || 'sent',
        replyTo,
        isEdited: row.is_edited === 1,
        reactions,
        fileName: row.file_name,
        caption: row.caption,
        isPinned: row.is_pinned === 1,
        inlineButtons
    };
}

function addMessage(msg) {
    const isGroup = msg.chatId && msg.chatId.startsWith('g-') ? 1 : 0;
    chatsRepo.getOrCreateChat(msg.chatId, isGroup);

    db.prepare(`
        UPDATE chats SET updated_at = ? WHERE chat_id = ?
    `).run(msg.timestamp || Date.now(), msg.chatId);

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO messages (
            id, chat_id, sender_id, text, type, timestamp, status, reply_to, is_edited, reactions, file_name, caption, is_pinned, inline_buttons
        ) VALUES (
            @id, @chat_id, @sender_id, @text, @type, @timestamp, @status, @reply_to, @is_edited, @reactions, @file_name, @caption, @is_pinned, @inline_buttons
        )
    `);

    stmt.run({
        id: String(msg.id),
        chat_id: msg.chatId,
        sender_id: msg.senderId,
        text: msg.text, // Already encrypted
        type: msg.type || 'text',
        timestamp: msg.timestamp || Date.now(),
        status: msg.status || 'sent',
        reply_to: msg.replyTo ? (typeof msg.replyTo === 'object' ? JSON.stringify(msg.replyTo) : msg.replyTo) : null,
        is_edited: msg.isEdited ? 1 : 0,
        reactions: msg.reactions ? JSON.stringify(msg.reactions) : '{}',
        file_name: msg.fileName || null,
        caption: msg.caption || null,
        is_pinned: msg.isPinned ? 1 : 0,
        inline_buttons: msg.inlineButtons ? JSON.stringify(msg.inlineButtons) : null
    });

    return getMessageById(msg.chatId, msg.id);
}

function getMessageById(chatId, id) {
    const row = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id = ?').get(chatId, String(id));
    return formatMessage(row);
}

function getHistory(chatKey, limit = 50, before = null) {
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const totalRow = db.prepare('SELECT count(*) as total FROM messages WHERE chat_id = ?').get(chatKey);
    const total = totalRow ? totalRow.total : 0;

    let rows = [];
    if (before) {
        const targetMsg = db.prepare('SELECT timestamp FROM messages WHERE chat_id = ? AND id = ?').get(chatKey, String(before));
        if (targetMsg) {
            rows = db.prepare(`
                SELECT * FROM (
                    SELECT * FROM messages
                    WHERE chat_id = ? AND (timestamp < ? OR (timestamp = ? AND id < ?))
                    ORDER BY timestamp DESC, id DESC
                    LIMIT ?
                ) ORDER BY timestamp ASC, id ASC
            `).all(chatKey, targetMsg.timestamp, targetMsg.timestamp, String(before), parsedLimit);
        } else {
            rows = db.prepare(`
                SELECT * FROM (
                    SELECT * FROM messages
                    WHERE chat_id = ?
                    ORDER BY timestamp DESC, id DESC
                    LIMIT ?
                ) ORDER BY timestamp ASC, id ASC
            `).all(chatKey, parsedLimit);
        }
    } else {
        rows = db.prepare(`
            SELECT * FROM (
                SELECT * FROM messages
                WHERE chat_id = ?
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
            ) ORDER BY timestamp ASC, id ASC
        `).all(chatKey, parsedLimit);
    }

    const history = rows.map(r => formatMessage(r, true));

    let hasMore = false;
    if (history.length > 0) {
        const oldestInSlice = history[0];
        const olderCount = db.prepare(`
            SELECT count(*) as count FROM messages
            WHERE chat_id = ? AND (timestamp < ? OR (timestamp = ? AND id < ?))
        `).get(chatKey, oldestInSlice.timestamp, oldestInSlice.timestamp, String(oldestInSlice.id));
        hasMore = olderCount && olderCount.count > 0;
    }

    return {
        history,
        hasMore,
        total
    };
}

function editMessage(chatKey, id, senderId, newEncryptedText) {
    const res = db.prepare(`
        UPDATE messages
        SET text = ?, is_edited = 1
        WHERE chat_id = ? AND id = ? AND sender_id = ?
    `).run(newEncryptedText, chatKey, String(id), senderId);
    return res.changes > 0;
}

function deleteMessage(chatKey, id, senderId = null) {
    if (senderId) {
        const res = db.prepare('DELETE FROM messages WHERE chat_id = ? AND id = ? AND sender_id = ?').run(chatKey, String(id), senderId);
        return res.changes > 0;
    }
    const res = db.prepare('DELETE FROM messages WHERE chat_id = ? AND id = ?').run(chatKey, String(id));
    return res.changes > 0;
}

function deleteMultipleMessages(chatKey, ids, senderId = null) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    if (senderId) {
        const stmt = db.prepare(`DELETE FROM messages WHERE chat_id = ? AND sender_id = ? AND id IN (${placeholders})`);
        const res = stmt.run(chatKey, senderId, ...ids.map(String));
        return res.changes;
    }
    const stmt = db.prepare(`DELETE FROM messages WHERE chat_id = ? AND id IN (${placeholders})`);
    const res = stmt.run(chatKey, ...ids.map(String));
    return res.changes;
}

function pinMessage(chatKey, id, isPin) {
    const res = db.prepare('UPDATE messages SET is_pinned = ? WHERE chat_id = ? AND id = ?')
        .run(isPin ? 1 : 0, chatKey, String(id));
    return res.changes > 0;
}

function addReaction(chatKey, id, from, emoji) {
    const row = db.prepare('SELECT reactions FROM messages WHERE chat_id = ? AND id = ?').get(chatKey, String(id));
    if (!row) return null;

    let reactions = {};
    try {
        reactions = JSON.parse(row.reactions || '{}');
    } catch (e) {
        reactions = {};
    }

    let existingEmoji = null;
    for (const key in reactions) {
        if (Array.isArray(reactions[key]) && reactions[key].includes(from)) {
            existingEmoji = key;
            reactions[key] = reactions[key].filter(u => u !== from);
            if (reactions[key].length === 0) delete reactions[key];
            break;
        }
    }

    if (existingEmoji !== emoji) {
        if (!reactions[emoji]) reactions[emoji] = [];
        reactions[emoji].push(from);
    }

    db.prepare('UPDATE messages SET reactions = ? WHERE chat_id = ? AND id = ?')
        .run(JSON.stringify(reactions), chatKey, String(id));

    return reactions;
}

function markMessagesAsRead(chatKey, from) {
    const res = db.prepare(`
        UPDATE messages
        SET status = 'read'
        WHERE chat_id = ? AND sender_id != ? AND status != 'read'
    `).run(chatKey, from);
    return res.changes;
}

module.exports = {
    addMessage,
    getMessageById,
    getHistory,
    editMessage,
    deleteMessage,
    deleteMultipleMessages,
    pinMessage,
    addReaction,
    markMessagesAsRead
};
