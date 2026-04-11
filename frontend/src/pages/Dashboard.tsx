import { useState, useEffect } from 'react';
import axios from 'axios';
import { Wand2, FileAudio, FileVideo, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';
import type { MatchMakerState, SpotiflacTrack } from '../types';
import FileCard from '../components/FileCard';
import MatchedPairCard from '../components/MatchedPairCard';

const API_BASE = 'http://localhost:3001/api';

function Dashboard() {
  const [matchState, setMatchState] = useState<MatchMakerState>({
    unmatchedAudio: [],
    unmatchedVideo: [],
    matchedPairs: [],
  });
  const [automatching, setAutomatching] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [searchingYtId, setSearchingYtId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedAudioIds, setSelectedAudioIds] = useState<string[]>([]);
  const [organizingAudio, setOrganizingAudio] = useState(false);
  const [takeoverRunning, setTakeoverRunning] = useState(false);
  const [takeoverProgress, setTakeoverProgress] = useState({ current: 0, total: 0 });
  const [checkingVideoId, setCheckingVideoId] = useState<string | null>(null);
  const [sendingNoVideoId, setSendingNoVideoId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  // SpotiFLAC state — map of fileId → track results (null while not yet searched)
  const [spotiflacResultsMap, setSpotiflacResultsMap] = useState<Record<string, SpotiflacTrack[]>>({});
  const [searchingSpotiflacId, setSearchingSpotiflacId] = useState<string | null>(null);

  useEffect(() => {
    fetchMatchState();
  }, []);

  const fetchMatchState = async () => {
    try {
      setRescanning(true);
      const res = await axios.get(`${API_BASE}/files`);
      if (res.data.success) setMatchState(res.data.state);
    } catch (error) {
      console.error('Failed to fetch match state:', error);
    } finally {
      setRescanning(false);
    }
  };

  const handleAutomatch = async () => {
    try {
      setAutomatching(true);
      const res = await axios.post(`${API_BASE}/automatch`);
      if (res.data.success) setMatchState(res.data.state);
    } catch (error: any) {
      console.error('Automatch failed:', error);
      alert('Ollama Automatch Failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setAutomatching(false);
    }
  };

  const handleResetAndRematch = async () => {
    if (!window.confirm('This will CLEAR all existing matched pairs and re-match everything from scratch using AI. Continue?')) return;
    try {
      setResetting(true);
      const res = await axios.post(`${API_BASE}/reset-matches`);
      if (res.data.success) setMatchState(res.data.state);
    } catch (error: any) {
      console.error('Reset failed:', error);
      alert('Reset failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setResetting(false);
    }
  };

  const handleUnlink = async (pairId: string) => {
    try {
      const res = await axios.post(`${API_BASE}/unlink`, { pairId });
      if (res.data.success) setMatchState(res.data.state);
    } catch (error) {
      console.error('Failed to unlink:', error);
    }
  };

  const handleAnalyze = async (pairId: string, filename: string) => {
    try {
      setAnalyzingId(pairId);
      const res = await axios.post(`${API_BASE}/analyze`, { filename });
      if (res.data.success) {
        setMatchState((prev) => ({
          ...prev,
          matchedPairs: prev.matchedPairs.map((p) =>
            p.id === pairId ? { ...p, classification: res.data.classification } : p
          ),
        }));
      }
    } catch (error) {
      console.error('Analyze failed:', error);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleYoutubeSearch = async (fileId: string, baseName: string) => {
    try {
      setSearchingYtId(fileId);
      const res = await axios.post(`${API_BASE}/youtube/${fileId}`, { title: baseName });
      if (res.data.success) {
        setMatchState(res.data.state);
      } else {
        alert('No official video found for this song.');
      }
    } catch (error: any) {
      console.error('YT Search failed:', error);
    } finally {
      setSearchingYtId(null);
    }
  };

  // ── SpotiFLAC ──────────────────────────────────────────────────────────────

  const handleSpotiflacSearch = async (fileId: string, baseName: string) => {
    try {
      setSearchingSpotiflacId(fileId);
      const res = await axios.post(`${API_BASE}/spotiflac/search`, { query: baseName, limit: 8 });
      if (res.data.success) {
        setSpotiflacResultsMap((prev) => ({ ...prev, [fileId]: res.data.tracks }));
      } else {
        alert('SpotiFLAC search failed: ' + (res.data.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('SpotiFLAC search failed:', error);
      alert('SpotiFLAC search failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setSearchingSpotiflacId(null);
    }
  };

  const handleSpotiflacDownload = async (fileId: string, track: SpotiflacTrack) => {
    try {
      const res = await axios.post(`${API_BASE}/spotiflac/download`, {
        spotify_url: track.external_urls,
        fileId,
      });
      if (res.data.success) {
        // Refresh state so the matched pair may appear
        if (res.data.state) setMatchState(res.data.state);
        else await fetchMatchState();
        return {
          success: true,
          chosen: res.data.chosen,
          file: res.data.file,
          message: res.data.message,
          audio_report: res.data.audio_report,
        };
      } else {
        alert('Download failed: ' + (res.data.error || 'Unknown error'));
        return null;
      }
    } catch (error: any) {
      console.error('SpotiFLAC download failed:', error);
      alert('Download failed: ' + (error.response?.data?.error || error.message));
      return null;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  const handleOrganizeAudioOnly = async () => {
    if (selectedAudioIds.length === 0) return;
    setOrganizingAudio(true);
    try {
      const res = await axios.post(`${API_BASE}/auto-organize-audio-only`, { fileIds: selectedAudioIds });
      if (res.data.success) {
        setMatchState(res.data.state);
        setSelectedAudioIds([]);
      }
    } catch (e: any) {
      console.error(e);
      alert('Failed formatting audio: ' + (e.response?.data?.error || e.message));
    } finally {
      setOrganizingAudio(false);
    }
  };

  const handleDownload = async (
    fileId: string,
    url: string,
    fileType: 'audio' | 'video',
    quality: string,
    baseName: string
  ) => {
    try {
      setDownloadingId(fileId);
      const res = await axios.post(`${API_BASE}/download`, { url, type: fileType, quality, filename: baseName });
      if (res.data.success) {
        setMatchState(res.data.state);
        alert('Download complete! Item automatically matched.');
      }
    } catch (error: any) {
      console.error('Download failed:', error);
      alert('Download Failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleAITakeover = async () => {
    if (matchState.matchedPairs.length === 0) return;
    setTakeoverRunning(true);
    setTakeoverProgress({ current: 0, total: matchState.matchedPairs.length });

    const currentPairs = [...matchState.matchedPairs];
    for (let i = 0; i < currentPairs.length; i++) {
      const pair = currentPairs[i];
      setTakeoverProgress((prev) => ({ ...prev, current: i + 1 }));
      try {
        const res = await axios.post(`${API_BASE}/auto-organize-single`, {
          pairId: pair.id,
          filename: pair.audioFile.filename,
        });
        if (res.data.success) setMatchState(res.data.state);
      } catch (err: any) {
        console.error('AI Takeover Failed for pair', pair.id, err);
        alert(
          `AI Validation Failed for ${pair.audioFile.baseName}: ` +
            (err.response?.data?.error || err.message)
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    setTakeoverRunning(false);
  };

  const handleCheckVideoRelease = async (fileId: string, baseName: string) => {
    try {
      setCheckingVideoId(fileId);
      const res = await axios.post(`${API_BASE}/check-video-release/${fileId}`, { title: baseName });
      if (res.data.success) setMatchState(res.data.state);
    } catch (error: any) {
      console.error('Video release check failed:', error);
      alert('Video check failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setCheckingVideoId(null);
    }
  };

  const handleSendNoVideo = async (fileId: string, filename: string, baseName: string) => {
    if (!window.confirm(`Send "${baseName}" to the no-video destination?`)) return;
    try {
      setSendingNoVideoId(fileId);
      const res = await axios.post(`${API_BASE}/send-no-video`, { fileId, filename });
      if (res.data.success) setMatchState(res.data.state);
    } catch (error: any) {
      console.error('Send no-video failed:', error);
      alert('Failed to send: ' + (error.response?.data?.error || error.message));
    } finally {
      setSendingNoVideoId(null);
    }
  };

  return (
    <>
      {/* Header */}
      <header className="h-16 flex items-center px-6 border-b border-gray-800 bg-gray-900/60 backdrop-blur-sm sticky top-0 z-10 justify-between shrink-0">
        <h1 className="text-base font-semibold text-white tracking-tight">Match-Maker Workspace</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAITakeover}
            disabled={takeoverRunning || matchState.matchedPairs.length === 0}
            className="inline-flex items-center gap-2 text-xs px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition font-semibold text-white shadow border border-indigo-500/60 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {takeoverRunning ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Organizing {takeoverProgress.current}/{takeoverProgress.total}
              </>
            ) : (
              <>
                <Wand2 size={13} /> AI Takeover
              </>
            )}
          </button>

          <div className="w-px h-5 bg-gray-700" />

          <button
            onClick={handleAutomatch}
            disabled={automatching || resetting || (matchState.unmatchedAudio.length === 0 && matchState.unmatchedVideo.length === 0)}
            className="inline-flex items-center gap-2 text-xs px-3.5 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg transition font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
            title="Match currently unmatched files using AI (keeps existing pairs)"
          >
            {automatching ? (
              <>
                <Loader2 size={13} className="animate-spin" /> AI Matching...
              </>
            ) : (
              <>
                <Wand2 size={13} /> Auto-Match
              </>
            )}
          </button>

          <button
            onClick={handleResetAndRematch}
            disabled={resetting || automatching}
            className="inline-flex items-center gap-2 text-xs px-3 py-2 bg-gray-800 hover:bg-red-900/40 border border-gray-700 hover:border-red-500/40 text-gray-400 hover:text-red-400 rounded-lg transition font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear ALL existing matches and re-run AI matching from scratch"
          >
            {resetting ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Resetting...
              </>
            ) : (
              'Reset & Re-match'
            )}
          </button>

          <button
            onClick={fetchMatchState}
            disabled={rescanning}
            className="inline-flex items-center gap-2 text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition border border-gray-700 text-gray-300 disabled:opacity-40"
            title="Rescan disk"
          >
            <RefreshCw size={13} className={rescanning ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col p-5">
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-[1600px] mx-auto w-full overflow-hidden">

          {/* ── Unmatched Audio ── */}
          <div className="flex flex-col bg-gray-900/80 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex flex-col gap-2.5">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <FileAudio size={15} className="text-blue-400" />
                  Unmatched Audio
                </h3>
                <span className="text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                  {matchState.unmatchedAudio.length}
                </span>
              </div>
              {selectedAudioIds.length > 0 && (
                <button
                  onClick={handleOrganizeAudioOnly}
                  disabled={organizingAudio}
                  className="w-full py-1.5 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/30 rounded-lg text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-50"
                >
                  {organizingAudio ? (
                    <span className="flex items-center justify-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Processing...</span>
                  ) : (
                    `Organize ${selectedAudioIds.length} as Audio Only`
                  )}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {matchState.unmatchedAudio.length === 0 ? (
                <div className="text-center text-xs text-gray-600 mt-12">No unmatched audio files.</div>
              ) : (
                matchState.unmatchedAudio.map((file) => (
                  <FileCard
                    key={file.filename}
                    file={file}
                    color="blue"
                    onYoutubeSearch={() => handleYoutubeSearch(file.id!, file.baseName)}
                    searchingYoutube={searchingYtId === file.id}
                    onDownload={(q) => handleDownload(file.id!, file.youtubeUrl!, 'video', q, file.baseName)}
                    downloading={downloadingId === file.id}
                    selected={selectedAudioIds.includes(file.id!)}
                    onToggleSelect={() => {
                      setSelectedAudioIds((prev) =>
                        prev.includes(file.id!)
                          ? prev.filter((id) => id !== file.id!)
                          : [...prev, file.id!]
                      );
                    }}
                    onCheckVideoRelease={() => handleCheckVideoRelease(file.id!, file.baseName)}
                    checkingVideo={checkingVideoId === file.id}
                    onSendNoVideo={() => handleSendNoVideo(file.id!, file.filename, file.baseName)}
                    sendingNoVideo={sendingNoVideoId === file.id}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Matched Pairs ── */}
          <div className="flex flex-col bg-gray-900/80 border border-primary-900/30 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(99,102,241,0.05)]">
            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-500" />
                Matched Pairs
              </h3>
              <span className="text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                {matchState.matchedPairs.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {matchState.matchedPairs.length === 0 ? (
                <div className="text-center text-xs text-gray-600 mt-12">
                  No pairs matched yet.
                  <br />
                  <span className="text-gray-700">Run Auto-Match (AI) to begin.</span>
                </div>
              ) : (
                matchState.matchedPairs.map((pair) => (
                  <MatchedPairCard
                    key={pair.id}
                    pair={pair}
                    onUnlink={() => handleUnlink(pair.id)}
                    onAnalyze={() => handleAnalyze(pair.id, pair.audioFile.filename)}
                    analyzing={analyzingId === pair.id}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Unmatched Video ── */}
          <div className="flex flex-col bg-gray-900/80 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
              <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <FileVideo size={15} className="text-purple-400" />
                Unmatched Video
              </h3>
              <span className="text-[11px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full">
                {matchState.unmatchedVideo.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {matchState.unmatchedVideo.length === 0 ? (
                <div className="text-center text-xs text-gray-600 mt-12">No unmatched videos.</div>
              ) : (
                matchState.unmatchedVideo.map((file) => (
                  <FileCard
                    key={file.filename}
                    file={file}
                    color="purple"
                    onSpotiflacSearch={() => handleSpotiflacSearch(file.id!, file.baseName)}
                    searchingSpotiflac={searchingSpotiflacId === file.id}
                    spotiflacResults={spotiflacResultsMap[file.id!]}
                    onSpotiflacDownload={(track) => handleSpotiflacDownload(file.id!, track)}
                  />
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

export default Dashboard;
