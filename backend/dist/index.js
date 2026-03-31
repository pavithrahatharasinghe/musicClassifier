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
const library_1 = require("./services/library");
const ollama_1 = require("./services/ollama");
const internet_1 = require("./services/internet");
const youtube_1 = require("./services/youtube");
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
// POST /api/automatch - Run Ollama batch
app.post('/api/automatch', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const state = library.getMatchState();
        if (state.unmatchedAudio.length > 0 && state.unmatchedVideo.length > 0) {
            const model = currentConfig.ollamaModel || 'llama3';
            const matches = yield ollama.findMatches(state.unmatchedAudio, state.unmatchedVideo, model);
            library.addOllamaMatches(matches);
            res.json({ success: true, state: library.getMatchState(), matches });
        }
        else {
            res.json({ success: true, state });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}));
app.post('/api/unlink', (req, res) => {
    const { audioBaseName } = req.body;
    if (!audioBaseName)
        return res.status(400).json({ success: false, error: 'audioBaseName required' });
    library.removeMatch(audioBaseName);
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
app.post('/api/youtube/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const fileId = req.params.id;
    const { title } = req.body;
    const link = yield youtube.findOfficialVideoSync(title);
    if (link)
        library.updateYoutubeUrl(fileId, link);
    res.json({ success: !!link, link, state: library.getMatchState() });
}));
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
