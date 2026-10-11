const express = require('express');
const bcrypt = require('bcrypt');
const usersRepo = require('../db/usersRepo');
const invitesRepo = require('../db/invitesRepo');
const authService = require('../services/authService');
const botService = require('../services/botService');
const { authLimiter } = require('../services/rateLimiter');

const router = express.Router();

router.post('/invite/verify', authLimiter, (req, res) => {
    let { inviteCode } = req.body;
    if (!inviteCode || typeof inviteCode !== 'string') {
        return res.json({ success: false, message: 'Введите код приглашения.' });
    }

    inviteCode = inviteCode.trim();
    if (inviteCode.includes('invite=')) {
        inviteCode = inviteCode.split('invite=')[1].split('&')[0];
    } else if (inviteCode.includes('code=')) {
        inviteCode = inviteCode.split('code=')[1].split('&')[0];
    }
    inviteCode = inviteCode.replace(/[#?]/g, '').trim().toUpperCase();

    const invite = invitesRepo.getInviteByCode(inviteCode);
    if (!invite) {
        return res.json({ success: false, message: 'Неверный или несуществующий код приглашения.' });
    }

    if (!invite.unlimited && invite.maxUses && invite.usedCount >= invite.maxUses) {
        return res.json({ success: false, message: 'Лимит активаций для этого приглашения исчерпан.' });
    }

    invitesRepo.incrementUsedCount(invite.code);

    return res.json({
        success: true,
        message: `Приглашение [${invite.title || invite.code}] успешно активировано!`,
        code: invite.code,
        tier: invite.tier || 'beta',
        title: invite.title || 'Участник',
        description: invite.description || ''
    });
});

router.get('/invite/active', (req, res) => {
    const primary = invitesRepo.getPrimaryInvite();
    res.json({ success: true, code: primary.code });
});

router.post('/register', authLimiter, async (req, res) => {
    try {
        const { name, email, password, sessionId, inviteCode } = req.body;
        if (!email || !password || !name) {
            return res.json({ success: false, message: 'Заполните все обязательные поля.' });
        }

        const existing = usersRepo.getUserByEmail(email);
        if (existing) {
            return res.json({ success: false, message: 'Эта почта уже занята.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const kId = usersRepo.generateID();

        let userTier = 'beta';
        let isDevFlag = usersRepo.isDev(email);
        let isVipFlag = false;

        if (inviteCode) {
            const cleanInv = String(inviteCode).trim().toUpperCase();
            const foundInv = invitesRepo.getInviteByCode(cleanInv);
            if (foundInv) {
                userTier = foundInv.tier || 'beta';
                if (userTier === 'dev') isDevFlag = true;
                if (userTier === 'vip') isVipFlag = true;
                if (!foundInv.unlimited) {
                    invitesRepo.incrementUsedCount(foundInv.code);
                }
            }
        }

        const newUser = {
            kId,
            name,
            email,
            password: hashedPassword,
            role: userTier,
            isDev: isDevFlag,
            isVip: isVipFlag,
            blocked: [],
            folders: [],
            archived: [],
            installedPacks: []
        };

        const createdUser = usersRepo.createUser(newUser);
        const io = req.app.get('io');
        const sessionInfo = authService.registerUserSession(createdUser, req, sessionId, io, botService);

        res.json({
            success: true,
            user: { ...createdUser, isDev: isDevFlag, isVip: isVipFlag },
            sessionId: sessionInfo.sessionId,
            token: sessionInfo.token
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Внутренняя ошибка при регистрации.' });
    }
});

router.post('/forgot-kid', authLimiter, (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false, message: 'Почта не указана.' });
    const user = usersRepo.getUserByEmail(email);
    if (user) {
        res.json({ success: true, kId: user.kId });
    } else {
        res.json({ success: false, message: 'Почта не найдена.' });
    }
});

router.post('/login', authLimiter, async (req, res) => {
    try {
        const { kId, password, isAuto, sessionId } = req.body;
        if (!kId || !password) {
            return res.json({ success: false, message: 'Укажите K-ID и пароль' });
        }

        const user = usersRepo.getUserById(kId, true);
        if (user) {
            if (user.isBot) {
                return res.json({ success: false, message: 'Вход в сервисные аккаунты ботов запрещен.' });
            }

            const match = await bcrypt.compare(password, user.password);
            if (match) {
                const devStatus = usersRepo.isDev(user.email, user);
                const vipStatus = user.isVip || user.role === 'vip';
                const io = req.app.get('io');

                if (isAuto) {
                    const sessionInfo = authService.registerUserSession(user, req, sessionId, io, botService);
                    return res.json({
                        success: true,
                        user: { ...user, isDev: devStatus, isVip: vipStatus },
                        sessionId: sessionInfo.sessionId,
                        token: sessionInfo.token
                    });
                }

                if (user.twoFactorEnabled && user.twoFactorPassword) {
                    return res.json({
                        success: true,
                        requiresCloud2FA: true,
                        hint: user.twoFactorHint || ''
                    });
                }

                const sessionInfo = authService.registerUserSession(user, req, sessionId, io, botService);
                return res.json({
                    success: true,
                    user: { ...user, isDev: devStatus, isVip: vipStatus },
                    sessionId: sessionInfo.sessionId,
                    token: sessionInfo.token
                });
            }
        }

        res.json({ success: false, message: 'Неверный K-ID или пароль' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Ошибка при входе' });
    }
});

router.post('/login/cloud-verify', authLimiter, async (req, res) => {
    try {
        const { kId, password, cloudPassword, sessionId } = req.body;
        const user = usersRepo.getUserById(kId, true);

        if (user && !user.isBot && await bcrypt.compare(password, user.password)) {
            if (user.twoFactorEnabled && user.twoFactorPassword) {
                const cloudMatch = await bcrypt.compare(cloudPassword || '', user.twoFactorPassword);
                if (!cloudMatch) {
                    return res.json({ success: false, message: 'Неверный облачный пароль' });
                }
            }

            const io = req.app.get('io');
            const sessionInfo = authService.registerUserSession(user, req, sessionId, io, botService);
            const devStatus = usersRepo.isDev(user.email, user);
            const vipStatus = user.isVip || user.role === 'vip';

            return res.json({
                success: true,
                user: { ...user, isDev: devStatus, isVip: vipStatus },
                sessionId: sessionInfo.sessionId,
                token: sessionInfo.token
            });
        }

        res.json({ success: false, message: 'Ошибка авторизации' });
    } catch (err) {
        console.error('Cloud 2FA login error:', err);
        res.status(500).json({ success: false, message: 'Ошибка авторизации' });
    }
});

module.exports = router;
