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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const youtube_dl_exec_1 = __importDefault(require("youtube-dl-exec"));
const library_1 = require("./services/library");
const ollama_1 = require("./services/ollama");
const internet_1 = require("./services/internet");
const youtube_1 = require("./services/youtube");
const spotify_1 = require("./services/spotify");
const musicbrainz_1 = require("./services/musicbrainz");
const qualityChecker_1 = require("./services/qualityChecker");
const db_1 = require("./db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const CONFIG_PATH = path_1.default.resolve(__dirname, '../../config.json');
const loadConfig = () => {
    if (fs_1.default.existsSync(CONFIG_PATH)) {
        try {
            const data = fs_1.default.readFileSync(CONFIG_PATH, 'utf-8');
            return JSON.parse(data);
        }
        catch (e) {
            console.error('Failed to parse config.json', e);
        }
    }
    return {
        audioDir: path_1.default.resolve(__dirname, '../../scan_dir/audio'),
        videoDir: path_1.default.resolve(__dirname, '../../scan_dir/video'),
        destDir: path_1.default.resolve(__dirname, '../../organized'),
        ollamaModel: 'llama3'
    };
};
const saveConfig = (config) => {
    fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
};
let currentConfig = loadConfig();
const library = new library_1.LibraryService(currentConfig);
const ollama = new ollama_1.OllamaService();
const internet = new internet_1.InternetSearchService();
const youtube = new youtube_1.YouTubeService();
const spotify = new spotify_1.SpotifyService();
const musicbrainz = new musicbrainz_1.MusicBrainzService();
// Config routes
app.get('/api/config', (req, res) => res.json({ success: true, config: currentConfig }));
app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        saveConfig(newConfig);
        currentConfig = newConfig;
        if (currentConfig.audioDir && currentConfig.videoDir && currentConfig.destDir) {
            library.setConfig(currentConfig);
        }
        res.json({ success: true, config: currentConfig });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Models route
app.get('/api/models', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const models = yield ollama.getModels();
    res.json({ success: true, models });
}));
// V2 Route: Get matching state
app.get('/api/files', (req, res) => {
    try {
        const state = library.getMatchState();
        res.json({ success: true, state });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// POST /api/automatch - Run AI matching only on currently unmatched files (batched)
app.post('/api/automatch', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const state = library.getMatchState();
        if (state.unmatchedAudio.length === 0 || state.unmatchedVideo.length === 0) {
            return res.json({ success: true, state });
        }
        const model = currentConfig.ollamaModel || 'llama3';
        // Send in batches of 50×50 so Ollama doesn't get overwhelmed by 500+ names at once
        const BATCH = 50;
        let allMatches = [];
        const audioList = [...state.unmatchedAudio];
        const videoList = [...state.unmatchedVideo];
        for (let ai = 0; ai < audioList.length; ai += BATCH) {
            const audioBatch = audioList.slice(ai, ai + BATCH);
            for (let vi = 0; vi < videoList.length; vi += BATCH) {
                const videoBatch = videoList.slice(vi, vi + BATCH);
                try {
                    const matches = yield ollama.findMatches(audioBatch, videoBatch, model);
                    allMatches = allMatches.concat(matches);
                }
                catch (batchErr) {
                    console.error(`Batch [${ai}-${ai + BATCH}] × [${vi}-${vi + BATCH}] failed:`, batchErr.message);
                }
            }
        }
        library.addOllamaMatches(allMatches);
        res.json({ success: true, state: library.getMatchState(), matches: allMatches });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/reset-matches - Clear all non-exact pairs and re-run AI matching from scratch
app.post('/api/reset-matches', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        library.clearNonExactPairs();
        const state = library.getMatchState();
        if (state.unmatchedAudio.length === 0 || state.unmatchedVideo.length === 0) {
            return res.json({ success: true, state });
        }
        const model = currentConfig.ollamaModel || 'llama3';
        const BATCH = 50;
        let allMatches = [];
        const audioList = [...state.unmatchedAudio];
        const videoList = [...state.unmatchedVideo];
        for (let ai = 0; ai < audioList.length; ai += BATCH) {
            const audioBatch = audioList.slice(ai, ai + BATCH);
            for (let vi = 0; vi < videoList.length; vi += BATCH) {
                const videoBatch = videoList.slice(vi, vi + BATCH);
                try {
                    const matches = yield ollama.findMatches(audioBatch, videoBatch, model);
                    allMatches = allMatches.concat(matches);
                }
                catch (batchErr) {
                    console.error(`Batch failed:`, batchErr.message);
                }
            }
        }
        library.addOllamaMatches(allMatches);
        res.json({ success: true, state: library.getMatchState(), matches: allMatches });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
app.post('/api/unlink', (req, res) => {
    const { pairId } = req.body;
    if (!pairId)
        return res.status(400).json({ success: false, error: 'pairId required' });
    library.removeMatch(pairId);
    res.json({ success: true, state: library.getMatchState() });
});
// POST /api/analyze - Analyze a filename using Ollama
app.post('/api/analyze', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { filename } = req.body;
    if (!filename)
        return res.status(400).json({ success: false, error: 'Filename is required' });
    try {
        const classification = yield ollama.classify(filename, currentConfig.ollamaModel || 'llama3');
        if (!classification)
            return res.status(500).json({ success: false, error: 'Failed to classify' });
        res.json({ success: true, classification });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/auto-organize-single
app.post('/api/auto-organize-single', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { pairId, filename } = req.body;
    try {
        const model = currentConfig.ollamaModel || 'llama3';
        // 1. Clean query
        const cleanName = yield ollama.cleanQuery(filename, model);
        // 2. Internet Fetch
        const internetData = yield internet.searchTrack(cleanName);
        // 3. AI Takeover categorization
        const aiResult = yield ollama.categorize(filename, internetData, model);
        if (!aiResult || !aiResult.verifiedCategory) {
            return res.status(500).json({ success: false, error: 'AI categorizer failed to return a validated folder.' });
        }
        // 4. Move physically based on AI logic
        const moveSuccess = library.aiMovePair(pairId, aiResult.verifiedCategory, aiResult.isOfficialVideo || false);
        if (moveSuccess) {
            res.json({ success: true, state: library.getMatchState(), result: aiResult });
        }
        else {
            res.status(500).json({ success: false, error: 'Failed to move files mechanically.' });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/auto-organize-audio-only
app.post('/api/auto-organize-audio-only', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds))
        return res.status(400).json({ success: false, error: 'fileIds array required' });
    try {
        const model = currentConfig.ollamaModel || 'llama3';
        const filesStmt = db_1.db.prepare(`SELECT id, filename FROM files WHERE type = 'Music' AND id IN (${fileIds.map(() => '?').join(',')})`);
        const files = filesStmt.all(...fileIds);
        for (const file of files) {
            const cleanName = yield ollama.cleanQuery(file.filename, model);
            const internetData = yield internet.searchTrack(cleanName);
            const aiResult = yield ollama.categorize(file.filename, internetData, model);
            if (aiResult && aiResult.verifiedCategory) {
                library.aiMoveAudioOnly(file.id, aiResult.verifiedCategory);
            }
        }
        res.json({ success: true, state: library.getMatchState() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
app.post('/api/youtube/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const fileId = req.params.id;
    const { title } = req.body;
    const result = yield youtube.findOfficialVideoSync(title);
    if (result)
        library.updateYoutubeUrl(fileId, result.url, result.previewUrl);
    res.json({ success: !!result, link: result === null || result === void 0 ? void 0 : result.url, previewUrl: result === null || result === void 0 ? void 0 : result.previewUrl, state: library.getMatchState() });
}));
app.post('/api/spotify/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const fileId = req.params.id;
    const { title } = req.body;
    const result = yield spotify.findTrackUrl(title);
    if (result)
        library.updateSpotifyUrl(fileId, result.url, result.previewUrl);
    res.json({ success: !!result, link: result === null || result === void 0 ? void 0 : result.url, previewUrl: result === null || result === void 0 ? void 0 : result.previewUrl, state: library.getMatchState() });
}));
// ─── SpotiFLAC Proxy Routes ────────────────────────────────────────────────
// POST /api/spotiflac/search  — search for tracks via the local SpotiFLAC API
app.post('/api/spotiflac/search', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { query, limit = 8 } = req.body;
        if (!query)
            return res.status(400).json({ success: false, error: 'query required' });
        const url = `http://localhost:8080/spotiflac/srcsong/${encodeURIComponent(query)}?limit=${limit}`;
        const upstream = yield axios_1.default.get(url);
        const data = upstream.data;
        res.json({ success: true, tracks: data.tracks || [], count: data.count || 0 });
    }
    catch (err) {
        console.error('SpotiFLAC search error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/spotiflac/download  — download best FLAC via the local SpotiFLAC API
app.post('/api/spotiflac/download', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { spotify_url, fileId } = req.body;
        if (!spotify_url)
            return res.status(400).json({ success: false, error: 'spotify_url required' });
        const outputDir = currentConfig.downloadDir || currentConfig.audioDir;
        const upstream = yield axios_1.default.post('http://localhost:8080/spotiflac/download-best', {
            spotify_url,
            strategy: 'best',
            output_dir: outputDir,
            allow_fallback: true,
        });
        const data = upstream.data;
        if (!data.success) {
            return res.status(500).json({ success: false, error: data.message || 'Download failed' });
        }
        // Rescan so the new FLAC appears in the library
        library.syncDisk();
        // Try to auto-link with the video file if fileId was passed
        if (fileId && data.file) {
            const dlPath = path_1.default.resolve(data.file);
            const dlExt = path_1.default.extname(dlPath);
            const dlBaseName = path_1.default.basename(dlPath, dlExt);
            const audio = db_1.db.prepare("SELECT id FROM files WHERE (absolutePath = ? OR baseName = ?) AND type = 'Music'").get(dlPath, dlBaseName);
            if (audio) {
                db_1.db.prepare("INSERT OR IGNORE INTO pairs (id, audioId, videoId, status) VALUES (?, ?, ?, 'downloaded')").run(`spf-${fileId}-${audio.id}`, audio.id, fileId);
            }
        }
        res.json({
            success: true,
            file: data.file,
            chosen: data.chosen,
            audio_report: data.audio_report,
            message: data.message,
            state: library.getMatchState(),
        });
    }
    catch (err) {
        console.error('SpotiFLAC download error:', err);
        res.status(500).json({ success: false, error: ((_b = (_a = err.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) || err.message });
    }
}));
app.post('/api/download', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { url, type, quality, filename } = req.body;
        let targetDir = currentConfig.downloadDir || (type === 'audio' ? currentConfig.audioDir : currentConfig.videoDir);
        let args = {
            noCheckCertificates: true,
            noWarnings: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0'
            ]
        };
        if (type === 'audio') {
            args.extractAudio = true;
            args.audioFormat = quality === 'best' ? 'best' : quality;
            args.output = path_1.default.join(targetDir, `%(title)s.%(ext)s`);
        }
        else {
            if (quality !== 'best' && !isNaN(parseInt(quality))) {
                args.format = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
            }
            else {
                args.format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
            }
            args.mergeOutputFormat = 'mp4';
            args.output = path_1.default.join(targetDir, `%(title)s.%(ext)s`);
        }
        try {
            // If we are downloading a video, we want to capture the output path
            // yt-dlp returns the path internally when we execute it
            const dlResult = yield (0, youtube_dl_exec_1.default)(url, Object.assign(Object.assign({}, args), { dumpJson: true }));
            // Execute the actual download
            args.noSimulate = true;
            const subprocess = youtube_dl_exec_1.default.exec(url, args);
            let outPath = '';
            // Wait for it to finish and extract the destination
            yield new Promise((resolve, reject) => {
                var _a;
                let stdout = '';
                (_a = subprocess.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (d) => stdout += d.toString());
                subprocess.on('close', (code) => {
                    if (code === 0) {
                        const matches = stdout.match(/Destination: (.*)$/m);
                        const mergeMatch = stdout.match(/Merging formats into "(.*)"/m);
                        if (mergeMatch && mergeMatch[1])
                            outPath = mergeMatch[1];
                        else if (matches && matches[1])
                            outPath = matches[1];
                        resolve(true);
                    }
                    else {
                        reject(new Error(`yt-dlp exited with code ${code}`));
                    }
                });
                subprocess.on('error', reject);
            });
            library.syncDisk();
            // Explicitly link if we requested a video for an audio baseName
            if (type === 'video' && filename && outPath) {
                const audio = db_1.db.prepare("SELECT id FROM files WHERE baseName = ? AND type = 'Music'").get(filename);
                if (audio) {
                    // Find the video id using the basename of the outPath
                    const ext = path_1.default.extname(outPath);
                    const dlBaseName = path_1.default.basename(outPath, ext);
                    // Wait, syncDisk might have indexed it. Let's find it by absolutePath or baseName.
                    const absPath = path_1.default.resolve(outPath); // Ensure absolute
                    const video = db_1.db.prepare("SELECT id FROM files WHERE absolutePath = ? OR baseName = ?").get(absPath, dlBaseName);
                    if (video) {
                        db_1.db.prepare("INSERT OR IGNORE INTO pairs (id, audioId, videoId, status) VALUES (?, ?, ?, 'downloaded')").run(`dl-${audio.id}`, audio.id, video.id);
                    }
                }
            }
            res.json({ success: true, state: library.getMatchState() });
        }
        catch (dlErr) {
            console.error("YTDL Error:", dlErr);
            res.status(500).json({ success: false, error: 'Download failed: ' + dlErr.message });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
app.post('/api/formats', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { url } = req.body;
        if (!url)
            return res.status(400).json({ success: false, error: 'URL required' });
        const result = yield (0, youtube_dl_exec_1.default)(url, {
            dumpJson: true,
            noCheckCertificates: true,
            noWarnings: true
        });
        const formats = result.formats || [];
        // Extract unique mp4 video heights
        const videoResolutions = Array.from(new Set(formats.filter((f) => f.vcodec !== 'none' && f.height && f.ext === 'mp4')
            .map((f) => f.height)
            .sort((a, b) => b - a)));
        // For audio formats
        const audioFormats = formats.filter((f) => f.acodec !== 'none' && f.vcodec === 'none' && f.abr && f.ext);
        // Unique extensions for audio, favoring best bitrate
        const audioTypes = Array.from(new Set(audioFormats.map((f) => f.ext)));
        res.json({ success: true, videos: videoResolutions, audios: audioTypes });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/check-video-release/:id - Check if a file has a video release on MusicBrainz
app.post('/api/check-video-release/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const fileId = req.params.id;
    const { title } = req.body;
    if (!title)
        return res.status(400).json({ success: false, error: 'title required' });
    try {
        const status = yield musicbrainz.checkVideoRelease(title);
        library.updateVideoStatus(fileId, status);
        res.json({ success: true, videoStatus: status, state: library.getMatchState() });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/send-no-video - Move a no-video audio file to the configured noVideoDestDir
app.post('/api/send-no-video', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { fileId, filename } = req.body;
    if (!fileId)
        return res.status(400).json({ success: false, error: 'fileId required' });
    try {
        let category = 'Uncategorized';
        // Attempt to AI-categorize using filename if provided so the file lands in the right subfolder
        if (filename) {
            const model = currentConfig.ollamaModel || 'llama3';
            const cleanName = yield ollama.cleanQuery(filename, model);
            const internetData = cleanName ? yield internet.searchTrack(cleanName) : [];
            const aiResult = yield ollama.categorize(filename, internetData !== null && internetData !== void 0 ? internetData : [], model);
            if (aiResult === null || aiResult === void 0 ? void 0 : aiResult.verifiedCategory) {
                category = aiResult.verifiedCategory;
            }
        }
        const moveSuccess = library.moveNoVideo(fileId, category);
        if (moveSuccess) {
            res.json({ success: true, state: library.getMatchState(), category });
        }
        else {
            res.status(500).json({ success: false, error: 'Failed to move file.' });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// ─── Quality Checker Routes ──────────────────────────────────────────────────
// In-memory scan cache (resets on each full scan)
let lastScanResults = [];
let scanInProgress = false;
let scanProgress = { done: 0, total: 0, currentFile: '' };
// GET /api/quality/status — live progress during scan
app.get('/api/quality/status', (_req, res) => {
    res.json({ success: true, inProgress: scanInProgress, progress: scanProgress, count: lastScanResults.length });
});
// GET /api/quality/results — return cached last scan
app.get('/api/quality/results', (_req, res) => {
    res.json({ success: true, results: lastScanResults, inProgress: scanInProgress });
});
// POST /api/quality/scan — kick off a fresh scan (non-blocking; poll /status)
app.post('/api/quality/scan', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (scanInProgress) {
        return res.json({ success: false, error: 'Scan already in progress', progress: scanProgress });
    }
    const dir = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.dir) || currentConfig.qualityCheckDir;
    if (!dir) {
        return res.status(400).json({ success: false, error: 'qualityCheckDir not configured. Set it in Settings first.' });
    }
    scanInProgress = true;
    scanProgress = { done: 0, total: 0, currentFile: '' };
    lastScanResults = [];
    // Run async in background
    (0, qualityChecker_1.scanDirectory)(dir, (done, total, currentFile) => {
        scanProgress = { done, total, currentFile };
    })
        .then((results) => {
        lastScanResults = results;
    })
        .catch((err) => {
        console.error('Quality scan error:', err);
    })
        .finally(() => {
        scanInProgress = false;
    });
    res.json({ success: true, message: 'Scan started', dir });
}));
// POST /api/quality/move — move a single file to its label sub-folder
app.post('/api/quality/move', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { absolutePath, label } = req.body;
        if (!absolutePath || !label)
            return res.status(400).json({ success: false, error: 'absolutePath and label required' });
        const baseDir = currentConfig.qualityCheckDir;
        if (!baseDir)
            return res.status(400).json({ success: false, error: 'qualityCheckDir not set' });
        if (!fs_1.default.existsSync(absolutePath)) {
            return res.status(404).json({ success: false, error: 'File not found: ' + absolutePath });
        }
        const newPath = (0, qualityChecker_1.moveFileByLabel)(absolutePath, baseDir, label);
        // Update in cache
        lastScanResults = lastScanResults.map((r) => r.absolutePath === absolutePath ? Object.assign(Object.assign({}, r), { absolutePath: newPath }) : r);
        res.json({ success: true, newPath });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/quality/move-all — bulk move all cached results by label
app.post('/api/quality/move-all', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { label } = req.body;
        const baseDir = currentConfig.qualityCheckDir;
        if (!baseDir)
            return res.status(400).json({ success: false, error: 'qualityCheckDir not set' });
        const toMove = label
            ? lastScanResults.filter((r) => r.label === label)
            : lastScanResults;
        let moved = 0;
        for (const r of toMove) {
            if (!fs_1.default.existsSync(r.absolutePath))
                continue;
            try {
                const np = (0, qualityChecker_1.moveFileByLabel)(r.absolutePath, baseDir, r.label);
                r.absolutePath = np;
                moved++;
            }
            catch ( /* skip locked/moved */_a) { /* skip locked/moved */ }
        }
        res.json({ success: true, moved });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/quality/ai-insight — Ollama verdict for a single file report
app.post('/api/quality/ai-insight', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { report } = req.body;
        if (!report)
            return res.status(400).json({ success: false, error: 'report required' });
        const model = currentConfig.ollamaModel || 'llama3';
        const prompt = `You are an audio quality expert. Analyze this FLAC file report and give a single short sentence verdict (max 20 words). Be direct and concise.

File: ${report.filename}
Artist: ${report.artist || 'Unknown'}
Title: ${report.title || 'Unknown'}
Bitrate: ${report.bitRate ? Math.round(report.bitRate / 1000) + ' kbps' : 'N/A'}
Sample Rate: ${report.sampleRate ? report.sampleRate + ' Hz' : 'N/A'}
Bit Depth: ${report.bitDepth || 'N/A'}-bit
Channels: ${report.channels || 'N/A'}
Clipping: ${report.hasClipping ? 'YES – clipping detected' : 'No'}
Metadata: ${report.metadataOk ? 'Complete' : 'MISSING artist/title'}
System Label: ${report.label.toUpperCase()} — ${report.labelReason}

Verdict:`;
        const ollamaRes = yield axios_1.default.post('http://localhost:11434/api/generate', {
            model,
            prompt,
            stream: false,
        }, { timeout: 30000 });
        const insight = (((_a = ollamaRes.data) === null || _a === void 0 ? void 0 : _a.response) || '').trim();
        // Patch cache
        lastScanResults = lastScanResults.map((r) => r.id === report.id ? Object.assign(Object.assign({}, r), { aiInsight: insight }) : r);
        res.json({ success: true, aiInsight: insight });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
// POST /api/quality/reanalyze — re-run quality check on a single file
app.post('/api/quality/reanalyze', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { absolutePath } = req.body;
        if (!absolutePath)
            return res.status(400).json({ success: false, error: 'absolutePath required' });
        if (!fs_1.default.existsSync(absolutePath))
            return res.status(404).json({ success: false, error: 'File not found' });
        const report = yield (0, qualityChecker_1.analyzeFile)(absolutePath);
        // Update cache
        const idx = lastScanResults.findIndex((r) => r.absolutePath === absolutePath);
        if (idx >= 0)
            lastScanResults[idx] = report;
        else
            lastScanResults.push(report);
        res.json({ success: true, report });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
