/**
 * KNX Ecosystem Web Messenger - Professional Production Server
 * Architecture: Clean Modular Layer (SQLite WAL, Socket.IO, Express, KNX-Proto v2)
 */

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./src/config');
const db = require('./src/db/database');
const botService = require('./src/services/botService');
const { setupSocketIO } = require('./src/sockets/socketHandler');
const { apiLimiter } = require('./src/services/rateLimiter');

const authRoutes = require('./src/routes/authRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const userRoutes = require('./src/routes/userRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');

// Global Resilience Shield
process.on('uncaughtException', (err) => {
    console.error('🛡️ [KNX Shield] Uncaught exception intercepted:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
    console.error('🛡️ [KNX Shield] Unhandled rejection intercepted:', reason);
});

const app = express();
const server = http.createServer(app);

// Socket.IO with KNX binary proto tuning
const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100 MB for heavy streams
    pingTimeout: 30000,
    pingInterval: 15000,
    cors: { origin: config.CORS_ORIGIN }
});

app.set('io', io);

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Safe Body Parsing Limits (2MB default, /api/upload has scoped 50MB handler)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Static Media Storage with CSP Sandboxing to prevent Stored XSS
app.use('/uploads', (req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
}, express.static(config.UPLOADS_DIR, {
    maxAge: '7d',
    immutable: true
}));

// Static Web Client Assets
app.use(express.static(config.PUBLIC_DIR));

// API Routing Layer with Rate Limiting Protection
app.use('/api', apiLimiter);
app.use('/api', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api', userRoutes);
app.use('/api', chatRoutes);
app.use('/api', sessionRoutes);

// Fallback to index.html for Single Page Application navigation
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
        return next();
    }
    res.sendFile(require('path').join(config.PUBLIC_DIR, 'index.html'));
});

// Realtime Communications Engine
setupSocketIO(io);

// Ensure essential system bots are provisioned
botService.ensureSystemBots();

// Server error diagnostics
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`⚠️ [KNX Server] Порт ${config.PORT} уже занят другим процессом. Завершите старый процесс или измените PORT в .env.`);
    } else {
        console.error('⚠️ [KNX Server] Ошибка запуска HTTP сервера:', err);
    }
});

// Launch Server
server.listen(config.PORT, () => {
    console.log(`🚀 [KNX Messenger] Сервер успешно запущен на порту ${config.PORT}`);
    console.log(`📁 Хранилище SQLite: ${config.DB_PATH} (WAL mode активен)`);
    console.log(`🖼️ Хранилище медиа: ${config.UPLOADS_DIR} (доступно по /uploads)`);
});

// Graceful Shutdown
function handleShutdown(signal) {
    console.log(`\n🛑 [KNX] Получен сигнал ${signal}. Завершение работы...`);
    server.close(() => {
        try {
            db.close();
            console.log('✅ [KNX DB] База данных корректно закрыта.');
        } catch (e) {}
        process.exit(0);
    });
}
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = { app, server };