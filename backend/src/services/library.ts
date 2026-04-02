import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db';
import { FileItem, MatchedPair, AppConfig, MatchMakerState } from '../types';

export class LibraryService {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.ensureDirectoryExists(this.config.audioDir);
    this.ensureDirectoryExists(this.config.videoDir);
    this.ensureDirectoryExists(this.config.destDir);
    if (this.config.downloadDir) this.ensureDirectoryExists(this.config.downloadDir);
  }

  public setConfig(config: AppConfig) {
    this.config = config;
    this.ensureDirectoryExists(this.config.audioDir);
    this.ensureDirectoryExists(this.config.videoDir);
    this.ensureDirectoryExists(this.config.destDir);
    if (this.config.downloadDir) this.ensureDirectoryExists(this.config.downloadDir);
  }

  private ensureDirectoryExists(dir: string) {
    if (dir && !fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error(`Failed to create dir: ${dir}`, e);
      }
    }
  }

  /**
   * Syncs the physical disk directories to SQLite.
   * Inserts new files, deletes missing ones.
   */
  public syncDisk() {
    if (!fs.existsSync(this.config.audioDir) || !fs.existsSync(this.config.videoDir)) return;

    const audioFiles = fs.readdirSync(this.config.audioDir).filter(f => f.endsWith('.flac'));
    const videoFiles = fs.readdirSync(this.config.videoDir).filter(f => f.endsWith('.mp4') || f.endsWith('.mkv'));

    let dlAudio: string[] = [];
    let dlVideo: string[] = [];
    if (this.config.downloadDir && fs.existsSync(this.config.downloadDir)) {
      const dlFiles = fs.readdirSync(this.config.downloadDir);
      dlAudio = dlFiles.filter(f => f.endsWith('.flac') || f.endsWith('.m4a') || f.endsWith('.mp3'));
      dlVideo = dlFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));
    }

    // Current files on disk (absolute paths)
    const diskPaths = new Set([
      ...audioFiles.map(f => path.join(this.config.audioDir, f)),
      ...videoFiles.map(f => path.join(this.config.videoDir, f)),
      ...dlAudio.map(f => path.join(this.config.downloadDir!, f)),
      ...dlVideo.map(f => path.join(this.config.downloadDir!, f))
    ]);

    // 1. Delete rows that no longer exist on disk
    const allDbFiles = db.prepare('SELECT id, absolutePath FROM files').all() as any[];
    const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');
    for (const f of allDbFiles) {
      if (!diskPaths.has(f.absolutePath)) {
        deleteStmt.run(f.id);
      }
    }

    // 2. Insert new files
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO files (id, filename, baseName, extension, absolutePath, type) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const processFile = (dir: string, file: string, type: string) => {
      const ext = path.extname(file).toLowerCase();
      const baseName = path.basename(file, ext);
      const absPath = path.join(dir, file);
      const id = crypto.createHash('md5').update(absPath).digest('hex');
      insertStmt.run(id, file, baseName, ext, absPath, type);
    };

    audioFiles.forEach(f => processFile(this.config.audioDir, f, 'Music'));
    videoFiles.forEach(f => processFile(this.config.videoDir, f, 'Video'));
    if (this.config.downloadDir) {
       dlAudio.forEach(f => processFile(this.config.downloadDir!, f, 'Music'));
       dlVideo.forEach(f => processFile(this.config.downloadDir!, f, 'Video'));
    }

    this.autoBuildExactPairs();
    this.autoBuildFuzzyPairs();
  }

  /**
   * Automatically pairs tracks that have the exact same baseName.
   */
  private autoBuildExactPairs() {
    const unassignedAudio = db.prepare(`
      SELECT f.* FROM files f
      LEFT JOIN pairs p ON f.id = p.audioId
      WHERE p.id IS NULL AND f.type = 'Music'
    `).all() as any[];

    const insertPair = db.prepare(`
      INSERT OR IGNORE INTO pairs (id, audioId, videoId, status)
      VALUES (?, ?, ?, 'exact')
    `);

    for (const audio of unassignedAudio) {
      const matchingVideo = db.prepare(`
        SELECT f.* FROM files f
        LEFT JOIN pairs p ON f.id = p.videoId
        WHERE p.id IS NULL AND f.type = 'Video' AND f.baseName = ?
      `).get(audio.baseName) as any;

      if (matchingVideo) {
        const pairId = `exact-${audio.id}`;
        insertPair.run(pairId, audio.id, matchingVideo.id);
      }
    }
  }

  /**
   * Automatically pairs tracks probabilistically by comparing word tokens.
   */
  private autoBuildFuzzyPairs() {
    const unassignedAudio = db.prepare(`
      SELECT f.* FROM files f
      LEFT JOIN pairs p ON f.id = p.audioId
      WHERE p.id IS NULL AND f.type = 'Music'
    `).all() as any[];

    const unassignedVideo = db.prepare(`
      SELECT f.* FROM files f
      LEFT JOIN pairs p ON f.id = p.videoId
      WHERE p.id IS NULL AND f.type = 'Video'
    `).all() as any[];

    const insertPair = db.prepare(`
      INSERT OR IGNORE INTO pairs (id, audioId, videoId, status)
      VALUES (?, ?, ?, 'fuzzy')
    `);

    // Extracts normalized alphabetical words > 1 character, handles korean logic as well
    const getTokens = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9\s가-힣]/g, ' ').split(/\s+/).filter(w => w.length > 1);

    const availableVideos = [...unassignedVideo];

    for (const audio of unassignedAudio) {
      const aTokens = getTokens(audio.baseName);
      if (aTokens.length === 0) continue;

      let bestScore = 0;
      let bestVideo = null;
      let bestIdx = -1;

      for (let i = 0; i < availableVideos.length; i++) {
         const video = availableVideos[i];
         const vTokens = getTokens(video.baseName);
         if (vTokens.length === 0) continue;

         let matches = 0;
         for (const t of aTokens) {
           if (vTokens.includes(t)) matches++;
         }
         
         // Using division on audio's string length guarantees we mandate 70% of the AUDIO's title exists in the VIDEO's title!
         const score = matches / aTokens.length;
         if (score > bestScore) {
           bestScore = score;
           bestVideo = video;
           bestIdx = i;
         }
      }

      // If at least 70% of the track's words appear in the video file
      if (bestScore >= 0.7 && bestVideo) {
         insertPair.run(`fuzzy-${audio.id}`, audio.id, bestVideo.id);
         availableVideos.splice(bestIdx, 1); // remove internally to avoid double-binding
      }
    }
  }

  public getMatchState(): MatchMakerState {
    this.syncDisk();

    const unmatchedAudio = db.prepare(`
      SELECT f.* FROM files f LEFT JOIN pairs p ON f.id = p.audioId WHERE p.id IS NULL AND f.type = 'Music'
    `).all() as FileItem[];

    const unmatchedVideo = db.prepare(`
      SELECT f.* FROM files f LEFT JOIN pairs p ON f.id = p.videoId WHERE p.id IS NULL AND f.type = 'Video'
    `).all() as FileItem[];

    const matchedPairsRaw = db.prepare(`
      SELECT p.*, 
             a.filename as a_fn, a.baseName as a_bn, a.extension as a_ext, a.absolutePath as a_abs, a.youtubeUrl as a_yt, a.spotifyUrl as a_sp, a.previewUrl as a_pr,
             v.filename as v_fn, v.baseName as v_bn, v.extension as v_ext, v.absolutePath as v_abs, v.youtubeUrl as v_yt, v.spotifyUrl as v_sp, v.previewUrl as v_pr
      FROM pairs p
      JOIN files a ON p.audioId = a.id
      JOIN files v ON p.videoId = v.id
    `).all() as any[];

    const matchedPairs: MatchedPair[] = matchedPairsRaw.map(r => ({
      id: r.id,
      status: r.status,
      audioFile: { id: r.audioId, type: 'Music', filename: r.a_fn, baseName: r.a_bn, extension: r.a_ext, absolutePath: r.a_abs, youtubeUrl: r.a_yt, spotifyUrl: r.a_sp, previewUrl: r.a_pr },
      videoFile: { id: r.videoId, type: 'Video', filename: r.v_fn, baseName: r.v_bn, extension: r.v_ext, absolutePath: r.v_abs, youtubeUrl: r.v_yt, spotifyUrl: r.v_sp, previewUrl: r.v_pr },
      aiResult: r.aiCategory ? { verifiedCategory: r.aiCategory, isOfficialVideo: r.isOfficial === 1, cleanName: r.cleanName } : undefined
    }));

    return { unmatchedAudio, unmatchedVideo, matchedPairs };
  }

  public updateYoutubeUrl(fileId: string, url: string, previewUrl?: string) {
    if (previewUrl) {
      db.prepare('UPDATE files SET youtubeUrl = ?, previewUrl = ? WHERE id = ?').run(url, previewUrl, fileId);
    } else {
      db.prepare('UPDATE files SET youtubeUrl = ? WHERE id = ?').run(url, fileId);
    }
  }

  public updateSpotifyUrl(fileId: string, url: string, previewUrl?: string) {
    if (previewUrl) {
      db.prepare('UPDATE files SET spotifyUrl = ?, previewUrl = ? WHERE id = ?').run(url, previewUrl, fileId);
    } else {
      db.prepare('UPDATE files SET spotifyUrl = ? WHERE id = ?').run(url, fileId);
    }
  }

  public addOllamaMatches(matches: {audioName: string, videoName: string}[]) {
    const insertPair = db.prepare(`
      INSERT OR IGNORE INTO pairs (id, audioId, videoId, status)
      VALUES (?, ?, ?, 'ollama')
    `);

    for (const match of matches) {
      const a = db.prepare("SELECT id FROM files WHERE baseName = ? AND type = 'Music'").get(match.audioName) as any;
      const v = db.prepare("SELECT id FROM files WHERE baseName = ? AND type = 'Video'").get(match.videoName) as any;
      
      if (a && v) {
        insertPair.run(`ollama-${a.id}`, a.id, v.id);
      }
    }
  }

  public removeMatch(pairId: string) {
    db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
  }

  private moveFileSafely(src: string, dest: string) {
    try {
      fs.renameSync(src, dest);
    } catch (err: any) {
      if (err.code === 'EXDEV') {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } else {
        throw err;
      }
    }
  }

  public aiMovePair(pairId: string, category: string, isOfficialVideo: boolean): boolean {
    const pair = db.prepare(`
      SELECT p.*, a.absolutePath as a_src, a.filename as a_fn, v.absolutePath as v_src, v.filename as v_fn 
      FROM pairs p
      JOIN files a ON p.audioId = a.id
      JOIN files v ON p.videoId = v.id
      WHERE p.id = ?
    `).get(pairId) as any;

    if (!pair) return false;

    // Use has video topology
    let baseDest = path.join(this.config.destDir, category, 'has video');
    if (isOfficialVideo) {
      baseDest = path.join(this.config.destDir, category, 'has video (Official)');
    }
    
    this.ensureDirectoryExists(baseDest);

    try {
      this.moveFileSafely(pair.a_src, path.join(baseDest, pair.a_fn));
      this.moveFileSafely(pair.v_src, path.join(baseDest, pair.v_fn));

      db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
      db.prepare('DELETE FROM files WHERE id = ? OR id = ?').run(pair.audioId, pair.videoId);
      return true;
    } catch (error) {
      console.error('Error physically moving file:', error);
      return false;
    }
  }

  public aiMoveAudioOnly(audioId: string, category: string): boolean {
    const audio = db.prepare(`SELECT absolutePath, filename FROM files WHERE id = ? AND type = 'Music'`).get(audioId) as any;
    if (!audio) return false;

    let baseDest = path.join(this.config.destDir, category, 'no video');
    this.ensureDirectoryExists(baseDest);

    try {
      this.moveFileSafely(audio.absolutePath, path.join(baseDest, audio.filename));
      db.prepare('DELETE FROM files WHERE id = ?').run(audioId);
      return true;
    } catch (error) {
       console.error('Error physically moving audio only file:', error);
       return false;
    }
  }
}
