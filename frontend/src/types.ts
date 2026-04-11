export interface AppConfig {
  audioDir: string;
  videoDir: string;
  destDir: string;
  downloadDir?: string;
  ollamaModel?: string;
  noVideoDestDir?: string; // Destination for no-video songs
}

export interface MediaMetadata {
  spotify_id?: string;
  isrc?: string;
  album_art_url?: string;
}

export interface FileItem {
  id?: string;
  filename: string;
  baseName: string;
  extension: string;
  absolutePath: string;
  type: 'Music' | 'Video';
  youtubeUrl?: string | null;
  spotifyUrl?: string | null;
  albumArt?: string | null;
  isrc?: string | null;
  previewUrl?: string | null;
  videoStatus?: 'available' | 'unavailable' | 'unknown' | null;
}

export interface OllamaClassification {
  genre: string;
  cleanName: string;
  matchConfidence: number;
}

export interface InternetMetadata {
  artistName: string;
  trackName: string;
  primaryGenreName: string;
}

export interface AITakeoverResult {
  verifiedCategory: string; // e.g., 'K-Pop', 'J-Pop', 'English', etc.
  isOfficialVideo: boolean;
  cleanName: string;
}

export type MatchStatus = 'exact' | 'ollama' | 'manual' | 'fuzzy' | 'downloaded';

export interface MatchedPair {
  id: string; // unique identifier
  audioFile: FileItem;
  videoFile: FileItem;
  status: MatchStatus;
  classification?: OllamaClassification;
  aiResult?: AITakeoverResult;
}

export interface MatchMakerState {
  unmatchedAudio: FileItem[];
  unmatchedVideo: FileItem[];
  matchedPairs: MatchedPair[];
}

export interface SpotiflacTrack {
  id: string;
  name: string;
  type: string;
  artists: string;
  album_name: string;
  images: string;
  external_urls: string;
  duration_ms: number;
}
