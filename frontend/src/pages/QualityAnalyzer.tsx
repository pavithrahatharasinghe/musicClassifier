import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle, ScanLine,
  FolderInput, Loader2, RefreshCw, Sparkles, Info,
  MoveRight, RotateCcw, Filter, X, Zap, Waves, Activity,
  CheckCircle2, XCircle, Music2,
} from 'lucide-react';
import type { QualityReport, QualityLabel, SpectrumData } from '../types';

const API_BASE = 'http://localhost:3001/api';

// ──────────────────────────────────────────────────────────────────────────────
// Label config
// ──────────────────────────────────────────────────────────────────────────────

const LABEL_CFG: Record<QualityLabel, {
  icon: React.ReactNode; text: string; short: string;
  color: string; bg: string; border: string;
}> = {
  lossless: {
    icon: <ShieldCheck size={12} />, text: 'Lossless Quality', short: 'Lossless',
    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30',
  },
  standard: {
    icon: <ShieldAlert size={12} />, text: 'Standard Quality', short: 'Standard',
    color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30',
  },
  recheck: {
    icon: <AlertTriangle size={12} />, text: 'Needs Recheck', short: 'Recheck',
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30',
  },
  invalid: {
    icon: <ShieldOff size={12} />, text: 'Invalid', short: 'Invalid',
    color: 'text-gray-500', bg: 'bg-gray-700/20', border: 'border-gray-600/30',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (!b) return '--';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDur(sec: number | null) {
  if (!sec) return '--';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
function fmtKbps(bps: number | null) {
  return bps ? `${Math.round(bps / 1000)} kbps` : '--';
}
function fmtDbFS(v: number | null) {
  return v !== null ? `${v.toFixed(2)} dB` : '--';
}
function fmtKhz(v: number | null) {
  return v !== null ? `${v.toFixed(1)} kHz` : '--';
}
function fmtSr(hz: number | null) {
  return hz ? `${(hz / 1000).toFixed(1)} kHz` : '--';
}
function fmtChannels(ch: number | null) {
  if (!ch) return '--';
  return ch === 2 ? 'Stereo' : ch === 1 ? 'Mono' : `${ch}ch`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mini bitrate bar
// ──────────────────────────────────────────────────────────────────────────────

function BitrateBar({ bps }: { bps: number | null }) {
  const kbps = bps ? bps / 1000 : 0;
  const pct = Math.min((kbps / 2000) * 100, 100);
  const col = kbps >= 900 ? 'bg-emerald-500' : kbps >= 500 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="h-1 w-full rounded-full bg-gray-800 overflow-hidden">
      <div className={`h-full rounded-full ${col} transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Spectrogram Canvas (ported from SpotiFLAC SpectrumVisualization)
// ──────────────────────────────────────────────────────────────────────────────

const MARGIN = { top: 36, right: 90, bottom: 50, left: 64 };
const CW = 900, CH = 340;

function spekColor(t: number): [number, number, number] {
  const cs: [number, number, number][] = [
    [0,0,0],[0,0,25],[0,0,50],[0,0,80],[20,0,120],[50,0,150],
    [80,0,180],[120,0,120],[150,0,80],[180,0,40],[210,0,0],
    [240,30,0],[255,60,0],[255,100,0],[255,140,0],[255,180,0],
    [255,210,0],[255,235,0],[255,250,50],[255,255,100],[255,255,150],[255,255,200],[255,255,255],
  ];
  const s = t * (cs.length - 1), i = Math.min(Math.floor(s), cs.length - 2), f = s - i;
  const [r1,g1,b1] = cs[i], [r2,g2,b2] = cs[i+1];
  return [Math.round(r1+(r2-r1)*f), Math.round(g1+(g2-g1)*f), Math.round(b1+(b2-b1)*f)];
}

async function drawSpectrogram(
  canvas: HTMLCanvasElement,
  spectrum: SpectrumData,
  sampleRate: number,
  durationSec: number,
  fileName: string,
  cancelRef: React.MutableRefObject<boolean>,
) {
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);

  const pw = CW - MARGIN.left - MARGIN.right;
  const ph = CH - MARGIN.top - MARGIN.bottom;
  const slices = spectrum.time_slices;
  const nTime = slices.length;
  const nFreq = slices[0]?.magnitudes.length ?? 0;
  if (!nTime || !nFreq) return;

  // Min/max
  let minM = Infinity, maxM = -Infinity;
  for (const s of slices) for (const m of s.magnitudes) {
    if (isFinite(m)) { if (m < minM) minM = m; if (m > maxM) maxM = m; }
  }
  if (!isFinite(minM)) { minM = -120; maxM = 0; }
  const range = maxM - minM || 1;

  // Draw pixels in chunks
  const imgData = ctx.createImageData(pw, ph);
  const px = imgData.data;
  const CHUNK = 40;

  for (let xStart = 0; xStart < pw; xStart += CHUNK) {
    if (cancelRef.current) return;
    const xEnd = Math.min(xStart + CHUNK, pw);
    for (let x = xStart; x < xEnd; x++) {
      const tp = x / (pw - 1);
      const ti = Math.min(Math.floor(tp * (nTime - 1)), nTime - 2);
      const tf = tp * (nTime - 1) - ti;
      for (let y = 0; y < ph; y++) {
        const fp = (ph - 1 - y) / (ph - 1);
        const fi = Math.min(Math.floor(fp * (nFreq - 1)), nFreq - 2);
        const ff = fp * (nFreq - 1) - fi;
        const m11 = slices[ti].magnitudes[fi] ?? 0;
        const m12 = slices[ti].magnitudes[fi + 1] ?? 0;
        const m21 = slices[ti + 1].magnitudes[fi] ?? 0;
        const m22 = slices[ti + 1].magnitudes[fi + 1] ?? 0;
        const mT1 = m11 * (1 - ff) + m12 * ff;
        const mT2 = m21 * (1 - ff) + m22 * ff;
        const mag = mT1 * (1 - tf) + mT2 * tf;
        const norm = Math.max(0, Math.min(1, (mag - minM) / range));
        const [r, g, b] = spekColor(norm);
        const pi = (y * pw + x) * 4;
        px[pi] = r; px[pi+1] = g; px[pi+2] = b; px[pi+3] = 255;
      }
    }
    ctx.putImageData(imgData, MARGIN.left, MARGIN.top);
    await new Promise(r => setTimeout(r, 0));
  }

  if (cancelRef.current) return;

  // Axes
  ctx.fillStyle = '#ccc'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  // Time axis
  const tStep = durationSec > 120 ? 20 : durationSec > 30 ? 5 : 1;
  for (let t = 0; t <= durationSec; t += tStep) {
    const x = MARGIN.left + (t / durationSec) * (pw - 1);
    ctx.fillStyle = '#666'; ctx.fillRect(x, MARGIN.top + ph, 1, 5);
    ctx.fillStyle = '#aaa'; ctx.fillText(`${t}s`, x, MARGIN.top + ph + 16);
  }
  // Freq axis
  ctx.textAlign = 'right';
  const maxF = sampleRate / 2;
  const fStep = maxF > 20000 ? 4000 : maxF > 10000 ? 2000 : 1000;
  for (let f = 0; f <= maxF; f += fStep) {
    const y = MARGIN.top + ph - (f / maxF) * ph;
    ctx.fillStyle = '#666'; ctx.fillRect(MARGIN.left - 4, y, 4, 1);
    ctx.fillStyle = '#aaa';
    const label = f >= 1000 ? `${(f/1000).toFixed(0)}k` : `${f}`;
    ctx.fillText(label, MARGIN.left - 6, y + 4);
  }
  // Labels
  ctx.textAlign = 'center'; ctx.fillStyle = '#888'; ctx.font = '11px monospace';
  ctx.fillText('Time (seconds)', CW / 2, CH - 8);
  ctx.save(); ctx.translate(12, MARGIN.top + ph / 2);
  ctx.rotate(-Math.PI / 2); ctx.fillText('Frequency (Hz)', 0, 0); ctx.restore();
  // Title + sample rate
  ctx.textAlign = 'left'; ctx.fillStyle = '#bbb'; ctx.font = '10px monospace';
  ctx.fillText(fileName, MARGIN.left + 8, 18);
  ctx.textAlign = 'right';
  ctx.fillText(`Sample Rate: ${sampleRate} Hz`, CW - MARGIN.right - 4, 18);
  // Color bar
  const cbX = CW - MARGIN.right + 12, cbW = 14;
  const grad = ctx.createLinearGradient(0, MARGIN.top + ph, 0, MARGIN.top);
  for (let i = 0; i <= 20; i++) {
    const tv = i / 20; const [r,g,b] = spekColor(tv);
    grad.addColorStop(tv, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = grad; ctx.fillRect(cbX, MARGIN.top, cbW, ph);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(cbX, MARGIN.top, cbW, ph);
  ctx.fillStyle = '#aaa'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
  ctx.fillText('High', cbX + cbW + 3, MARGIN.top + 10);
  ctx.fillText('Low', cbX + cbW + 3, MARGIN.top + ph);
}

function SpectrogramPanel({ report }: { report: QualityReport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (loading || loaded) return;
    setLoading(true); setError('');
    cancelRef.current = false;
    try {
      const res = await axios.post(`${API_BASE}/quality/spectrum`, {
        absolutePath: report.absolutePath, fftSize: 4096,
      });
      if (!res.data.success) { setError(res.data.error || 'Failed'); return; }
      const spectrum: SpectrumData = res.data.spectrum;
      if (canvasRef.current && report.sampleRate && report.durationSec) {
        await drawSpectrogram(
          canvasRef.current, spectrum,
          report.sampleRate, report.durationSec,
          report.filename, cancelRef,
        );
        setLoaded(true);
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [report, loading, loaded]);

  useEffect(() => () => { cancelRef.current = true; }, []);

  return (
    <div className="rounded-lg overflow-hidden border border-gray-800/60 bg-black">
      {!loaded && (
        <div className="flex items-center justify-center h-24 gap-3">
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin text-emerald-400" />
              <span className="text-xs text-gray-400">Computing spectrogram…</span>
            </>
          ) : error ? (
            <span className="text-xs text-red-400">{error}</span>
          ) : (
            <button
              onClick={load}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:border-emerald-500/50 text-gray-300 hover:text-emerald-400 rounded-lg text-xs font-medium transition"
            >
              <Activity size={12} /> Load Spectrogram
            </button>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`w-full h-auto ${loaded ? '' : 'hidden'}`}
        style={{ imageRendering: 'auto' }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Stat counters
// ──────────────────────────────────────────────────────────────────────────────

function StatCounter({ value, label, icon, colorClass }: {
  value: number; label: string; icon: React.ReactNode; colorClass: string;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let v = 0;
    const step = Math.ceil(value / 20);
    const iv = setInterval(() => {
      v = Math.min(v + step, value);
      setDisplay(v);
      if (v >= value) clearInterval(iv);
    }, 30);
    return () => clearInterval(iv);
  }, [value]);
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-4 rounded-xl bg-gray-900/60 border border-gray-800">
      <div className={`${colorClass} mb-1`}>{icon}</div>
      <div className={`text-2xl font-bold tabular-nums ${colorClass}`}>{display}</div>
      <div className="text-[11px] text-gray-500 font-medium">{label}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Quality Card — full SpotiFLAC AudioAnalysis layout
// ──────────────────────────────────────────────────────────────────────────────

function DataRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <li className="flex justify-between gap-2 py-[3px] border-b border-gray-800/50 last:border-0">
      <span className="text-gray-500 text-[11px]">{label}</span>
      <span className={`text-gray-200 text-[11px] ${mono ? 'font-mono' : 'font-medium'} text-right`}>{value}</span>
    </li>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <p className="text-[9px] font-bold tracking-[0.12em] text-gray-500 uppercase flex items-center gap-1.5 mb-1.5 mt-3 first:mt-0">
      {icon}{title}
    </p>
  );
}

function QualityCard({
  report,
  onMove,
  onReanalyze,
  onAiInsight,
  movingId,
  insightLoadingId,
}: {
  report: QualityReport;
  onMove: (r: QualityReport) => void;
  onReanalyze: (r: QualityReport) => void;
  onAiInsight: (r: QualityReport) => void;
  movingId: string | null;
  insightLoadingId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = LABEL_CFG[report.label];
  const isMoving = movingId === report.id;
  const isInsightLoading = insightLoadingId === report.id;
  const sig = report.signal;

  return (
    <div className={`rounded-xl border overflow-hidden transition-all duration-200 bg-gray-900/80 hover:bg-gray-900 ${cfg.border}`}>
      {/* ── Header: album art + title/artist + badge ── */}
      <div className="flex gap-3 p-4">
        {/* Album art */}
        <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-gray-800 border border-gray-700/50 flex items-center justify-center">
          {report.albumArtBase64 ? (
            <img src={report.albumArtBase64} alt="cover" className="w-full h-full object-cover" />
          ) : (
            <Music2 size={24} className="text-gray-600" />
          )}
        </div>

        {/* Core info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate leading-snug" title={report.filename}>
                {report.title || report.baseName}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {report.artist || <span className="text-red-400 italic">No artist tag</span>}
              </div>
              {report.album && (
                <div className="text-[10px] text-gray-600 truncate mt-0.5">{report.album}</div>
              )}
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
              {cfg.icon}{cfg.short}
            </span>
          </div>

          {/* Bitrate bar + quick stats */}
          <BitrateBar bps={report.bitRate} />
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {report.codec && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded uppercase text-gray-400 tracking-wider">
                {report.codec}
              </span>
            )}
            {report.formatName && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded uppercase text-gray-400 tracking-wider">
                {report.formatName.split(',')[0].toUpperCase()}
              </span>
            )}
            <span className="text-[10px] text-gray-500 font-mono">{fmtKbps(report.bitRate)}</span>
            <span className="text-[10px] text-gray-500 font-mono">{fmtSr(report.sampleRate)}</span>
            {report.bitDepth && <span className="text-[10px] text-gray-500 font-mono">{report.bitDepth}-bit</span>}
            <span className="text-[10px] text-gray-600 ml-auto font-mono">{fmtBytes(report.sizeBytes)}</span>
          </div>

          {/* Flag badges */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {!report.metadataOk && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-400 bg-red-500/10 border border-red-500/25 rounded-full px-1.5 py-0.5">
                <XCircle size={7} /> Missing metadata
              </span>
            )}
            {report.hasClipping && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-orange-400 bg-orange-500/10 border border-orange-500/25 rounded-full px-1.5 py-0.5">
                <Waves size={7} /> Clipping
              </span>
            )}
            {report.metadataOk && !report.hasClipping && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-gray-600 rounded-full px-1">
                <CheckCircle2 size={7} className="text-emerald-600" /> Clean
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Analysis data grid (SpotiFLAC AudioAnalysis.tsx layout) ── */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-3 gap-x-4 gap-y-0">
          {/* Col 1: Format */}
          <div>
            <SectionHeader title="Format" icon={null} />
            <ul>
              <DataRow label="Type:" value={report.extension.toUpperCase()} />
              <DataRow label="Sample Rate:" value={fmtSr(report.sampleRate)} />
              <DataRow label="Bit Depth:" value={report.bitDepth ? `${report.bitDepth}-bit` : '--'} />
              <DataRow label="Channels:" value={fmtChannels(report.channels)} />
              <DataRow label="Duration:" value={fmtDur(report.durationSec)} />
              <DataRow label="Size:" value={fmtBytes(report.sizeBytes)} />
            </ul>
          </div>

          {/* Col 2: Signal Analytics */}
          <div>
            <SectionHeader title="Signal Analytics" icon={null} />
            <ul>
              <DataRow label="Nyquist:" value={fmtKhz(sig.nyquistKhz)} />
              <DataRow label="Dynamic Range:" value={sig.dynamicRange ? `${sig.dynamicRange.toFixed(2)} dB` : '--'} />
              <DataRow label="Peak Amplitude:" value={fmtDbFS(sig.peakAmplitude)} />
              <DataRow label="RMS Level:" value={fmtDbFS(sig.rmsLevel)} />
              <DataRow label="Total Samples:" value={sig.totalSamples ? sig.totalSamples.toLocaleString() : '--'} />
            </ul>
          </div>

          {/* Col 3: Spectrum Meta */}
          <div>
            <SectionHeader title="Spectrum Meta" icon={null} />
            {report.spectrumMeta ? (
              <ul>
                <DataRow label="Display Frames:" value={report.spectrumMeta.displayFrames.toLocaleString()} />
                <DataRow label="FFT Size:" value={report.spectrumMeta.fftSize.toLocaleString()} />
                <DataRow label="Freq Resolution:" value={`${report.spectrumMeta.freqResolutionHz.toFixed(2)} Hz/bin`} />
              </ul>
            ) : (
              <p className="text-[10px] text-gray-600 italic">N/A</p>
            )}

            {/* Bitrate details below */}
            <SectionHeader title="Encoding" icon={null} />
            <ul>
              <DataRow label="Codec:" value={report.codec?.toUpperCase() || '--'} />
              <DataRow label="Bitrate:" value={fmtKbps(report.bitRate)} />
              <DataRow label="Format:" value={report.formatName?.split(',')[0].toUpperCase() || '--'} />
            </ul>
          </div>
        </div>
      </div>

      {/* ── AI insight ── */}
      {report.aiInsight && (
        <div className="mx-4 mb-3 flex items-start gap-1.5 p-2.5 rounded-lg bg-violet-500/5 border border-violet-500/20">
          <Sparkles size={10} className="shrink-0 text-violet-400 mt-0.5" />
          <span className="text-[10px] text-violet-300 leading-relaxed italic">{report.aiInsight}</span>
        </div>
      )}

      {/* ── Spectrogram ── */}
      {expanded && (
        <div className="px-4 pb-4">
          <SectionHeader title="Spectrogram" icon={<Activity size={9} />} />
          <SpectrogramPanel report={report} />
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="border-t border-gray-800/80 px-4 py-2 flex items-center gap-2">
        <span className="text-[9px] text-gray-600 flex-1 truncate" title={report.labelReason}>
          <Info size={7} className="inline mr-1" />{report.labelReason}
        </span>

        {/* Spectrogram toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-gray-800 border border-gray-700 text-gray-400 hover:text-emerald-400 hover:border-emerald-500/40 transition"
        >
          <Activity size={9} />
          {expanded ? 'Hide Spectrum' : 'Spectrum'}
        </button>

        {/* AI Insight */}
        {!report.aiInsight && (
          <button
            onClick={() => onAiInsight(report)}
            disabled={isInsightLoading}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-violet-600/10 border border-violet-500/30 text-violet-400 hover:bg-violet-600/20 transition disabled:opacity-50"
          >
            {isInsightLoading ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
            {isInsightLoading ? '…' : 'AI'}
          </button>
        )}

        {/* Re-analyze */}
        <button
          onClick={() => onReanalyze(report)}
          title="Re-run quality check"
          className="p-1.5 rounded text-gray-500 hover:text-gray-300 bg-gray-800 border border-gray-700 hover:border-gray-600 transition"
        >
          <RotateCcw size={10} />
        </button>

        {/* Move */}
        <button
          onClick={() => onMove(report)}
          disabled={isMoving}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold transition disabled:opacity-50
            ${cfg.bg} ${cfg.border} border ${cfg.color} hover:brightness-125`}
        >
          {isMoving ? <Loader2 size={9} className="animate-spin" /> : <MoveRight size={9} />}
          {isMoving ? 'Moving…' : 'Move'}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | QualityLabel;

export default function QualityAnalyzer() {
  const [results, setResults] = useState<QualityReport[]>([]);
  const [inProgress, setInProgress] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, currentFile: '' });
  const [filter, setFilter] = useState<FilterTab>('all');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [insightLoadingId, setInsightLoadingId] = useState<string | null>(null);
  const [moveAllLabel, setMoveAllLabel] = useState<QualityLabel | ''>('');
  const [bulkMoving, setBulkMoving] = useState(false);
  const [configDir, setConfigDir] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    axios.get(`${API_BASE}/quality/results`).then(r => {
      if (r.data.success) { setResults(r.data.results); setInProgress(r.data.inProgress); }
    }).catch(() => {});
    axios.get(`${API_BASE}/config`).then(r => {
      if (r.data.success) setConfigDir(r.data.config.qualityCheckDir || '');
    }).catch(() => {});
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await axios.get(`${API_BASE}/quality/status`);
        setProgress(s.data.progress);
        setInProgress(s.data.inProgress);
        if (!s.data.inProgress) {
          clearInterval(pollRef.current!); pollRef.current = null;
          const r = await axios.get(`${API_BASE}/quality/results`);
          if (r.data.success) setResults(r.data.results);
        }
      } catch { clearInterval(pollRef.current!); pollRef.current = null; setInProgress(false); }
    }, 800);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleScan = async () => {
    if (inProgress) return;
    setResults([]); setInProgress(true); setProgress({ done: 0, total: 0, currentFile: '' });
    try {
      const res = await axios.post(`${API_BASE}/quality/scan`);
      if (!res.data.success) { alert(res.data.error || 'Failed to start scan'); setInProgress(false); return; }
      startPolling();
    } catch (e: any) { alert('Scan failed: ' + (e.response?.data?.error || e.message)); setInProgress(false); }
  };

  const handleMove = async (report: QualityReport) => {
    setMovingId(report.id);
    try {
      const res = await axios.post(`${API_BASE}/quality/move`, { absolutePath: report.absolutePath, label: report.label });
      if (res.data.success) setResults(prev => prev.filter(r => r.id !== report.id));
      else alert('Move failed: ' + res.data.error);
    } catch (e: any) { alert('Move failed: ' + (e.response?.data?.error || e.message)); }
    finally { setMovingId(null); }
  };

  const handleReanalyze = async (report: QualityReport) => {
    try {
      const res = await axios.post(`${API_BASE}/quality/reanalyze`, { absolutePath: report.absolutePath });
      if (res.data.success) setResults(prev => prev.map(r => r.id === report.id ? res.data.report : r));
    } catch (e: any) { alert('Reanalyze failed: ' + (e.response?.data?.error || e.message)); }
  };

  const handleAiInsight = async (report: QualityReport) => {
    setInsightLoadingId(report.id);
    try {
      const res = await axios.post(`${API_BASE}/quality/ai-insight`, { report });
      if (res.data.success) setResults(prev => prev.map(r => r.id === report.id ? { ...r, aiInsight: res.data.aiInsight } : r));
      else alert('AI insight failed: ' + res.data.error);
    } catch (e: any) { alert('AI insight failed: ' + (e.response?.data?.error || e.message)); }
    finally { setInsightLoadingId(null); }
  };

  const handleBulkMove = async () => {
    if (!window.confirm(moveAllLabel ? `Move ALL "${moveAllLabel}" files?` : 'Move ALL files to their sub-folders?')) return;
    setBulkMoving(true);
    try {
      const res = await axios.post(`${API_BASE}/quality/move-all`, { label: moveAllLabel || undefined });
      if (res.data.success) {
        alert(`Moved ${res.data.moved} files.`);
        setResults(prev => moveAllLabel ? prev.filter(r => r.label !== moveAllLabel) : []);
      }
    } catch (e: any) { alert('Bulk move failed: ' + (e.response?.data?.error || e.message)); }
    finally { setBulkMoving(false); }
  };

  const counts: Record<QualityLabel, number> = {
    lossless: results.filter(r => r.label === 'lossless').length,
    standard: results.filter(r => r.label === 'standard').length,
    recheck: results.filter(r => r.label === 'recheck').length,
    invalid: results.filter(r => r.label === 'invalid').length,
  };
  const filtered = filter === 'all' ? results : results.filter(r => r.label === filter);
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const tabs: { label: FilterTab; display: string; count: number; color: string }[] = [
    { label: 'all', display: 'All', count: results.length, color: 'text-gray-300' },
    { label: 'lossless', display: '✅ Lossless', count: counts.lossless, color: 'text-emerald-400' },
    { label: 'standard', display: '⚠️ Standard', count: counts.standard, color: 'text-amber-400' },
    { label: 'recheck', display: '❌ Recheck', count: counts.recheck, color: 'text-red-400' },
    { label: 'invalid', display: '🚫 Invalid', count: counts.invalid, color: 'text-gray-500' },
  ];

  return (
    <>
      {/* Header */}
      <header className="h-16 flex items-center px-6 border-b border-gray-800 bg-gray-900/60 backdrop-blur-sm sticky top-0 z-10 justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
            <ShieldCheck size={15} className="text-white" />
          </div>
          <h1 className="text-base font-semibold text-white tracking-tight">Quality Analyzer</h1>
          {configDir && (
            <span className="hidden lg:block text-[10px] text-gray-600 font-mono truncate max-w-sm" title={configDir}>
              {configDir}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {results.length > 0 && !inProgress && (
            <>
              <select
                value={moveAllLabel}
                onChange={e => setMoveAllLabel(e.target.value as QualityLabel | '')}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 outline-none"
              >
                <option value="">All labels</option>
                <option value="lossless">Lossless only</option>
                <option value="standard">Standard only</option>
                <option value="recheck">Recheck only</option>
                <option value="invalid">Invalid only</option>
              </select>
              <button onClick={handleBulkMove} disabled={bulkMoving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
                {bulkMoving ? <Loader2 size={11} className="animate-spin" /> : <FolderInput size={11} />} Move All
              </button>
              <div className="w-px h-5 bg-gray-700" />
            </>
          )}
          <button onClick={handleScan} disabled={inProgress}
            className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-bold rounded-lg transition shadow-lg shadow-emerald-900/30 disabled:opacity-60">
            {inProgress ? <><Loader2 size={12} className="animate-spin" /> Scanning… {progressPct}%</> : <><ScanLine size={12} />{results.length > 0 ? 'Re-scan' : 'Scan Now'}</>}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Progress bar */}
        {inProgress && (
          <div className="bg-gray-950/80 border-b border-gray-800 px-6 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-400">Analyzing: <span className="text-gray-300 font-mono">{progress.currentFile || '…'}</span></span>
              <span className="text-xs text-gray-500">{progress.done} / {progress.total || '?'}</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-600 to-cyan-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Empty state */}
        {results.length === 0 && !inProgress && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-12">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-900/40 to-cyan-900/40 border border-gray-800 flex items-center justify-center">
              <ShieldCheck size={28} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-300 mb-1">Ready to Analyze</h2>
              <p className="text-sm text-gray-600 max-w-sm">
                {configDir ? 'Click "Scan Now" to analyze your FLAC files.' : 'Set a "Quality Check Directory" in Settings first.'}
              </p>
            </div>
            <button onClick={handleScan}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-sm font-bold rounded-xl transition shadow-lg shadow-emerald-900/30">
              <ScanLine size={14} /> Scan Now
            </button>
          </div>
        )}

        {results.length > 0 && (
          <>
            {/* Stats row */}
            <div className="px-6 pt-5 pb-3">
              <div className="grid grid-cols-4 gap-3 max-w-2xl mx-auto">
                <StatCounter value={counts.lossless} label="Lossless" icon={<ShieldCheck size={18} />} colorClass="text-emerald-400" />
                <StatCounter value={counts.standard} label="Standard" icon={<ShieldAlert size={18} />} colorClass="text-amber-400" />
                <StatCounter value={counts.recheck} label="Needs Recheck" icon={<AlertTriangle size={18} />} colorClass="text-red-400" />
                <StatCounter value={counts.invalid} label="Invalid" icon={<ShieldOff size={18} />} colorClass="text-gray-500" />
              </div>
            </div>

            {/* Filter tabs */}
            <div className="px-6 pb-3 flex items-center gap-1 overflow-x-auto">
              <Filter size={12} className="text-gray-600 shrink-0 mr-1" />
              {tabs.map(t => (
                <button key={t.label} onClick={() => setFilter(t.label)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                    ${filter === t.label ? `${t.color} bg-gray-800 border border-gray-700` : 'text-gray-500 hover:text-gray-300 border border-transparent'}`}>
                  {t.display}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filter === t.label ? 'bg-gray-700' : 'bg-gray-800/60'}`}>{t.count}</span>
                </button>
              ))}
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="ml-1 text-gray-600 hover:text-gray-400 transition"><X size={12} /></button>
              )}
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-gray-600">{filtered.length} file{filtered.length !== 1 ? 's' : ''}</span>
                <button onClick={handleScan} disabled={inProgress} title="Re-scan"
                  className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition disabled:opacity-40">
                  <RefreshCw size={11} className={inProgress ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-6 pb-8">
              {filtered.length === 0 ? (
                <div className="text-center text-sm text-gray-600 mt-16">No files match this filter.</div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4 max-w-[1800px] mx-auto">
                  {filtered.map(r => (
                    <QualityCard
                      key={r.id} report={r}
                      onMove={handleMove} onReanalyze={handleReanalyze} onAiInsight={handleAiInsight}
                      movingId={movingId} insightLoadingId={insightLoadingId}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Bottom bar */}
            <div className="shrink-0 border-t border-gray-800 bg-gray-900/60 px-6 py-2 flex items-center gap-4 text-[11px] text-gray-600">
              <Zap size={11} className="text-emerald-600" />
              <span><span className="text-emerald-400 font-semibold">{counts.lossless}</span> lossless</span>
              <span>·</span>
              <span><span className="text-amber-400 font-semibold">{counts.standard}</span> standard</span>
              <span>·</span>
              <span><span className="text-red-400 font-semibold">{counts.recheck}</span> recheck</span>
              <span>·</span>
              <span><span className="text-gray-500 font-semibold">{counts.invalid}</span> invalid</span>
              <span className="ml-auto font-mono">{results.length} total</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
