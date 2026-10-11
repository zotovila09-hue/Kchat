const express = require('express');
const config = require('../config');
const chatsRepo = require('../db/chatsRepo');
const messagesRepo = require('../db/messagesRepo');
const groupsRepo = require('../db/groupsRepo');
const stickersRepo = require('../db/stickersRepo');
const usersRepo = require('../db/usersRepo');
const { requireAuth } = require('../services/authService');
const { isSafeMedia } = require('../services/cryptoService');
const { apiLimiter } = require('../services/rateLimiter');
const KNXProto = require('../../knx-proto');

const router = express.Router();

function sanitizeText(str) {
    if (typeof str !== 'string') return '';
    if (typeof KNXProto !== 'undefined' && KNXProto.sanitize && KNXProto.sanitize.text) {
        return KNXProto.sanitize.text(str);
    }
    return str;
}

router.get('/mychats/:kId', requireAuth, (req, res) => {
    const kId = req.params.kId || req.userKId;
    if (kId !== req.userKId) {
        return res.status(403).json({ success: false, message: 'Доступ к чатам другого пользователя запрещен' });
    }
    const myChats = chatsRepo.getMyChats(kId);
    res.json({ success: true, chats: myChats });
});

router.get('/history', requireAuth, (req, res) => {
    const { kId, targetId, isGroup, limit = 50, before } = req.query;
    const callerId = req.userKId;
    const isGroupChat = (isGroup === 'true');

    if (isGroupChat) {
        const group = groupsRepo.getGroupById(targetId);
        if (!group || !Array.isArray(group.members) || !group.members.includes(callerId)) {
            return res.status(403).json({ success: false, message: 'Доступ к истории группы запрещен: вы не являетесь участником.' });
        }
        const result = messagesRepo.getHistory(targetId, limit, before);
        return res.json({
            success: true,
            history: result.history,
            hasMore: result.hasMore,
            total: result.total
        });
    }

    // Direct chat: ensure caller is participant
    const otherId = (callerId === kId) ? targetId : (callerId === targetId ? kId : null);
    if (!otherId && kId && targetId && callerId !== kId && callerId !== targetId) {
        return res.status(403).json({ success: false, message: 'Доступ к чужой переписке запрещен.' });
    }

    const effectiveTarget = otherId || targetId || kId;
    const chatKey = [callerId, effectiveTarget].sort().join('_');
    const result = messagesRepo.getHistory(chatKey, limit, before);
    res.json({
        success: true,
        history: result.history,
        hasMore: result.hasMore,
        total: result.total
    });
});

router.post('/history/delete', requireAuth, (req, res) => {
    const effectiveKId = req.body.kId || req.userKId;
    const { targetId, isGroup } = req.body;
    if (isGroup) {
        const group = groupsRepo.getGroupById(targetId);
        if (group) {
            if (group.creatorId === effectiveKId) {
                groupsRepo.deleteGroup(targetId);
            } else {
                groupsRepo.removeMember(targetId, effectiveKId);
            }
        }
    } else {
        const chatKey = [effectiveKId, targetId].sort().join('_');
        chatsRepo.deleteChat(chatKey);
    }
    const io = req.app.get('io');
    if (io) {
        io.to(effectiveKId).emit('chatDeleted', { chatKId: targetId });
        if (!isGroup) {
            io.to(targetId).emit('chatDeleted', { chatKId: effectiveKId });
        }
    }
    res.json({ success: true });
});

router.get('/stickers/:kId', (req, res) => {
    const kId = req.params.kId;
    const u = usersRepo.getUserById(kId, false);
    if (u) {
        const allPacks = stickersRepo.getAllPacks();
        const packs = (u.installedPacks || []).map(pId => allPacks[pId]).filter(Boolean);
        res.json({ success: true, packs });
    } else {
        res.json({ success: false });
    }
});

router.post('/group/create', requireAuth, (req, res) => {
    const creatorId = req.body.creatorId || req.userKId;
    const { name, desc, type, avatar } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Укажите название группы' });
    }

    const gId = usersRepo.generateID('g-');
    const safeAvatar = (avatar && isSafeMedia(avatar)) ? avatar : config.DEFAULT_AVATAR;

    const group = groupsRepo.createGroup({
        gId,
        name: sanitizeText(name),
        desc: sanitizeText(desc || ''),
        type: type || 'group',
        creatorId,
        avatar: safeAvatar,
        header: config.DEFAULT_HEADER
    });

    res.json({ success: true, group });
});

router.post('/group/edit', requireAuth, (req, res) => {
    const requesterId = req.body.requesterId || req.userKId;
    const { gId, name, desc, avatar, header } = req.body;
    const group = groupsRepo.getGroupById(gId);

    if (group && group.creatorId === requesterId) {
        const updates = {};
        if (name) updates.name = sanitizeText(name);
        if (desc !== undefined) updates.desc = sanitizeText(desc);
        if (avatar && isSafeMedia(avatar)) updates.avatar = avatar;
        if (header !== undefined && isSafeMedia(header)) updates.header = header;

        const updated = groupsRepo.updateGroup(gId, updates);
        const io = req.app.get('io');
        if (io) {
            io.emit('profileUpdated', {
                kId: gId,
                name: updated.name,
                avatar: updated.avatar,
                header: updated.header,
                bio: updated.desc,
                isGroup: true
            });
        }
        res.json({ success: true, group: updated });
    } else {
        res.status(403).json({ success: false, message: 'Нет прав для редактирования этой группы' });
    }
});

router.post('/group/join', requireAuth, (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { gId } = req.body;
    const group = groupsRepo.getGroupById(gId);
    if (group && !group.members.includes(kId)) {
        const updated = groupsRepo.addMember(gId, kId);
        res.json({ success: true, group: updated });
    } else {
        res.json({ success: false, message: 'Группа не найдена или вы уже являетесь участником' });
    }
});

module.exports = router;
