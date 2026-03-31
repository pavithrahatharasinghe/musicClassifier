"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class ScannerService {
    constructor(config) {
        this.ollamaMatches = new Map(); // audioBaseName -> videoBaseName
        this.config = config;
        this.ensureDirectoryExists(this.config.audioDir);
        this.ensureDirectoryExists(this.config.videoDir);
        this.ensureDirectoryExists(this.config.destDir);
    }
    setConfig(config) {
        this.config = config;
        this.ensureDirectoryExists(this.config.audioDir);
        this.ensureDirectoryExists(this.config.videoDir);
        this.ensureDirectoryExists(this.config.destDir);
    }
    ensureDirectoryExists(dir) {
        if (dir && !fs_1.default.existsSync(dir)) {
            try {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            catch (e) {
                console.error(`Failed to create dir: ${dir}`, e);
            }
        }
    }
    getFiles(dir, allowedExts, type) {
        if (!dir || !fs_1.default.existsSync(dir))
            return [];
        const files = fs_1.default.readdirSync(dir);
        return files
            .map(file => {
            const ext = path_1.default.extname(file).toLowerCase();
            if (!allowedExts.includes(ext))
                return null;
            return {
                filename: file,
                baseName: path_1.default.basename(file, ext),
                extension: ext,
                absolutePath: path_1.default.join(dir, file),
                type
            };
        })
            .filter((f) => f !== null);
    }
    getMatchState() {
        const audioFiles = this.getFiles(this.config.audioDir, ['.flac'], 'Music');
        const videoFiles = this.getFiles(this.config.videoDir, ['.mp4', '.mkv'], 'Video');
        const matchedPairs = [];
        const unmatchedAudio = [];
        let unmatchedVideo = [...videoFiles];
        for (const audio of audioFiles) {
            // Check Exact Match
            const exactVideoIndex = unmatchedVideo.findIndex(v => v.baseName === audio.baseName);
            if (exactVideoIndex !== -1) {
                matchedPairs.push({
                    id: `exact-${audio.baseName}`,
                    audioFile: audio,
                    videoFile: unmatchedVideo[exactVideoIndex],
                    status: 'exact'
                });
                unmatchedVideo.splice(exactVideoIndex, 1);
                continue;
            }
            // Check Ollama Match
            const ollamaVideoName = this.ollamaMatches.get(audio.baseName);
            if (ollamaVideoName) {
                const ollamaVideoIndex = unmatchedVideo.findIndex(v => v.baseName === ollamaVideoName);
                if (ollamaVideoIndex !== -1) {
                    matchedPairs.push({
                        id: `ollama-${audio.baseName}`,
                        audioFile: audio,
                        videoFile: unmatchedVideo[ollamaVideoIndex],
                        status: 'ollama'
                    });
                    unmatchedVideo.splice(ollamaVideoIndex, 1);
                    continue;
                }
            }
            unmatchedAudio.push(audio);
        }
        return {
            unmatchedAudio,
            unmatchedVideo,
            matchedPairs
        };
    }
    addOllamaMatches(matches) {
        for (const match of matches) {
            if (match.audioName && match.videoName) {
                this.ollamaMatches.set(match.audioName, match.videoName);
            }
        }
    }
    removeMatch(audioBaseName) {
        this.ollamaMatches.delete(audioBaseName);
    }
    moveFileSafely(src, dest) {
        try {
            fs_1.default.renameSync(src, dest);
        }
        catch (err) {
            if (err.code === 'EXDEV') {
                fs_1.default.copyFileSync(src, dest);
                fs_1.default.unlinkSync(src);
            }
            else {
                throw err;
            }
        }
    }
    movePair(id, category) {
        const state = this.getMatchState();
        const pairToMove = state.matchedPairs.find(p => p.id === id);
        if (!pairToMove)
            return false;
        const destFolder = path_1.default.join(this.config.destDir, category.toLowerCase());
        this.ensureDirectoryExists(destFolder);
        try {
            const destAudio = path_1.default.join(destFolder, pairToMove.audioFile.filename);
            this.moveFileSafely(pairToMove.audioFile.absolutePath, destAudio);
            const destVideo = path_1.default.join(destFolder, pairToMove.videoFile.filename);
            this.moveFileSafely(pairToMove.videoFile.absolutePath, destVideo);
            // Remove from ollama memory to keep it clean
            this.ollamaMatches.delete(pairToMove.audioFile.baseName);
            return true;
        }
        catch (error) {
            console.error('Error moving file:', error);
            return false;
        }
    }
    aiMovePair(id, category, isOfficialVideo) {
        const state = this.getMatchState();
        const pairToMove = state.matchedPairs.find(p => p.id === id);
        if (!pairToMove)
            return false;
        let destFolder = path_1.default.join(this.config.destDir, category);
        if (isOfficialVideo) {
            destFolder = path_1.default.join(destFolder, 'Official Videos');
        }
        this.ensureDirectoryExists(destFolder);
        try {
            const destAudio = path_1.default.join(destFolder, pairToMove.audioFile.filename);
            this.moveFileSafely(pairToMove.audioFile.absolutePath, destAudio);
            const destVideo = path_1.default.join(destFolder, pairToMove.videoFile.filename);
            this.moveFileSafely(pairToMove.videoFile.absolutePath, destVideo);
            this.ollamaMatches.delete(pairToMove.audioFile.baseName);
            return true;
        }
        catch (error) {
            console.error('Error moving file with AI:', error);
            return false;
        }
    }
}
exports.ScannerService = ScannerService;
