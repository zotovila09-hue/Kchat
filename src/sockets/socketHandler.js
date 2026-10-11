const usersRepo = require('../db/usersRepo');
const authService = require('../services/authService');
const botService = require('../services/botService');
const messageService = require('../services/messageService');
const KNXProto = require('../../knx-proto');

function isUserOnline(kId, io) {
    const u = usersRepo.getUserById(kId, false);
    if (u && (u.showOnlineStatus === false || u.hideOnline === true)) {
        return false;
    }
    const room = io.sockets.adapter.rooms.get(kId);
    return !!room && room.size > 0;
}

function setupSocketIO(io) {
    io.on('connection', (socket) => {
        let currentKId = null;
        socket.authenticated = false;

        socket.on('auth', (data) => {
            let targetKId = null;
            let token = null;

            if (data && typeof data === 'object') {
                targetKId = data.kId;
                token = data.token;
            }

            if (!targetKId || !token) {
                return socket.emit('authError', { message: 'Сессионный токен обязателен для авторизации' });
            }

            const user = usersRepo.getUserById(targetKId, false);
            if (!user) {
                return socket.emit('authError', { message: 'Пользователь не найден' });
            }

            if (!authService.verifyUserToken(targetKId, token)) {
                return socket.emit('authError', { message: 'Недействительный или истекший сессионный токен' });
            }

            socket.join(targetKId);
            currentKId = targetKId;
            socket.kId = targetKId;
            socket.authenticated = true;

            socket.broadcast.emit('userStatusChanged', { kId: targetKId, isOnline: true });
            socket.emit('authSuccess', { kId: targetKId });
        });

        socket.on('qr_listen', (data) => {
            if (data && data.qrToken) {
                let clean = String(data.qrToken).trim();
                if (clean.includes('token=')) clean = clean.split('token=')[1].split('&')[0];
                socket.join('qr_' + clean);
            }
        });

        socket.replayWindow = (KNXProto && KNXProto.createReplayWindow)
            ? KNXProto.createReplayWindow(1000, 300000)
            : null;

        socket.on('kp_packet', (rawBuffer) => {
            try {
                const packet = KNXProto.unpack(rawBuffer);
                if (!packet) return;

                if (socket.replayWindow && !socket.replayWindow.isValid(packet.seq, packet.timestamp)) {
                    return; // Discard replayed or expired packet
                }

                switch (packet.opcode) {
                    case KNXProto.OPCODES.AUTH: {
                        const { kId, token } = packet.payload || {};
                        if (!kId || !token) {
                            const err = KNXProto.pack(KNXProto.OPCODES.ERROR, { message: 'Токен обязателен' }, packet.seq);
                            return socket.emit('kp_packet', err);
                        }
                        const user = usersRepo.getUserById(kId, false);
                        if (!user) {
                            const err = KNXProto.pack(KNXProto.OPCODES.ERROR, { message: 'Пользователь не найден' }, packet.seq);
                            return socket.emit('kp_packet', err);
                        }
                        if (!authService.verifyUserToken(kId, token)) {
                            const err = KNXProto.pack(KNXProto.OPCODES.ERROR, { message: 'Недействительный токен' }, packet.seq);
                            return socket.emit('kp_packet', err);
                        }
                        socket.join(kId);
                        currentKId = kId;
                        socket.kId = kId;
                        socket.authenticated = true;
                        socket.broadcast.emit('userStatusChanged', { kId, isOnline: true });
                        const resp = KNXProto.pack(KNXProto.OPCODES.AUTH_RESP, { success: true, kId }, packet.seq);
                        socket.emit('kp_packet', resp);
                        break;
                    }
                    case KNXProto.OPCODES.PING: {
                        const clientTime = (packet.payload && packet.payload.t) ? packet.payload.t : packet.timestamp;
                        const resp = KNXProto.pack(KNXProto.OPCODES.PONG, { t: clientTime }, packet.seq);
                        socket.emit('kp_packet', resp);
                        break;
                    }
                    case KNXProto.OPCODES.MSG_SEND: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            const ack = KNXProto.pack(KNXProto.OPCODES.ACK, { seq: packet.seq, id: packet.payload.id });
                            socket.emit('kp_packet', ack);
                            messageService.handleIncomingMessage(packet.payload, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.TYPING: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handleTyping(packet.payload, true, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.STOP_TYPING: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handleTyping(packet.payload, false, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.MARK_READ: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handleMarkRead(packet.payload, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.REACTION: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handleAddReaction(packet.payload, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.MSG_EDIT: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handleEditMessage(packet.payload, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.MSG_DELETE: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handleDeleteMessage(packet.payload, socket, io);
                        }
                        break;
                    }
                    case KNXProto.OPCODES.MSG_PIN: {
                        if (socket.authenticated && socket.kId && packet.payload && socket.kId === packet.payload.from) {
                            messageService.handlePinMessage(packet.payload, socket, io);
                        }
                        break;
                    }
                }
            } catch (err) {
                console.error('KNX-Proto decode error:', err);
            }
        });

        // JSON Socket.IO Event Handlers - Strictly Enforce socket.authenticated
        socket.on('sendMessage', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleIncomingMessage(data, socket, io);
        });

        socket.on('markRead', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleMarkRead(data, socket, io);
        });

        socket.on('typing', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleTyping(data, true, socket, io);
        });

        socket.on('stopTyping', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleTyping(data, false, socket, io);
        });

        socket.on('botCommand', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.kId) return;
            botService.handleStickerBotCommand(data.kId, data.command, data.payload, io);
        });

        socket.on('editMessage', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleEditMessage(data, socket, io);
        });

        socket.on('deleteMessage', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleDeleteMessage(data, socket, io);
        });

        socket.on('deleteMultipleMessages', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleDeleteMultipleMessages(data, socket, io);
        });

        socket.on('pinMessage', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handlePinMessage(data, socket, io);
        });

        socket.on('addReaction', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.from) return;
            messageService.handleAddReaction(data, socket, io);
        });

        socket.on('customizeSettings', (data) => {
            if (!socket.authenticated || !socket.kId || socket.kId !== data?.kId) return;
            const updates = {};
            if (data.name) updates.name = String(data.name);
            if (data.theme) updates.theme = data.theme;
            if (data.lang) updates.lang = data.lang;
            if (data.avatar) updates.avatar = data.avatar;
            if (data.header !== undefined) updates.header = data.header;
            if (data.bio !== undefined) updates.bio = String(data.bio);
            if (data.hobbies !== undefined) updates.hobbies = String(data.hobbies);
            if (data.birthDate !== undefined) updates.birthDate = String(data.birthDate);
            if (data.chatBg !== undefined) updates.chatBg = data.chatBg;
            if (data.soundEnabled !== undefined) updates.soundEnabled = data.soundEnabled;
            if (data.folders !== undefined) updates.folders = data.folders;
            if (data.archived !== undefined) updates.archived = data.archived;
            const updatedUser = usersRepo.updateUser(socket.kId, updates);
            if (updatedUser) {
                io.to(socket.kId).emit('profileSync', { user: updatedUser, kId: socket.kId });
            }
        });

        socket.on('disconnect', () => {
            if (currentKId) {
                if (!isUserOnline(currentKId, io)) {
                    socket.broadcast.emit('userStatusChanged', { kId: currentKId, isOnline: false });
                }
            }
        });
    });
}

module.exports = {
    setupSocketIO,
    isUserOnline
};
