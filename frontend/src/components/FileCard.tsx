import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  FileAudio, FileVideo, Video, VideoOff, HelpCircle, Send, Loader2
} from 'lucide-react';
import type { FileItem } from '../types';

const API_BASE = 'http://localhost:3001/api';

interface FileCardProps {
  file: FileItem;
  color: 'blue' | 'purple';
  onYoutubeSearch?: () => void;
  searchingYoutube?: boolean;
  onSpotifySearch?: () => void;
  searchingSpotify?: boolean;
  onDownload?: (quality: string) => void;
  downloading?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  // Video check is always on for audio cards
  onCheckVideoRelease?: () => void;
  checkingVideo?: boolean;
  onSendNoVideo?: () => void;
  sendingNoVideo?: boolean;
}

function FileCard({
  file,
  color,
  onYoutubeSearch,
  searchingYoutube,
  onSpotifySearch,
  searchingSpotify,
  onDownload,
  downloading,
  selected,
  onToggleSelect,
  onCheckVideoRelease,
  checkingVideo,
  onSendNoVideo,
  sendingNoVideo,
}: FileCardProps) {
  const Icon = color === 'blue' ? FileAudio : FileVideo;
  const isAudio = color === 'blue';

  const isExpanded = !!file.previewUrl || !!file.youtubeUrl || !!file.spotifyUrl;
  const [quality, setQuality] = useState(isAudio ? '1080' : 'best');
  const [formats, setFormats] = useState<{ videos: number[]; audios: string[] } | null>(null);
  const [loadingFormats, setLoadingFormats] = useState(false);

  useEffect(() => {
    if (isExpanded && !formats && !loadingFormats) {
      const url = file.youtubeUrl || file.spotifyUrl;
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
  }, [isExpanded, file.youtubeUrl, file.spotifyUrl]);

  const videoStatus = file.videoStatus;

  // Determine border color based on state
  const borderColor = selected
    ? 'border-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.25)]'
    : isAudio
    ? 'border-blue-500/15 hover:border-blue-500/35'
    : 'border-purple-500/15 hover:border-purple-500/35';

  const bgColor = selected
    ? 'bg-indigo-500/5'
    : isAudio
    ? 'bg-blue-500/5'
    : 'bg-purple-500/5';

  return (
    <div className={`flex flex-col rounded-lg border transition-all duration-150 overflow-hidden ${borderColor} ${bgColor}`}>
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
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-200 truncate leading-tight" title={file.filename}>
              {file.baseName}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5 font-mono">{file.extension.toUpperCase()}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 flex items-center gap-1.5">
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

          {!isAudio && onSpotifySearch && !isExpanded && (
            <button
              onClick={onSpotifySearch}
              disabled={searchingSpotify}
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-700 hover:border-purple-500/50 hover:text-purple-400 text-gray-400 rounded text-[10px] font-medium transition disabled:opacity-50"
            >
              {searchingSpotify ? <Loader2 size={9} className="animate-spin" /> : null}
              {searchingSpotify ? 'Searching...' : 'Find Spotify'}
            </button>
          )}

          {/* Video check — always shown for audio files */}
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
              {/* Allow re-checking */}
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

      {/* Expanded preview + download section */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2 border-t border-gray-700/40">
          {file.previewUrl && (
            <div className="w-full bg-black/40 rounded overflow-hidden mt-1">
              {isAudio ? (
                <iframe
                  src={file.previewUrl}
                  className="w-full aspect-video"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <audio controls src={file.previewUrl} className="w-full h-9" />
              )}
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
                ) : isAudio ? (
                  <>
                    <option value="best">Best (4K+)</option>
                    {formats?.videos.map((v) => (
                      <option key={v} value={v.toString()}>{v}p</option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value="best">Best Audio</option>
                    {formats?.audios.map((a) => (
                      <option key={a} value={a}>{a.toUpperCase()}</option>
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
