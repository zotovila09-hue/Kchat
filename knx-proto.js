export const MAGIC_0 = 0x4B; 
export const MAGIC_1 = 0x50; 
export const PROTO_VERSION = 0x02; 
export const HEADER_SIZE = 22;

export const OPCODES = Object.freeze({
    AUTH: 0x01,
    AUTH_RESP: 0x02,
    MSG_SEND: 0x03,
    MSG_RECV: 0x04,
    TYPING: 0x05,
    STOP_TYPING: 0x06,
    MARK_READ: 0x07,
    MSG_READ_ACK: 0x08,
    MSG_EDIT: 0x09,
    MSG_DELETE: 0x0A,
    MSG_PIN: 0x0B,
    REACTION: 0x0C,
    PING: 0x0D,
    PONG: 0x0E,
    ACK: 0x0F,
    ERROR: 0x10
});

export const OPCODE_NAMES = Object.freeze(
    Object.fromEntries(Object.entries(OPCODES).map(([k, v]) => [v, k]))
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32_TABLE[i] = c >>> 0;
}

export function calculateCRC32(bytes, offset = 0, length = bytes.byteLength - offset) {
    let crc = 0xFFFFFFFF;
    const end = offset + length;
    for (let i = offset; i < end; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function toBigInt(val, fallback = 0n) {
    if (val === undefined || val === null || val === '') return fallback;
    if (typeof val === 'bigint') return val;
    if (typeof val === 'number') {
        if (!Number.isFinite(val)) return fallback;
        return BigInt(Math.trunc(val));
    }
    try {
        return BigInt(val);
    } catch {
        return fallback;
    }
}

export class ByteWriter {
    constructor(initialCapacity = 64) {
        this.buffer = new Uint8Array(Math.max(initialCapacity, 16));
        this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
        this.length = 0;
    }

    ensure(size) {
        if (this.length + size > this.buffer.byteLength) {
            const nextCapacity = Math.max(this.buffer.byteLength * 2, this.length + size);
            const nextBuffer = new Uint8Array(nextCapacity);
            nextBuffer.set(this.buffer.subarray(0, this.length));
            this.buffer = nextBuffer;
            this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
        }
    }

    writeUint8(val) {
        this.ensure(1);
        this.view.setUint8(this.length, (val ?? 0) & 0xFF);
        this.length += 1;
    }

    writeUint16(val) {
        this.ensure(2);
        this.view.setUint16(this.length, (val ?? 0) & 0xFFFF, false);
        this.length += 2;
    }

    writeUint32(val) {
        this.ensure(4);
        this.view.setUint32(this.length, (val ?? 0) >>> 0, false);
        this.length += 4;
    }

    writeBigUint64(val) {
        this.ensure(8);
        this.view.setBigUint64(this.length, toBigInt(val), false);
        this.length += 8;
    }

    writeBytes(bytes) {
        if (!bytes || bytes.byteLength === 0) return;
        this.ensure(bytes.byteLength);
        this.buffer.set(bytes, this.length);
        this.length += bytes.byteLength;
    }

    writeString(str) {
        if (!str) {
            this.writeUint16(0);
            return;
        }
        const encoded = textEncoder.encode(str);
        if (encoded.byteLength > 0xFFFF) {
            throw new RangeError(`KNXProto: String byte length (${encoded.byteLength}) exceeds 65535 limit`);
        }
        this.writeUint16(encoded.byteLength);
        this.writeBytes(encoded);
    }

    writeLongString(str) {
        if (!str) {
            this.writeUint32(0);
            return;
        }
        const encoded = textEncoder.encode(str);
        this.writeUint32(encoded.byteLength);
        this.writeBytes(encoded);
    }

    getBytes() {
        return this.buffer.subarray(0, this.length);
    }
}

export class ByteReader {
    constructor(source) {
        if (source instanceof Uint8Array) {
            this.bytes = source;
        } else if (source instanceof ArrayBuffer) {
            this.bytes = new Uint8Array(source);
        } else if (ArrayBuffer.isView(source)) {
            this.bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        } else {
            throw new TypeError('KNXProto: ByteReader requires ArrayBuffer or ArrayBufferView');
        }
        this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
        this.pos = 0;
    }

    hasMore(size = 1) {
        return (this.pos + size) <= this.bytes.byteLength;
    }

    readUint8() {
        if (!this.hasMore(1)) return 0;
        const val = this.view.getUint8(this.pos);
        this.pos += 1;
        return val;
    }

    readUint16() {
        if (!this.hasMore(2)) return 0;
        const val = this.view.getUint16(this.pos, false);
        this.pos += 2;
        return val;
    }

    readUint32() {
        if (!this.hasMore(4)) return 0;
        const val = this.view.getUint32(this.pos, false);
        this.pos += 4;
        return val;
    }

    readBigUint64() {
        if (!this.hasMore(8)) return 0n;
        const val = this.view.getBigUint64(this.pos, false);
        this.pos += 8;
        return val;
    }

    readBytes(length) {
        if (length <= 0) return new Uint8Array(0);
        const available = Math.min(length, this.bytes.byteLength - this.pos);
        const slice = this.bytes.subarray(this.pos, this.pos + available);
        this.pos += available;
        return slice;
    }

    readString() {
        const length = this.readUint16();
        if (length === 0 || !this.hasMore(length)) return '';
        const slice = this.bytes.subarray(this.pos, this.pos + length);
        this.pos += length;
        return textDecoder.decode(slice);
    }

    readLongString() {
        const length = this.readUint32();
        if (length === 0 || !this.hasMore(length)) return '';
        const slice = this.bytes.subarray(this.pos, this.pos + length);
        this.pos += length;
        return textDecoder.decode(slice);
    }
}

export function serializePayload(opcode, payload) {
    const w = new ByteWriter(64);

    switch (opcode) {
        case OPCODES.AUTH: {
            w.writeString(payload?.token ?? '');
            w.writeString(payload?.clientVersion ?? '');
            w.writeString(payload?.platform ?? '');
            w.writeString(payload?.deviceId ?? '');
            break;
        }

        case OPCODES.AUTH_RESP: {
            w.writeUint8(payload?.status ?? 0);
            w.writeBigUint64(toBigInt(payload?.userId));
            w.writeString(payload?.sessionId ?? '');
            w.writeBigUint64(toBigInt(payload?.expiresAt));
            break;
        }

        case OPCODES.MSG_SEND: {
            w.writeBigUint64(toBigInt(payload?.chatId));
            w.writeBigUint64(toBigInt(payload?.replyToId));
            w.writeUint8(payload?.flags ?? 0);
            w.writeLongString(payload?.text ?? '');
            break;
        }

        case OPCODES.MSG_RECV: {
            w.writeBigUint64(toBigInt(payload?.id));
            w.writeBigUint64(toBigInt(payload?.chatId));
            w.writeBigUint64(toBigInt(payload?.senderId));
            w.writeBigUint64(toBigInt(payload?.timestamp));
            w.writeBigUint64(toBigInt(payload?.replyToId));
            w.writeUint8(payload?.flags ?? 0);
            w.writeString(payload?.senderName ?? '');
            w.writeLongString(payload?.text ?? '');
            break;
        }

        case OPCODES.TYPING:
        case OPCODES.STOP_TYPING: {
            w.writeString(payload?.from ?? '');
            w.writeString(payload?.to ?? '');
            w.writeUint8(payload?.isGroup ? 1 : 0);
            break;
        }

        case OPCODES.MARK_READ: {
            w.writeString(payload?.from ?? '');
            w.writeString(payload?.to ?? '');
            w.writeUint8(payload?.isGroup ? 1 : 0);
            w.writeBigUint64(toBigInt(payload?.msgId ?? payload?.id));
            break;
        }

        case OPCODES.MSG_READ_ACK: {
            w.writeString(payload?.chatKId ?? (payload?.chatId !== undefined ? String(payload.chatId) : ''));
            w.writeBigUint64(toBigInt(payload?.msgId ?? payload?.id));
            break;
        }

        case OPCODES.MSG_EDIT: {
            w.writeBigUint64(toBigInt(payload?.id));
            w.writeString(payload?.from ?? '');
            w.writeString(payload?.to ?? '');
            w.writeLongString(payload?.newText ?? payload?.text ?? '');
            break;
        }

        case OPCODES.MSG_DELETE: {
            w.writeBigUint64(toBigInt(payload?.id));
            w.writeString(payload?.from ?? '');
            w.writeString(payload?.to ?? '');
            break;
        }

        case OPCODES.MSG_PIN: {
            w.writeBigUint64(toBigInt(payload?.id));
            w.writeString(payload?.from ?? '');
            w.writeString(payload?.to ?? '');
            w.writeUint8(payload?.isPin ? 1 : 0);
            break;
        }

        case OPCODES.REACTION: {
            w.writeBigUint64(toBigInt(payload?.id));
            w.writeString(payload?.from ?? '');
            w.writeString(payload?.to ?? '');
            w.writeString(payload?.emoji ?? '');
            break;
        }

        case OPCODES.PING:
        case OPCODES.PONG: {
            const time = payload?.t !== undefined ? toBigInt(payload.t) : BigInt(Date.now());
            w.writeBigUint64(time);
            break;
        }

        case OPCODES.ACK: {
            w.writeUint16(payload?.seq ?? 0);
            w.writeBigUint64(toBigInt(payload?.id));
            break;
        }

        case OPCODES.ERROR: {
            w.writeUint16(payload?.code ?? 0);
            w.writeUint8(payload?.failedOpcode ?? 0);
            w.writeString(payload?.message ?? '');
            break;
        }

        default: {
            throw new Error(`KNXProto: Cannot serialize unsupported opcode 0x${opcode?.toString(16)}`);
        }
    }

    return w.getBytes();
}

export function deserializePayload(opcode, bytes) {
    if (!bytes || bytes.byteLength === 0) return null;
    const r = new ByteReader(bytes);

    switch (opcode) {
        case OPCODES.AUTH: {
            return {
                token: r.readString(),
                clientVersion: r.readString(),
                platform: r.readString(),
                deviceId: r.readString()
            };
        }

        case OPCODES.AUTH_RESP: {
            return {
                status: r.readUint8(),
                userId: r.readBigUint64(),
                sessionId: r.readString(),
                expiresAt: r.readBigUint64()
            };
        }

        case OPCODES.MSG_SEND: {
            return {
                chatId: r.readBigUint64(),
                replyToId: r.readBigUint64(),
                flags: r.readUint8(),
                text: r.readLongString()
            };
        }

        case OPCODES.MSG_RECV: {
            return {
                id: r.readBigUint64(),
                chatId: r.readBigUint64(),
                senderId: r.readBigUint64(),
                timestamp: r.readBigUint64(),
                replyToId: r.readBigUint64(),
                flags: r.readUint8(),
                senderName: r.readString(),
                text: r.readLongString()
            };
        }

        case OPCODES.TYPING:
        case OPCODES.STOP_TYPING: {
            return {
                from: r.readString(),
                to: r.readString(),
                isGroup: r.readUint8() === 1
            };
        }

        case OPCODES.MARK_READ: {
            return {
                from: r.readString(),
                to: r.readString(),
                isGroup: r.readUint8() === 1,
                msgId: r.readBigUint64()
            };
        }

        case OPCODES.MSG_READ_ACK: {
            return {
                chatKId: r.readString(),
                msgId: r.readBigUint64()
            };
        }

        case OPCODES.MSG_EDIT: {
            return {
                id: r.readBigUint64(),
                from: r.readString(),
                to: r.readString(),
                newText: r.readLongString()
            };
        }

        case OPCODES.MSG_DELETE: {
            return {
                id: r.readBigUint64(),
                from: r.readString(),
                to: r.readString()
            };
        }

        case OPCODES.MSG_PIN: {
            return {
                id: r.readBigUint64(),
                from: r.readString(),
                to: r.readString(),
                isPin: r.readUint8() === 1
            };
        }

        case OPCODES.REACTION: {
            return {
                id: r.readBigUint64(),
                from: r.readString(),
                to: r.readString(),
                emoji: r.readString()
            };
        }

        case OPCODES.PING:
        case OPCODES.PONG: {
            return {
                t: r.readBigUint64()
            };
        }

        case OPCODES.ACK: {
            return {
                seq: r.readUint16(),
                id: r.readBigUint64()
            };
        }

        case OPCODES.ERROR: {
            return {
                code: r.readUint16(),
                failedOpcode: r.readUint8(),
                message: r.readString()
            };
        }

        default: {
            return null;
        }
    }
}

let globalSeq = 0;

export const KNXProto = {
    VERSION: PROTO_VERSION,
    HEADER_SIZE,
    OPCODES,
    OPCODE_NAMES,
    lastRTT: null,

    nextSeq() {
        globalSeq = (globalSeq + 1) & 0xFFFF;
        return globalSeq;
    },

    pack(opcode, payload, seqNo = null, timestamp = null) {
        const seq = (seqNo !== null && seqNo !== undefined) ? (Number(seqNo) & 0xFFFF) : this.nextSeq();
        const time = (timestamp !== null && timestamp !== undefined) ? toBigInt(timestamp) : BigInt(Date.now());

        let payloadBytes;
        if (payload instanceof Uint8Array) {
            payloadBytes = payload;
        } else if (payload instanceof ArrayBuffer) {
            payloadBytes = new Uint8Array(payload);
        } else if (ArrayBuffer.isView(payload)) {
            payloadBytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        } else {
            payloadBytes = serializePayload(opcode, payload);
        }

        const payloadLen = payloadBytes.byteLength;
        const crc = calculateCRC32(payloadBytes, 0, payloadLen);
        const totalLen = HEADER_SIZE + payloadLen;

        const frameBuffer = new ArrayBuffer(totalLen);
        const view = new DataView(frameBuffer);
        const frameBytes = new Uint8Array(frameBuffer);

        view.setUint8(0, MAGIC_0);
        view.setUint8(1, MAGIC_1);
        view.setUint8(2, PROTO_VERSION);
        view.setUint8(3, opcode & 0xFF);
        view.setUint32(4, payloadLen, false);
        view.setUint16(8, seq, false);
        view.setBigUint64(10, time, false);
        view.setUint32(18, crc, false);

        if (payloadLen > 0) {
            frameBytes.set(payloadBytes, HEADER_SIZE);
        }

        return frameBytes;
    },

    unpack(input) {
        if (!input) return null;

        let bytes;
        if (input instanceof Uint8Array) {
            bytes = input;
        } else if (input instanceof ArrayBuffer) {
            bytes = new Uint8Array(input);
        } else if (ArrayBuffer.isView(input)) {
            bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        } else {
            return null;
        }

        if (bytes.byteLength < HEADER_SIZE) {
            throw new Error(`KNXProto: Packet too small for header (${bytes.byteLength} bytes, expected at least ${HEADER_SIZE})`);
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        const m0 = view.getUint8(0);
        const m1 = view.getUint8(1);
        if (m0 !== MAGIC_0 || m1 !== MAGIC_1) {
            throw new Error(`KNXProto: Invalid magic header (0x${m0.toString(16).padStart(2, '0')}, 0x${m1.toString(16).padStart(2, '0')})`);
        }

        const version = view.getUint8(2);
        const opcode = view.getUint8(3);
        const payloadLen = view.getUint32(4, false);
        const seq = view.getUint16(8, false);
        const timestamp = view.getBigUint64(10, false);
        const expectedCRC = view.getUint32(18, false);

        if (bytes.byteLength < HEADER_SIZE + payloadLen) {
            throw new Error(`KNXProto: Truncated packet. Expected ${HEADER_SIZE + payloadLen} bytes, got ${bytes.byteLength}`);
        }

        const payloadSlice = bytes.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);
        const actualCRC = calculateCRC32(payloadSlice, 0, payloadLen);

        if (actualCRC !== expectedCRC) {
            throw new Error(
                `KNXProto: CRC32 checksum mismatch (expected: 0x${expectedCRC.toString(16).padStart(8, '0')}, got: 0x${actualCRC.toString(16).padStart(8, '0')})`
            );
        }

        const payload = deserializePayload(opcode, payloadSlice);

        return {
            version,
            opcode,
            opcodeName: OPCODE_NAMES[opcode] || `UNKNOWN_0x${opcode.toString(16).padStart(2, '0')}`,
            seq,
            timestamp,
            payload,
            rawPayload: payloadSlice
        };
    },

    isKNXPacket(input) {
        if (!input) return false;
        let bytes;
        if (input instanceof Uint8Array) {
            bytes = input;
        } else if (input instanceof ArrayBuffer) {
            bytes = new Uint8Array(input);
        } else if (ArrayBuffer.isView(input)) {
            bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        } else {
            return false;
        }

        if (bytes.byteLength < 2) return false;
        return bytes[0] === MAGIC_0 && bytes[1] === MAGIC_1;
    },

    createReplayWindow(windowSize = 1000, maxTimeDriftMs = 300000) {
        const seen = new Set();
        const maxDrift = BigInt(maxTimeDriftMs);

        return {
            isValid(seq, timestamp) {
                const now = BigInt(Date.now());
                const ts = toBigInt(timestamp);
                const drift = now >= ts ? (now - ts) : (ts - now);

                if (drift > maxDrift) {
                    return false;
                }

                const key = `${seq}:${ts}`;
                if (seen.has(key)) {
                    return false;
                }

                seen.add(key);
                if (seen.size > windowSize) {
                    const oldest = seen.values().next().value;
                    seen.delete(oldest);
                }

                return true;
            }
        };
    },

    sanitize: {
        text(str) {
            if (typeof str !== 'string') return '';
            return str.replace(/[&<>'"]/g, match => {
                switch (match) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case "'": return '&#39;';
                    case '"': return '&quot;';
                    default: return match;
                }
            });
        },

        isSafeDataUrl(url) {
            if (typeof url !== 'string' || !url) return true;
            if (!url.startsWith('data:')) return true;

            if (url.includes('image/svg+xml')) {
                try {
                    const decoded = decodeURIComponent(url);
                    if (/<script/i.test(decoded) || /javascript:/i.test(decoded) || /onload=/i.test(decoded) || /onerror=/i.test(decoded)) {
                        return false;
                    }
                } catch {
                    return false;
                }
            }
            return true;
        }
    }
};

export default KNXProto;