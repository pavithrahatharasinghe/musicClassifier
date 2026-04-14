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
/** Simple deterministic id from absolute path */
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
/** Run ffprobe on a file and return parsed JSON. Returns null if ffprobe fails. */
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
 * Detect clipping using ffmpeg volumedetect filter.
 * Equivalent to app.py's is_clipped() — checks if peak sample == max amplitude.
 * A max_volume of 0.0 dBFS means the signal hits the ceiling (clipping).
 */
function detectClipping(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // volumedetect prints to stderr
            const { stderr } = yield execFileAsync('ffmpeg', [
                '-i', filePath,
                '-af', 'volumedetect',
                '-vn', '-sn', '-dn',
                '-f', 'null',
                '-',
            ], { maxBuffer: 2 * 1024 * 1024 }).catch((err) => {
                var _a;
                return ({
                    stderr: ((_a = err.stderr) === null || _a === void 0 ? void 0 : _a.toString()) || '',
                    stdout: '',
                });
            });
            const match = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
            if (!match)
                return false;
            const maxVol = parseFloat(match[1]);
            // 0.0 dBFS = at full scale = clipped (same logic as numpy iinfo max check)
            return maxVol >= 0.0;
        }
        catch (_a) {
            return false;
        }
    });
}
/** Determine the quality label from the gathered info — mirrors app.py pipeline */
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
    // Hi-res threshold: bit rate ≥ 900 kbps AND sample rate ≥ 44100 Hz
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
/**
 * Analyze a single FLAC file and return its QualityReport.
 * Progress callback receives (filename) after each file is probed.
 */
function analyzeFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
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
            // Tags (metadata)
            const tags = {};
            const formatTags = ((_a = probe.format) === null || _a === void 0 ? void 0 : _a.tags) || {};
            // Also check first stream tags
            const streamTags = ((_c = (_b = probe.streams) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.tags) || {};
            Object.assign(tags, streamTags, formatTags);
            // Case-insensitive tag lookup
            const getTag = (key) => {
                const lk = key.toLowerCase();
                for (const k of Object.keys(tags)) {
                    if (k.toLowerCase() === lk)
                        return asStr(tags[k]).trim() || null;
                }
                return null;
            };
            artist = getTag('artist') || getTag('ARTIST');
            title = getTag('title') || getTag('TITLE');
            album = getTag('album') || getTag('ALBUM');
            formatName = asStr((_d = probe.format) === null || _d === void 0 ? void 0 : _d.format_name) || null;
            const fmtBr = asNum((_e = probe.format) === null || _e === void 0 ? void 0 : _e.bit_rate);
            if (fmtBr)
                bitRate = fmtBr;
            const fmtDur = asNum((_f = probe.format) === null || _f === void 0 ? void 0 : _f.duration);
            if (fmtDur)
                durationSec = fmtDur;
            // Audio stream
            for (const stream of (probe.streams || [])) {
                if (asStr(stream.codec_type) === 'audio') {
                    codec = asStr(stream.codec_name) || null;
                    sampleRate = asNum(stream.sample_rate);
                    channels = asNum(stream.channels);
                    bitDepth = asNum(stream.bits_per_raw_sample) || asNum(stream.bits_per_sample);
                    if (!bitRate) {
                        bitRate = asNum(stream.bit_rate);
                    }
                    break;
                }
            }
        }
        // ── Quality checks (app.py logic) ──
        const metadataOk = !!((artist === null || artist === void 0 ? void 0 : artist.trim()) && (title === null || title === void 0 ? void 0 : title.trim()));
        const bitrateOk = bitRate !== null && bitRate > 0;
        // Only run clipping detection if basic checks pass (expensive operation)
        let hasClipping = false;
        if (bitrateOk) {
            hasClipping = yield detectClipping(filePath);
        }
        const { label, reason } = deriveLabel(metadataOk, bitrateOk, hasClipping, bitRate, sampleRate);
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
            label,
            labelReason: reason,
        };
    });
}
/**
 * Scan an entire directory for audio files (FLAC, FLAC-adjacent) and return
 * quality reports. Calls progressCb(done, total, currentFile) after each file.
 */
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
                const r = yield analyzeFile(f);
                reports.push(r);
            }
            catch (err) {
                // Unreadable file — mark as invalid
                reports.push({
                    id: makeId(f),
                    filename: path_1.default.basename(f),
                    baseName: path_1.default.basename(f, path_1.default.extname(f)),
                    absolutePath: f,
                    extension: path_1.default.extname(f).replace('.', '').toLowerCase(),
                    sizeBytes: 0,
                    artist: null,
                    title: null,
                    album: null,
                    codec: null,
                    sampleRate: null,
                    channels: null,
                    bitRate: null,
                    bitDepth: null,
                    formatName: null,
                    durationSec: null,
                    metadataOk: false,
                    bitrateOk: false,
                    hasClipping: false,
                    label: 'invalid',
                    labelReason: `Read error: ${err.message}`,
                });
            }
        }
        progressCb === null || progressCb === void 0 ? void 0 : progressCb(allFiles.length, allFiles.length, 'done');
        return reports;
    });
}
/**
 * Move a file into a sub-folder of the quality check dir based on its label.
 * Returns the new absolute path.
 */
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
