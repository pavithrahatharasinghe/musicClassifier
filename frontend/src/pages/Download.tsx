import React, { useState } from 'react';
import axios from 'axios';
import { Download as DownloadIcon, Loader2, Music, Video, AlertCircle, ShieldCheck } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

export default function Download() {
  const [url, setUrl] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; audioPath?: string; videoPath?: string; error?: string } | null>(null);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsDownloading(true);
    setResult(null);

    try {
      const res = await axios.post(`${API_BASE}/unified-download`, { url });
      setResult(res.data);
    } catch (err: any) {
      setResult({
        success: false,
        error: err.response?.data?.error || err.message || 'Failed to download media'
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const getSourceIcon = () => {
    if (url.includes('spotify.com')) return <Music className="text-emerald-500" size={18} />;
    if (url.includes('youtube.com') || url.includes('youtu.be')) return <Video className="text-red-500" size={18} />;
    return <DownloadIcon className="text-gray-400" size={18} />;
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <header className="h-16 flex items-center px-6 border-b border-gray-800 bg-gray-900/60 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <h1 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
          <DownloadIcon size={18} className="text-primary-400" />
          Unified Download
        </h1>
      </header>

      <div className="flex-1 overflow-auto p-6 flex flex-col items-center">
        <div className="w-full max-w-2xl bg-gray-900/80 border border-gray-800 rounded-xl p-6 mt-10">
          <h2 className="text-lg font-medium text-white mb-2">Download Media</h2>
          <p className="text-gray-400 text-sm mb-6">
            Paste a link from Spotify (track) or YouTube (video). We will intelligently find and download both the FLAC audio and the official Music Video entirely in the background.
          </p>

          <form onSubmit={handleDownload} className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                {getSourceIcon()}
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://open.spotify.com/track/... OR https://www.youtube.com/watch?v=..."
                className="w-full pl-10 pr-4 py-3 bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-gray-200 placeholder-gray-600 transition"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isDownloading || !url}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Processing & Downloading...
                </>
              ) : (
                <>
                  <DownloadIcon size={16} /> Start Download
                </>
              )}
            </button>
          </form>

          {result && (
            <div className={`mt-6 p-4 rounded-lg border ${result.success ? 'bg-emerald-950/30 border-emerald-900/50' : 'bg-red-950/30 border-red-900/50'}`}>
              {!result.success ? (
                <div className="flex items-start gap-3 text-red-400">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-sm">Download Encountered an Error</h3>
                    <p className="text-xs text-red-400/80 mt-1">{result.error}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                   <h3 className="font-medium text-sm text-emerald-400 flex items-center gap-2">
                     <ShieldCheck size={18} /> Success! Items downloaded to library.
                   </h3>
                   
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                     <div className="bg-gray-950 p-3 rounded border border-gray-800 flex items-start gap-3">
                       <Music className={`shrink-0 ${result.audioPath ? 'text-emerald-500' : 'text-gray-600'}`} size={18} />
                       <div className="overflow-hidden">
                         <span className="text-xs font-semibold text-gray-300 block">FLAC Audio</span>
                         <span className="text-xs text-gray-500 truncate block mt-0.5" title={result.audioPath || 'Not downloaded'}>
                           {result.audioPath ? result.audioPath.split('\\').pop()?.split('/').pop() : 'Failed or skipped'}
                         </span>
                       </div>
                     </div>
                     <div className="bg-gray-950 p-3 rounded border border-gray-800 flex items-start gap-3">
                       <Video className={`shrink-0 ${result.videoPath ? 'text-primary-500' : 'text-gray-600'}`} size={18} />
                       <div className="overflow-hidden">
                         <span className="text-xs font-semibold text-gray-300 block">Music Video</span>
                         <span className="text-xs text-gray-500 truncate block mt-0.5" title={result.videoPath || 'Not downloaded'}>
                           {result.videoPath ? result.videoPath.split('\\').pop()?.split('/').pop() : 'Failed or skipped'}
                         </span>
                       </div>
                     </div>
                   </div>
                   {(result.audioPath && result.videoPath) && (
                     <p className="text-xs text-emerald-500/80 mt-2">
                       A pair has been automatically created for these two files.
                     </p>
                   )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
