import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  FileAudio, FileVideo, Video, VideoOff, HelpCircle, Send, Loader2,
  Music2, Clock, Download, CheckCircle2, AlertCircle, Play, Pause, X,
} from 'lucide-react';
import type { FileItem, SpotiflacTrack } from '../types';

const API_BASE = 'http://localhost:3001/api';

/** Format ms to m:ss */
function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface AudioReport {
  codec: string;
  sample_rate: string;
  bit_rate: string;
  channels: string;
  format_name: string;
}

interface SpotiflacDownloadResult {
  success: boolean;
  chosen: string;
  file: string;
  message: string;
  audio_report: AudioReport;
}

interface FileCardProps {
  file: FileItem;
  color: 'blue' | 'purple';
  onYoutubeSearch?: () => void;
  searchingYoutube?: boolean;
  // SpotiFLAC (replaces Spotify for video cards)
  spotiflacResults?: SpotiflacTrack[];
  onSpotiflacSearch?: () => void;
  searchingSpotiflac?: boolean;
  onSpotiflacDownload?: (track: SpotiflacTrack) => Promise<SpotiflacDownloadResult | null>;
  // YouTube download (audio cards)
  onDownload?: (quality: string) => void;
  downloading?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  // Video check always on for audio cards
  onCheckVideoRelease?: () => void;
  checkingVideo?: boolean;
  onSendNoVideo?: () => void;
  sendingNoVideo?: boolean;
  // Drag-and-drop manual matching
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragTarget?: boolean;   // true while ANY audio card is being dragged (video cards only)
  isDragOver?: boolean;     // true when THIS video card is the current drag-over target
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

// ── Tooltip component ─────────────────────────────────────────────────────────
function TitleTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative min-w-0"
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
          {/* Arrow */}
          <div className="absolute left-3 top-full w-0 h-0"
            style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #4B5563' }} />
        </div>
      )}
    </div>
  );
}

function FileCard({
  file,
  color,
  onYoutubeSearch,
  searchingYoutube,
  spotiflacResults,
  onSpotiflacSearch,
  searchingSpotiflac,
  onSpotiflacDownload,
  onDownload,
  downloading,
  selected,
  onToggleSelect,
  onCheckVideoRelease,
  checkingVideo,
  onSendNoVideo,
  sendingNoVideo,
  draggable: isDraggable,
  onDragStart,
  onDragEnd,
  isDragTarget,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
}: FileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const Icon = color === 'blue' ? FileAudio : FileVideo;
  const isAudio = color === 'blue';

  const isExpanded = !!file.previewUrl || !!file.youtubeUrl;
  const [quality, setQuality] = useState(isAudio ? '1080' : 'best');
  const [formats, setFormats] = useState<{ videos: number[]; audios: string[] } | null>(null);
  const [loadingFormats, setLoadingFormats] = useState(false);

  // Per-track download status within this card
  const [downloadResults, setDownloadResults] = useState<Record<string, SpotiflacDownloadResult | 'error'>>({});
  const [localDownloadingTrackId, setLocalDownloadingTrackId] = useState<string | null>(null);

  // Local media player state
  const [showLocalPlayer, setShowLocalPlayer] = useState(false);
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (isExpanded && !formats && !loadingFormats) {
      const url = file.youtubeUrl;
      if (url) {
        setLoadingFormats(true);
        axios
          .post(`${API_BASE}/formats`, { url })
          .then((res) => {
            if (res.data.success) {
              setFormats({ videos: res.data.videos, audios: res.data.audios });
              if (isAudio && res.data.videos.length > 0) {
                setQuality(res.data.videos[0].toString());
              } else if (!isAudio && res.data.audios.length > 0) {
                setQuality(res.data.audios.includes('m4a') ? 'm4a' : 'best');
              }
            }
          })
          .catch(console.error)
          .finally(() => setLoadingFormats(false));
      }
    }
  }, [isExpanded, file.youtubeUrl]);

  // Close player when card unmounts
  useEffect(() => {
    return () => {
      if (mediaRef.current) {
        mediaRef.current.pause();
      }
    };
  }, []);

  const streamUrl = file.id ? `${API_BASE}/stream/${file.id}` : null;

  function toggleLocalPlayer() {
    if (showLocalPlayer) {
      mediaRef.current?.pause();
      setIsPlaying(false);
      setShowLocalPlayer(false);
    } else {
      setShowLocalPlayer(true);
    }
  }

  function handleMediaPlay() { setIsPlaying(true); }
  function handleMediaPause() { setIsPlaying(false); }

  const videoStatus = file.videoStatus;

  const borderColor = selected
    ? 'border-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.25)]'
    : isDragOver
    ? 'border-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.35)]'
    : isDragTarget && !isAudio
    ? 'border-purple-500/40 border-dashed'
    : isAudio
    ? 'border-blue-500/15 hover:border-blue-500/35'
    : 'border-purple-500/15 hover:border-purple-500/35';

  const bgColor = selected
    ? 'bg-indigo-500/5'
    : isDragOver
    ? 'bg-purple-500/10'
    : isAudio
    ? 'bg-blue-500/5'
    : 'bg-purple-500/5';

  // Quality badge config
  const ql = file.qualityLabel;
  const qualityBad = ql === 'recheck' || ql === 'invalid';

  async function handleTrackDownload(track: SpotiflacTrack) {
    if (!onSpotiflacDownload) return;
    setLocalDownloadingTrackId(track.id);
    try {
      const result = await onSpotiflacDownload(track);
      if (result) {
        setDownloadResults((prev) => ({ ...prev, [track.id]: result }));
      } else {
        setDownloadResults((prev) => ({ ...prev, [track.id]: 'error' }));
      }
    } catch {
      setDownloadResults((prev) => ({ ...prev, [track.id]: 'error' }));
    } finally {
      setLocalDownloadingTrackId(null);
    }
  }

  const showSpotiflacPanel = !isAudio && (spotiflacResults !== undefined && spotiflacResults !== null);

  return (
    <div
      ref={cardRef}
      className={`flex flex-col rounded-lg border transition-all duration-150 overflow-hidden relative ${borderColor} ${bgColor}`}
      draggable={isDraggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'link';
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        onDragOver?.(e);
      }}
      onDragLeave={(e) => {
        // Only fire leave if cursor truly left the card (not just entered a child)
        if (cardRef.current && cardRef.current.contains(e.relatedTarget as Node)) return;
        onDragLeave?.(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop?.(e);
      }}
    >
      {/* Drop-zone hint overlay — shown on video cards when an audio card is being dragged */}
      {isDragTarget && !isAudio && (
        <div className={`absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center gap-1 rounded-lg transition-all ${
          isDragOver
            ? 'bg-purple-500/20 border-2 border-purple-400'
            : 'bg-purple-500/5'
        }`}>
          {isDragOver && (
            <>
              <Play size={18} className="text-purple-300 animate-pulse" />
              <span className="text-[11px] font-bold text-purple-300">Drop to match</span>
            </>
          )}
        </div>
      )}

      {/* Quality warning banner */}
      {qualityBad && (
        <div className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold ${
          ql === 'invalid'
            ? 'bg-red-500/15 text-red-400 border-b border-red-500/20'
            : 'bg-amber-500/15 text-amber-400 border-b border-amber-500/20'
        }`}>
          <AlertCircle size={10} />
          {ql === 'invalid' ? 'Bad Quality — Invalid Bitrate' : 'Needs Recheck'}
        </div>
      )}
      {/* Main row */}
      <div className="p-3 flex justify-between items-start gap-2">
        <div className="flex items-start gap-2.5 overflow-hidden min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="mt-0.5 rounded border-gray-600 bg-gray-900 text-indigo-500 focus:ring-indigo-500 shrink-0 cursor-pointer"
            />
          )}
          <Icon size={16} className={`shrink-0 mt-0.5 ${isAudio ? 'text-blue-400' : 'text-purple-400'}`} />
          <TitleTooltip text={file.baseName}>
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200 truncate leading-tight">
                {file.baseName}
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5 font-mono">{file.extension.toUpperCase()}</div>
            </div>
          </TitleTooltip>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 flex items-center gap-1.5">
          {/* Local play/pause button — always shown when we have a fileId */}
          {streamUrl && (
            <button
              onClick={toggleLocalPlayer}
              title={showLocalPlayer ? 'Close player' : `Play ${isAudio ? 'audio' : 'video'}`}
              className={`flex items-center gap-1 px-2 py-1 border rounded text-[10px] font-medium transition ${
                showLocalPlayer
                  ? isAudio
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                    : 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                  : 'bg-gray-800 border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200'
              }`}
            >
              {showLocalPlayer
                ? isPlaying
                  ? <Pause size={9} />
                  : <X size={9} />
                : <Play size={9} />}
              {showLocalPlayer ? (isPlaying ? 'Pause' : 'Close') : 'Play'}
            </button>
          )}

          {/* Audio cards: Find Video button */}
          {isAudio && onYoutubeSearch && !isExpanded && (
            <button
              onClick={onYoutubeSearch}
              disabled={searchingYoutube}
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-700 hover:border-blue-500/50 hover:text-blue-400 text-gray-400 rounded text-[10px] font-medium transition disabled:opacity-50"
            >
              {searchingYoutube ? <Loader2 size={9} className="animate-spin" /> : null}
              {searchingYoutube ? 'Searching...' : 'Find Video'}
            </button>
          )}

          {/* Video cards: Find Audio (SpotiFLAC) button */}
          {!isAudio && onSpotiflacSearch && (
            <button
              onClick={onSpotiflacSearch}
              disabled={searchingSpotiflac || localDownloadingTrackId !== null}
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-700 hover:border-purple-500/50 hover:text-purple-400 text-gray-400 rounded text-[10px] font-medium transition disabled:opacity-50"
            >
              {searchingSpotiflac ? <Loader2 size={9} className="animate-spin" /> : <Music2 size={9} />}
              {searchingSpotiflac ? 'Searching...' : 'Find Audio'}
            </button>
          )}

          {/* Video check — always shown for audio files without status */}
          {isAudio && onCheckVideoRelease && !videoStatus && (
            <button
              onClick={onCheckVideoRelease}
              disabled={checkingVideo}
              title="Check MusicBrainz for a video release"
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-700 hover:border-cyan-500/50 hover:text-cyan-400 text-gray-400 rounded text-[10px] font-medium transition disabled:opacity-50"
            >
              {checkingVideo ? <Loader2 size={9} className="animate-spin" /> : <Video size={9} />}
              {checkingVideo ? 'Checking...' : 'Check Video'}
            </button>
          )}
        </div>
      </div>

      {/* Local media player panel */}
      {showLocalPlayer && streamUrl && (
        <div className={`px-3 pb-3 pt-0 border-t border-gray-700/40 ${isAudio ? 'bg-blue-500/3' : 'bg-purple-500/3'}`}>
          {isAudio ? (
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={streamUrl}
              controls
              autoPlay
              onPlay={handleMediaPlay}
              onPause={handleMediaPause}
              onEnded={handleMediaPause}
              className="w-full mt-2.5"
              style={{ height: 36, accentColor: '#60a5fa' }}
            />
          ) : (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={streamUrl}
              controls
              autoPlay
              onPlay={handleMediaPlay}
              onPause={handleMediaPause}
              onEnded={handleMediaPause}
              className="w-full mt-2.5 rounded overflow-hidden bg-black aspect-video"
              style={{ maxHeight: 220 }}
            />
          )}
        </div>
      )}

      {/* Video status badge row */}
      {isAudio && videoStatus && (
        <div className="px-3 pb-2 flex items-center gap-2">
          {videoStatus === 'available' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/25 rounded-full px-2 py-0.5">
              <Video size={9} /> Video available
            </span>
          )}
          {videoStatus === 'unavailable' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/25 rounded-full px-2 py-0.5">
                <VideoOff size={9} /> No video release
              </span>
              {onSendNoVideo && (
                <button
                  onClick={onSendNoVideo}
                  disabled={sendingNoVideo}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/25 hover:bg-amber-400/20 rounded-full transition disabled:opacity-50"
                >
                  {sendingNoVideo ? <Loader2 size={8} className="animate-spin" /> : <Send size={8} />}
                  {sendingNoVideo ? 'Sending...' : 'Send to No-Video Folder'}
                </button>
              )}
            </div>
          )}
          {videoStatus === 'unknown' && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-700/30 border border-gray-600/30 rounded-full px-2 py-0.5">
                <HelpCircle size={9} /> Status unknown
              </span>
              {onCheckVideoRelease && (
                <button
                  onClick={onCheckVideoRelease}
                  disabled={checkingVideo}
                  className="text-[10px] text-gray-500 hover:text-cyan-400 transition underline underline-offset-2"
                >
                  {checkingVideo ? 'Checking...' : 'Retry'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* SpotiFLAC track picker panel (video cards only) */}
      {showSpotiflacPanel && (
        <div className="border-t border-gray-700/40 px-3 pb-3 pt-2 flex flex-col gap-2">
          {spotiflacResults!.length === 0 ? (
            <div className="text-[10px] text-gray-500 text-center py-2">No tracks found. Try searching again.</div>
          ) : (
            <>
              <div className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">
                Select a track to download as FLAC
              </div>
              <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-0.5">
                {spotiflacResults!.map((track) => {
                  const dlResult = downloadResults[track.id];
                  const isThisDownloading = localDownloadingTrackId === track.id;
                  const isSuccess = dlResult && dlResult !== 'error';
                  const isErr = dlResult === 'error';

                  return (
                    <div
                      key={track.id}
                      className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all ${
                        isSuccess
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : isErr
                          ? 'border-red-500/30 bg-red-500/5'
                          : 'border-gray-700/50 bg-gray-800/40 hover:border-purple-500/30 hover:bg-purple-500/5'
                      }`}
                    >
                      {/* Album art */}
                      <div className="shrink-0 w-9 h-9 rounded overflow-hidden bg-gray-700">
                        {track.images ? (
                          <img
                            src={track.images}
                            alt={track.album_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music2 size={14} className="text-gray-500" />
                          </div>
                        )}
                      </div>

                      {/* Track info */}
                      <div className="flex-1 min-w-0">
                        <TitleTooltip text={`${track.name} · ${track.artists}`}>
                          <div className="text-[11px] font-semibold text-gray-100 truncate leading-tight">
                            {track.name}
                          </div>
                        </TitleTooltip>
                        <div className="text-[10px] text-gray-400 truncate">{track.artists}</div>
                        <div className="text-[9px] text-gray-600 truncate mt-0.5">{track.album_name}</div>

                        {/* Success: show audio report */}
                        {isSuccess && (dlResult as SpotiflacDownloadResult).audio_report && (
                          <div className="mt-1 flex items-center gap-1 flex-wrap">
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 uppercase">
                              {(dlResult as SpotiflacDownloadResult).audio_report.format_name}
                            </span>
                            <span className="text-[9px] text-gray-500">
                              {(dlResult as SpotiflacDownloadResult).audio_report.sample_rate} Hz
                            </span>
                            <span className="text-[9px] text-gray-500">
                              {Math.round(parseInt((dlResult as SpotiflacDownloadResult).audio_report.bit_rate) / 1000)} kbps
                            </span>
                            <span className="text-[9px] text-gray-500">
                              via {(dlResult as SpotiflacDownloadResult).chosen}
                            </span>
                          </div>
                        )}

                        {/* Error */}
                        {isErr && (
                          <div className="mt-1 text-[9px] text-red-400 flex items-center gap-1">
                            <AlertCircle size={8} /> Download failed
                          </div>
                        )}
                      </div>

                      {/* Duration + download button */}
                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        <span className="text-[9px] text-gray-500 flex items-center gap-0.5">
                          <Clock size={8} />
                          {fmtDuration(track.duration_ms)}
                        </span>
                        {isSuccess ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400">
                            <CheckCircle2 size={10} /> Done
                          </span>
                        ) : (
                          <button
                            onClick={() => handleTrackDownload(track)}
                            disabled={isThisDownloading || localDownloadingTrackId !== null}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-600/80 hover:bg-purple-600 disabled:opacity-50 text-white text-[9px] font-bold rounded transition"
                          >
                            {isThisDownloading ? (
                              <Loader2 size={8} className="animate-spin" />
                            ) : (
                              <Download size={8} />
                            )}
                            {isThisDownloading ? 'DL...' : 'FLAC'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Expanded YouTube preview + download section (audio cards only) */}
      {isAudio && isExpanded && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2 border-t border-gray-700/40">
          {file.previewUrl && (
            <div className="w-full bg-black/40 rounded overflow-hidden mt-1">
              <iframe
                src={file.previewUrl}
                className="w-full aspect-video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          <div className="flex items-center gap-2 mt-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold">Quality</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={loadingFormats}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none w-28 disabled:opacity-50"
              >
                {loadingFormats ? (
                  <option>Loading...</option>
                ) : (
                  <>
                    <option value="best">Best (4K+)</option>
                    {formats?.videos.map((v) => (
                      <option key={v} value={v.toString()}>{v}p</option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <button
              onClick={() => onDownload?.(quality)}
              disabled={downloading}
              className={`flex-1 flex justify-center items-center gap-1.5 py-1.5 px-3 rounded text-xs font-bold transition ${
                downloading
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-primary-600 hover:bg-primary-500 text-white'
              }`}
            >
              {downloading ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Downloading...
                </>
              ) : (
                'Accept & Download'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileCard;
