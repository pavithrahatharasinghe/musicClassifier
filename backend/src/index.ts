import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import youtubedl from 'youtube-dl-exec';
import { LibraryService } from './services/library';
import { OllamaService } from './services/ollama';
import { InternetSearchService } from './services/internet';
import { YouTubeService } from './services/youtube';
import { SpotifyService } from './services/spotify';
import { MusicBrainzService } from './services/musicbrainz';
import { scanDirectory, analyzeFile, moveFileByLabel, computeSpectrum } from './services/qualityChecker';
import type { QualityReport } from './types';
import { db } from './db';
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
const musicbrainz = new MusicBrainzService();

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

// POST /api/automatch - Run AI matching only on currently unmatched files (batched)
app.post('/api/automatch', async (req, res) => {
  try {
    const state = library.getMatchState();

    if (state.unmatchedAudio.length === 0 || state.unmatchedVideo.length === 0) {
      return res.json({ success: true, state });
    }

    const model = currentConfig.ollamaModel || 'llama3';

    // Send in batches of 50×50 so Ollama doesn't get overwhelmed by 500+ names at once
    const BATCH = 50;
    let allMatches: { audioName: string; videoName: string }[] = [];

    const audioList = [...state.unmatchedAudio];
    const videoList = [...state.unmatchedVideo];

    for (let ai = 0; ai < audioList.length; ai += BATCH) {
      const audioBatch = audioList.slice(ai, ai + BATCH);
      for (let vi = 0; vi < videoList.length; vi += BATCH) {
        const videoBatch = videoList.slice(vi, vi + BATCH);
        try {
          const matches = await ollama.findMatches(audioBatch, videoBatch, model);
          allMatches = allMatches.concat(matches);
        } catch (batchErr: any) {
          console.error(`Batch [${ai}-${ai+BATCH}] × [${vi}-${vi+BATCH}] failed:`, batchErr.message);
        }
      }
    }

    library.addOllamaMatches(allMatches);
    res.json({ success: true, state: library.getMatchState(), matches: allMatches });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/reset-matches - Clear all non-exact pairs and re-run AI matching from scratch
app.post('/api/reset-matches', async (req, res) => {
  try {
    library.clearNonExactPairs();
    const state = library.getMatchState();

    if (state.unmatchedAudio.length === 0 || state.unmatchedVideo.length === 0) {
      return res.json({ success: true, state });
    }

    const model = currentConfig.ollamaModel || 'llama3';
    const BATCH = 50;
    let allMatches: { audioName: string; videoName: string }[] = [];
    const audioList = [...state.unmatchedAudio];
    const videoList = [...state.unmatchedVideo];

    for (let ai = 0; ai < audioList.length; ai += BATCH) {
      const audioBatch = audioList.slice(ai, ai + BATCH);
      for (let vi = 0; vi < videoList.length; vi += BATCH) {
        const videoBatch = videoList.slice(vi, vi + BATCH);
        try {
          const matches = await ollama.findMatches(audioBatch, videoBatch, model);
          allMatches = allMatches.concat(matches);
        } catch (batchErr: any) {
          console.error(`Batch failed:`, batchErr.message);
        }
      }
    }

    library.addOllamaMatches(allMatches);
    res.json({ success: true, state: library.getMatchState(), matches: allMatches });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.post('/api/unlink', (req, res) => {
  const { pairId } = req.body;
  if (!pairId) return res.status(400).json({ success: false, error: 'pairId required' });
  library.removeMatch(pairId);
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

// POST /api/auto-organize-audio-only
app.post('/api/auto-organize-audio-only', async (req, res) => {
  const { fileIds } = req.body;
  if (!fileIds || !Array.isArray(fileIds)) return res.status(400).json({ success: false, error: 'fileIds array required' });

  try {
    const model = currentConfig.ollamaModel || 'llama3';
    
    const filesStmt = db.prepare(`SELECT id, filename FROM files WHERE type = 'Music' AND id IN (${fileIds.map(() => '?').join(',')})`);
    const files = filesStmt.all(...fileIds) as any[];

    for (const file of files) {
      const cleanName = await ollama.cleanQuery(file.filename, model);
      const internetData = await internet.searchTrack(cleanName);
      const aiResult = await ollama.categorize(file.filename, internetData, model);

      if (aiResult && aiResult.verifiedCategory) {
         library.aiMoveAudioOnly(file.id, aiResult.verifiedCategory);
      }
    }

    res.json({ success: true, state: library.getMatchState() });
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

// ─── SpotiFLAC Proxy Routes ────────────────────────────────────────────────

// POST /api/spotiflac/search  — search for tracks via the local SpotiFLAC API
app.post('/api/spotiflac/search', async (req, res) => {
  try {
    const { query, limit = 8 } = req.body;
    if (!query) return res.status(400).json({ success: false, error: 'query required' });

    const url = `http://localhost:8080/spotiflac/srcsong/${encodeURIComponent(query)}?limit=${limit}`;
    const upstream = await axios.get(url);
    const data = upstream.data;
    res.json({ success: true, tracks: data.tracks || [], count: data.count || 0 });
  } catch (err: any) {
    console.error('SpotiFLAC search error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/spotiflac/download  — download best FLAC via the local SpotiFLAC API
app.post('/api/spotiflac/download', async (req, res) => {
  try {
    const { spotify_url, fileId } = req.body;
    if (!spotify_url) return res.status(400).json({ success: false, error: 'spotify_url required' });

    const outputDir = currentConfig.downloadDir || currentConfig.audioDir;

    const upstream = await axios.post('http://localhost:8080/spotiflac/download-best', {
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
      const dlPath = path.resolve(data.file);
      const dlExt = path.extname(dlPath);
      const dlBaseName = path.basename(dlPath, dlExt);
      const audio = db.prepare("SELECT id FROM files WHERE (absolutePath = ? OR baseName = ?) AND type = 'Music'").get(dlPath, dlBaseName) as any;
      if (audio) {
        db.prepare("INSERT OR IGNORE INTO pairs (id, audioId, videoId, status) VALUES (?, ?, ?, 'downloaded')").run(`spf-${fileId}-${audio.id}`, audio.id, fileId);
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
  } catch (err: any) {
    console.error('SpotiFLAC download error:', err);
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
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
      args.output = path.join(targetDir, `%(title)s.%(ext)s`);
    } else {
      if (quality !== 'best' && !isNaN(parseInt(quality))) {
         args.format = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
      } else {
         args.format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
      }
      args.mergeOutputFormat = 'mp4';
      args.output = path.join(targetDir, `%(title)s.%(ext)s`);
    }

    try {
      // If we are downloading a video, we want to capture the output path
      // yt-dlp returns the path internally when we execute it
      const dlResult = await youtubedl(url, { ...args, dumpJson: true });
      // Execute the actual download
      args.noSimulate = true;
      const subprocess = youtubedl.exec(url, args);
      let outPath = '';
      
      // Wait for it to finish and extract the destination
      await new Promise((resolve, reject) => {
         let stdout = '';
         subprocess.stdout?.on('data', (d) => stdout += d.toString());
         subprocess.on('close', (code) => {
           if (code === 0) {
              const matches = stdout.match(/Destination: (.*)$/m);
              const mergeMatch = stdout.match(/Merging formats into "(.*)"/m);
              if (mergeMatch && mergeMatch[1]) outPath = mergeMatch[1];
              else if (matches && matches[1]) outPath = matches[1];
              resolve(true);
           } else {
              reject(new Error(`yt-dlp exited with code ${code}`));
           }
         });
         subprocess.on('error', reject);
      });

      library.syncDisk();

      // Explicitly link if we requested a video for an audio baseName
      if (type === 'video' && filename && outPath) {
         const audio = db.prepare("SELECT id FROM files WHERE baseName = ? AND type = 'Music'").get(filename) as any;
         if (audio) {
            // Find the video id using the basename of the outPath
            const ext = path.extname(outPath);
            const dlBaseName = path.basename(outPath, ext);
            
            // Wait, syncDisk might have indexed it. Let's find it by absolutePath or baseName.
            const absPath = path.resolve(outPath); // Ensure absolute
            const video = db.prepare("SELECT id FROM files WHERE absolutePath = ? OR baseName = ?").get(absPath, dlBaseName) as any;
            if (video) {
               db.prepare("INSERT OR IGNORE INTO pairs (id, audioId, videoId, status) VALUES (?, ?, ?, 'downloaded')").run(`dl-${audio.id}`, audio.id, video.id);
            }
         }
      }

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

// POST /api/check-video-release/:id - Check if a file has a video release on MusicBrainz
app.post('/api/check-video-release/:id', async (req, res) => {
  const fileId = req.params.id;
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });

  try {
    const status = await musicbrainz.checkVideoRelease(title);
    library.updateVideoStatus(fileId, status);
    res.json({ success: true, videoStatus: status, state: library.getMatchState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/send-no-video - Move a no-video audio file to the configured noVideoDestDir
app.post('/api/send-no-video', async (req, res) => {
  const { fileId, filename } = req.body;
  if (!fileId) return res.status(400).json({ success: false, error: 'fileId required' });

  try {
    let category = 'Uncategorized';

    // Attempt to AI-categorize using filename if provided so the file lands in the right subfolder
    if (filename) {
      const model = currentConfig.ollamaModel || 'llama3';
      const cleanName = await ollama.cleanQuery(filename, model);
      const internetData = cleanName ? await internet.searchTrack(cleanName) : [];
      const aiResult = await ollama.categorize(filename, internetData ?? [], model);
      if (aiResult?.verifiedCategory) {
        category = aiResult.verifiedCategory;
      }
    }

    const moveSuccess = library.moveNoVideo(fileId, category);
    if (moveSuccess) {
      res.json({ success: true, state: library.getMatchState(), category });
    } else {
      res.status(500).json({ success: false, error: 'Failed to move file.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Quality Checker Routes ──────────────────────────────────────────────────

// In-memory scan cache (resets on each full scan)
let lastScanResults: QualityReport[] = [];
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
app.post('/api/quality/scan', async (req, res) => {
  if (scanInProgress) {
    return res.json({ success: false, error: 'Scan already in progress', progress: scanProgress });
  }
  const dir = (req.body?.dir as string) || currentConfig.qualityCheckDir;
  if (!dir) {
    return res.status(400).json({ success: false, error: 'qualityCheckDir not configured. Set it in Settings first.' });
  }

  scanInProgress = true;
  scanProgress = { done: 0, total: 0, currentFile: '' };
  lastScanResults = [];

  // Run async in background
  scanDirectory(dir, (done, total, currentFile) => {
    scanProgress = { done, total, currentFile };
  })
    .then((results) => {
      lastScanResults = results;
      // Persist quality labels to DB so Dashboard can surface warnings
      const updateLabel = db.prepare('UPDATE files SET qualityLabel = ? WHERE absolutePath = ?');
      for (const r of results) {
        try { updateLabel.run(r.label, r.absolutePath); } catch { /* row may not exist in files table */ }
      }
    })
    .catch((err) => {
      console.error('Quality scan error:', err);
    })
    .finally(() => {
      scanInProgress = false;
    });

  res.json({ success: true, message: 'Scan started', dir });
});

// POST /api/quality/move — move a single file to its label sub-folder
app.post('/api/quality/move', async (req, res) => {
  try {
    const { absolutePath, label } = req.body as { absolutePath: string; label: string };
    if (!absolutePath || !label) return res.status(400).json({ success: false, error: 'absolutePath and label required' });

    const baseDir = currentConfig.qualityCheckDir;
    if (!baseDir) return res.status(400).json({ success: false, error: 'qualityCheckDir not set' });

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, error: 'File not found: ' + absolutePath });
    }

    const newPath = moveFileByLabel(absolutePath, baseDir, label as any);

    // Update in cache
    lastScanResults = lastScanResults.map((r) =>
      r.absolutePath === absolutePath ? { ...r, absolutePath: newPath } : r
    );

    res.json({ success: true, newPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/quality/move-all — bulk move all cached results by label
app.post('/api/quality/move-all', async (req, res) => {
  try {
    const { label } = req.body as { label?: string };
    const baseDir = currentConfig.qualityCheckDir;
    if (!baseDir) return res.status(400).json({ success: false, error: 'qualityCheckDir not set' });

    const toMove = label
      ? lastScanResults.filter((r) => r.label === label)
      : lastScanResults;

    let moved = 0;
    for (const r of toMove) {
      if (!fs.existsSync(r.absolutePath)) continue;
      try {
        const np = moveFileByLabel(r.absolutePath, baseDir, r.label);
        r.absolutePath = np;
        moved++;
      } catch { /* skip locked/moved */ }
    }

    res.json({ success: true, moved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/quality/ai-insight — Ollama verdict for a single file report
app.post('/api/quality/ai-insight', async (req, res) => {
  try {
    const { report } = req.body as { report: QualityReport };
    if (!report) return res.status(400).json({ success: false, error: 'report required' });

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

    const ollamaRes = await axios.post('http://localhost:11434/api/generate', {
      model,
      prompt,
      stream: false,
    }, { timeout: 30000 });

    const insight = (ollamaRes.data?.response || '').trim();

    // Patch cache
    lastScanResults = lastScanResults.map((r) =>
      r.id === report.id ? { ...r, aiInsight: insight } : r
    );

    res.json({ success: true, aiInsight: insight });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/quality/reanalyze — re-run quality check on a single file
app.post('/api/quality/reanalyze', async (req, res) => {
  try {
    const { absolutePath } = req.body as { absolutePath: string };
    if (!absolutePath) return res.status(400).json({ success: false, error: 'absolutePath required' });
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ success: false, error: 'File not found' });

    const report = await analyzeFile(absolutePath);

    // Update cache
    const idx = lastScanResults.findIndex((r) => r.absolutePath === absolutePath);
    if (idx >= 0) lastScanResults[idx] = report;
    else lastScanResults.push(report);

    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/quality/spectrum — compute spectrogram data for a single file (on-demand)
app.post('/api/quality/spectrum', async (req, res) => {
  try {
    const { absolutePath, fftSize = 4096 } = req.body as { absolutePath: string; fftSize?: number };
    if (!absolutePath) return res.status(400).json({ success: false, error: 'absolutePath required' });
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ success: false, error: 'File not found' });

    const result = await computeSpectrum(absolutePath, fftSize);
    if (!result) return res.status(422).json({ success: false, error: 'Could not compute spectrum' });

    res.json({ success: true, spectrum: result.data, meta: result.meta });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Local media streaming (supports HTTP Range requests for seek) ────────────
app.get('/api/stream/:fileId', (req, res) => {
  try {
    const { fileId } = req.params;
    const row = db.prepare('SELECT absolutePath FROM files WHERE id = ?').get(fileId) as any;
    if (!row) return res.status(404).json({ success: false, error: 'File not found' });

    const filePath = row.absolutePath as string;
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File missing on disk' });

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase().replace('.', '');

    // Determine MIME type
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
      ogg: 'audio/ogg', opus: 'audio/ogg',
      mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
      mov: 'video/quicktime', wmv: 'video/x-ms-wmv',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ─── Manual Drag-and-Drop Match ───────────────────────────────────────────────
app.post('/api/manual-match', (req, res) => {
  const { audioId, videoId } = req.body;
  if (!audioId || !videoId) return res.status(400).json({ success: false, error: 'audioId and videoId required' });

  const audio = db.prepare("SELECT id FROM files WHERE id = ? AND type = 'Music'").get(audioId) as any;
  const video = db.prepare("SELECT id FROM files WHERE id = ? AND type = 'Video'").get(videoId) as any;
  if (!audio) return res.status(404).json({ success: false, error: 'Audio file not found' });
  if (!video) return res.status(404).json({ success: false, error: 'Video file not found' });

  // Remove any existing pairs involving these files so we can re-link cleanly
  db.prepare('DELETE FROM pairs WHERE audioId = ? OR videoId = ?').run(audioId, videoId);

  const pairId = `manual-${audioId}-${videoId}`;
  db.prepare("INSERT OR REPLACE INTO pairs (id, audioId, videoId, status) VALUES (?, ?, ?, 'manual')").run(pairId, audioId, videoId);

  res.json({ success: true, state: library.getMatchState() });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
