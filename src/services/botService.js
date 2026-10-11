const config = require('../config');
const usersRepo = require('../db/usersRepo');
const stickersRepo = require('../db/stickersRepo');
const messagesRepo = require('../db/messagesRepo');
const { encrypt } = require('./cryptoService');
const KNXProto = require('../../knx-proto');

const botStates = {};

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

function ensureSystemBots() {
    const sti = usersRepo.getUserById(config.BOT_STI, false);
    if (!sti) {
        usersRepo.createUser({
            kId: config.BOT_STI,
            name: 'Стикер Мастер',
            email: 'sticker@knx',
            password: 'bot',
            avatar: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23d946ef'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14c-2.33 0-4.31-1.46-5.11-3.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5zM7.5 9.5c-.83 0-1.5-.67-1.5-1.5S6.67 6.5 7.5 6.5 9 7.17 9 8s-.67 1.5-1.5 1.5zm9 0c-.83 0-1.5-.67-1.5-1.5S15.67 6.5 16.5 6.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z'/%3E%3C/svg%3E",
            header: '',
            chatBg: '',
            bio: 'Отправь /start,если нужен стикерпак',
            theme: 'light',
            lang: 'ru',
            soundEnabled: false,
            searchable: true,
            hideAvatar: false,
            hideHeader: false,
            hideBio: false,
            hideKid: false,
            blocked: [],
            folders: [],
            archived: [],
            installedPacks: [],
            isBot: true
        });
    }

    const sup = usersRepo.getUserById(config.BOT_SUPPORT, false);
    if (!sup) {
        usersRepo.createUser({
            kId: config.BOT_SUPPORT,
            name: 'KNX Support',
            email: 'support@knx',
            password: 'bot',
            avatar: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230084ff'%3E%3Cpath d='M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.4 0 2.8 1.1 2.8 2.5V11c.6 0 1.2.6 1.2 1.2v3.5c0 .7-.6 1.3-1.2 1.3H9.2c-.6 0-1.2-.6-1.2-1.3v-3.5c0-.6.6-1.2 1.2-1.2V9.5C9.2 8.1 10.6 7 12 7zm0 1c-.8 0-1.5.7-1.5 1.5V11h3V9.5c0-.8-.7-1.5-1.5-1.5z'/%3E%3C/svg%3E",
            header: '',
            chatBg: '',
            bio: 'Официальный системный аккаунт. Отправляет коды авторизации и важные уведомления.',
            theme: 'light',
            lang: 'ru',
            soundEnabled: false,
            searchable: true,
            hideAvatar: false,
            hideHeader: false,
            hideBio: false,
            hideKid: false,
            blocked: [],
            folders: [],
            archived: [],
            installedPacks: [],
            isBot: true
        });
    }
}

function sendSystemBotMessage(botId, toId, text, inlineButtons = null, io = null) {
    const toUser = usersRepo.getUserById(toId, false);
    const botUser = usersRepo.getUserById(botId, false);
    if (!toUser || !botUser) return;

    const msgId = Date.now().toString() + '_' + botId;
    const chatKey = [botId, toId].sort().join('_');

    const msgObj = {
        id: msgId,
        chatId: chatKey,
        senderId: botId,
        text: encrypt(text),
        type: 'text',
        timestamp: Date.now(),
        status: 'sent',
        isEdited: false,
        reactions: {},
        inlineButtons
    };

    messagesRepo.addMessage(msgObj);

    if (io) {
        const emitObj = {
            id: msgId,
            from: botId,
            to: toId,
            text,
            type: 'text',
            timestamp: Date.now(),
            status: 'sent',
            isGroup: false,
            inlineButtons
        };
        broadcastUnified(io, toId, 'newMessage', emitObj, typeof KNXProto !== 'undefined' ? KNXProto.OPCODES.MSG_RECV : null);
    }
}

function handleStickerBotMessage(from, text, type, io) {
    const user = usersRepo.getUserById(from, false);
    if (!user) return;

    setTimeout(() => {
        let st = botStates[from] || {};
        let replyText = "Я не понимаю эту команду.";
        let inlineButtons = null;

        if (type === 'text') {
            if (text.startsWith('/start') || text === 'Меню' || text === '/editbot') {
                replyText = "Привет! Я бот для создания стикеров 🤖\nЧто хочешь сделать?";
                inlineButtons = [{ text: "Создать пак", action: "sti_new" }, { text: "Мои паки", action: "sti_list" }];
                if (usersRepo.isDev(user.email, user)) {
                    inlineButtons.push({ text: "⚙️ Редактировать меня (Dev)", action: "edit_bot_menu" });
                }
                botStates[from] = null;
            } else if (st.action === 'waiting_pack_name') {
                const pId = 'pack_' + Date.now();
                stickersRepo.createPack({ id: pId, name: text, creatorId: from, items: [] });
                const currentPacks = user.installedPacks || [];
                if (!currentPacks.includes(pId)) currentPacks.push(pId);
                usersRepo.updateUser(from, { installedPacks: currentPacks });
                replyText = `Пак «${text}» создан!\nТеперь отправь мне любое фото, чтобы добавить стикер.`;
                botStates[from] = { action: 'waiting_sticker', packId: pId };
                if (io) io.to(from).emit('stickersUpdated');
            } else if (st.action === 'waiting_bot_main_bio' && usersRepo.isDev(user.email, user)) {
                usersRepo.updateUser(config.BOT_STI, { bio: text });
                replyText = "✅ Описание бота успешно обновлено!";
                const botUser = usersRepo.getUserById(config.BOT_STI, false);
                if (io) {
                    io.emit('profileUpdated', {
                        kId: config.BOT_STI,
                        name: botUser.name,
                        avatar: botUser.avatar,
                        header: botUser.header,
                        bio: text,
                        isGroup: false
                    });
                }
                botStates[from] = null;
            }
        } else if (type === 'image' || type === 'file') {
            if (st.action === 'waiting_bot_main_photo' && usersRepo.isDev(user.email, user)) {
                usersRepo.updateUser(config.BOT_STI, { avatar: text });
                replyText = "✅ Аватарка бота успешно обновлена!";
                const botUser = usersRepo.getUserById(config.BOT_STI, false);
                if (io) {
                    io.emit('profileUpdated', {
                        kId: config.BOT_STI,
                        name: botUser.name,
                        avatar: text,
                        header: botUser.header,
                        bio: botUser.bio,
                        isGroup: false
                    });
                }
                botStates[from] = null;
            } else if (st.action === 'waiting_sticker' && st.packId) {
                const pack = stickersRepo.getPackById(st.packId);
                if (pack) {
                    stickersRepo.addStickerToPack(st.packId, text);
                    const updated = stickersRepo.getPackById(st.packId);
                    replyText = `Стикер добавлен в пак «${pack.name}» (всего: ${updated.items.length}).\nКидай ещё фото или нажми обновить.`;
                    inlineButtons = [{ text: "Обновить пак у себя", action: "install_pack", payload: st.packId }];
                } else {
                    replyText = "Пак не найден. Попробуйте создать новый.";
                }
            } else {
                replyText = "Сначала выбери действие в меню.";
                inlineButtons = [{ text: "Меню", action: "sti_menu" }];
            }
        }

        sendSystemBotMessage(config.BOT_STI, from, replyText, inlineButtons, io);
    }, 400);
}

function handleStickerBotCommand(kId, command, payload, io) {
    const user = usersRepo.getUserById(kId, false);
    if (!user) return;

    if (command === 'install_pack') {
        const currentPacks = user.installedPacks || [];
        if (!currentPacks.includes(payload) && stickersRepo.getPackById(payload)) {
            currentPacks.push(payload);
            usersRepo.updateUser(kId, { installedPacks: currentPacks });
        }
        if (io) io.to(kId).emit('stickersUpdated');
    } else if (command === 'sti_new') {
        botStates[kId] = { action: 'waiting_pack_name' };
        sendSystemBotMessage(config.BOT_STI, kId, "Введите название для нового пака:", null, io);
    } else if (command === 'sti_menu') {
        let btns = [{ text: "Создать пак", action: "sti_new" }, { text: "Мои паки", action: "sti_list" }];
        if (usersRepo.isDev(user.email, user)) {
            btns.push({ text: "⚙️ Редактировать меня (Dev)", action: "edit_bot_menu" });
        }
        sendSystemBotMessage(config.BOT_STI, kId, "Меню:", btns, io);
    } else if (command === 'sti_list') {
        const allPacks = Object.values(stickersRepo.getAllPacks());
        const userPacks = allPacks.filter(p => p.creatorId === kId);
        if (userPacks.length === 0) {
            sendSystemBotMessage(config.BOT_STI, kId, "У вас нет паков.", null, io);
        } else {
            let btns = userPacks.map(p => ({ text: `❌ Удалить ${p.name}`, action: "sti_del", payload: p.id }));
            sendSystemBotMessage(config.BOT_STI, kId, "Ваши паки (нажмите для удаления):", btns, io);
        }
    } else if (command === 'sti_del') {
        const pack = stickersRepo.getPackById(payload);
        if (pack && pack.creatorId === kId) {
            stickersRepo.deletePack(payload);
            const remaining = (user.installedPacks || []).filter(id => id !== payload);
            usersRepo.updateUser(kId, { installedPacks: remaining });
            sendSystemBotMessage(config.BOT_STI, kId, "Пак удален.", null, io);
            if (io) io.to(kId).emit('stickersUpdated');
        }
    } else if (command === 'edit_bot_menu') {
        if (usersRepo.isDev(user.email, user)) {
            sendSystemBotMessage(config.BOT_STI, kId, "Что вы хотите изменить у меня?", [
                { text: "🖼 Изменить аватарку", action: "edit_bot_photo" },
                { text: "📝 Изменить описание", action: "edit_bot_bio" }
            ], io);
        }
    } else if (command === 'edit_bot_photo') {
        if (usersRepo.isDev(user.email, user)) {
            botStates[kId] = { action: 'waiting_bot_main_photo' };
            sendSystemBotMessage(config.BOT_STI, kId, "Отправьте мне новую картинку (скрепкой) для аватарки.", null, io);
        }
    } else if (command === 'edit_bot_bio') {
        if (usersRepo.isDev(user.email, user)) {
            botStates[kId] = { action: 'waiting_bot_main_bio' };
            sendSystemBotMessage(config.BOT_STI, kId, "Отправьте мне новый текст описания (bio).", null, io);
        }
    }
}

module.exports = {
    ensureSystemBots,
    sendSystemBotMessage,
    handleStickerBotMessage,
    handleStickerBotCommand,
    broadcastUnified
};
