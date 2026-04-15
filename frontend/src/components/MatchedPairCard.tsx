import { useRef, useState } from 'react';
import {
  FileAudio, FileVideo, Wand2, Unlink, CheckCircle2, HelpCircle,
  Link2, Play, Pause, X, Music2, Film,
} from 'lucide-react';
import type { MatchedPair } from '../types';

const API_BASE = 'http://localhost:3001/api';

// ── Tooltip ───────────────────────────────────────────────────────────────────
function TitleTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div
      className="relative min-w-0 overflow-hidden"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          className="absolute left-0 bottom-full mb-1.5 z-50 max-w-xs pointer-events-none"
          style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.6))' }}
        >
          <div className="bg-gray-800 border border-gray-600 text-gray-100 text-[11px] font-medium rounded-lg px-3 py-2 leading-snug whitespace-normal break-words">
            {text}
          </div>
          <div className="absolute left-3 top-full w-0 h-0"
            style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #4B5563' }} />
        </div>
      )}
    </div>
  );
}

// ── Genre badge colour ────────────────────────────────────────────────────────
function genreBadgeClass(cat: string) {
  const c = (cat || '').toLowerCase();
  if (c.includes('k-pop') || c.includes('kpop'))
    return 'text-rose-400 bg-rose-400/10 border-rose-400/25';
  if (c.includes('j-pop') || c.includes('jpop'))
    return 'text-violet-400 bg-violet-400/10 border-violet-400/25';
  // English / fallback
  return 'text-sky-400 bg-sky-400/10 border-sky-400/25';
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === 'exact')
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 border border-emerald-400/25 rounded px-1.5 py-0.5">
        <Link2 size={8} /> Exact
      </span>
    );
  if (status === 'downloaded')
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-sky-400 bg-sky-400/10 border border-sky-400/25 rounded px-1.5 py-0.5">
        <CheckCircle2 size={8} /> Downloaded
      </span>
    );
  if (status === 'manual')
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/25 rounded px-1.5 py-0.5">
        <Link2 size={8} /> Manual
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-violet-400 bg-violet-400/10 border border-violet-400/25 rounded px-1.5 py-0.5">
      <Wand2 size={8} /> AI Linked
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface MatchedPairCardProps {
  pair: MatchedPair;
  onUnlink: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
function MatchedPairCard({ pair, onUnlink, onAnalyze, analyzing }: MatchedPairCardProps) {
  const [playerMode, setPlayerMode] = useState<null | 'audio' | 'video'>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const audioStreamUrl = pair.audioFile.id ? `${API_BASE}/stream/${pair.audioFile.id}` : null;
  const videoStreamUrl = pair.videoFile.id ? `${API_BASE}/stream/${pair.videoFile.id}` : null;

  function openPlayer(mode: 'audio' | 'video') {
    if (playerMode === mode) {
      // toggle off
      audioRef.current?.pause();
      videoRef.current?.pause();
      setIsPlaying(false);
      setPlayerMode(null);
    } else {
      audioRef.current?.pause();
      videoRef.current?.pause();
      setIsPlaying(false);
      setPlayerMode(mode);
    }
  }

  function closePlayer() {
    audioRef.current?.pause();
    videoRef.current?.pause();
    setIsPlaying(false);
    setPlayerMode(null);
  }

  const category = pair.aiResult?.verifiedCategory || pair.classification?.genre;

  return (
    <div className="flex flex-col rounded-lg border border-gray-700/60 bg-gray-800/70 overflow-hidden hover:border-gray-600 transition-colors group">

      {/* ── File names row ── */}
      <div className="flex items-stretch justify-between divide-x divide-gray-700/60">
        {/* Audio side */}
        <div className="flex-1 p-3 flex items-center gap-2 min-w-0 overflow-hidden">
          <FileAudio size={14} className="text-blue-400 shrink-0" />
          <TitleTooltip text={pair.audioFile.baseName}>
            <span className="text-xs truncate text-gray-200 block">{pair.audioFile.baseName}</span>
          </TitleTooltip>
        </div>

        {/* Centre connector */}
        <div className="px-2 flex flex-col items-center justify-center bg-gray-900/40 shrink-0 gap-1 min-w-[80px]">
          <StatusBadge status={pair.status} />
          {category && (
            <span className={`px-1.5 py-0.5 mt-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${genreBadgeClass(category)}`}>
              {category}
            </span>
          )}
        </div>

        {/* Video side */}
        <div className="flex-1 p-3 flex items-center gap-2 min-w-0 overflow-hidden">
          <FileVideo size={14} className="text-purple-400 shrink-0" />
          <TitleTooltip text={pair.videoFile.baseName}>
            <span className="text-xs truncate text-gray-200 block">{pair.videoFile.baseName}</span>
          </TitleTooltip>
        </div>
      </div>

      {/* ── Footer: meta + play controls + unlink ── */}
      <div className="bg-gray-900/50 px-3 py-2 flex items-center justify-between border-t border-gray-700/50">

        {/* Left: AI clean name or validation button */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
          {pair.aiResult ? (
            <span className="text-[11px] text-gray-400 truncate italic" title={pair.aiResult.cleanName}>
              {pair.aiResult.cleanName}
              {pair.aiResult.isOfficialVideo && (
                <span className="ml-2 text-yellow-400 not-italic font-semibold text-[9px] border border-yellow-500/30 rounded px-1 py-0.5">
                  Official
                </span>
              )}
            </span>
          ) : pair.classification ? (
            <span className="text-[11px] text-gray-400 truncate italic" title={pair.classification.cleanName}>
              {pair.classification.cleanName}
            </span>
          ) : (
            <button
              disabled={analyzing}
              onClick={onAnalyze}
              className="text-[11px] font-medium text-gray-400 hover:text-white flex items-center gap-1 bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition"
            >
              {analyzing ? (
                <span className="animate-pulse">Validating...</span>
              ) : (
                <><HelpCircle size={12} /> Needs AI Validation</>
              )}
            </button>
          )}
        </div>

        {/* Right: play buttons + unlink */}
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* Play audio */}
          {audioStreamUrl && (
            <button
              onClick={() => openPlayer('audio')}
              title={playerMode === 'audio' ? 'Close audio player' : 'Play audio'}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border transition ${
                playerMode === 'audio'
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                  : 'bg-gray-800 border-gray-700 hover:border-blue-500/50 hover:text-blue-400 text-gray-400'
              }`}
            >
              {playerMode === 'audio' ? <Pause size={9} /> : <Music2 size={9} />}
              Audio
            </button>
          )}

          {/* Play video */}
          {videoStreamUrl && (
            <button
              onClick={() => openPlayer('video')}
              title={playerMode === 'video' ? 'Close video player' : 'Play video'}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border transition ${
                playerMode === 'video'
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                  : 'bg-gray-800 border-gray-700 hover:border-purple-500/50 hover:text-purple-400 text-gray-400'
              }`}
            >
              {playerMode === 'video' ? <Pause size={9} /> : <Film size={9} />}
              Video
            </button>
          )}

          {/* Unlink */}
          <button
            onClick={onUnlink}
            title="Unlink this pair"
            className="text-gray-600 hover:text-red-400 transition p-1 rounded hover:bg-red-400/10"
          >
            <Unlink size={13} />
          </button>
        </div>
      </div>

      {/* ── Inline Audio Player ── */}
      {playerMode === 'audio' && audioStreamUrl && (
        <div className="border-t border-gray-700/40 bg-blue-500/5 px-3 py-2.5 flex items-center gap-2">
          <Music2 size={13} className="text-blue-400 shrink-0" />
          <audio
            ref={audioRef}
            src={audioStreamUrl}
            controls
            autoPlay
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            className="flex-1 h-8"
            style={{ accentColor: '#60a5fa' }}
          />
          <button onClick={closePlayer} className="text-gray-500 hover:text-gray-300 transition shrink-0">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Inline Video Player ── */}
      {playerMode === 'video' && videoStreamUrl && (
        <div className="border-t border-gray-700/40 bg-purple-500/5 px-3 py-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-purple-400 font-semibold flex items-center gap-1">
              <Film size={10} /> Video Preview
            </span>
            <button onClick={closePlayer} className="text-gray-500 hover:text-gray-300 transition">
              <X size={13} />
            </button>
          </div>
          <video
            ref={videoRef}
            src={videoStreamUrl}
            controls
            autoPlay
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            className="w-full rounded bg-black aspect-video"
            style={{ maxHeight: 220 }}
          />
        </div>
      )}
    </div>
  );
}

export default MatchedPairCard;
