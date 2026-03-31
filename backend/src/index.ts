import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { LibraryService } from './services/library';
import { OllamaService } from './services/ollama';
import { InternetSearchService } from './services/internet';
import { YouTubeService } from './services/youtube';
import { SpotifyService } from './services/spotify';
import { AppConfig } from './types';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const CONFIG_PATH = path.resolve(__dirname, '../../config.json');

const loadConfig = (): AppConfig => {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse config.json', e);
    }
  }
  return {
    audioDir: path.resolve(__dirname, '../../scan_dir/audio'),
    videoDir: path.resolve(__dirname, '../../scan_dir/video'),
    destDir: path.resolve(__dirname, '../../organized'),
    ollamaModel: 'llama3'
  };
};

const saveConfig = (config: AppConfig) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
};

let currentConfig = loadConfig();
const library = new LibraryService(currentConfig);
const ollama = new OllamaService();
const internet = new InternetSearchService();
const youtube = new YouTubeService();
const spotify = new SpotifyService();

// Config routes
app.get('/api/config', (req, res) => res.json({ success: true, config: currentConfig }));

app.post('/api/config', (req, res) => {
  try {
    const newConfig: AppConfig = req.body;
    saveConfig(newConfig);
    currentConfig = newConfig;
    if (currentConfig.audioDir && currentConfig.videoDir && currentConfig.destDir) {
      library.setConfig(currentConfig);
    }
    res.json({ success: true, config: currentConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Models route
app.get('/api/models', async (req, res) => {
  const models = await ollama.getModels();
  res.json({ success: true, models });
});

// V2 Route: Get matching state
app.get('/api/files', (req, res) => {
  try {
    const state = library.getMatchState();
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/automatch - Run Ollama batch
app.post('/api/automatch', async (req, res) => {
  try {
    const state = library.getMatchState();
    if (state.unmatchedAudio.length > 0 && state.unmatchedVideo.length > 0) {
      const model = currentConfig.ollamaModel || 'llama3';
      const matches = await ollama.findMatches(state.unmatchedAudio, state.unmatchedVideo, model);
      library.addOllamaMatches(matches);
      res.json({ success: true, state: library.getMatchState(), matches });
    } else {
      res.json({ success: true, state });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/unlink', (req, res) => {
  const { audioBaseName } = req.body;
  if (!audioBaseName) return res.status(400).json({ success: false, error: 'audioBaseName required' });
  library.removeMatch(audioBaseName);
  res.json({ success: true, state: library.getMatchState() });
});

// POST /api/analyze - Analyze a filename using Ollama
app.post('/api/analyze', async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Filename is required' });

  try {
    const classification = await ollama.classify(filename, currentConfig.ollamaModel || 'llama3');
    if (!classification) return res.status(500).json({ success: false, error: 'Failed to classify' });
    res.json({ success: true, classification });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auto-organize-single
app.post('/api/auto-organize-single', async (req, res) => {
  const { pairId, filename } = req.body;
  
  try {
    const model = currentConfig.ollamaModel || 'llama3';
    
    // 1. Clean query
    const cleanName = await ollama.cleanQuery(filename, model);
    
    // 2. Internet Fetch
    const internetData = await internet.searchTrack(cleanName);
    
    // 3. AI Takeover categorization
    const aiResult = await ollama.categorize(filename, internetData, model);
    
    if (!aiResult || !aiResult.verifiedCategory) {
       return res.status(500).json({ success: false, error: 'AI categorizer failed to return a validated folder.' });
    }

    // 4. Move physically based on AI logic
    const moveSuccess = library.aiMovePair(pairId, aiResult.verifiedCategory, aiResult.isOfficialVideo || false);
    
    if (moveSuccess) {
      res.json({ success: true, state: library.getMatchState(), result: aiResult });
    } else {
      res.status(500).json({ success: false, error: 'Failed to move files mechanically.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/youtube/:id', async (req, res) => {
  const fileId = req.params.id;
  const { title } = req.body;
  const link = await youtube.findOfficialVideoSync(title);
  if (link) library.updateYoutubeUrl(fileId, link);
  res.json({ success: !!link, link, state: library.getMatchState() });
});

app.post('/api/spotify/:id', async (req, res) => {
  const fileId = req.params.id;
  const { title } = req.body;
  const link = await spotify.findTrackUrl(title);
  if (link) library.updateSpotifyUrl(fileId, link);
  res.json({ success: !!link, link, state: library.getMatchState() });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
