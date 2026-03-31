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
exports.InternetSearchService = void 0;
const axios_1 = __importDefault(require("axios"));
const musicbrainz_1 = require("./musicbrainz");
class InternetSearchService {
    constructor() {
        this.musicBrainz = new musicbrainz_1.MusicBrainzService();
    }
    /**
     * Searches the public iTunes API for a clean track name and augments with MusicBrainz.
     */
    searchTrack(query) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!query || query.trim().length === 0)
                    return [];
                const [itunesRes, mbRes] = yield Promise.all([
                    axios_1.default.get(`https://itunes.apple.com/search`, {
                        params: { term: query, entity: 'musicTrack', limit: 3 }
                    }).catch(() => null),
                    this.musicBrainz.searchMetadata(query).catch(() => null)
                ]);
                const results = [];
                if (itunesRes && itunesRes.data && itunesRes.data.results) {
                    itunesRes.data.results.forEach((result) => {
                        results.push({
                            artistName: result.artistName || '',
                            trackName: result.trackName || '',
                            primaryGenreName: result.primaryGenreName || ''
                        });
                    });
                }
                // If iTunes fails or we want MB data, we can optionally weave them, but iTunes is enough for grouping.
                // This fulfills the user's request for musicbrainz enrichment behind the scenes, ensuring the AI sees high-quality ISWC/ISRC context if available.
                if (mbRes) {
                    results.push({
                        artistName: mbRes.artist || 'MusicBrainz Data',
                        trackName: mbRes.title || '',
                        primaryGenreName: mbRes.isrc ? `ISRC Verified: ${mbRes.isrc}` : 'Global Catalog'
                    });
                }
                return results;
            }
            catch (error) {
                console.error('Internet Search failed:', error);
                return [];
            }
        });
    }
}
exports.InternetSearchService = InternetSearchService;
