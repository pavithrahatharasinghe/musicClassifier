import fs from 'fs';
import path from 'path';
import { FileItem, MatchedPair, AppConfig, MatchMakerState } from '../types';

export class ScannerService {
  private config: AppConfig;
  private ollamaMatches: Map<string, string> = new Map(); // audioBaseName -> videoBaseName

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

  private getFiles(dir: string, allowedExts: string[], type: 'Music' | 'Video'): FileItem[] {
    if (!dir || !fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir);
    
    return files
      .map(file => {
        const ext = path.extname(file).toLowerCase();
        if (!allowedExts.includes(ext)) return null;
        return {
          filename: file,
          baseName: path.basename(file, ext),
          extension: ext,
          absolutePath: path.join(dir, file),
          type
        } as FileItem;
      })
      .filter((f): f is FileItem => f !== null);
  }

  public getMatchState(): MatchMakerState {
    const audioFiles = this.getFiles(this.config.audioDir, ['.flac'], 'Music');
    const videoFiles = this.getFiles(this.config.videoDir, ['.mp4', '.mkv'], 'Video');

    const matchedPairs: MatchedPair[] = [];
    const unmatchedAudio: FileItem[] = [];
    let unmatchedVideo: FileItem[] = [...videoFiles];

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

  public addOllamaMatches(matches: {audioName: string, videoName: string}[]) {
    for (const match of matches) {
      if (match.audioName && match.videoName) {
        this.ollamaMatches.set(match.audioName, match.videoName);
      }
    }
  }

  public removeMatch(audioBaseName: string) {
    this.ollamaMatches.delete(audioBaseName);
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

  public movePair(id: string, category: string): boolean {
    const state = this.getMatchState();
    const pairToMove = state.matchedPairs.find(p => p.id === id);

    if (!pairToMove) return false;

    const destFolder = path.join(this.config.destDir, category.toLowerCase());
    this.ensureDirectoryExists(destFolder);

    try {
      const destAudio = path.join(destFolder, pairToMove.audioFile.filename);
      this.moveFileSafely(pairToMove.audioFile.absolutePath, destAudio);
      
      const destVideo = path.join(destFolder, pairToMove.videoFile.filename);
      this.moveFileSafely(pairToMove.videoFile.absolutePath, destVideo);

      // Remove from ollama memory to keep it clean
      this.ollamaMatches.delete(pairToMove.audioFile.baseName);
      return true;
    } catch (error) {
      console.error('Error moving file:', error);
      return false;
    }
  }

  public aiMovePair(id: string, category: string, isOfficialVideo: boolean): boolean {
    const state = this.getMatchState();
    const pairToMove = state.matchedPairs.find(p => p.id === id);

    if (!pairToMove) return false;

    let destFolder = path.join(this.config.destDir, category);
    if (isOfficialVideo) {
      destFolder = path.join(destFolder, 'Official Videos');
    }
    this.ensureDirectoryExists(destFolder);

    try {
      const destAudio = path.join(destFolder, pairToMove.audioFile.filename);
      this.moveFileSafely(pairToMove.audioFile.absolutePath, destAudio);
      
      const destVideo = path.join(destFolder, pairToMove.videoFile.filename);
      this.moveFileSafely(pairToMove.videoFile.absolutePath, destVideo);

      this.ollamaMatches.delete(pairToMove.audioFile.baseName);
      return true;
    } catch (error) {
      console.error('Error moving file with AI:', error);
      return false;
    }
  }
}
