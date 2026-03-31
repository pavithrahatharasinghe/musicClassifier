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
class MusicBrainzService {
    /**
     * Search MusicBrainz public API for high-fidelity metadata.
     * Note: The API allows anonymous requests but requires a proper User-Agent.
     */
    searchMetadata(query) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            try {
                const response = yield axios_1.default.get('https://musicbrainz.org/ws/2/recording/', {
                    params: {
                        query: `recording:"${query}"`,
                        fmt: 'json',
                        limit: 1
                    },
                    headers: {
                        'User-Agent': 'MusicClassifier/4.0 ( media@example.com )'
                    }
                });
                if (response.data && response.data.recordings && response.data.recordings.length > 0) {
                    const record = response.data.recordings[0];
                    const artist = ((_b = (_a = record['artist-credit']) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.name) || '';
                    const title = record.title || '';
                    const isrc = ((_c = record.isrcs) === null || _c === void 0 ? void 0 : _c[0]) || null;
                    const releaseYear = ((_f = (_e = (_d = record.releases) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.date) === null || _f === void 0 ? void 0 : _f.substring(0, 4)) || null;
                    return { artist, title, isrc, releaseYear };
                }
                return null;
            }
            catch (error) {
                console.error('MusicBrainz API Error:', error);
                return null;
            }
        });
    }
}
exports.MusicBrainzService = MusicBrainzService;
