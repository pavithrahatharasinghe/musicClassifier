"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpotifyService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
// ─── TOTP (Spotify Web Player anonymous token) ────────────────────────────────
// Secret / version reverse-engineered by the SpotiFLAC project
// (https://github.com/afkarxyz/SpotiFLAC) – no Spotify account required.
const TOTP_SECRET = 'GM3TMMJTGYZTQNZVGM4DINJZHA4TGOBYGMZTCMRTGEYDSMJRHE4TEOBUG4YTCMRUGQ4DQOJUGQYTAMRRGA2TCMJSHE3TCMBY';
const TOTP_VERSION = 61;
function base32Decode(b32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0;
    const output = [];
    for (const char of b32.toUpperCase().replace(/=+$/, '')) {
        const idx = alphabet.indexOf(char);
        if (idx === -1)
            continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}
function generateTOTP(secret, step = 30) {
    const key = base32Decode(secret);
    const counter = Math.floor(Date.now() / 1000 / step);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto_1.default.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24) |
        (hmac[offset + 1] << 16) |
        (hmac[offset + 2] << 8) |
        hmac[offset + 3];
    return String(code % 1000000).padStart(6, '0');
}
function scoreTrack(track, query) {
    const q = query.toLowerCase();
    const name = track.name.toLowerCase();
    let s = 0;
    if (name === q) {
        s += 100;
    }
    else if (q.includes(name)) {
        s += 30;
    }
    for (const a of track.artists) {
        if (q.includes(a.name.toLowerCase()))
            s += 20;
    }
    return s;
}
// ─── SpotifyService ────────────────────────────────────────────────────────────
class SpotifyService {
    constructor() {
        this.cachedToken = null;
        this.tokenExpiry = 0;
    }
    /**
     * Fetches an anonymous Spotify Web Player access token using the same
     * TOTP-based approach as the SpotiFLAC project. No developer credentials needed.
     */
    getAccessToken() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this.cachedToken && Date.now() < this.tokenExpiry) {
                return this.cachedToken;
            }
            try {
                const totpCode = generateTOTP(TOTP_SECRET);
                const url = new URL('https://open.spotify.com/api/token');
                url.searchParams.set('reason', 'init');
                url.searchParams.set('productType', 'web-player');
                url.searchParams.set('totp', totpCode);
                url.searchParams.set('totpVer', String(TOTP_VERSION));
                url.searchParams.set('totpServer', totpCode);
                const res = yield axios_1.default.get(url.toString(), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                    },
                });
                const token = (_a = res.data) === null || _a === void 0 ? void 0 : _a.accessToken;
                if (!token) {
                    console.error('Spotify anonymous token response had no accessToken field');
                    return null;
                }
                this.cachedToken = token;
                // Spotify web-player tokens typically expire in ~1 hour; refresh 60 s early
                this.tokenExpiry = Date.now() + (3600 - 60) * 1000;
                return token;
            }
            catch (error) {
                console.error('Failed to get Spotify anonymous token:', error);
                return null;
            }
        });
    }
    /**
     * Removes common video title noise (e.g. "Official Music Video", "[4K]", "(MV)")
     * so the query sent to Spotify's search is as clean as possible.
     */
    cleanQuery(raw) {
        return raw
            .replace(/[\[(][^\])]*(official|mv|m\/v|music video|video|hd|4k|uhd|lyric|audio|ver\.?|version|ft\.?|feat\.?)[^\])]*[\])]/gi, '')
            .replace(/\b(official music video|official video|music video|official mv|official m\/v|official audio|lyric video|official lyric|hd|4k|uhd)\b/gi, '')
            .replace(/[-–|]+\s*$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }
    /**
     * Searches Spotify for a track matching the provided song name and returns
     * the canonical track URL in the format https://open.spotify.com/track/{id}.
     *
     * Fetches the top 5 results and picks the best match using a simple scoring
     * function that rewards exact name matches and artist name presence in the query.
     */
    findTrackUrl(songName) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const token = yield this.getAccessToken();
                if (!token)
                    return null;
                const query = this.cleanQuery(songName);
                const res = yield axios_1.default.get('https://api.spotify.com/v1/search', {
                    params: { q: query, type: 'track', limit: 5 },
                    headers: { Authorization: `Bearer ${token}` },
                });
                const items = (_b = (_a = res.data) === null || _a === void 0 ? void 0 : _a.tracks) === null || _b === void 0 ? void 0 : _b.items;
                if (!items || items.length === 0)
                    return null;
                let best = items[0];
                let bestScore = scoreTrack(best, query);
                for (let i = 1; i < items.length; i++) {
                    const sc = scoreTrack(items[i], query);
                    if (sc > bestScore) {
                        best = items[i];
                        bestScore = sc;
                    }
                }
                return `https://open.spotify.com/track/${best.id}`;
            }
            catch (error) {
                console.error('Spotify search failed:', error);
                return null;
            }
        });
    }
}
exports.SpotifyService = SpotifyService;
