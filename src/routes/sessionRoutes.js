const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const usersRepo = require('../db/usersRepo');
const sessionsRepo = require('../db/sessionsRepo');
const authService = require('../services/authService');
const botService = require('../services/botService');
const { requireAuth } = require('../services/authService');
const { authLimiter } = require('../services/rateLimiter');

const router = express.Router();

const pendingQRLogins = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [token, item] of pendingQRLogins.entries()) {
        if (now > item.expiresAt) {
            pendingQRLogins.delete(token);
        }
    }
}, 30000);

router.get('/sessions/:kId', requireAuth, (req, res) => {
    const kId = req.params.kId || req.userKId;
    const { currentSessionId } = req.query;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    const sessions = sessionsRepo.getSessionsByUserId(kId);
    // Secure session output: Never expose secret auth tokens to API consumers!
    const list = sessions.map(s => ({
        id: s.id,
        userKId: s.userKId,
        name: s.name,
        app: s.app,
        icon: s.icon,
        ip: s.ip,
        location: s.location,
        loginDate: s.loginDate,
        date: s.loginDate,
        lastActive: s.lastActive,
        userAgent: s.userAgent,
        isCurrent: s.id === (currentSessionId || req.session?.id)
    }));
    res.json({ success: true, sessions: list });
});

router.post('/sessions/terminate', requireAuth, (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { sessionId, terminateAllOthers, allOthers, currentSessionId } = req.body;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    const isAllOthers = terminateAllOthers || allOthers;
    const keepSessionId = currentSessionId || (req.session && req.session.id) || sessionId;
    const io = req.app.get('io');

    if (isAllOthers) {
        const result = sessionsRepo.deleteAllOtherSessions(kId, keepSessionId);
        if (io) {
            io.to(kId).emit('sessionTerminated', {
                allOthers: true,
                exceptSessionId: keepSessionId,
                sessionId: keepSessionId,
                terminatedSessionIds: result.terminatedIds
            });
        }
        const safeSessions = result.remainingSessions.map(s => ({
            id: s.id,
            userKId: s.userKId,
            name: s.name,
            app: s.app,
            icon: s.icon,
            ip: s.ip,
            location: s.location,
            loginDate: s.loginDate,
            date: s.loginDate,
            lastActive: s.lastActive,
            isCurrent: s.id === keepSessionId
        }));
        return res.json({ success: true, sessions: safeSessions });
    }

    const remaining = sessionsRepo.deleteSession(kId, sessionId);
    if (io) {
        io.to(kId).emit('sessionTerminated', {
            allOthers: false,
            sessionId: sessionId,
            terminatedSessionIds: [sessionId]
        });
    }
    const safeRemaining = remaining.map(s => ({
        id: s.id,
        userKId: s.userKId,
        name: s.name,
        app: s.app,
        icon: s.icon,
        ip: s.ip,
        location: s.location,
        loginDate: s.loginDate,
        date: s.loginDate,
        lastActive: s.lastActive,
        isCurrent: s.id === (currentSessionId || req.session?.id)
    }));
    res.json({ success: true, sessions: safeRemaining });
});

router.post('/qr/create', (req, res) => {
    const qrToken = 'knx_qr_' + crypto.randomBytes(20).toString('hex');
    const ua = req.headers['user-agent'] || '';
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const deviceInfo = authService.parseDeviceInfo(ua);
    const ttlSeconds = 120;
    const expiresAt = Date.now() + (ttlSeconds * 1000);

    pendingQRLogins.set(qrToken, {
        qrToken,
        status: 'waiting',
        createdAt: Date.now(),
        expiresAt,
        clientIp: ip,
        deviceInfo
    });

    res.json({
        success: true,
        qrToken,
        expiresAt,
        ttl: ttlSeconds,
        qrUrl: `knx://login?token=${qrToken}`
    });
});

router.get('/qr/check/:qrToken', (req, res) => {
    const { qrToken } = req.params;
    const item = pendingQRLogins.get(qrToken);

    if (!item) {
        return res.json({ success: false, status: 'invalid', message: 'QR-код недействителен или истек' });
    }

    if (Date.now() > item.expiresAt) {
        pendingQRLogins.delete(qrToken);
        return res.json({ success: false, status: 'expired', message: 'Время действия QR-кода истекло' });
    }

    if (item.status === 'confirmed') {
        const result = {
            success: true,
            status: 'confirmed',
            kId: item.kId,
            user: item.userData,
            token: item.sessionToken,
            sessionId: item.sessionId
        };
        pendingQRLogins.delete(qrToken);
        return res.json(result);
    }

    const remainingSec = Math.max(0, Math.round((item.expiresAt - Date.now()) / 1000));
    res.json({
        success: true,
        status: 'waiting',
        remaining: remainingSec
    });
});

router.post('/qr/confirm', (req, res) => {
    const { qrToken, kId, sessionToken } = req.body;
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer '))
        ? authHeader.slice(7).trim()
        : (sessionToken || req.headers['x-session-token']);

    if (!qrToken || !kId) {
        return res.status(400).json({ success: false, message: 'Не указаны данные для подтверждения' });
    }

    if (!token || !authService.verifyUserToken(kId, token)) {
        return res.status(401).json({ success: false, message: 'Недействительный или отсутствующий сессионный токен' });
    }

    const user = usersRepo.getUserById(kId, false);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    let cleanToken = String(qrToken).trim();
    if (cleanToken.includes('token=')) {
        cleanToken = cleanToken.split('token=')[1].split('&')[0];
    }

    const item = pendingQRLogins.get(cleanToken);
    if (!item) {
        return res.status(404).json({ success: false, message: 'QR-код не найден или устарел' });
    }

    if (Date.now() > item.expiresAt) {
        pendingQRLogins.delete(cleanToken);
        return res.status(410).json({ success: false, message: 'QR-код истек' });
    }

    if (item.status === 'confirmed') {
        return res.status(409).json({ success: false, message: 'Этот QR-код уже был использован' });
    }

    const newSessionId = 'sess_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const newAuthToken = crypto.randomBytes(32).toString('hex');
    const targetDevInfo = item.deviceInfo || authService.parseDeviceInfo(req.headers['user-agent'] || '');

    const newSession = {
        id: newSessionId,
        userKId: kId,
        token: newAuthToken,
        name: targetDevInfo.name || 'KNX Web Client',
        app: targetDevInfo.app || 'KNX Web (Вход по QR)',
        icon: targetDevInfo.icon || 'desktop',
        ip: item.clientIp || '127.0.0.1',
        location: 'Онлайн • ' + (targetDevInfo.icon === 'mobile' ? 'Мобильное устройство' : 'Компьютер'),
        loginDate: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        lastActive: Date.now(),
        userAgent: req.headers['user-agent'] || ''
    };

    sessionsRepo.createSession(newSession);

    const safeUserData = {
        kId: user.kId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        theme: user.theme || 'light',
        lang: user.lang || 'ru',
        isDev: usersRepo.isDev(user.email, user),
        installedPacks: user.installedPacks || [],
        folders: user.folders || [],
        hideKid: user.hideKid,
        hideAvatar: user.hideAvatar,
        hideHeader: user.hideHeader,
        hideBio: user.hideBio,
        twoFactorEnabled: user.twoFactorEnabled || false
    };

    item.status = 'confirmed';
    item.kId = kId;
    item.userData = safeUserData;
    item.sessionToken = newAuthToken;
    item.sessionId = newSessionId;

    const io = req.app.get('io');
    if (io) {
        io.to('qr_' + cleanToken).emit('qr_login_success', {
            success: true,
            user: safeUserData,
            token: newAuthToken,
            sessionId: newSessionId
        });

        const safeSessionBroadcast = { ...newSession };
        delete safeSessionBroadcast.token;
        io.to(kId).emit('sessionAdded', safeSessionBroadcast);

        botService.sendSystemBotMessage('knx_support', kId,
            `🔔 Предупреждение безопасности\n\n` +
            `Авторизовано новое устройство по QR-коду:\n` +
            `• Устройство: ${newSession.name}\n` +
            `• Приложение: ${newSession.app}\n` +
            `• IP-адрес: ${newSession.ip}\n` +
            `• Дата: ${newSession.loginDate}\n\n` +
            `Если это были не вы, немедленно перейдите в Настройки → Устройства и завершите сеанс.`,
            null,
            io
        );
    }

    res.json({
        success: true,
        message: 'Устройство успешно авторизовано!',
        device: newSession.name
    });
});

router.get('/security/2fa/status/:kId', (req, res) => {
    const user = usersRepo.getUserById(req.params.kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    res.json({
        success: true,
        enabled: !!user.twoFactorEnabled,
        twoFactorEnabled: !!user.twoFactorEnabled,
        hint: user.twoFactorHint || ''
    });
});

router.post('/security/2fa/set', requireAuth, authLimiter, async (req, res) => {
    const kId = req.body.kId || req.userKId;
    const { mainPassword, newCloudPassword, cloudPassword, hint, disable, enabled } = req.body;
    const user = usersRepo.getUserById(kId, false);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    if (!mainPassword) {
        return res.status(400).json({ success: false, message: 'Введите основной пароль для подтверждения' });
    }

    const match = await bcrypt.compare(mainPassword, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Неверный основной пароль' });

    const shouldDisable = disable === true || enabled === false;
    if (shouldDisable) {
        usersRepo.update2FA(kId, false, null, '');
        return res.json({ success: true, message: 'Двухфакторная аутентификация отключена' });
    }

    const pwd = newCloudPassword || cloudPassword;
    if (!pwd || pwd.length < 4) {
        return res.status(400).json({ success: false, message: 'Облачный пароль должен содержать от 4 символов' });
    }

    const hashedCloud = await bcrypt.hash(pwd, 10);
    usersRepo.update2FA(kId, true, hashedCloud, hint || '');
    res.json({ success: true, message: 'Двухфакторная аутентификация успешно включена!' });
});

module.exports = router;
