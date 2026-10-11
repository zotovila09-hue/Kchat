const crypto = require('crypto');
const sessionsRepo = require('../db/sessionsRepo');
const usersRepo = require('../db/usersRepo');

function parseDeviceInfo(userAgent = '') {
    let name = 'Web Browser';
    let icon = 'desktop';
    let app = 'KNX Web v2.5';

    if (/iPhone/i.test(userAgent)) {
        name = 'iPhone';
        icon = 'mobile';
        app = 'KNX Mobile (iOS)';
    } else if (/iPad/i.test(userAgent)) {
        name = 'iPad';
        icon = 'tablet';
        app = 'KNX Mobile (iPadOS)';
    } else if (/Android/i.test(userAgent)) {
        name = /Mobile/i.test(userAgent) ? 'Android Смартфон' : 'Android Планшет';
        icon = 'mobile';
        app = 'KNX Mobile (Android)';
    } else if (/Macintosh|Mac OS X/i.test(userAgent)) {
        name = 'macOS (MacBook/iMac)';
        icon = 'desktop';
        app = 'KNX Web / Desktop';
    } else if (/Windows NT/i.test(userAgent)) {
        name = 'Windows ПК';
        icon = 'desktop';
        app = 'KNX Web / Desktop';
    } else if (/Linux/i.test(userAgent)) {
        name = 'Linux ПК';
        icon = 'desktop';
        app = 'KNX Web / Desktop';
    }

    if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) name += ' • Chrome';
    else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) name += ' • Safari';
    else if (/Firefox/i.test(userAgent)) name += ' • Firefox';
    else if (/Edg/i.test(userAgent)) name += ' • Edge';

    return { name, icon, app };
}

function registerUserSession(user, req, sessionId = null, io = null, botService = null) {
    const kId = user.kId;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const ua = req.headers['user-agent'] || '';
    const info = parseDeviceInfo(ua);

    const sId = sessionId || ('sess_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'));
    const token = crypto.randomBytes(32).toString('hex');

    const existingSessions = sessionsRepo.getSessionsByUserId(kId);
    let existing = existingSessions.find(s => s.id === sId);
    let isNewDevice = false;

    if (existing) {
        if (existing.userAgent && existing.userAgent !== ua) {
            isNewDevice = true;
        }
        sessionsRepo.updateSession(sId, {
            lastActive: Date.now(),
            ip: clientIp,
            name: info.name,
            app: info.app,
            icon: info.icon,
            userAgent: ua
        });
    } else {
        const hasExistingSessions = existingSessions.length > 0;
        const knownUserAgents = existingSessions.map(s => s.userAgent).filter(Boolean);
        if (hasExistingSessions && (!ua || !knownUserAgents.includes(ua))) {
            isNewDevice = true;
        }

        const newSession = {
            id: sId,
            userKId: kId,
            token: token,
            name: info.name,
            app: info.app,
            icon: info.icon,
            ip: clientIp,
            location: 'Онлайн • ' + (info.icon === 'mobile' ? 'Мобильное устройство' : 'Компьютер'),
            loginDate: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            lastActive: Date.now(),
            userAgent: ua
        };

        existing = sessionsRepo.createSession(newSession);

        if (hasExistingSessions && io) {
            // Do not leak token over socket broadcast
            const safeBroadcast = { ...existing };
            delete safeBroadcast.token;
            io.to(kId).emit('sessionAdded', safeBroadcast);
        }
    }

    if (isNewDevice && botService && io) {
        const alertMsg = `🔔 Предупреждение безопасности\n\n` +
            `Выполнен вход в аккаунт с нового устройства:\n` +
            `• Устройство: ${info.name}\n` +
            `• Приложение: ${info.app}\n` +
            `• IP-адрес: ${clientIp}\n` +
            `• Дата: ${existing.loginDate}\n\n` +
            `Если это были не вы, немедленно завершите этот сеанс в Настройки → Устройства.`;

        setTimeout(() => {
            botService.sendSystemBotMessage('knx_support', kId, alertMsg, null, io);
            io.to(kId).emit('securityAlert', {
                type: 'new_device_login',
                title: 'Вход с нового устройства',
                message: `${info.name} (${info.app})`,
                device: info.name,
                ip: clientIp,
                date: existing.loginDate
            });
        }, 200);
    }

    return { sessionId: sId, token: existing.token || token };
}

function verifyUserToken(kId, token) {
    return sessionsRepo.verifyUserToken(kId, token);
}

function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer '))
        ? authHeader.slice(7).trim()
        : (req.headers['x-session-token'] || req.body?.token || req.query?.token);

    if (!token) {
        return res.status(401).json({ success: false, message: 'Требуется авторизация: сессионный токен отсутствует.' });
    }

    const session = sessionsRepo.getSessionByToken(token);
    if (!session) {
        return res.status(401).json({ success: false, message: 'Сессия недействительна или завершена.' });
    }

    // Attach verified user credentials to request
    req.userKId = session.userKId;
    req.session = session;

    // Anti-spoofing validation: if an actor ID is explicitly claimed in body/params/query, it MUST match the session owner
    const claimedKId = req.body?.kId || req.params?.kId || req.query?.kId || req.body?.requesterId || req.body?.creatorId;
    if (claimedKId && claimedKId !== session.userKId) {
        return res.status(403).json({ success: false, message: 'Доступ запрещен: попытка несанкционированного действия от имени другого пользователя.' });
    }

    next();
}

module.exports = {
    parseDeviceInfo,
    registerUserSession,
    verifyUserToken,
    requireAuth
};
