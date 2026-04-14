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
        if (this.config.downloadDir)
            this.ensureDirectoryExists(this.config.downloadDir);
    }
    setConfig(config) {
        this.config = config;
        this.ensureDirectoryExists(this.config.audioDir);
        this.ensureDirectoryExists(this.config.videoDir);
        this.ensureDirectoryExists(this.config.destDir);
        if (this.config.downloadDir)
            this.ensureDirectoryExists(this.config.downloadDir);
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
        let dlAudio = [];
        let dlVideo = [];
        if (this.config.downloadDir && fs_1.default.existsSync(this.config.downloadDir)) {
            const dlFiles = fs_1.default.readdirSync(this.config.downloadDir);
            dlAudio = dlFiles.filter(f => f.endsWith('.flac') || f.endsWith('.m4a') || f.endsWith('.mp3'));
            dlVideo = dlFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));
        }
        // Current files on disk (absolute paths)
        const diskPaths = new Set([
            ...audioFiles.map(f => path_1.default.join(this.config.audioDir, f)),
            ...videoFiles.map(f => path_1.default.join(this.config.videoDir, f)),
            ...dlAudio.map(f => path_1.default.join(this.config.downloadDir, f)),
            ...dlVideo.map(f => path_1.default.join(this.config.downloadDir, f))
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
        if (this.config.downloadDir) {
            dlAudio.forEach(f => processFile(this.config.downloadDir, f, 'Music'));
            dlVideo.forEach(f => processFile(this.config.downloadDir, f, 'Video'));
        }
        this.autoBuildExactPairs();
        this.autoBuildSmartFuzzyPairs();
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
    /**
     * Removes all non-exact pairs so they can be re-matched from scratch by AI.
     * Called only by the explicit /api/reset-matches route.
     */
    clearNonExactPairs() {
        db_1.db.prepare("DELETE FROM pairs WHERE status != 'exact'").run();
    }
    /**
     * Smart fuzzy pairing: only links audio→video when they share the SAME leading
     * artist token AND ≥90% of the remaining title words. This prevents cross-artist
     * false positives like "=LOVE - ヒロインズ" ↔ "2NE1 - I LOVE YOU MV".
     */
    autoBuildSmartFuzzyPairs() {
        const unassignedAudio = db_1.db.prepare(`
      SELECT f.* FROM files f
      LEFT JOIN pairs p ON f.id = p.audioId
      WHERE p.id IS NULL AND f.type = 'Music'
    `).all();
        const unassignedVideo = db_1.db.prepare(`
      SELECT f.* FROM files f
      LEFT JOIN pairs p ON f.id = p.videoId
      WHERE p.id IS NULL AND f.type = 'Video'
    `).all();
        if (unassignedAudio.length === 0 || unassignedVideo.length === 0)
            return;
        const insertPair = db_1.db.prepare(`
      INSERT OR IGNORE INTO pairs (id, audioId, videoId, status)
      VALUES (?, ?, ?, 'fuzzy')
    `);
        // Stop-words that are too common to be useful for matching
        const STOP = new Set(['mv', 'official', 'video', 'music', 'audio', 'the', 'a', 'an', 'and', 'in', 'of', 'to', 'is', 'ft', 'feat', 'with', 'live', 'version', 'edit', 'hd', '4k', '1080p', 'lyrics']);
        const tokenize = (str) => (str || '').toLowerCase()
            .replace(/[\(\)\[\]\{\}]/g, ' ')
            .replace(/[^a-z0-9\s가-힣ぁ-ん一-龯]/g, ' ')
            .split(/[\s\-_]+/)
            .map(w => w.trim())
            .filter(w => w.length > 1 && !STOP.has(w));
        const getArtist = (str) => {
            // Artist is everything before the first ' - ' separator
            const dashIdx = str.indexOf(' - ');
            if (dashIdx !== -1)
                return str.substring(0, dashIdx).toLowerCase().trim();
            return tokenize(str)[0] || '';
        };
        const availableVideos = [...unassignedVideo];
        for (const audio of unassignedAudio) {
            const aArtist = getArtist(audio.baseName);
            const aTokens = tokenize(audio.baseName);
            if (aTokens.length === 0)
                continue;
            let bestScore = 0;
            let bestVideo = null;
            let bestIdx = -1;
            for (let i = 0; i < availableVideos.length; i++) {
                const video = availableVideos[i];
                const vArtist = getArtist(video.baseName);
                const vTokens = tokenize(video.baseName);
                if (vTokens.length === 0)
                    continue;
                // Artist must match at least partially (prefix match or full match)
                const artistMatch = aArtist.length > 0 && vArtist.length > 0 &&
                    (aArtist.startsWith(vArtist) || vArtist.startsWith(aArtist) || aArtist === vArtist);
                if (!artistMatch)
                    continue;
                // Count how many audio tokens appear in video tokens
                let matches = 0;
                for (const t of aTokens) {
                    if (vTokens.includes(t))
                        matches++;
                }
                const score = matches / aTokens.length;
                if (score > bestScore) {
                    bestScore = score;
                    bestVideo = video;
                    bestIdx = i;
                }
            }
            // Require ≥90% of audio title words to match, AND artist must have matched
            if (bestScore >= 0.9 && bestVideo) {
                insertPair.run(`fuzzy-${audio.id}`, audio.id, bestVideo.id);
                availableVideos.splice(bestIdx, 1);
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
             a.filename as a_fn, a.baseName as a_bn, a.extension as a_ext, a.absolutePath as a_abs, a.youtubeUrl as a_yt, a.spotifyUrl as a_sp, a.previewUrl as a_pr, a.videoStatus as a_vs,
             v.filename as v_fn, v.baseName as v_bn, v.extension as v_ext, v.absolutePath as v_abs, v.youtubeUrl as v_yt, v.spotifyUrl as v_sp, v.previewUrl as v_pr
      FROM pairs p
      JOIN files a ON p.audioId = a.id
      JOIN files v ON p.videoId = v.id
    `).all();
        const matchedPairs = matchedPairsRaw.map(r => ({
            id: r.id,
            status: r.status,
            audioFile: { id: r.audioId, type: 'Music', filename: r.a_fn, baseName: r.a_bn, extension: r.a_ext, absolutePath: r.a_abs, youtubeUrl: r.a_yt, spotifyUrl: r.a_sp, previewUrl: r.a_pr, videoStatus: r.a_vs },
            videoFile: { id: r.videoId, type: 'Video', filename: r.v_fn, baseName: r.v_bn, extension: r.v_ext, absolutePath: r.v_abs, youtubeUrl: r.v_yt, spotifyUrl: r.v_sp, previewUrl: r.v_pr },
            aiResult: r.aiCategory ? { verifiedCategory: r.aiCategory, isOfficialVideo: r.isOfficial === 1, cleanName: r.cleanName } : undefined
        }));
        return { unmatchedAudio, unmatchedVideo, matchedPairs };
    }
    updateYoutubeUrl(fileId, url, previewUrl) {
        if (previewUrl) {
            db_1.db.prepare('UPDATE files SET youtubeUrl = ?, previewUrl = ? WHERE id = ?').run(url, previewUrl, fileId);
        }
        else {
            db_1.db.prepare('UPDATE files SET youtubeUrl = ? WHERE id = ?').run(url, fileId);
        }
    }
    updateSpotifyUrl(fileId, url, previewUrl) {
        if (previewUrl) {
            db_1.db.prepare('UPDATE files SET spotifyUrl = ?, previewUrl = ? WHERE id = ?').run(url, previewUrl, fileId);
        }
        else {
            db_1.db.prepare('UPDATE files SET spotifyUrl = ? WHERE id = ?').run(url, fileId);
        }
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
        // Use has video topology
        let baseDest = path_1.default.join(this.config.destDir, category, 'has video');
        if (isOfficialVideo) {
            baseDest = path_1.default.join(this.config.destDir, category, 'has video (Official)');
        }
        this.ensureDirectoryExists(baseDest);
        try {
            this.moveFileSafely(pair.a_src, path_1.default.join(baseDest, pair.a_fn));
            this.moveFileSafely(pair.v_src, path_1.default.join(baseDest, pair.v_fn));
            db_1.db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
            db_1.db.prepare('DELETE FROM files WHERE id = ? OR id = ?').run(pair.audioId, pair.videoId);
            return true;
        }
        catch (error) {
            console.error('Error physically moving file:', error);
            return false;
        }
    }
    updateVideoStatus(fileId, status) {
        db_1.db.prepare('UPDATE files SET videoStatus = ? WHERE id = ?').run(status, fileId);
    }
    /**
     * Move an audio file to the noVideoDestDir (or destDir/category/no video if unset).
     * Intended for use when a file is confirmed to have no video release.
     */
    moveNoVideo(fileId, category) {
        const audio = db_1.db.prepare(`SELECT absolutePath, filename FROM files WHERE id = ? AND type = 'Music'`).get(fileId);
        if (!audio)
            return false;
        const resolvedCategory = category || 'Uncategorized';
        const noVideoDest = this.config.noVideoDestDir;
        const baseDir = (noVideoDest && noVideoDest.trim()) ? noVideoDest.trim() : this.config.destDir;
        const baseDest = path_1.default.join(baseDir, resolvedCategory, 'no video');
        this.ensureDirectoryExists(baseDest);
        try {
            this.moveFileSafely(audio.absolutePath, path_1.default.join(baseDest, audio.filename));
            db_1.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
            return true;
        }
        catch (error) {
            console.error('Error moving no-video file:', error);
            return false;
        }
    }
    aiMoveAudioOnly(audioId, category) {
        const audio = db_1.db.prepare(`SELECT absolutePath, filename FROM files WHERE id = ? AND type = 'Music'`).get(audioId);
        if (!audio)
            return false;
        let baseDest = path_1.default.join(this.config.destDir, category, 'no video');
        this.ensureDirectoryExists(baseDest);
        try {
            this.moveFileSafely(audio.absolutePath, path_1.default.join(baseDest, audio.filename));
            db_1.db.prepare('DELETE FROM files WHERE id = ?').run(audioId);
            return true;
        }
        catch (error) {
            console.error('Error physically moving audio only file:', error);
            return false;
        }
    }
}
exports.LibraryService = LibraryService;
