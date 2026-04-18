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
exports.OllamaService = void 0;
const axios_1 = __importDefault(require("axios"));
class OllamaService {
    constructor(baseUrl = 'http://localhost:11434') {
        this.baseUrl = baseUrl;
    }
    getModels() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield axios_1.default.get(`${this.baseUrl}/api/tags`);
                if (response.data && response.data.models) {
                    return response.data.models.map((m) => m.name);
                }
                return [];
            }
            catch (e) {
                console.error('Error fetching models:', e);
                return [];
            }
        });
    }
    findMatches(audioFiles, videoFiles, model) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                if (audioFiles.length === 0 || videoFiles.length === 0)
                    return [];
                const audioNames = audioFiles.map(a => a.baseName);
                const videoNames = videoFiles.map(v => v.baseName);
                const prompt = `You are an intelligent file matching system. 
      I have a list of Audio files and a list of Video files. 
      Task: Match the audio file to its corresponding video file based on semantic similarity of the names (e.g. "Artist - Song" matches "Artist - Song (Official Video)").
      
      Audio Files:
      ${JSON.stringify(audioNames)}
      
      Video Files:
      ${JSON.stringify(videoNames)}
      
      Return ONLY a valid JSON object with a single key "matches" containing an array of matched pairs. Each pair must be an object with "audioName" and "videoName".
      Example: { "matches": [{"audioName": "Song A", "videoName": "Song A (Official Video)"}] }
      Do not include any other text.`;
                const response = yield axios_1.default.post(`${this.baseUrl}/api/generate`, {
                    model: model || 'llama3',
                    prompt: prompt,
                    format: 'json',
                    stream: false
                });
                const responseText = response.data.response;
                const parseMatches = (text) => {
                    const result = JSON.parse(text);
                    if (result && Array.isArray(result.matches)) {
                        const finalPairs = [];
                        for (const m of result.matches) {
                            const clean = (str) => (str || '').replace(/['"]/g, '').toLowerCase().trim();
                            const originalAudio = audioFiles.find(a => clean(a.baseName) === clean(m.audioName));
                            const originalVideo = videoFiles.find(v => clean(v.baseName) === clean(m.videoName));
                            if (originalAudio && originalVideo) {
                                finalPairs.push({
                                    audioName: originalAudio.baseName,
                                    videoName: originalVideo.baseName
                                });
                            }
                        }
                        return finalPairs;
                    }
                    return [];
                };
                try {
                    return parseMatches(responseText.trim());
                }
                catch (parseError) {
                    // Fallback regex if format:json misbehaves
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        return parseMatches(jsonMatch[0]);
                    }
                    throw new Error("Ollama returned malformed JSON: " + responseText);
                }
            }
            catch (error) {
                console.error('Error in Ollama findMatches:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                throw new Error(((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.error) || error.message || 'Failed to communicate with Ollama');
            }
        });
    }
    classify(filename, model) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                const prompt = `You are a music and video classification assistant. Analyze the following filename: "${filename}".
      Return ONLY a valid JSON object with exactly these fields:
      - "genre": MUST be exactly one of: "K-Pop", "J-Pop", or "English". No other genre is allowed.
        * Use "K-Pop" for Korean-language or Korean-origin pop music.
        * Use "J-Pop" for Japanese-language or Japanese-origin pop music.
        * Use "English" for any Western / English-language artist.
        * If unsure, default to "English".
      - "cleanName": the clean "Artist - Title" format reconstructed from the filename.
      - "matchConfidence": a number between 0 and 1 indicating how confident you are.

      Do not include any other text, code blocks, or markdown. Only the raw JSON object.`;
                const response = yield axios_1.default.post(`${this.baseUrl}/api/generate`, {
                    model: model || 'llama3',
                    prompt: prompt,
                    format: 'json',
                    stream: false
                });
                const responseText = response.data.response;
                try {
                    const result = JSON.parse(responseText.trim());
                    return result;
                }
                catch (parseError) {
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const result = JSON.parse(jsonMatch[0]);
                        return result;
                    }
                    throw new Error("Ollama returned malformed JSON: " + responseText);
                }
            }
            catch (error) {
                console.error('Error calling Ollama API classification:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                throw new Error(((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.error) || error.message || 'Failed to communicate with Ollama');
            }
        });
    }
    cleanQuery(filename, model) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const prompt = `Task: Extract ONLY the pure Artist and Song Name from this chaotic filename.
      Filename: "${filename}"
      Rules:
      - Remove terms like "Official Video", "MV", "1080p", "Lyrics", "Audio", bracketed tags.
      - Return ONLY the cleaned-up string. Do not include markdown or quotes.
      Example Output: BTS Dynamite`;
                const response = yield axios_1.default.post(`${this.baseUrl}/api/generate`, {
                    model: model || 'llama3',
                    prompt: prompt,
                    stream: false
                });
                return response.data.response.trim();
            }
            catch (error) {
                console.error('Error cleaning query:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                return filename; // Fallback to raw filename if ollama fails
            }
        });
    }
    categorize(filename, internetMetadata, model) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const prompt = `You are an AI Librarian for a music and music video collection.
      I have a file named: "${filename}".
      I automatically searched the Apple Music API for this song and found these potential internet matches:
      ${JSON.stringify(internetMetadata)}

      Task: Based on the filename and the internet data, classify the final destination for this file.

      Rules for "verifiedCategory" — CRITICAL:
      - The value MUST be exactly one of these three strings: "K-Pop", "J-Pop", or "English".
      - NO other categories are allowed (not "Rock", "Pop", "Hip-Hop", "R&B", etc.).
      - Use "K-Pop" for Korean-origin pop artists (e.g. BTS, BLACKPINK, aespa).
      - Use "J-Pop" for Japanese-origin pop artists (e.g. YOASOBI, Ado, LiSA).
      - Use "English" for all Western / English-language artists (e.g. Taylor Swift, Ed Sheeran, Ariana Grande).
      - If in doubt, use "English".

      Rules for "isOfficialVideo":
      - Evaluate the RAW filename. If it contains words like "Official Video", "MV", "Music Video", set true. Else false.

      Rules for "cleanName":
      - Provide the official "Artist - Track" string (e.g., "Taylor Swift - Blank Space").

      Return ONLY a valid JSON object:
      {
        "verifiedCategory": "K-Pop" | "J-Pop" | "English",
        "isOfficialVideo": boolean,
        "cleanName": "string"
      }
      Do not include any other text or markdown.`;
                const response = yield axios_1.default.post(`${this.baseUrl}/api/generate`, {
                    model: model || 'llama3',
                    prompt: prompt,
                    format: 'json',
                    stream: false
                });
                const responseText = response.data.response;
                try {
                    return JSON.parse(responseText.trim());
                }
                catch (parseError) {
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
                }
            }
            catch (error) {
                console.error('Error in categorize:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                throw new Error('AI Takeover classification failed.');
            }
        });
    }
}
exports.OllamaService = OllamaService;
