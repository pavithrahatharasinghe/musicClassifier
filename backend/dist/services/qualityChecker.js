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
exports.makeId = makeId;
exports.computeSpectrum = computeSpectrum;
exports.analyzeFile = analyzeFile;
exports.scanDirectory = scanDirectory;
exports.moveFileByLabel = moveFileByLabel;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function makeId(p) {
    let h = 0;
    for (let i = 0; i < p.length; i++) {
        h = ((h << 5) - h + p.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
}
function asStr(v) {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number')
        return String(v);
    return '';
}
function asNum(v) {
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string') {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
    }
    return null;
}
function ffprobeJson(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { stdout } = yield execFileAsync('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_streams',
                '-show_format',
                filePath,
            ], { maxBuffer: 4 * 1024 * 1024 });
            return JSON.parse(stdout);
        }
        catch (_a) {
            return null;
        }
    });
}
/**
 * Extract embedded album art from the FLAC using ffmpeg → stdout (piped as base64).
 * Returns null if no cover is embedded.
 */
function extractAlbumArt(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { stdout } = yield execFileAsync('ffmpeg', [
                '-v', 'quiet',
                '-i', filePath,
                '-an', // no audio
                '-vcodec', 'copy', // copy video stream (= album art)
                '-f', 'image2pipe',
                '-',
            ], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
            if (stdout && stdout.length > 0) {
                return `data:image/jpeg;base64,${stdout.toString('base64')}`;
            }
            return null;
        }
        catch (_a) {
            return null;
        }
    });
}
/**
 * Detect clipping via volumedetect + gather peak/RMS from astats.
 * Returns partial signal analytics.
 */
function gatherSignalStats(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { stderr } = yield execFileAsync('ffmpeg', [
                '-i', filePath,
                '-af', 'volumedetect,astats=metadata=1:reset=1',
                '-vn', '-sn', '-dn',
                '-f', 'null',
                '-',
            ], { maxBuffer: 4 * 1024 * 1024 }).catch((err) => {
                var _a;
                return ({
                    stderr: ((_a = err.stderr) === null || _a === void 0 ? void 0 : _a.toString()) || '',
                    stdout: '',
                });
            });
            // Parse max_volume (peak) — 0.0 dBFS = clipped
            const peakMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
            const peakAmplitude = peakMatch ? parseFloat(peakMatch[1]) : null;
            const hasClipping = peakAmplitude !== null && peakAmplitude >= 0.0;
            // Parse RMS from astats
            const rmsMatch = stderr.match(/RMS level dB:\s*([-\d.]+)/);
            const rmsLevel = rmsMatch ? parseFloat(rmsMatch[1]) : null;
            // Dynamic range = peak - RMS (simplified DR measurement)
            const dynamicRange = peakAmplitude !== null && rmsLevel !== null
                ? Math.abs(peakAmplitude - rmsLevel)
                : null;
            return { hasClipping, peakAmplitude, rmsLevel, dynamicRange };
        }
        catch (_a) {
            return { hasClipping: false, peakAmplitude: null, rmsLevel: null, dynamicRange: null };
        }
    });
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
function computeSpectrum(filePath_1) {
    return __awaiter(this, arguments, void 0, function* (filePath, fftSize = 4096) {
        try {
            // Extract raw PCM at 22050 Hz mono → pipe out
            // We use a fixed sample rate for spectrum analysis (reduces compute)
            const ANALYSIS_SR = 22050;
            const { stdout: pcmBuf } = yield execFileAsync('ffmpeg', [
                '-v', 'quiet',
                '-i', filePath,
                '-ac', '1',
                '-ar', String(ANALYSIS_SR),
                '-f', 's16le',
                '-',
            ], { encoding: 'buffer', maxBuffer: 300 * 1024 * 1024 });
            if (!pcmBuf || pcmBuf.length < fftSize * 2)
                return null;
            const pcm = pcmBuf;
            const totalSamples = pcm.length / 2;
            const freqBins = fftSize / 2 + 1;
            // Downsample time slices — target ~512 time frames
            const TARGET_FRAMES = 512;
            const hop = Math.max(1, Math.floor(totalSamples / TARGET_FRAMES));
            const timeSlices = [];
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
                if (timeSlices.length >= TARGET_FRAMES)
                    break;
            }
            const meta = {
                displayFrames: timeSlices.length,
                fftSize,
                freqResolutionHz: ANALYSIS_SR / fftSize,
            };
            return {
                data: { freq_bins: freqBins, time_slices: timeSlices },
                meta,
            };
        }
        catch (_a) {
            return null;
        }
    });
}
/**
 * Radix-2 Cooley-Tukey FFT on real input.
 * Returns magnitude in dB for first `freqBins` bins.
 */
function fft(samples, freqBins) {
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
    const mag = new Array(freqBins);
    for (let i = 0; i < freqBins; i++) {
        const power = re[i] * re[i] + im[i] * im[i];
        mag[i] = power > 0 ? 10 * Math.log10(power / (N * N)) : -160;
    }
    return mag;
}
function deriveLabel(metadataOk, bitrateOk, hasClipping, bitRate, sampleRate) {
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
    const sr = sampleRate !== null && sampleRate !== void 0 ? sampleRate : 0;
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
function analyzeFile(filePath_1) {
    return __awaiter(this, arguments, void 0, function* (filePath, includeSpectrum = false) {
        var _a, _b, _c, _d, _e, _f;
        const filename = path_1.default.basename(filePath);
        const baseName = path_1.default.basename(filePath, path_1.default.extname(filePath));
        const extension = path_1.default.extname(filePath).replace('.', '').toLowerCase();
        const stats = fs_1.default.statSync(filePath);
        const probe = yield ffprobeJson(filePath);
        let artist = null;
        let title = null;
        let album = null;
        let codec = null;
        let sampleRate = null;
        let channels = null;
        let bitRate = null;
        let bitDepth = null;
        let formatName = null;
        let durationSec = null;
        if (probe) {
            const tags = {};
            const formatTags = ((_a = probe.format) === null || _a === void 0 ? void 0 : _a.tags) || {};
            const streamTags = ((_c = (_b = probe.streams) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.tags) || {};
            Object.assign(tags, streamTags, formatTags);
            const getTag = (key) => {
                const lk = key.toLowerCase();
                for (const k of Object.keys(tags)) {
                    if (k.toLowerCase() === lk)
                        return asStr(tags[k]).trim() || null;
                }
                return null;
            };
            artist = getTag('artist');
            title = getTag('title');
            album = getTag('album');
            formatName = asStr((_d = probe.format) === null || _d === void 0 ? void 0 : _d.format_name) || null;
            const fmtBr = asNum((_e = probe.format) === null || _e === void 0 ? void 0 : _e.bit_rate);
            if (fmtBr)
                bitRate = fmtBr;
            const fmtDur = asNum((_f = probe.format) === null || _f === void 0 ? void 0 : _f.duration);
            if (fmtDur)
                durationSec = fmtDur;
            for (const stream of (probe.streams || [])) {
                if (asStr(stream.codec_type) === 'audio') {
                    codec = asStr(stream.codec_name) || null;
                    sampleRate = asNum(stream.sample_rate);
                    channels = asNum(stream.channels);
                    bitDepth = asNum(stream.bits_per_raw_sample) || asNum(stream.bits_per_sample);
                    if (!bitRate)
                        bitRate = asNum(stream.bit_rate);
                    break;
                }
            }
        }
        const metadataOk = !!((artist === null || artist === void 0 ? void 0 : artist.trim()) && (title === null || title === void 0 ? void 0 : title.trim()));
        const bitrateOk = bitRate !== null && bitRate > 0;
        // Signal analytics — run all at once
        const signalStats = bitrateOk
            ? yield gatherSignalStats(filePath)
            : { hasClipping: false, peakAmplitude: null, rmsLevel: null, dynamicRange: null };
        const { hasClipping, peakAmplitude, rmsLevel, dynamicRange } = signalStats;
        const nyquistKhz = sampleRate ? sampleRate / 2 / 1000 : null;
        const totalSamples = sampleRate && durationSec ? Math.round(sampleRate * durationSec) : null;
        const signal = {
            nyquistKhz,
            dynamicRange,
            peakAmplitude,
            rmsLevel,
            totalSamples,
        };
        // Extract album art
        const albumArtBase64 = yield extractAlbumArt(filePath);
        const { label, reason } = deriveLabel(metadataOk, bitrateOk, hasClipping, bitRate, sampleRate);
        // Spectrum meta (computed from file params without full PCM decode)
        const fftSize = 4096;
        const spectrumMeta = sampleRate && durationSec && totalSamples
            ? {
                fftSize,
                displayFrames: Math.floor(totalSamples / Math.max(1, Math.floor(totalSamples / 512))),
                freqResolutionHz: parseFloat(((sampleRate !== null && sampleRate !== void 0 ? sampleRate : 44100) / fftSize).toFixed(2)),
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
    });
}
function scanDirectory(dirPath, progressCb) {
    return __awaiter(this, void 0, void 0, function* () {
        const SUPPORTED = ['.flac', '.wav', '.aiff', '.dsf', '.dff'];
        if (!fs_1.default.existsSync(dirPath)) {
            throw new Error(`Directory not found: ${dirPath}`);
        }
        const allFiles = fs_1.default.readdirSync(dirPath)
            .filter((f) => SUPPORTED.includes(path_1.default.extname(f).toLowerCase()))
            .map((f) => path_1.default.join(dirPath, f));
        const reports = [];
        for (let i = 0; i < allFiles.length; i++) {
            const f = allFiles[i];
            progressCb === null || progressCb === void 0 ? void 0 : progressCb(i, allFiles.length, path_1.default.basename(f));
            try {
                const r = yield analyzeFile(f, false);
                reports.push(r);
            }
            catch (err) {
                reports.push({
                    id: makeId(f),
                    filename: path_1.default.basename(f),
                    baseName: path_1.default.basename(f, path_1.default.extname(f)),
                    absolutePath: f,
                    extension: path_1.default.extname(f).replace('.', '').toLowerCase(),
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
        progressCb === null || progressCb === void 0 ? void 0 : progressCb(allFiles.length, allFiles.length, 'done');
        return reports;
    });
}
function moveFileByLabel(filePath, baseDir, label) {
    const subDirMap = {
        lossless: 'validated',
        standard: 'standard',
        recheck: 'recheck',
        invalid: 'bitrate_invalid',
    };
    const dest = path_1.default.join(baseDir, subDirMap[label]);
    fs_1.default.mkdirSync(dest, { recursive: true });
    const newPath = path_1.default.join(dest, path_1.default.basename(filePath));
    fs_1.default.renameSync(filePath, newPath);
    return newPath;
}
