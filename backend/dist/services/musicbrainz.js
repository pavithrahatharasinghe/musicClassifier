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
exports.MusicBrainzService = void 0;
const axios_1 = __importDefault(require("axios"));
const MB_HEADERS = {
    'User-Agent': 'MusicClassifier/4.0 ( media@example.com )'
};
const MB_BASE = 'https://musicbrainz.org/ws/2';
class MusicBrainzService {
    /**
     * Search MusicBrainz public API for high-fidelity metadata.
     */
    searchMetadata(query) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            try {
                const response = yield axios_1.default.get(`${MB_BASE}/recording/`, {
                    params: { query: `recording:"${query}"`, fmt: 'json', limit: 1 },
                    headers: MB_HEADERS
                });
                if (((_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.recordings) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                    const record = response.data.recordings[0];
                    return {
                        artist: ((_d = (_c = record['artist-credit']) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.name) || '',
                        title: record.title || '',
                        isrc: ((_e = record.isrcs) === null || _e === void 0 ? void 0 : _e[0]) || null,
                        releaseYear: ((_h = (_g = (_f = record.releases) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.date) === null || _h === void 0 ? void 0 : _h.substring(0, 4)) || null,
                    };
                }
                return null;
            }
            catch (error) {
                console.error('MusicBrainz API Error:', error);
                return null;
            }
        });
    }
    /**
     * Check whether a recording has a music video release.
     *
     * Strategy:
     *  1. Search for the recording by name to get MusicBrainz IDs.
     *  2. For each candidate, fetch the individual recording with ?inc=url-rels
     *     (url-rels do NOT come back in the search endpoint, only on lookup).
     *  3. Look for relations of type 'music video' or 'video streaming'.
     *
     * Returns 'available', 'unavailable', or 'unknown' (on network error).
     */
    checkVideoRelease(query) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                // Step 1: Search for recordings by name (no inc= here — it doesn't work on search)
                const searchRes = yield axios_1.default.get(`${MB_BASE}/recording/`, {
                    params: { query: `recording:"${query}"`, fmt: 'json', limit: 5 },
                    headers: MB_HEADERS
                });
                const recordings = ((_a = searchRes.data) === null || _a === void 0 ? void 0 : _a.recordings) || [];
                if (recordings.length === 0) {
                    // Try a looser query without quotes
                    const looseRes = yield axios_1.default.get(`${MB_BASE}/recording/`, {
                        params: { query, fmt: 'json', limit: 5 },
                        headers: MB_HEADERS
                    });
                    recordings.push(...(((_b = looseRes.data) === null || _b === void 0 ? void 0 : _b.recordings) || []));
                }
                if (recordings.length === 0) {
                    return 'unavailable';
                }
                // Step 2: Lookup each recording individually with url-rels
                // MusicBrainz rate-limits to ~1 req/sec; check up to 3 to be safe
                const candidates = recordings.slice(0, 3);
                for (const rec of candidates) {
                    try {
                        // Add a small delay to respect the MB rate limit
                        yield new Promise(r => setTimeout(r, 350));
                        const lookupRes = yield axios_1.default.get(`${MB_BASE}/recording/${rec.id}`, {
                            params: { fmt: 'json', inc: 'url-rels' },
                            headers: MB_HEADERS
                        });
                        const relations = ((_c = lookupRes.data) === null || _c === void 0 ? void 0 : _c.relations) || [];
                        const hasVideo = relations.some((rel) => {
                            var _a;
                            return rel.type === 'music video' ||
                                rel.type === 'video streaming' ||
                                (((_a = rel.url) === null || _a === void 0 ? void 0 : _a.resource) && rel.url.resource.includes('youtube'));
                        });
                        if (hasVideo)
                            return 'available';
                    }
                    catch (lookupErr) {
                        // If a single lookup fails, continue to the next
                        console.error(`MusicBrainz lookup failed for ${rec.id}:`, lookupErr);
                    }
                }
                return 'unavailable';
            }
            catch (error) {
                console.error('MusicBrainz video release check error:', error);
                return 'unknown';
            }
        });
    }
}
exports.MusicBrainzService = MusicBrainzService;
