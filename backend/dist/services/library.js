"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
class LibraryService {
    constructor(config) {
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
    /**
     * Syncs the physical disk directories to SQLite.
     * Inserts new files, deletes missing ones.
     */
    syncDisk() {
        if (!fs_1.default.existsSync(this.config.audioDir) || !fs_1.default.existsSync(this.config.videoDir))
            return;
        const audioFiles = fs_1.default.readdirSync(this.config.audioDir).filter(f => f.endsWith('.flac'));
        const videoFiles = fs_1.default.readdirSync(this.config.videoDir).filter(f => f.endsWith('.mp4') || f.endsWith('.mkv'));
        // Current files on disk (absolute paths)
        const diskPaths = new Set([
            ...audioFiles.map(f => path_1.default.join(this.config.audioDir, f)),
            ...videoFiles.map(f => path_1.default.join(this.config.videoDir, f))
        ]);
        // 1. Delete rows that no longer exist on disk
        const allDbFiles = db_1.db.prepare('SELECT id, absolutePath FROM files').all();
        const deleteStmt = db_1.db.prepare('DELETE FROM files WHERE id = ?');
        for (const f of allDbFiles) {
            if (!diskPaths.has(f.absolutePath)) {
                deleteStmt.run(f.id);
            }
        }
        // 2. Insert new files
        const insertStmt = db_1.db.prepare(`
      INSERT OR IGNORE INTO files (id, filename, baseName, extension, absolutePath, type) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const processFile = (dir, file, type) => {
            const ext = path_1.default.extname(file).toLowerCase();
            const baseName = path_1.default.basename(file, ext);
            const absPath = path_1.default.join(dir, file);
            const id = crypto_1.default.createHash('md5').update(absPath).digest('hex');
            insertStmt.run(id, file, baseName, ext, absPath, type);
        };
        audioFiles.forEach(f => processFile(this.config.audioDir, f, 'Music'));
        videoFiles.forEach(f => processFile(this.config.videoDir, f, 'Video'));
        this.autoBuildExactPairs();
    }
    /**
     * Automatically pairs tracks that have the exact same baseName.
     */
    autoBuildExactPairs() {
        const unassignedAudio = db_1.db.prepare(`
      SELECT f.* FROM files f
      LEFT JOIN pairs p ON f.id = p.audioId
      WHERE p.id IS NULL AND f.type = 'Music'
    `).all();
        const insertPair = db_1.db.prepare(`
      INSERT OR IGNORE INTO pairs (id, audioId, videoId, status)
      VALUES (?, ?, ?, 'exact')
    `);
        for (const audio of unassignedAudio) {
            const matchingVideo = db_1.db.prepare(`
        SELECT f.* FROM files f
        LEFT JOIN pairs p ON f.id = p.videoId
        WHERE p.id IS NULL AND f.type = 'Video' AND f.baseName = ?
      `).get(audio.baseName);
            if (matchingVideo) {
                const pairId = `exact-${audio.id}`;
                insertPair.run(pairId, audio.id, matchingVideo.id);
            }
        }
    }
    getMatchState() {
        this.syncDisk();
        const unmatchedAudio = db_1.db.prepare(`
      SELECT f.* FROM files f LEFT JOIN pairs p ON f.id = p.audioId WHERE p.id IS NULL AND f.type = 'Music'
    `).all();
        const unmatchedVideo = db_1.db.prepare(`
      SELECT f.* FROM files f LEFT JOIN pairs p ON f.id = p.videoId WHERE p.id IS NULL AND f.type = 'Video'
    `).all();
        const matchedPairsRaw = db_1.db.prepare(`
      SELECT p.*, 
             a.filename as a_fn, a.baseName as a_bn, a.extension as a_ext, a.absolutePath as a_abs,
             v.filename as v_fn, v.baseName as v_bn, v.extension as v_ext, v.absolutePath as v_abs
      FROM pairs p
      JOIN files a ON p.audioId = a.id
      JOIN files v ON p.videoId = v.id
    `).all();
        const matchedPairs = matchedPairsRaw.map(r => ({
            id: r.id,
            status: r.status,
            audioFile: { id: r.audioId, type: 'Music', filename: r.a_fn, baseName: r.a_bn, extension: r.a_ext, absolutePath: r.a_abs },
            videoFile: { id: r.videoId, type: 'Video', filename: r.v_fn, baseName: r.v_bn, extension: r.v_ext, absolutePath: r.v_abs },
            aiResult: r.aiCategory ? { verifiedCategory: r.aiCategory, isOfficialVideo: r.isOfficial === 1, cleanName: r.cleanName } : undefined
        }));
        return { unmatchedAudio, unmatchedVideo, matchedPairs };
    }
    updateYoutubeUrl(fileId, url) {
        db_1.db.prepare('UPDATE files SET youtubeUrl = ? WHERE id = ?').run(url, fileId);
    }
    addOllamaMatches(matches) {
        const insertPair = db_1.db.prepare(`
      INSERT OR IGNORE INTO pairs (id, audioId, videoId, status)
      VALUES (?, ?, ?, 'ollama')
    `);
        for (const match of matches) {
            const a = db_1.db.prepare("SELECT id FROM files WHERE baseName = ? AND type = 'Music'").get(match.audioName);
            const v = db_1.db.prepare("SELECT id FROM files WHERE baseName = ? AND type = 'Video'").get(match.videoName);
            if (a && v) {
                insertPair.run(`ollama-${a.id}`, a.id, v.id);
            }
        }
    }
    removeMatch(pairId) {
        db_1.db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
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
    aiMovePair(pairId, category, isOfficialVideo) {
        const pair = db_1.db.prepare(`
      SELECT p.*, a.absolutePath as a_src, a.filename as a_fn, v.absolutePath as v_src, v.filename as v_fn 
      FROM pairs p
      JOIN files a ON p.audioId = a.id
      JOIN files v ON p.videoId = v.id
      WHERE p.id = ?
    `).get(pairId);
        if (!pair)
            return false;
        // Build the new v4 subfolder paths e.g., /organized/English/flac/ and /organized/English/video/
        let baseDest = path_1.default.join(this.config.destDir, category);
        if (isOfficialVideo) {
            baseDest = path_1.default.join(baseDest, 'Official Videos');
        }
        const audioDestFolder = path_1.default.join(baseDest, 'flac');
        const videoDestFolder = path_1.default.join(baseDest, 'video');
        this.ensureDirectoryExists(audioDestFolder);
        this.ensureDirectoryExists(videoDestFolder);
        try {
            this.moveFileSafely(pair.a_src, path_1.default.join(audioDestFolder, pair.a_fn));
            this.moveFileSafely(pair.v_src, path_1.default.join(videoDestFolder, pair.v_fn));
            db_1.db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
            db_1.db.prepare('DELETE FROM files WHERE id = ? OR id = ?').run(pair.audioId, pair.videoId);
            return true;
        }
        catch (error) {
            console.error('Error physically moving file:', error);
            return false;
        }
    }
}
exports.LibraryService = LibraryService;
