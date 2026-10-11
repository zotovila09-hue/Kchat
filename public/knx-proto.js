/**
 * KNX-Proto Protocol v2.0 (Enhanced Binary Protocol)
 * Ultra-fast binary framing, compact TLV serialization, CRC32 integrity,
 * replay protection, and heartbeat telemetry.
 * Inspired by MTProto (Telegram) and modern binary network protocols.
 * Works seamlessly in both Node.js and Modern Web Browsers.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KNXProto = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAGIC_0 = 0x4B; // 'K'
    const MAGIC_1 = 0x50; // 'P'
    const PROTO_VERSION = 0x02; // v2.0
    const HEADER_SIZE = 22;

    const OPCODES = {
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
    };

    const OPCODE_NAMES = {};
    for (const key in OPCODES) {
        OPCODE_NAMES[OPCODES[key]] = key;
    }

    // Precomputed CRC32 lookup table for fast packet integrity validation
    const CRC32_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        CRC32_TABLE[i] = c >>> 0;
    }

    function calculateCRC32(bytes, offset = 0, length = bytes.length) {
        let crc = 0xFFFFFFFF;
        for (let i = offset; i < offset + length; i++) {
            crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const utf8Encoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
    const utf8Decoder = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;

    function encodeStr(str) {
        if (!str) return new Uint8Array(0);
        if (utf8Encoder) return utf8Encoder.encode(str);
        if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8');
        const arr = [];
        for (let i = 0; i < str.length; i++) {
            let c = str.charCodeAt(i);
            if (c < 128) arr.push(c);
            else if (c < 2048) { arr.push((c >> 6) | 192); arr.push((c & 63) | 128); }
            else { arr.push((c >> 12) | 224); arr.push(((c >> 6) & 63) | 128); arr.push((c & 63) | 128); }
        }
        return new Uint8Array(arr);
    }

    function decodeStr(bytes) {
        if (!bytes || bytes.length === 0) return '';
        if (utf8Decoder) return utf8Decoder.decode(bytes);
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
        return String.fromCharCode.apply(null, bytes);
    }

    // Binary byte writer helper
    class ByteWriter {
        constructor(initialSize = 64) {
            this.buffer = new Uint8Array(initialSize);
            this.length = 0;
        }
        ensure(size) {
            if (this.length + size > this.buffer.length) {
                let newCap = Math.max(this.buffer.length * 2, this.length + size);
                const next = new Uint8Array(newCap);
                next.set(this.buffer);
                this.buffer = next;
            }
        }
        writeUint8(val) {
            this.ensure(1);
            this.buffer[this.length++] = val & 0xFF;
        }
        writeUint16(val) {
            this.ensure(2);
            this.buffer[this.length++] = (val >> 8) & 0xFF;
            this.buffer[this.length++] = val & 0xFF;
        }
        writeUint32(val) {
            this.ensure(4);
            this.buffer[this.length++] = (val >>> 24) & 0xFF;
            this.buffer[this.length++] = (val >>> 16) & 0xFF;
            this.buffer[this.length++] = (val >>> 8) & 0xFF;
            this.buffer[this.length++] = val & 0xFF;
        }
        writeUint64(val) {
            this.ensure(8);
            const high = Math.floor(val / 0x100000000);
            const low = val >>> 0;
            this.writeUint32(high);
            this.writeUint32(low);
        }
        writeString(str) {
            const bytes = encodeStr(str);
            if (bytes.length > 65535) throw new Error('String too long');
            this.writeUint16(bytes.length);
            this.ensure(bytes.length);
            this.buffer.set(bytes, this.length);
            this.length += bytes.length;
        }
        getBytes() {
            return this.buffer.subarray(0, this.length);
        }
    }

    // Binary byte reader helper
    class ByteReader {
        constructor(uint8) {
            this.bytes = uint8;
            this.pos = 0;
        }
        hasMore(size = 1) {
            return (this.pos + size) <= this.bytes.length;
        }
        readUint8() {
            if (!this.hasMore(1)) return 0;
            return this.bytes[this.pos++];
        }
        readUint16() {
            if (!this.hasMore(2)) return 0;
            const val = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1];
            this.pos += 2;
            return val;
        }
        readUint32() {
            if (!this.hasMore(4)) return 0;
            const val = ((this.bytes[this.pos] << 24) |
                         (this.bytes[this.pos + 1] << 16) |
                         (this.bytes[this.pos + 2] << 8) |
                         this.bytes[this.pos + 3]) >>> 0;
            this.pos += 4;
            return val;
        }
        readUint64() {
            const high = this.readUint32();
            const low = this.readUint32();
            return (high * 0x100000000) + low;
        }
        readString() {
            const len = this.readUint16();
            if (len === 0) return '';
            if (!this.hasMore(len)) return '';
            const slice = this.bytes.subarray(this.pos, this.pos + len);
            this.pos += len;
            return decodeStr(slice);
        }
    }

    // Compact TLV serializers for high-frequency opcodes (Zero-JSON overhead)
    function serializeCompact(opcode, payload) {
        const w = new ByteWriter(48);
        w.writeUint8(0x00); // 0x00 = Binary compact format marker

        switch (opcode) {
            case OPCODES.PING:
            case OPCODES.PONG: {
                w.writeUint64(payload && payload.t ? payload.t : Date.now());
                break;
            }
            case OPCODES.ACK: {
                w.writeUint16(payload.seq || 0);
                w.writeString(payload.id ? String(payload.id) : '');
                break;
            }
            case OPCODES.TYPING:
            case OPCODES.STOP_TYPING: {
                w.writeString(payload.from || '');
                w.writeString(payload.to || '');
                w.writeUint8(payload.isGroup ? 1 : 0);
                break;
            }
            case OPCODES.MARK_READ: {
                w.writeString(payload.from || '');
                w.writeString(payload.to || '');
                w.writeUint8(payload.isGroup ? 1 : 0);
                break;
            }
            case OPCODES.MSG_READ_ACK: {
                w.writeString(payload.chatKId || '');
                break;
            }
            case OPCODES.REACTION: {
                w.writeString(payload.id ? String(payload.id) : '');
                w.writeString(payload.from || '');
                w.writeString(payload.to || '');
                w.writeString(payload.emoji || '');
                break;
            }
            case OPCODES.MSG_PIN: {
                w.writeString(payload.id ? String(payload.id) : '');
                w.writeString(payload.from || '');
                w.writeString(payload.to || '');
                w.writeUint8(payload.isPin ? 1 : 0);
                break;
            }
            case OPCODES.MSG_DELETE: {
                w.writeString(payload.id ? String(payload.id) : '');
                w.writeString(payload.from || '');
                w.writeString(payload.to || '');
                break;
            }
            case OPCODES.MSG_EDIT: {
                w.writeString(payload.id ? String(payload.id) : '');
                w.writeString(payload.from || '');
                w.writeString(payload.to || '');
                w.writeString(payload.newText || '');
                break;
            }
            default:
                return null; // Fallback to JSON
        }
        return w.getBytes();
    }

    function deserializeCompact(opcode, bytes) {
        const r = new ByteReader(bytes);
        const marker = r.readUint8();
        if (marker !== 0x00) return null;

        switch (opcode) {
            case OPCODES.PING:
            case OPCODES.PONG: {
                return { t: r.readUint64() };
            }
            case OPCODES.ACK: {
                return { seq: r.readUint16(), id: r.readString() };
            }
            case OPCODES.TYPING:
            case OPCODES.STOP_TYPING: {
                return { from: r.readString(), to: r.readString(), isGroup: r.readUint8() === 1 };
            }
            case OPCODES.MARK_READ: {
                return { from: r.readString(), to: r.readString(), isGroup: r.readUint8() === 1 };
            }
            case OPCODES.MSG_READ_ACK: {
                return { chatKId: r.readString() };
            }
            case OPCODES.REACTION: {
                return { id: r.readString(), from: r.readString(), to: r.readString(), emoji: r.readString() };
            }
            case OPCODES.MSG_PIN: {
                return { id: r.readString(), from: r.readString(), to: r.readString(), isPin: r.readUint8() === 1 };
            }
            case OPCODES.MSG_DELETE: {
                return { id: r.readString(), from: r.readString(), to: r.readString() };
            }
            case OPCODES.MSG_EDIT: {
                return { id: r.readString(), from: r.readString(), to: r.readString(), newText: r.readString() };
            }
            default:
                return null;
        }
    }

    let globalSeq = 0;

    const KNXProto = {
        VERSION: PROTO_VERSION,
        OPCODES,
        OPCODE_NAMES,
        lastRTT: null,

        /**
         * Next incremental sequence number (like MTProto seq_no)
         */
        nextSeq() {
            globalSeq = (globalSeq + 1) & 0xFFFF;
            return globalSeq;
        },

        /**
         * Packs a message payload into a binary KNX-Proto frame:
         * [0..1]   Magic: 0x4B 0x50 ('KP')
         * [2]      Version: 0x02
         * [3]      Opcode: uint8
         * [4..5]   Sequence Number: uint16 (Big-Endian)
         * [6..13]  Timestamp: uint64 (Big-Endian ms)
         * [14..17] Payload Length: uint32 (Big-Endian)
         * [18..21] CRC32 Checksum: uint32 (Big-Endian)
         * [22..N]  Payload Bytes (Compact Binary or JSON)
         */
        pack(opcode, payload, seqNo = null) {
            const seq = (seqNo !== null) ? (seqNo & 0xFFFF) : this.nextSeq();
            const now = Date.now();

            let payloadBytes;

            // Attempt compact binary serialization first
            if (payload instanceof Uint8Array) {
                payloadBytes = payload;
            } else if (typeof payload === 'object' && payload !== null) {
                const compact = serializeCompact(opcode, payload);
                if (compact) {
                    payloadBytes = compact;
                } else {
                    // JSON format with 0x01 prefix marker
                    const jsonStr = JSON.stringify(payload);
                    const encoded = encodeStr(jsonStr);
                    payloadBytes = new Uint8Array(1 + encoded.length);
                    payloadBytes[0] = 0x01; // JSON marker
                    payloadBytes.set(encoded, 1);
                }
            } else if (typeof payload === 'string') {
                const encoded = encodeStr(payload);
                payloadBytes = new Uint8Array(1 + encoded.length);
                payloadBytes[0] = 0x01;
                payloadBytes.set(encoded, 1);
            } else {
                payloadBytes = new Uint8Array([0x01, 0x7B, 0x7D]); // '{}'
            }

            const payloadLen = payloadBytes.length;
            const crc = calculateCRC32(payloadBytes, 0, payloadLen);
            const totalLen = HEADER_SIZE + payloadLen;

            const buffer = new ArrayBuffer(totalLen);
            const view = new DataView(buffer);
            const uint8 = new Uint8Array(buffer);

            // Magic & Version
            view.setUint8(0, MAGIC_0);
            view.setUint8(1, MAGIC_1);
            view.setUint8(2, PROTO_VERSION);
            view.setUint8(3, opcode & 0xFF);

            // Seq & Timestamp
            view.setUint16(4, seq, false);
            const highTime = Math.floor(now / 0x100000000);
            const lowTime = now >>> 0;
            view.setUint32(6, highTime, false);
            view.setUint32(10, lowTime, false);

            // Length & CRC32
            view.setUint32(14, payloadLen, false);
            view.setUint32(18, crc, false);

            // Body
            uint8.set(payloadBytes, HEADER_SIZE);

            return (typeof Buffer !== 'undefined' && !(payload instanceof ArrayBuffer))
                ? Buffer.from(buffer)
                : uint8;
        },

        /**
         * Unpacks and verifies a binary KNX-Proto frame
         */
        unpack(input) {
            if (!input) return null;

            let bytes;
            if (input instanceof ArrayBuffer) {
                bytes = new Uint8Array(input);
            } else if (input.buffer instanceof ArrayBuffer && input.byteOffset !== undefined) {
                bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
            } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
                bytes = new Uint8Array(input);
            } else {
                return null;
            }

            if (bytes.length < HEADER_SIZE) {
                throw new Error('KNX-Proto: Packet too small for header (' + bytes.length + ' bytes)');
            }

            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

            const m0 = view.getUint8(0);
            const m1 = view.getUint8(1);
            if (m0 !== MAGIC_0 || m1 !== MAGIC_1) {
                throw new Error(`KNX-Proto: Invalid magic header (0x${m0.toString(16)}, 0x${m1.toString(16)})`);
            }

            const version = view.getUint8(2);
            const opcode = view.getUint8(3);
            const seq = view.getUint16(4, false);

            const highTime = view.getUint32(6, false);
            const lowTime = view.getUint32(10, false);
            const timestamp = (highTime * 0x100000000) + lowTime;

            const payloadLen = view.getUint32(14, false);
            const expectedCRC = view.getUint32(18, false);

            if (bytes.length < HEADER_SIZE + payloadLen) {
                throw new Error(`KNX-Proto: Truncated packet. Expected ${HEADER_SIZE + payloadLen}, got ${bytes.length}`);
            }

            const payloadSlice = bytes.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);

            // Verify packet integrity with CRC32
            const actualCRC = calculateCRC32(payloadSlice, 0, payloadLen);
            if (actualCRC !== expectedCRC) {
                throw new Error(`KNX-Proto: CRC32 checksum mismatch (expected: 0x${expectedCRC.toString(16)}, got: 0x${actualCRC.toString(16)})`);
            }

            // Parse payload (Compact binary or JSON)
            let payload = null;
            if (payloadSlice.length > 0 && payloadSlice[0] === 0x00) {
                payload = deserializeCompact(opcode, payloadSlice);
            }

            if (payload === null && payloadSlice.length > 0) {
                try {
                    let jsonSlice = payloadSlice;
                    if (payloadSlice[0] === 0x01) {
                        jsonSlice = payloadSlice.subarray(1); // skip marker
                    }
                    const text = decodeStr(jsonSlice);
                    payload = JSON.parse(text);
                } catch (e) {
                    payload = payloadSlice; // Raw binary fallback
                }
            }

            return {
                version,
                opcode,
                opcodeName: OPCODE_NAMES[opcode] || 'UNKNOWN_0x' + opcode.toString(16),
                seq,
                timestamp,
                payload
            };
        },

        /**
         * Fast check if a buffer starts with KNX-Proto magic bytes
         */
        isKNXPacket(input) {
            if (!input) return false;
            if (input.length < 2) return false;
            const b0 = (input[0] !== undefined) ? input[0] : (new Uint8Array(input))[0];
            const b1 = (input[1] !== undefined) ? input[1] : (new Uint8Array(input))[1];
            return b0 === MAGIC_0 && b1 === MAGIC_1;
        },

        /**
         * Sliding anti-replay window tracker (MTProto style)
         */
        createReplayWindow(windowSize = 1000, maxTimeDriftMs = 300000) {
            const seen = new Set();
            return {
                isValid(seq, timestamp) {
                    const now = Date.now();
                    if (Math.abs(now - timestamp) > maxTimeDriftMs) {
                        return false; // Stale or futuristic packet
                    }
                    const key = `${seq}:${timestamp}`;
                    if (seen.has(key)) {
                        return false; // Replay attack detected
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

        /**
         * XSS and SVG Sanitizer helper
         */
        sanitize: {
            text(str) {
                if (typeof str !== 'string') return '';
                return str.replace(/[&<>'"]/g, match => {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match];
                });
            },

            isSafeDataUrl(url) {
                if (typeof url !== 'string' || !url) return true;
                if (!url.startsWith('data:')) return true;

                if (url.includes('image/svg+xml')) {
                    const decoded = decodeURIComponent(url);
                    if (/<script/i.test(decoded) || /javascript:/i.test(decoded) || /onload=/i.test(decoded) || /onerror=/i.test(decoded)) {
                        return false;
                    }
                }
                return true;
            }
        }
    };

    return KNXProto;
}));
