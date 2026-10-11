const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const ROOT_DIR = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'messenger.db');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const DEV_EMAIL = (process.env.DEV_EMAIL || 'zotovila09@gmail.com').toLowerCase().trim();
const UPLOAD_MAX_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE, 10) || 52428800; // 50MB
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS, 10) || 30;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'knx-secret-secure-key-2026';
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || 'salt';
const ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_SECRET, ENCRYPTION_SALT, 32);

const IV_LENGTH = 16;
const GCM_IV_LENGTH = 12;

const DEFAULT_AVATAR = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2364748b'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
const DEFAULT_HEADER = "";

const BOT_STI = 'sti123cer';
const BOT_SUPPORT = 'knx_support';

const DEFAULT_INVITES = [
    { code: 'KNX-BETA-2026', description: 'Основной инвайт закрытого тестирования', unlimited: 1, maxUses: 0, usedCount: 0, tier: 'beta', title: 'Beta Tester', created: new Date().toISOString() },
    { code: 'KNX-PREVIEW-VIP', description: 'VIP инвайт раннего доступа', unlimited: 1, maxUses: 0, usedCount: 0, tier: 'vip', title: 'VIP Preview', created: new Date().toISOString() },
    { code: 'KNX-DEV-777', description: 'Инвайт разработчика', unlimited: 1, maxUses: 0, usedCount: 0, tier: 'dev', title: 'Core Developer', created: new Date().toISOString() }
];

module.exports = {
    ROOT_DIR,
    DATA_DIR,
    UPLOADS_DIR,
    DB_PATH,
    PUBLIC_DIR,
    PORT,
    NODE_ENV,
    DEV_EMAIL,
    UPLOAD_MAX_SIZE,
    SESSION_TTL_DAYS,
    CORS_ORIGIN,
    ENCRYPTION_KEY,
    IV_LENGTH,
    GCM_IV_LENGTH,
    DEFAULT_AVATAR,
    DEFAULT_HEADER,
    BOT_STI,
    BOT_SUPPORT,
    DEFAULT_INVITES
};
