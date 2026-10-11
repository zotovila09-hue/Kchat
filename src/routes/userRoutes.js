const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../db/database');
const usersRepo = require('../db/usersRepo');
const groupsRepo = require('../db/groupsRepo');
const chatsRepo = require('../db/chatsRepo');
const { isSafeMedia } = require('../services/cryptoService');
const { requireAuth, verifyUserToken } = require('../services/authService');
const KNXProto = require('../../knx-proto');

const router = express.Router();

function sanitizeText(str) {
    if (typeof str !== 'string') return '';
    if (typeof KNXProto !== 'undefined' && KNXProto.sanitize && KNXProto.sanitize.text) {
        return KNXProto.sanitize.text(str);
    }
    return str;
}

function checkUserOnline(kId, io, user = null) {
    const u = user || usersRepo.getUserById(kId, false);
    if (u && (u.showOnlineStatus === false || u.hideOnline === true)) {
        return false;
    }
    if (!io) return false;
    const room = io.sockets.adapter.rooms.get(kId);
    return !!room && room.size > 0;
}

router.get('/profile/:id', (req, res) => {
    const id = req.params.id;
    const requesterId = req.query.requester;
    const io = req.app.get('io');

    const u = usersRepo.getUserById(id, false);
    if (u) {
        const isBlockedByTarget = Array.isArray(u.blocked) && u.blocked.some(b => b.kId === requesterId);
        if (isBlockedByTarget && id !== requesterId) {
            return res.json({
                success: true,
                type: 'user',
                data: {
                    kId: 'Скрыто',
                    name: 'Пользователь',
                    avatar: config.DEFAULT_AVATAR,
                    header: config.DEFAULT_HEADER,
                    bio: 'Скрыто настройками',
                    searchable: false,
                    isOnline: false,
                    isBlockedMe: true
                }
            });
        }

        const devStatus = usersRepo.isDev(u.email, u);
        const vipStatus = u.isVip || u.role === 'vip';

        if (id === requesterId) {
            return res.json({
                success: true,
                type: 'user',
                data: {
                    kId: u.kId,
                    name: u.name,
                    avatar: u.avatar,
                    header: u.header,
                    bio: u.bio || '',
                    hobbies: u.hobbies || '',
                    birthDate: u.birthDate || '',
                    searchable: u.searchable,
                    isOnline: true,
                    isBlockedMe: false,
                    isBot: u.isBot,
                    isDev: devStatus,
                    isVip: vipStatus
                }
            });
        }

        const publicData = {
            kId: u.hideKid ? 'Скрыто' : u.kId,
            name: u.name,
            avatar: u.hideAvatar ? config.DEFAULT_AVATAR : u.avatar,
            header: u.hideHeader ? config.DEFAULT_HEADER : u.header,
            bio: u.hideBio ? 'Скрыто настройками' : (u.bio || ''),
            hobbies: u.hobbies || '',
            birthDate: u.birthDate || '',
            searchable: u.searchable,
            isOnline: checkUserOnline(id, io, u),
            isBlockedMe: false,
            isBot: u.isBot,
            isDev: devStatus,
            isVip: vipStatus
        };

        return res.json({ success: true, type: 'user', data: publicData });
    }

    const g = groupsRepo.getGroupById(id);
    if (g) {
        return res.json({
            success: true,
            type: 'group',
            data: {
                kId: g.gId,
                name: g.name,
                avatar: g.avatar,
                header: g.header,
                members: g.members,
                bio: g.desc,
                groupType: g.type,
                creatorId: g.creatorId
            }
        });
    }

    res.status(404).json({ success: false, message: 'Профиль не найден' });
});

router.post('/user/delete-account', requireAuth, async (req, res) => {
    try {
        const kId = req.body.kId || req.userKId;
        const { password, cloudPassword } = req.body;
        const authHeader = req.headers['authorization'];
        const token = (authHeader && authHeader.startsWith('Bearer '))
            ? authHeader.slice(7).trim()
            : (req.body.token || req.headers['x-session-token']);

        const user = usersRepo.getUserById(kId, false);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }

        if (!token || !verifyUserToken(kId, token)) {
            return res.status(401).json({ success: false, message: 'Сессия недействительна' });
        }

        if (!password) {
            return res.status(400).json({ success: false, message: 'Введите пароль для подтверждения удаления' });
        }

        const passMatch = await bcrypt.compare(password, user.password);
        if (!passMatch) {
            return res.status(401).json({ success: false, message: 'Неверный пароль от аккаунта' });
        }

        if (user.twoFactorEnabled && user.twoFactorPassword) {
            if (!cloudPassword) {
                return res.status(400).json({ success: false, message: 'Введите облачный пароль (2FA)' });
            }
            const cloudMatch = await bcrypt.compare(cloudPassword, user.twoFactorPassword);
            if (!cloudMatch) {
                return res.status(401).json({ success: false, message: 'Неверный облачный пароль (2FA)' });
            }
        }

        const io = req.app.get('io');
        if (io) {
            io.to(kId).emit('accountDeleted', { message: 'Ваш аккаунт был успешно удален.' });
        }

        // Clean up group memberships and ownership
        const allGroups = groupsRepo.getAllGroupsMap();
        for (const gId in allGroups) {
            const grp = allGroups[gId];
            if (grp.creatorId === kId) {
                const remaining = (grp.members || []).filter(id => id !== kId);
                if (remaining.length > 0) {
                    groupsRepo.updateGroup(gId, { creatorId: remaining[0] });
                    groupsRepo.removeMember(gId, kId);
                } else {
                    groupsRepo.deleteGroup(gId);
                }
            } else if (grp.members && grp.members.includes(kId)) {
                groupsRepo.removeMember(gId, kId);
            }
        }

        // Remove any residual group_members entries
        try {
            db.prepare('DELETE FROM group_members WHERE user_k_id = ?').run(kId);
        } catch (e) {}

        // Delete user's 1-on-1 chats and notify peers
        const myChats = chatsRepo.getMyChats(kId);
        for (const chat of myChats) {
            if (!chat.isGroup) {
                const chatKey = [kId, chat.id].sort().join('_');
                chatsRepo.deleteChat(chatKey);
                if (io) {
                    io.to(chat.id).emit('chatDeleted', { chatKId: kId });
                }
            }
        }

        // Delete user record from DB
        usersRepo.deleteUser(kId);

        if (io) {
            const sockets = await io.in(kId).fetchSockets();
            sockets.forEach(s => s.disconnect(true));
        }

        res.json({ success: true, message: 'Аккаунт и все персональные данные полностью удалены.' });
    } catch (err) {
        console.error('Error deleting account:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера при удалении аккаунта' });
    }
});

router.post('/settings/customize', requireAuth, (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { name, theme, lang, avatar, header, bio, hobbies, birthDate, chatBg, soundEnabled, folders, archived } = req.body;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    const updates = {};
    if (name) updates.name = sanitizeText(name);
    if (theme) updates.theme = theme;
    if (lang) updates.lang = lang;
    if (avatar && isSafeMedia(avatar)) updates.avatar = avatar;
    if (header !== undefined && isSafeMedia(header)) updates.header = header;
    if (bio !== undefined) updates.bio = sanitizeText(bio);
    if (hobbies !== undefined) updates.hobbies = sanitizeText(hobbies);
    if (birthDate !== undefined) updates.birthDate = sanitizeText(birthDate);
    if (chatBg !== undefined && isSafeMedia(chatBg)) updates.chatBg = chatBg;
    if (soundEnabled !== undefined) updates.soundEnabled = soundEnabled;
    if (folders !== undefined) updates.folders = folders;
    if (archived !== undefined) updates.archived = archived;

    const updatedUser = usersRepo.updateUser(kId, updates);
    const io = req.app.get('io');
    if (io) {
        io.to(kId).emit('profileSync', { user: updatedUser, kId });
        io.emit('profileUpdated', {
            kId,
            name: updatedUser.name,
            avatar: updatedUser.hideAvatar ? config.DEFAULT_AVATAR : updatedUser.avatar,
            header: updatedUser.hideHeader ? config.DEFAULT_HEADER : updatedUser.header,
            bio: updatedUser.hideBio ? 'Скрыто' : updatedUser.bio,
            hobbies: updatedUser.hobbies || '',
            birthDate: updatedUser.birthDate || '',
            isGroup: false
        });
    }

    res.json({ success: true, user: updatedUser });
});

router.post('/settings/privacy', requireAuth, (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { searchable, hideAvatar, hideHeader, hideBio, hideKid, showOnlineStatus, readReceipts, privPhone, privLast, privCalls, sessionTtl, screenshotAlerts } = req.body;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    const updates = {};
    if (searchable !== undefined) updates.searchable = searchable;
    if (hideAvatar !== undefined) updates.hideAvatar = hideAvatar;
    if (hideHeader !== undefined) updates.hideHeader = hideHeader;
    if (hideBio !== undefined) updates.hideBio = hideBio;
    if (hideKid !== undefined) updates.hideKid = hideKid;
    if (showOnlineStatus !== undefined) updates.showOnlineStatus = showOnlineStatus;
    if (privPhone !== undefined) updates.privPhone = privPhone;
    if (privLast !== undefined) updates.privLast = privLast;
    if (privCalls !== undefined) updates.privCalls = privCalls;
    if (sessionTtl !== undefined) updates.sessionTtl = sessionTtl;
    if (screenshotAlerts !== undefined) updates.screenshotAlerts = screenshotAlerts;

    if (readReceipts !== undefined) {
        const isVipOrDev = user.isVip || user.role === 'vip' || usersRepo.isDev(user.email, user);
        if (isVipOrDev) {
            updates.readReceipts = readReceipts;
        }
    }

    const updatedUser = usersRepo.updateUser(kId, updates);
    const io = req.app.get('io');
    if (io) {
        io.to(kId).emit('profileSync', { user: updatedUser, kId });
        io.emit('profileUpdated', {
            kId,
            name: updatedUser.name,
            avatar: updatedUser.hideAvatar ? config.DEFAULT_AVATAR : updatedUser.avatar,
            header: updatedUser.hideHeader ? config.DEFAULT_HEADER : updatedUser.header,
            bio: updatedUser.hideBio ? 'Скрыто' : updatedUser.bio,
            hobbies: updatedUser.hobbies || '',
            birthDate: updatedUser.birthDate || '',
            isGroup: false
        });
    }

    res.json({ success: true, user: updatedUser });
});

router.post('/settings/password', requireAuth, async (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { oldPassword, newPassword } = req.body;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Укажите старый и новый пароль' });
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (match) {
        const hashed = await bcrypt.hash(newPassword, 10);
        usersRepo.updatePassword(kId, hashed);
        return res.json({ success: true, message: 'Пароль успешно изменен' });
    }

    res.json({ success: false, message: 'Неверный текущий пароль' });
});

router.post('/settings/block', requireAuth, (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { blockedList } = req.body;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    const updatedUser = usersRepo.updateUser(kId, { blocked: blockedList || [] });
    const io = req.app.get('io');
    if (io) {
        io.to(kId).emit('profileSync', { user: updatedUser, kId });
    }
    res.json({ success: true, user: updatedUser });
});

module.exports = router;
