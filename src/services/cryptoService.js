const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const KNXProto = require('../../knx-proto');

function encrypt(text) {
    if (text === null || text === undefined) return text;
    const str = (typeof text === 'string') ? text : JSON.stringify(text);
    try {
        const iv = crypto.randomBytes(config.GCM_IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-gcm', config.ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(str, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return 'gcm:' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
    } catch (e) {
        try {
            const iv = crypto.randomBytes(config.IV_LENGTH);
            const cipher = crypto.createCipheriv('aes-256-cbc', config.ENCRYPTION_KEY, iv);
            let encrypted = cipher.update(str, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return iv.toString('hex') + ':' + encrypted;
        } catch (err) {
            return str;
        }
    }
}

function decrypt(text) {
    if (!text || typeof text !== 'string') return text;
    try {
        if (text.startsWith('gcm:')) {
            const parts = text.split(':');
            if (parts.length < 4) return text;
            const iv = Buffer.from(parts[1], 'hex');
            const authTag = Buffer.from(parts[2], 'hex');
            const encryptedText = Buffer.from(parts[3], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', config.ENCRYPTION_KEY, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } else if (text.includes(':')) {
            const textParts = text.split(':');
            const iv = Buffer.from(textParts.shift(), 'hex');
            const encryptedText = Buffer.from(textParts.join(':'), 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', config.ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        return text;
    } catch (e) {
        return text;
    }
}

function isSafeMedia(str) {
    if (!str || typeof str !== 'string') return true;
    const trimmed = str.trim().toLowerCase();
    // Strict block of script-based URI schemes and raw HTML data URLs
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:') || trimmed.startsWith('data:text/html')) {
        return false;
    }
    if (str.startsWith('/uploads/')) return true;
    if (str.startsWith('http://') || str.startsWith('https://')) return true;
    if (str.startsWith('data:image/') || str.startsWith('data:audio/') || str.startsWith('data:video/')) {
        if (typeof KNXProto !== 'undefined' && KNXProto.sanitize && KNXProto.sanitize.isSafeDataUrl) {
            return KNXProto.sanitize.isSafeDataUrl(str);
        }
        return true;
    }
    return false;
}

const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/zip': 'zip'
};

function saveBase64ToFile(dataUrl, prefix = 'media') {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return dataUrl;
    }
    try {
        const matches = dataUrl.match(/^data:([A-Za-z0-9\-+\/.]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return dataUrl;

        const mime = matches[1].toLowerCase();
        const ext = MIME_TO_EXT[mime] || 'bin';

        // Sanitize prefix to prevent directory traversal
        const safePrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '_') || 'media';

        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `${safePrefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
        const filePath = path.join(config.UPLOADS_DIR, filename);

        fs.writeFileSync(filePath, buffer);
        return `/uploads/${filename}`;
    } catch (err) {
        console.error('Failed to convert base64 to file:', err);
        return dataUrl;
    }
}

module.exports = {
    encrypt,
    decrypt,
    isSafeMedia,
    saveBase64ToFile
};
