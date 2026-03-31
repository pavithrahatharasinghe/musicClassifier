import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import youtubedl from 'youtube-dl-exec';
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
  const result = await youtube.findOfficialVideoSync(title);
  if (result) library.updateYoutubeUrl(fileId, result.url, result.previewUrl);
  res.json({ success: !!result, link: result?.url, previewUrl: result?.previewUrl, state: library.getMatchState() });
});

app.post('/api/spotify/:id', async (req, res) => {
  const fileId = req.params.id;
  const { title } = req.body;
  const result = await spotify.findTrackUrl(title);
  if (result) library.updateSpotifyUrl(fileId, result.url, result.previewUrl);
  res.json({ success: !!result, link: result?.url, previewUrl: result?.previewUrl, state: library.getMatchState() });
});

app.post('/api/download', async (req, res) => {
  try {
    const { url, type, quality, filename } = req.body;
    let targetDir = currentConfig.downloadDir || (type === 'audio' ? currentConfig.audioDir : currentConfig.videoDir);
    
    let args: any = {
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
      args.output = path.join(targetDir, `${filename}.%(ext)s`);
    } else {
      if (quality !== 'best' && !isNaN(parseInt(quality))) {
         args.format = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
      } else {
         args.format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
      }
      args.mergeOutputFormat = 'mp4';
      args.output = path.join(targetDir, `${filename}.%(ext)s`);
    }

    try {
      await youtubedl(url, args);
      library.syncDisk();
      res.json({ success: true, state: library.getMatchState() });
    } catch (dlErr: any) {
       console.error("YTDL Error:", dlErr);
       res.status(500).json({ success: false, error: 'Download failed: ' + dlErr.message });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/formats', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL required' });

    const result = await youtubedl(url, {
      dumpJson: true,
      noCheckCertificates: true,
      noWarnings: true
    }) as any;

    const formats = result.formats || [];
    
    // Extract unique mp4 video heights
    const videoResolutions = Array.from(new Set(
      formats.filter((f: any) => f.vcodec !== 'none' && f.height && f.ext === 'mp4')
             .map((f: any) => f.height)
             .sort((a: any, b: any) => (b as number)-(a as number))
    ));

    // For audio formats
    const audioFormats = formats.filter((f: any) => f.acodec !== 'none' && f.vcodec === 'none' && f.abr && f.ext);
    // Unique extensions for audio, favoring best bitrate
    const audioTypes = Array.from(new Set(
      audioFormats.map((f: any) => f.ext)
    ));

    res.json({ success: true, videos: videoResolutions, audios: audioTypes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
