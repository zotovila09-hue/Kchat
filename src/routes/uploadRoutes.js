const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { saveBase64ToFile } = require('../services/cryptoService');
const { requireAuth } = require('../services/authService');
const { uploadLimiter } = require('../services/rateLimiter');

const router = express.Router();

const DANGEROUS_EXTENSIONS = new Set([
    '.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.php', '.phtml',
    '.exe', '.bat', '.cmd', '.sh', '.com', '.vbs', '.msi', '.ps1', '.py',
    '.jar', '.vbe', '.wsf', '.hta', '.scr', '.dll'
]);

function getSafeExtension(originalname) {
    const rawExt = path.extname(originalname || '').toLowerCase();
    if (!rawExt || DANGEROUS_EXTENSIONS.has(rawExt)) {
        return '.bin';
    }
    if (!/^\.[a-z0-9]{1,10}$/.test(rawExt)) {
        return '.bin';
    }
    return rawExt;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const safeExt = getSafeExtension(file.originalname);
        const uniqueName = `up_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: config.UPLOAD_MAX_SIZE
    }
});

// Middleware for large base64 JSON payload specifically on upload
const jsonUploadParser = express.json({ limit: '50mb' });

router.post('/', uploadLimiter, requireAuth, jsonUploadParser, (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Ошибка загрузки файла: ${err.message}` });
        } else if (err) {
            return res.status(500).json({ success: false, message: 'Внутренняя ошибка при сохранении файла.' });
        }

        // Case 1: Standard multipart file upload
        if (req.file) {
            return res.json({
                success: true,
                url: `/uploads/${req.file.filename}`,
                filename: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype
            });
        }

        // Case 2: Base64 JSON payload fallback
        if (req.body && req.body.base64) {
            const prefix = req.body.prefix || 'upload';
            const fileUrl = saveBase64ToFile(req.body.base64, prefix);
            return res.json({
                success: true,
                url: fileUrl,
                filename: req.body.filename || 'file'
            });
        }

        return res.status(400).json({ success: false, message: 'Файл не передан' });
    });
});

module.exports = router;
