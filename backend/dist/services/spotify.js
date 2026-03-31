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
class SpotifyService {
    constructor() {
        this.accessToken = null;
        this.tokenExpiry = 0;
    }
    get clientId() {
        return process.env.SPOTIFY_CLIENT_ID || '';
    }
    get clientSecret() {
        return process.env.SPOTIFY_CLIENT_SECRET || '';
    }
    getAccessToken() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.accessToken && Date.now() < this.tokenExpiry) {
                return this.accessToken;
            }
            if (!this.clientId || !this.clientSecret) {
                console.error('Spotify credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your environment.');
                return null;
            }
            try {
                const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
                const res = yield axios_1.default.post('https://accounts.spotify.com/api/token', new URLSearchParams({ grant_type: 'client_credentials' }).toString(), {
                    headers: {
                        Authorization: `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                });
                this.accessToken = res.data.access_token;
                // Refresh 60 seconds before actual expiry to avoid using a token that expires mid-request
                this.tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
                return this.accessToken;
            }
            catch (error) {
                console.error('Failed to get Spotify access token:', error);
                return null;
            }
        });
    }
    /**
     * Searches Spotify for a track matching the provided song name and returns
     * the canonical track URL in the format https://open.spotify.com/track/{id}.
     */
    findTrackUrl(songName) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const token = yield this.getAccessToken();
                if (!token)
                    return null;
                const res = yield axios_1.default.get('https://api.spotify.com/v1/search', {
                    params: {
                        q: songName,
                        type: 'track',
                        limit: 1,
                    },
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                const tracks = (_b = (_a = res.data) === null || _a === void 0 ? void 0 : _a.tracks) === null || _b === void 0 ? void 0 : _b.items;
                if (tracks && tracks.length > 0) {
                    const trackId = tracks[0].id;
                    return `https://open.spotify.com/track/${trackId}`;
                }
                return null;
            }
            catch (error) {
                console.error('Spotify search failed:', error);
                return null;
            }
        });
    }
}
exports.SpotifyService = SpotifyService;
