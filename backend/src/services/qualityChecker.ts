import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type QualityLabel =
  | 'lossless'    // ✅ Hi-res lossless
  | 'standard'    // ⚠️  Standard quality
  | 'recheck'     // ❌ Needs recheck
  | 'invalid';    // 🚫 Invalid

export interface SignalAnalytics {
  nyquistKhz: number | null;
  dynamicRange: number | null;   // dB
  peakAmplitude: number | null;  // dBFS
  rmsLevel: number | null;       // dBFS
  totalSamples: number | null;
}

export interface SpectrumMeta {
  displayFrames: number;
  fftSize: number;
  freqResolutionHz: number;
}

// Compact spectrum data for in-memory carry (same shape as SpotiFLAC SpectrumData)
export interface SpectrumData {
  freq_bins: number;
  time_slices: Array<{ magnitudes: number[] }>;
}

export interface QualityReport {
  id: string;
  filename: string;
  baseName: string;
  absolutePath: string;
  extension: string;
  sizeBytes: number;

  // Metadata tags
  artist: string | null;
  title: string | null;
  album: string | null;
  albumArtBase64: string | null;   // data:image/jpeg;base64,…

  // Audio technical info
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  bitDepth: number | null;
  formatName: string | null;
  durationSec: number | null;

  // Quality checks
  metadataOk: boolean;
  bitrateOk: boolean;
  hasClipping: boolean;

  // Signal analytics
  signal: SignalAnalytics;
  spectrumMeta: SpectrumMeta | null;

  // Final verdict
  label: QualityLabel;
  labelReason: string;
  aiInsight?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

export function makeId(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    h = ((h << 5) - h + p.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

async function ffprobeJson(filePath: string): Promise<any | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Extract embedded album art from the FLAC using ffmpeg → stdout (piped as base64).
 * Returns null if no cover is embedded.
 */
async function extractAlbumArt(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', [
      '-v', 'quiet',
      '-i', filePath,
      '-an',              // no audio
      '-vcodec', 'copy',  // copy video stream (= album art)
      '-f', 'image2pipe',
      '-',
    ], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
    if (stdout && stdout.length > 0) {
      return `data:image/jpeg;base64,${(stdout as Buffer).toString('base64')}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect clipping via volumedetect + gather peak/RMS from astats.
 * Returns partial signal analytics.
 */
async function gatherSignalStats(filePath: string): Promise<{
  hasClipping: boolean;
  peakAmplitude: number | null;
  rmsLevel: number | null;
  dynamicRange: number | null;
}> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-af', 'volumedetect,astats=metadata=1:reset=1',
      '-vn', '-sn', '-dn',
      '-f', 'null',
      '-',
    ], { maxBuffer: 4 * 1024 * 1024 }).catch((err: any) => ({
      stderr: err.stderr?.toString() || '',
      stdout: '',
    }));

    // Parse max_volume (peak) — 0.0 dBFS = clipped
    const peakMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const peakAmplitude = peakMatch ? parseFloat(peakMatch[1]) : null;
    const hasClipping = peakAmplitude !== null && peakAmplitude >= 0.0;

    // Parse RMS from astats
    const rmsMatch = stderr.match(/RMS level dB:\s*([-\d.]+)/);
    const rmsLevel = rmsMatch ? parseFloat(rmsMatch[1]) : null;

    // Dynamic range = peak - RMS (simplified DR measurement)
    const dynamicRange =
      peakAmplitude !== null && rmsLevel !== null
        ? Math.abs(peakAmplitude - rmsLevel)
        : null;

    return { hasClipping, peakAmplitude, rmsLevel, dynamicRange };
  } catch {
    return { hasClipping: false, peakAmplitude: null, rmsLevel: null, dynamicRange: null };
  }
}

/**
 * Compute a compact spectrogram for a file.
 * Uses ffmpeg to pipe PCM → WebAssembly-free in-process FFT approximation.
 * Returns SpectrumData + SpectrumMeta or null if ffmpeg not available.
 *
 * Strategy: use ffmpeg showspectrumpic to generate a pixel image, then
 * decode it as 1-D column magnitudes — same approach as many audio analysers.
 * For simplicity we instead use astats per-chunk to generate approximate time slices.
 */
export async function computeSpectrum(
  filePath: string,
  fftSize = 4096,
): Promise<{ data: SpectrumData; meta: SpectrumMeta } | null> {
  try {
    // Extract raw PCM at 22050 Hz mono → pipe out
    // We use a fixed sample rate for spectrum analysis (reduces compute)
    const ANALYSIS_SR = 22050;
    const { stdout: pcmBuf } = await execFileAsync('ffmpeg', [
      '-v', 'quiet',
      '-i', filePath,
      '-ac', '1',
      '-ar', String(ANALYSIS_SR),
      '-f', 's16le',
      '-',
    ], { encoding: 'buffer', maxBuffer: 300 * 1024 * 1024 });

    if (!pcmBuf || (pcmBuf as Buffer).length < fftSize * 2) return null;

    const pcm = pcmBuf as Buffer;
    const totalSamples = pcm.length / 2;
    const freqBins = fftSize / 2 + 1;

    // Downsample time slices — target ~512 time frames
    const TARGET_FRAMES = 512;
    const hop = Math.max(1, Math.floor(totalSamples / TARGET_FRAMES));
    const timeSlices: Array<{ magnitudes: number[] }> = [];

    for (let start = 0; start + fftSize <= totalSamples; start += hop) {
      // Read window of samples
      const samples = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        const offset = (start + i) * 2;
        if (offset + 1 < pcm.length) {
          // Read int16 little-endian, normalize to [-1, 1]
          const s = pcm.readInt16LE(offset);
          // Hann window
          const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
          samples[i] = (s / 32768.0) * w;
        }
      }

      // Real DFT (Cooley-Tukey radix-2 FFT)
      const magnitudes = fft(samples, freqBins);
      timeSlices.push({ magnitudes });

      if (timeSlices.length >= TARGET_FRAMES) break;
    }

    const meta: SpectrumMeta = {
      displayFrames: timeSlices.length,
      fftSize,
      freqResolutionHz: ANALYSIS_SR / fftSize,
    };

    return {
      data: { freq_bins: freqBins, time_slices: timeSlices },
      meta,
    };
  } catch {
    return null;
  }
}

/**
 * Radix-2 Cooley-Tukey FFT on real input.
 * Returns magnitude in dB for first `freqBins` bins.
 */
function fft(samples: Float32Array, freqBins: number): number[] {
  const N = samples.length;
  // Bit-reversal permutation
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    re[i] = samples[i];
    im[i] = 0;
  }
  // FFT in-place
  let len = 2;
  while (len <= N) {
    const halfLen = len >> 1;
    const wRe = Math.cos(-2 * Math.PI / len);
    const wIm = Math.sin(-2 * Math.PI / len);
    for (let k = 0; k < N; k += len) {
      let curWRe = 1.0;
      let curWIm = 0.0;
      for (let i = 0; i < halfLen; i++) {
        const uRe = re[k + i];
        const uIm = im[k + i];
        const vRe = re[k + i + halfLen] * curWRe - im[k + i + halfLen] * curWIm;
        const vIm = re[k + i + halfLen] * curWIm + im[k + i + halfLen] * curWRe;
        re[k + i] = uRe + vRe;
        im[k + i] = uIm + vIm;
        re[k + i + halfLen] = uRe - vRe;
        im[k + i + halfLen] = uIm - vIm;
        const tmpRe = curWRe * wRe - curWIm * wIm;
        curWIm = curWRe * wIm + curWIm * wRe;
        curWRe = tmpRe;
      }
    }
    len <<= 1;
  }
  // Magnitude in dB
  const mag: number[] = new Array(freqBins);
  for (let i = 0; i < freqBins; i++) {
    const power = re[i] * re[i] + im[i] * im[i];
    mag[i] = power > 0 ? 10 * Math.log10(power / (N * N)) : -160;
  }
  return mag;
}

function deriveLabel(
  metadataOk: boolean,
  bitrateOk: boolean,
  hasClipping: boolean,
  bitRate: number | null,
  sampleRate: number | null,
): { label: QualityLabel; reason: string } {
  if (!bitrateOk) {
    return { label: 'invalid', reason: 'Bitrate is invalid or zero' };
  }
  if (!metadataOk) {
    return { label: 'recheck', reason: 'Missing artist or title metadata' };
  }
  if (hasClipping) {
    return { label: 'recheck', reason: 'Audio clipping detected at peak amplitude' };
  }
  const kbps = bitRate ? bitRate / 1000 : 0;
  const sr = sampleRate ?? 0;
  if (kbps >= 900 && sr >= 44100) {
    return { label: 'lossless', reason: `Hi-res lossless — ${Math.round(kbps)} kbps @ ${sr} Hz` };
  }
  return {
    label: 'standard',
    reason: `Standard quality — ${Math.round(kbps)} kbps @ ${sr} Hz`,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Core scanner
// ──────────────────────────────────────────────────────────────────────────────

export async function analyzeFile(
  filePath: string,
  includeSpectrum = false,
): Promise<QualityReport> {
  const filename = path.basename(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  const stats = fs.statSync(filePath);

  const probe = await ffprobeJson(filePath);

  let artist: string | null = null;
  let title: string | null = null;
  let album: string | null = null;
  let codec: string | null = null;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitRate: number | null = null;
  let bitDepth: number | null = null;
  let formatName: string | null = null;
  let durationSec: number | null = null;

  if (probe) {
    const tags: Record<string, string> = {};
    const formatTags = probe.format?.tags || {};
    const streamTags = probe.streams?.[0]?.tags || {};
    Object.assign(tags, streamTags, formatTags);

    const getTag = (key: string) => {
      const lk = key.toLowerCase();
      for (const k of Object.keys(tags)) {
        if (k.toLowerCase() === lk) return asStr(tags[k]).trim() || null;
      }
      return null;
    };

    artist = getTag('artist');
    title = getTag('title');
    album = getTag('album');
    formatName = asStr(probe.format?.format_name) || null;
    const fmtBr = asNum(probe.format?.bit_rate);
    if (fmtBr) bitRate = fmtBr;
    const fmtDur = asNum(probe.format?.duration);
    if (fmtDur) durationSec = fmtDur;

    for (const stream of (probe.streams || []) as any[]) {
      if (asStr(stream.codec_type) === 'audio') {
        codec = asStr(stream.codec_name) || null;
        sampleRate = asNum(stream.sample_rate);
        channels = asNum(stream.channels);
        bitDepth = asNum(stream.bits_per_raw_sample) || asNum(stream.bits_per_sample);
        if (!bitRate) bitRate = asNum(stream.bit_rate);
        break;
      }
    }
  }

  const metadataOk = !!(artist?.trim() && title?.trim());
  const bitrateOk = bitRate !== null && bitRate > 0;

  // Signal analytics — run all at once
  const signalStats = bitrateOk
    ? await gatherSignalStats(filePath)
    : { hasClipping: false, peakAmplitude: null, rmsLevel: null, dynamicRange: null };

  const { hasClipping, peakAmplitude, rmsLevel, dynamicRange } = signalStats;

  const nyquistKhz = sampleRate ? sampleRate / 2 / 1000 : null;
  const totalSamples =
    sampleRate && durationSec ? Math.round(sampleRate * durationSec) : null;

  const signal: SignalAnalytics = {
    nyquistKhz,
    dynamicRange,
    peakAmplitude,
    rmsLevel,
    totalSamples,
  };

  // Extract album art
  const albumArtBase64 = await extractAlbumArt(filePath);

  const { label, reason } = deriveLabel(metadataOk, bitrateOk, hasClipping, bitRate, sampleRate);

  // Spectrum meta (computed from file params without full PCM decode)
  const fftSize = 4096;
  const spectrumMeta: SpectrumMeta | null =
    sampleRate && durationSec && totalSamples
      ? {
          fftSize,
          displayFrames: Math.floor(totalSamples / Math.max(1, Math.floor(totalSamples / 512))),
          freqResolutionHz: parseFloat(((sampleRate ?? 44100) / fftSize).toFixed(2)),
        }
      : null;

  return {
    id: makeId(filePath),
    filename,
    baseName,
    absolutePath: filePath,
    extension,
    sizeBytes: stats.size,
    artist,
    title,
    album,
    albumArtBase64,
    codec,
    sampleRate,
    channels,
    bitRate,
    bitDepth,
    formatName,
    durationSec,
    metadataOk,
    bitrateOk,
    hasClipping,
    signal,
    spectrumMeta,
    label,
    labelReason: reason,
  };
}

export async function scanDirectory(
  dirPath: string,
  progressCb?: (done: number, total: number, currentFile: string) => void,
): Promise<QualityReport[]> {
  const SUPPORTED = ['.flac', '.wav', '.aiff', '.dsf', '.dff'];

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const allFiles = fs.readdirSync(dirPath)
    .filter((f) => SUPPORTED.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(dirPath, f));

  const reports: QualityReport[] = [];
  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i];
    progressCb?.(i, allFiles.length, path.basename(f));
    try {
      const r = await analyzeFile(f, false);
      reports.push(r);
    } catch (err: any) {
      reports.push({
        id: makeId(f),
        filename: path.basename(f),
        baseName: path.basename(f, path.extname(f)),
        absolutePath: f,
        extension: path.extname(f).replace('.', '').toLowerCase(),
        sizeBytes: 0,
        artist: null, title: null, album: null, albumArtBase64: null,
        codec: null, sampleRate: null, channels: null, bitRate: null,
        bitDepth: null, formatName: null, durationSec: null,
        metadataOk: false, bitrateOk: false, hasClipping: false,
        signal: { nyquistKhz: null, dynamicRange: null, peakAmplitude: null, rmsLevel: null, totalSamples: null },
        spectrumMeta: null,
        label: 'invalid',
        labelReason: `Read error: ${err.message}`,
      });
    }
  }
  progressCb?.(allFiles.length, allFiles.length, 'done');
  return reports;
}

export function moveFileByLabel(
  filePath: string,
  baseDir: string,
  label: QualityLabel,
): string {
  const subDirMap: Record<QualityLabel, string> = {
    lossless: 'validated',
    standard: 'standard',
    recheck: 'recheck',
    invalid: 'bitrate_invalid',
  };
  const dest = path.join(baseDir, subDirMap[label]);
  fs.mkdirSync(dest, { recursive: true });
  const newPath = path.join(dest, path.basename(filePath));
  fs.renameSync(filePath, newPath);
  return newPath;
}
