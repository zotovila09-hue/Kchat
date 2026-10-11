/**
 * KNX Messenger - High-Performance In-Memory Sliding-Window Rate Limiter
 * Protects auth endpoints, file uploads, and general API routes from abuse.
 */

class RateLimiter {
    constructor({ windowMs = 60000, max = 60, message = 'Слишком много запросов. Пожалуйста, повторите позже.' } = {}) {
        this.windowMs = windowMs;
        this.max = max;
        this.message = message;
        this.hits = new Map();

        // Periodic sweep of expired rate limit windows
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [ip, entry] of this.hits.entries()) {
                if (now > entry.resetTime) {
                    this.hits.delete(ip);
                }
            }
        }, 60000);
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    middleware() {
        return (req, res, next) => {
            const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
            const now = Date.now();
            let entry = this.hits.get(ip);

            if (!entry || now > entry.resetTime) {
                entry = { count: 1, resetTime: now + this.windowMs };
                this.hits.set(ip, entry);
            } else {
                entry.count++;
            }

            const remaining = Math.max(0, this.max - entry.count);
            const resetSec = Math.ceil(entry.resetTime / 1000);

            res.setHeader('X-RateLimit-Limit', this.max);
            res.setHeader('X-RateLimit-Remaining', remaining);
            res.setHeader('X-RateLimit-Reset', resetSec);

            if (entry.count > this.max) {
                const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);
                res.setHeader('Retry-After', retryAfterSec);
                return res.status(429).json({
                    success: false,
                    message: this.message,
                    retryAfter: retryAfterSec
                });
            }

            next();
        };
    }
}

// 30 requests per 15 minutes for credential/auth actions
const authLimiter = new RateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Слишком много попыток входа или регистрации. Подождите 15 минут.'
});

// 60 file uploads per 15 minutes
const uploadLimiter = new RateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: 'Превышен лимит загрузки медиафайлов. Попробуйте позже.'
});

// 300 general API requests per 15 minutes
const apiLimiter = new RateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: 'Слишком много запросов к серверу. Подождите немного.'
});

module.exports = {
    RateLimiter,
    authLimiter: authLimiter.middleware(),
    uploadLimiter: uploadLimiter.middleware(),
    apiLimiter: apiLimiter.middleware()
};
