const config = require('../config');
const usersRepo = require('../db/usersRepo');
const groupsRepo = require('../db/groupsRepo');
const messagesRepo = require('../db/messagesRepo');
const { encrypt } = require('./cryptoService');
const botService = require('./botService');
const KNXProto = require('../../knx-proto');

const recentReactionEvents = new Map();

function broadcastUnified(io, room, eventName, payload, knxOpcode = null) {
    if (!io) return;
    io.to(room).emit(eventName, payload);
    if (knxOpcode && typeof KNXProto !== 'undefined') {
        try {
            const bin = KNXProto.pack(knxOpcode, payload);
            io.to(room).emit('kp_packet', bin);
        } catch (e) {}
    }
}

function handleIncomingMessage(data, socket, io) {
    const { id, from, to, text, type, timestamp, replyTo, fileName, caption } = data;
    if (!from || !to) return;
    const isGroup = to && to.startsWith('g-');

    if (!isGroup) {
        const toUser = usersRepo.getUserById(to, false);
        if (!toUser) return; // Recipient does not exist
        if (Array.isArray(toUser.blocked) && toUser.blocked.some(b => b.kId === from)) {
            return; // Blocked user cannot send message
        }
    } else {
        const group = groupsRepo.getGroupById(to);
        if (!group) return; // Group does not exist
        if (!Array.isArray(group.members) || !group.members.includes(from)) {
            return; // Non-member cannot post to group
        }
        if (group.type === 'channel' && group.creatorId !== from) {
            return; // Only channel creator can broadcast
        }
    }

    const encryptedText = encrypt(text);
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    const msgObj = {
        id: String(id),
        chatId: chatKey,
        senderId: from,
        text: encryptedText,
        type: type || 'text',
        timestamp: timestamp || Date.now(),
        status: 'sent',
        replyTo: replyTo || null,
        isEdited: false,
        reactions: {},
        fileName: fileName || null,
        caption: caption || null,
        isPinned: false
    };

    messagesRepo.addMessage(msgObj);

    const emitObj = {
        id: String(id),
        from,
        to,
        text,
        type: type || 'text',
        timestamp: msgObj.timestamp,
        status: 'sent',
        isGroup: !!isGroup,
        replyTo: replyTo || null,
        isEdited: false,
        reactions: {},
        fileName: fileName || null,
        caption: caption || null,
        isPinned: false
    };

    if (isGroup) {
        const group = groupsRepo.getGroupById(to);
        if (group) {
            group.members.forEach(memberId => {
                broadcastUnified(io, memberId, 'newMessage', emitObj, KNXProto.OPCODES.MSG_RECV);
            });
        }
    } else {
        broadcastUnified(io, to, 'newMessage', emitObj, KNXProto.OPCODES.MSG_RECV);
        broadcastUnified(io, from, 'newMessage', emitObj, KNXProto.OPCODES.MSG_RECV);

        if (to === config.BOT_STI) {
            botService.handleStickerBotMessage(from, text, type, io);
        }
    }
}

function handleEditMessage(data, socket, io) {
    const { id, from, to, newText } = data;
    if (!id || !from || !to) return;
    const isGroup = to && to.startsWith('g-');
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    const encrypted = encrypt(newText);
    const updated = messagesRepo.editMessage(chatKey, id, from, encrypted);

    if (updated) {
        const emitObj = { id: String(id), from, to, newText, isGroup: !!isGroup };
        if (isGroup) {
            const group = groupsRepo.getGroupById(to);
            if (group) {
                group.members.forEach(memberId => {
                    broadcastUnified(io, memberId, 'messageEdited', emitObj, KNXProto.OPCODES.MSG_EDIT);
                });
            }
        } else {
            broadcastUnified(io, to, 'messageEdited', emitObj, KNXProto.OPCODES.MSG_EDIT);
            broadcastUnified(io, from, 'messageEdited', emitObj, KNXProto.OPCODES.MSG_EDIT);
        }
    }
}

function handleDeleteMessage(data, socket, io) {
    const { id, from, to } = data;
    if (!id || !from || !to) return;
    const isGroup = to && to.startsWith('g-');
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    const msg = messagesRepo.getMessageById(chatKey, id);
    if (!msg) return;

    // Check authorization: only message author or group owner can delete
    if (isGroup) {
        const group = groupsRepo.getGroupById(to);
        const isOwner = group && group.creatorId === from;
        const isAuthor = msg.senderId === from;
        if (!isOwner && !isAuthor) return;
    } else {
        // In 1-on-1 chat, must be participant
        if (from !== msg.senderId && from !== to) return;
    }

    const deleted = messagesRepo.deleteMessage(chatKey, id);
    if (deleted) {
        const emitObj = { id: String(id), from, to, isGroup: !!isGroup };
        if (isGroup) {
            const group = groupsRepo.getGroupById(to);
            if (group) {
                group.members.forEach(memberId => {
                    broadcastUnified(io, memberId, 'messageDeleted', emitObj, KNXProto.OPCODES.MSG_DELETE);
                });
            }
        } else {
            broadcastUnified(io, to, 'messageDeleted', emitObj, KNXProto.OPCODES.MSG_DELETE);
            broadcastUnified(io, from, 'messageDeleted', emitObj, KNXProto.OPCODES.MSG_DELETE);
        }
    }
}

function handleDeleteMultipleMessages(data, socket, io) {
    const { ids, from, to } = data;
    if (!ids || !Array.isArray(ids) || ids.length === 0 || !from || !to) return;
    const isGroup = to && to.startsWith('g-');
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    let allowedIds = ids;
    if (isGroup) {
        const group = groupsRepo.getGroupById(to);
        const isOwner = group && group.creatorId === from;
        if (!isOwner) {
            // Non-owner can only delete own messages
            allowedIds = ids.filter(id => {
                const m = messagesRepo.getMessageById(chatKey, id);
                return m && m.senderId === from;
            });
        }
    }

    if (allowedIds.length === 0) return;

    const count = messagesRepo.deleteMultipleMessages(chatKey, allowedIds);
    if (count > 0) {
        const emitObj = { ids: allowedIds.map(String), from, to, isGroup: !!isGroup };
        if (isGroup) {
            const group = groupsRepo.getGroupById(to);
            if (group) {
                group.members.forEach(memberId => {
                    io.to(memberId).emit('messagesMultipleDeleted', emitObj);
                });
            }
        } else {
            io.to(to).emit('messagesMultipleDeleted', emitObj);
            io.to(from).emit('messagesMultipleDeleted', emitObj);
        }
    }
}

function handlePinMessage(data, socket, io) {
    const { id, from, to, isPin } = data;
    if (!id || !from || !to) return;
    const isGroup = to && to.startsWith('g-');
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    const msg = messagesRepo.getMessageById(chatKey, id);
    if (msg) {
        messagesRepo.pinMessage(chatKey, id, isPin);
        const emitObj = {
            id: String(id),
            from,
            to,
            isGroup: !!isGroup,
            isPin: !!isPin,
            text: msg.type === 'text' ? msg.text : msg.type
        };

        if (isGroup) {
            const group = groupsRepo.getGroupById(to);
            if (group) {
                group.members.forEach(memberId => {
                    broadcastUnified(io, memberId, 'messagePinned', emitObj, KNXProto.OPCODES.MSG_PIN);
                });
            }
        } else {
            broadcastUnified(io, to, 'messagePinned', emitObj, KNXProto.OPCODES.MSG_PIN);
            broadcastUnified(io, from, 'messagePinned', emitObj, KNXProto.OPCODES.MSG_PIN);
        }
    }
}

function handleAddReaction(data, socket, io) {
    const { id, from, to, emoji } = data;
    if (!id || !from || !to || !emoji) return;

    const dedupeKey = `${from}_${id}_${emoji}`;
    const now = Date.now();
    const lastTime = recentReactionEvents.get(dedupeKey);
    if (lastTime && (now - lastTime < 350)) {
        return;
    }
    recentReactionEvents.set(dedupeKey, now);
    if (recentReactionEvents.size > 2000) {
        const firstKey = recentReactionEvents.keys().next().value;
        recentReactionEvents.delete(firstKey);
    }

    const isGroup = to && to.startsWith('g-');
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    const updatedReactions = messagesRepo.addReaction(chatKey, id, from, emoji);
    if (updatedReactions !== null) {
        const emitObj = {
            id: String(id),
            from,
            to,
            isGroup: !!isGroup,
            reactions: updatedReactions
        };

        if (isGroup) {
            const group = groupsRepo.getGroupById(to);
            if (group) {
                group.members.forEach(memberId => {
                    broadcastUnified(io, memberId, 'reactionAdded', emitObj, KNXProto.OPCODES.REACTION);
                    io.to(memberId).emit('reactionUpdated', emitObj);
                });
            }
        } else {
            broadcastUnified(io, to, 'reactionAdded', emitObj, KNXProto.OPCODES.REACTION);
            io.to(to).emit('reactionUpdated', emitObj);
            broadcastUnified(io, from, 'reactionAdded', emitObj, KNXProto.OPCODES.REACTION);
            io.to(from).emit('reactionUpdated', emitObj);
        }
    }
}

function handleMarkRead(data, socket, io) {
    const { from, to } = data;
    if (!from || !to) return;
    const u = usersRepo.getUserById(from, false);
    const isVipOrDev = u && (u.isVip || u.role === 'vip' || usersRepo.isDev(u.email, u));
    if (u && u.readReceipts === false && isVipOrDev) {
        return; // Ghost reading mode
    }

    const isGroup = to && to.startsWith('g-');
    const chatKey = isGroup ? to : [from, to].sort().join('_');

    const changes = messagesRepo.markMessagesAsRead(chatKey, from);
    if (changes > 0) {
        if (isGroup) {
            const group = groupsRepo.getGroupById(to);
            if (group && Array.isArray(group.members)) {
                group.members.forEach(memberId => {
                    broadcastUnified(io, memberId, 'messagesRead', { chatKId: to }, KNXProto.OPCODES.MSG_READ_ACK);
                });
            }
        } else {
            broadcastUnified(io, to, 'messagesRead', { chatKId: from }, KNXProto.OPCODES.MSG_READ_ACK);
        }
    }

    // Cross-device sync: other tabs and devices of user A reset unread badge for this chat
    const targetChatKId = isGroup ? to : to;
    if (io) {
        io.to(from).emit('chatReadSync', { chatKId: targetChatKId });
    }
}

function handleTyping(data, isTyping, socket, io) {
    const { from, to } = data;
    if (!from || !to) return;
    const ev = isTyping ? 'typing' : 'stopTyping';
    const opcode = isTyping ? KNXProto.OPCODES.TYPING : KNXProto.OPCODES.STOP_TYPING;
    const isGroup = to && to.startsWith('g-');

    if (isGroup) {
        const group = groupsRepo.getGroupById(to);
        if (group) {
            group.members.forEach(memberId => {
                if (memberId !== from) {
                    broadcastUnified(io, memberId, ev, { from, to, isGroup: true }, opcode);
                }
            });
        }
    } else {
        broadcastUnified(io, to, ev, { from, to, isGroup: false }, opcode);
    }
}

module.exports = {
    handleIncomingMessage,
    handleEditMessage,
    handleDeleteMessage,
    handleDeleteMultipleMessages,
    handlePinMessage,
    handleAddReaction,
    handleMarkRead,
    handleTyping,
    broadcastUnified
};
