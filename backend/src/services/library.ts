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
  }

  public setConfig(config: AppConfig) {
    this.config = config;
    this.ensureDirectoryExists(this.config.audioDir);
    this.ensureDirectoryExists(this.config.videoDir);
    this.ensureDirectoryExists(this.config.destDir);
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

    // Current files on disk (absolute paths)
    const diskPaths = new Set([
      ...audioFiles.map(f => path.join(this.config.audioDir, f)),
      ...videoFiles.map(f => path.join(this.config.videoDir, f))
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

    this.autoBuildExactPairs();
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
             a.filename as a_fn, a.baseName as a_bn, a.extension as a_ext, a.absolutePath as a_abs,
             v.filename as v_fn, v.baseName as v_bn, v.extension as v_ext, v.absolutePath as v_abs
      FROM pairs p
      JOIN files a ON p.audioId = a.id
      JOIN files v ON p.videoId = v.id
    `).all() as any[];

    const matchedPairs: MatchedPair[] = matchedPairsRaw.map(r => ({
      id: r.id,
      status: r.status,
      audioFile: { id: r.audioId, type: 'Music', filename: r.a_fn, baseName: r.a_bn, extension: r.a_ext, absolutePath: r.a_abs },
      videoFile: { id: r.videoId, type: 'Video', filename: r.v_fn, baseName: r.v_bn, extension: r.v_ext, absolutePath: r.v_abs },
      aiResult: r.aiCategory ? { verifiedCategory: r.aiCategory, isOfficialVideo: r.isOfficial === 1, cleanName: r.cleanName } : undefined
    }));

    return { unmatchedAudio, unmatchedVideo, matchedPairs };
  }

  public updateYoutubeUrl(fileId: string, url: string) {
    db.prepare('UPDATE files SET youtubeUrl = ? WHERE id = ?').run(url, fileId);
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

    // Build the new v4 subfolder paths e.g., /organized/English/flac/ and /organized/English/video/
    let baseDest = path.join(this.config.destDir, category);
    if (isOfficialVideo) {
      baseDest = path.join(baseDest, 'Official Videos');
    }
    
    const audioDestFolder = path.join(baseDest, 'flac');
    const videoDestFolder = path.join(baseDest, 'video');

    this.ensureDirectoryExists(audioDestFolder);
    this.ensureDirectoryExists(videoDestFolder);

    try {
      this.moveFileSafely(pair.a_src, path.join(audioDestFolder, pair.a_fn));
      this.moveFileSafely(pair.v_src, path.join(videoDestFolder, pair.v_fn));

      db.prepare('DELETE FROM pairs WHERE id = ?').run(pairId);
      db.prepare('DELETE FROM files WHERE id = ? OR id = ?').run(pair.audioId, pair.videoId);
      return true;
    } catch (error) {
      console.error('Error physically moving file:', error);
      return false;
    }
  }
}
