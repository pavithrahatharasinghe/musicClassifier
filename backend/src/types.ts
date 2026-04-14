export interface AppConfig {
  audioDir: string;
  videoDir: string;
  destDir: string;
  downloadDir?: string;
  ollamaModel?: string; // New Model field
  videoValidationEnabled?: boolean; // Enable video-release validation during auto-tagging
  noVideoDestDir?: string; // Destination for no-video songs (overrides destDir when set)
  qualityCheckDir?: string; // Directory for FLAC quality analysis
}

// ─── Quality Checker types ────────────────────────────────────────────────────

export type QualityLabel = 'lossless' | 'standard' | 'recheck' | 'invalid';

export interface SignalAnalytics {
  nyquistKhz: number | null;
  dynamicRange: number | null;
  peakAmplitude: number | null;
  rmsLevel: number | null;
  totalSamples: number | null;
}

export interface SpectrumMeta {
  displayFrames: number;
  fftSize: number;
  freqResolutionHz: number;
}

export interface QualityReport {
  id: string;
  filename: string;
  baseName: string;
  absolutePath: string;
  extension: string;
  sizeBytes: number;
  artist: string | null;
  title: string | null;
  album: string | null;
  albumArtBase64: string | null;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  bitDepth: number | null;
  formatName: string | null;
  durationSec: number | null;
  metadataOk: boolean;
  bitrateOk: boolean;
  hasClipping: boolean;
  signal: SignalAnalytics;
  spectrumMeta: SpectrumMeta | null;
  label: QualityLabel;
  labelReason: string;
  aiInsight?: string;
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
  id: string; // unique identifier (often db id)
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
