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
exports.YouTubeService = void 0;
const yt_search_1 = __importDefault(require("yt-search"));
class YouTubeService {
    /**
     * Searches YouTube for an official music video of the provided track name.
     * Uses yt-search which crawls youtube natively without requiring an API Key.
     */
    findOfficialVideoSync(songName) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const query = `${songName} Official Music Video`;
                const result = yield (0, yt_search_1.default)(query);
                if (result && result.videos && result.videos.length > 0) {
                    // Return the first valid youtube video URL
                    return result.videos[0].url;
                }
                return null;
            }
            catch (error) {
                console.error('YouTube Search Failed:', error);
                return null;
            }
        });
    }
}
exports.YouTubeService = YouTubeService;
