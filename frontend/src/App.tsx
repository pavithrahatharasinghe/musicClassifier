import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { 
  FileAudio, FileVideo, Wand2, 
  Music, Settings, LayoutDashboard, Save,
  Unlink, CheckCircle2, HelpCircle
} from 'lucide-react';
import type { MatchMakerState, AppConfig, FileItem, MatchedPair } from './types';

const API_BASE = 'http://localhost:3001/api';

function App() {
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
  
  // Dashboard state
  const [matchState, setMatchState] = useState<MatchMakerState>({ unmatchedAudio: [], unmatchedVideo: [], matchedPairs: [] });
  const [automatching, setAutomatching] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [searchingYtId, setSearchingYtId] = useState<string | null>(null);
  const [searchingSpotifyId, setSearchingSpotifyId] = useState<string | null>(null);

  // Settings state
  const [config, setConfig] = useState<AppConfig>({ audioDir: '', videoDir: '', destDir: '', downloadDir: '', ollamaModel: 'llama3' });
  const [configSaving, setConfigSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      axios.get(`${API_BASE}/config`),
      axios.get(`${API_BASE}/models`)
    ]).then(([configRes, modelsRes]) => {
      let loadedConfig = configRes.data.success ? configRes.data.config : { audioDir: '', videoDir: '', destDir: '', downloadDir: '', ollamaModel: 'llama3' };
      
      if (modelsRes.data.success) {
        const models = modelsRes.data.models;
        setAvailableModels(models);
        
        // Auto-correct model if the saved one isn't actually installed
        if (models.length > 0 && (!loadedConfig.ollamaModel || !models.includes(loadedConfig.ollamaModel))) {
          loadedConfig.ollamaModel = models[0];
          axios.post(`${API_BASE}/config`, loadedConfig).catch(console.error);
        }
      }
      setConfig(loadedConfig);
    }).catch(console.error);

    fetchMatchState();
  }, []);

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setConfigSaving(true);
      const res = await axios.post(`${API_BASE}/config`, config);
      if (res.data.success) {
        setConfig(res.data.config);
        alert('Settings saved successfully!');
        fetchMatchState();
      }
    } catch (error) {
      console.error('Failed to save config', error);
      alert('Failed to save settings');
    } finally {
      setConfigSaving(false);
    }
  };

  const fetchMatchState = async () => {
    try {
      const res = await axios.get(`${API_BASE}/files`);
      if (res.data.success) setMatchState(res.data.state);
    } catch (error) {
      console.error('Failed to fetch match state:', error);
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
         setMatchState(prev => ({
           ...prev,
           matchedPairs: prev.matchedPairs.map(p => 
             p.id === pairId ? { ...p, classification: res.data.classification } : p
           )
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

  const handleSpotifySearch = async (fileId: string, baseName: string) => {
    try {
      setSearchingSpotifyId(fileId);
      const res = await axios.post(`${API_BASE}/spotify/${fileId}`, { title: baseName });
      if (res.data.success) {
        setMatchState(res.data.state);
      } else {
        alert('No Spotify track found for this song.');
      }
    } catch (error: any) {
      console.error('Spotify search failed:', error);
    } finally {
      setSearchingSpotifyId(null);
    }
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  
  const [selectedAudioIds, setSelectedAudioIds] = useState<string[]>([]);
  const [organizingAudio, setOrganizingAudio] = useState(false);

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
       alert("Failed formatting audio: " + (e.response?.data?.error || e.message));
    } finally {
       setOrganizingAudio(false);
    }
  };

  const handleDownload = async (fileId: string, url: string, fileType: 'audio'|'video', quality: string, baseName: string) => {
    try {
      setDownloadingId(fileId);
      const res = await axios.post(`${API_BASE}/download`, {
        url,
        type: fileType,
        quality,
        filename: baseName
      });
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

  const [takeoverRunning, setTakeoverRunning] = useState(false);
  const [takeoverProgress, setTakeoverProgress] = useState({ current: 0, total: 0 });

  const handleAITakeover = async () => {
    if (matchState.matchedPairs.length === 0) return;
    setTakeoverRunning(true);
    setTakeoverProgress({ current: 0, total: matchState.matchedPairs.length });

    // Ensure we capture locally because state updates are asynchronous
    let currentPairs = [...matchState.matchedPairs];

    for (let i = 0; i < currentPairs.length; i++) {
      const pair = currentPairs[i];
      setTakeoverProgress(prev => ({ ...prev, current: i + 1 }));

      try {
        const res = await axios.post(`${API_BASE}/auto-organize-single`, {
          pairId: pair.id,
          filename: pair.audioFile.filename
        });
        
        if (res.data.success) {
           setMatchState(res.data.state);
        }
      } catch (err: any) {
        console.error('AI Takeover Failed for pair', pair.id, err);
        alert(`AI Validation Failed for ${pair.audioFile.baseName}: ` + (err.response?.data?.error || err.message));
      }

      // 1-second delay to be kind to iTunes
      await new Promise(r => setTimeout(r, 1000));
    }
    
    setTakeoverRunning(false);
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-200">
      <aside className="w-64 border-r border-gray-800 bg-gray-900 flex flex-col hidden md:flex shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-gray-800 font-semibold text-lg tracking-tight text-white gap-2">
          <div className="w-8 h-8 rounded bg-primary-600 flex items-center justify-center text-white">
            <Music size={18} />
          </div>
          MediaOrganize
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <NavItem icon={<LayoutDashboard size={18} />} label="Workspace" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <NavItem icon={<Settings size={18} />} label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
        </nav>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#0f1522] overflow-hidden">
        <header className="h-16 flex items-center px-6 border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-10 justify-between shrink-0">
          <h1 className="text-xl font-medium text-white capitalize">{view === 'dashboard' ? 'Match-Maker Workspace' : 'Settings'}</h1>
          <div className="flex items-center gap-4">
            {view === 'dashboard' && (
              <>
                <button 
                  onClick={handleAITakeover} 
                  disabled={takeoverRunning || matchState.matchedPairs.length === 0}
                  className="flex items-center gap-2 text-sm px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md transition font-medium text-white shadow-lg border border-indigo-500 disabled:opacity-50"
                >
                  {takeoverRunning ? 
                    <span className="animate-pulse">Analyzing {takeoverProgress.current}/{takeoverProgress.total}...</span> 
                    : <><Wand2 size={16}/> AI Takeover (Organize All)</>}
                </button>

                <div className="w-[1px] h-6 bg-gray-700 mx-1"></div>

                <button 
                  onClick={handleAutomatch} 
                  disabled={automatching || (matchState.unmatchedAudio.length === 0 && matchState.unmatchedVideo.length === 0)}
                  className="flex items-center gap-2 text-sm px-4 py-1.5 bg-primary-600 hover:bg-primary-500 rounded-md transition font-medium text-white disabled:opacity-50"
                >
                  {automatching ? <span className="animate-pulse">Matching...</span> : 'Auto-Match'}
                </button>
                <button onClick={fetchMatchState} className="text-sm px-4 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md transition border border-gray-700 text-gray-300">
                  Rescan
                </button>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col p-6">
          {view === 'dashboard' && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-[1600px] mx-auto w-full overflow-hidden">
              
              {/* Unmatched Audio */}
              <div className="flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-gray-800 bg-gray-800/20 flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-gray-200 flex items-center gap-2"><FileAudio size={16} className="text-blue-400"/> Unmatched Audio</h3>
                    <span className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full font-medium">{matchState.unmatchedAudio.length}</span>
                  </div>
                  {selectedAudioIds.length > 0 && (
                    <button 
                      onClick={handleOrganizeAudioOnly} 
                      disabled={organizingAudio}
                      className="w-full py-2 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/40 rounded text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-50"
                    >
                      {organizingAudio ? 'Processing...' : `Organize ${selectedAudioIds.length} as Audio Only`}
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {matchState.unmatchedAudio.length === 0 ? (
                     <div className="text-center text-sm text-gray-500 mt-10">No unmatched audio.</div>
                  ) : matchState.unmatchedAudio.map(file => (
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
                        setSelectedAudioIds(prev => prev.includes(file.id!) ? prev.filter(id => id !== file.id!) : [...prev, file.id!]);
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Matched Pairs ("The Ruler") */}
              <div className="flex flex-col bg-gray-900 border-2 border-primary-900/40 rounded-xl overflow-hidden shadow-lg shadow-primary-900/10">
                <div className="px-5 py-4 border-b border-gray-800 bg-gray-800/40 flex justify-between items-center">
                  <h3 className="font-semibold text-white flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500"/> Matched Pairs</h3>
                  <span className="bg-primary-900/50 text-primary-300 text-xs px-2 py-0.5 rounded-full font-medium">{matchState.matchedPairs.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {matchState.matchedPairs.length === 0 ? (
                    <div className="text-center text-sm text-gray-500 mt-10">No pairs matched yet.</div>
                  ) : matchState.matchedPairs.map(pair => (
                    <MatchedPairCard 
                      key={pair.id} 
                      pair={pair} 
                      onUnlink={() => handleUnlink(pair.id)} 
                      onAnalyze={() => handleAnalyze(pair.id, pair.audioFile.filename)}
                      analyzing={analyzingId === pair.id}
                    />
                  ))}
                </div>
              </div>

              {/* Unmatched Video */}
              <div className="flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-gray-800 bg-gray-800/20 flex justify-between items-center">
                  <h3 className="font-semibold text-gray-200 flex items-center gap-2"><FileVideo size={16} className="text-purple-400"/> Unmatched Video</h3>
                  <span className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full font-medium">{matchState.unmatchedVideo.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {matchState.unmatchedVideo.length === 0 ? (
                     <div className="text-center text-sm text-gray-500 mt-10">No unmatched videos.</div>
                  ) : matchState.unmatchedVideo.map(file => (
                    <FileCard
                      key={file.filename}
                      file={file}
                      color="purple"
                      onSpotifySearch={() => handleSpotifySearch(file.id!, file.baseName)}
                      searchingSpotify={searchingSpotifyId === file.id}
                      onDownload={(q) => handleDownload(file.id!, file.spotifyUrl || file.youtubeUrl || '', 'audio', q, file.baseName)}
                      downloading={downloadingId === file.id}
                    />
                  ))}
                </div>
              </div>

            </div>
          )}

          {view === 'settings' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-sm text-sm p-6 overflow-auto max-w-4xl mx-auto w-full">
              <h2 className="font-semibold text-white text-lg mb-6">Directory & AI Configuration</h2>
              <form onSubmit={saveConfig} className="max-w-3xl space-y-6">
                
                <div className="space-y-2">
                  <label className="text-gray-400 font-medium">Audio Files Directory</label>
                  <p className="text-xs text-gray-500 mb-2">Absolute path to scan for .flac files</p>
                  <input type="text" value={config.audioDir} onChange={e => setConfig({...config, audioDir: e.target.value})} className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-200 font-mono text-xs" required />
                </div>

                <div className="space-y-2">
                  <label className="text-gray-400 font-medium">Video Files Directory</label>
                  <p className="text-xs text-gray-500 mb-2">Absolute path to scan for .mp4, .mkv files</p>
                  <input type="text" value={config.videoDir} onChange={e => setConfig({...config, videoDir: e.target.value})} className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-200 font-mono text-xs" required />
                </div>

                <div className="border-t border-gray-800 my-6"></div>

                <div className="space-y-2">
                  <label className="text-gray-400 font-medium">Destination Directory</label>
                  <p className="text-xs text-gray-500 mb-2">Base path for organized files (e.g., will create \kpop or \jpop here)</p>
                  <input type="text" value={config.destDir} onChange={e => setConfig({...config, destDir: e.target.value})} className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-200 font-mono text-xs" required />
                </div>

                <div className="border-t border-gray-800 my-6"></div>

                <div className="space-y-2">
                  <label className="text-gray-400 font-medium">Download Directory (Optional)</label>
                  <p className="text-xs text-gray-500 mb-2">Absolute path for downloaded files before categorization</p>
                  <input type="text" value={config.downloadDir || ''} onChange={e => setConfig({...config, downloadDir: e.target.value})} className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-200 font-mono text-xs" />
                </div>

                <div className="border-t border-gray-800 my-6"></div>

                <div className="space-y-2">
                  <label className="text-gray-400 font-medium">Ollama Model</label>
                  <p className="text-xs text-gray-500 mb-2">Select the Ollama model for Fuzzy Matching and Analysis</p>
                  <select 
                    value={config.ollamaModel || 'llama3'} 
                    onChange={e => setConfig({...config, ollamaModel: e.target.value})}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-200"
                  >
                    {availableModels.length > 0 ? (
                      availableModels.map(m => <option key={m} value={m}>{m}</option>)
                    ) : (
                      <option value="llama3">llama3</option> // fallback
                    )}
                  </select>
                </div>

                <div className="pt-4 flex justify-end">
                  <button type="submit" disabled={configSaving} className="flex items-center gap-2 px-5 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded font-medium transition disabled:opacity-50">
                    <Save size={16} />
                    {configSaving ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Subcomponents
function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium text-sm transition-colors ${active ? 'bg-primary-600/10 text-primary-500' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'}`}>
      {icon}
      {label}
    </button>
  );
}

function FileCard({ file, color, onYoutubeSearch, searchingYoutube, onSpotifySearch, searchingSpotify, onDownload, downloading, selected, onToggleSelect }: { file: FileItem, color: 'blue' | 'purple', onYoutubeSearch?: () => void, searchingYoutube?: boolean, onSpotifySearch?: () => void, searchingSpotify?: boolean, onDownload?: (quality: string) => void, downloading?: boolean, selected?: boolean, onToggleSelect?: () => void }) {
  const Icon = color === 'blue' ? FileAudio : FileVideo;
  const bgColors = color === 'blue' ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' : 'bg-purple-400/10 text-purple-400 border-purple-400/20';
  
  // Local state for expanded view
  const isExpanded = !!file.previewUrl || !!file.youtubeUrl || !!file.spotifyUrl;
  const [quality, setQuality] = useState(color === 'blue' ? '1080' : 'best'); // default
  const [formats, setFormats] = useState<{videos: number[], audios: string[]} | null>(null);
  const [loadingFormats, setLoadingFormats] = useState(false);

  useEffect(() => {
    if (isExpanded && !formats && !loadingFormats) {
      const url = file.youtubeUrl || file.spotifyUrl;
      if (url) {
        setLoadingFormats(true);
        axios.post(`${API_BASE}/formats`, { url }).then(res => {
          if (res.data.success) {
            setFormats({ videos: res.data.videos, audios: res.data.audios });
            if (color === 'blue' && res.data.videos.length > 0) {
               setQuality(res.data.videos[0].toString());
            } else if (color === 'purple' && res.data.audios.length > 0) {
               if (res.data.audios.includes('m4a')) setQuality('m4a');
               else setQuality('best');
            }
          }
        }).catch(err => console.error(err))
          .finally(() => setLoadingFormats(false));
      }
    }
  }, [isExpanded, file.youtubeUrl, file.spotifyUrl]);
  
  return (
    <div className={`flex flex-col rounded-lg border hover:bg-gray-800 transition group overflow-hidden ${selected ? 'bg-gray-800 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : `bg-gray-800/40 ${bgColors}`}`}>
      <div className="p-3 flex justify-between items-center">
        <div className="flex items-center gap-3 overflow-hidden">
          {onToggleSelect && (
            <input 
              type="checkbox" 
              checked={selected} 
              onChange={onToggleSelect} 
              className="mt-0.5 rounded border-gray-600 bg-gray-900 text-indigo-600 focus:ring-indigo-500 shrink-0"
            />
          )}
          <Icon size={18} className="shrink-0" />
          <div className="truncate text-xs font-medium text-gray-200 leading-tight" title={file.filename}>
            {file.baseName}
            <div className="text-[10px] text-gray-500 mt-0.5">{file.extension}</div>
          </div>
        </div>
        
        {color === 'blue' && onYoutubeSearch && !isExpanded && (
          <div className="shrink-0 ml-2">
            <button 
              onClick={onYoutubeSearch}
              disabled={searchingYoutube}
              className="px-2 py-1 bg-gray-800 border border-gray-700 hover:border-gray-500 text-gray-400 rounded text-[10px] font-medium transition opacity-0 group-hover:opacity-100 disabled:opacity-50"
            >
              {searchingYoutube ? 'Searching...' : 'Find Video'}
            </button>
          </div>
        )}

        {color === 'purple' && onSpotifySearch && !isExpanded && (
          <div className="shrink-0 ml-2">
            <button 
              onClick={onSpotifySearch}
              disabled={searchingSpotify}
              className="px-2 py-1 bg-gray-800 border border-gray-700 hover:border-gray-500 text-gray-400 rounded text-[10px] font-medium transition opacity-0 group-hover:opacity-100 disabled:opacity-50"
            >
              {searchingSpotify ? 'Searching...' : 'Find Spotify'}
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2 border-t border-gray-700/50 mt-1">
          {file.previewUrl && (
            <div className="w-full bg-black/40 rounded overflow-hidden flex items-center justify-center">
              {color === 'blue' ? (
                // Video Preview (YouTube Iframe)
                <iframe 
                  src={file.previewUrl} 
                  className="w-full aspect-video" 
                  frameBorder="0" 
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                  allowFullScreen
                ></iframe>
              ) : (
                // Audio Preview (Spotify or raw)
                <audio controls src={file.previewUrl} className="w-full h-10"></audio>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-between gap-2 mt-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold ml-1">Quality</span>
              <select 
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={loadingFormats}
                className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 outline-none w-28 disabled:opacity-50"
              >
                {loadingFormats ? <option>Loading...</option> : color === 'blue' ? (
                  <>
                    <option value="best">Best (4K+)</option>
                    {formats?.videos && formats.videos.map(v => <option key={v} value={v.toString()}>{v}p</option>)}
                  </>
                ) : (
                  <>
                    <option value="best">Best Audio</option>
                    {formats?.audios && formats.audios.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                  </>
                )}
              </select>
            </div>

            <button
              onClick={() => onDownload?.(quality)}
              disabled={downloading}
              className={`flex-1 flex justify-center items-center py-1.5 px-3 rounded text-xs font-bold transition ${downloading ? 'bg-gray-700 text-gray-400 animate-pulse' : 'bg-primary-600 hover:bg-primary-500 text-white'}`}
            >
              {downloading ? 'Downloading...' : 'Accept & Download'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchedPairCard({ pair, onUnlink, onAnalyze, analyzing }: { pair: MatchedPair, onUnlink: () => void, onAnalyze: () => void, analyzing: boolean }) {
  return (
    <div className="flex flex-col rounded-lg border border-gray-700 bg-gray-800 overflow-hidden shadow-sm hover:border-gray-600 transition group items-stretch">
      
      <div className="flex items-stretch justify-between divide-x divide-gray-700">
        <div className="flex-1 p-3 truncate flex items-center gap-2">
           <FileAudio size={14} className="text-blue-400 shrink-0"/>
           <span className="text-xs truncate text-gray-200" title={pair.audioFile.filename}>{pair.audioFile.baseName}</span>
        </div>
        
        {/* Linker visual */}
        <div className="px-3 flex flex-col items-center justify-center bg-gray-900/50 shrink-0 gap-1">
          {pair.status === 'exact' ? (
             <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Exact Match</span>
          ) : pair.status === 'fuzzy' || pair.status === 'downloaded' ? (
             <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">Auto-Linked</span>
          ) : (
             <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1"><Wand2 size={10}/> Ollama</span>
          )}

          {/* Prominent Label */}
          {pair.aiResult && (
             <span className="px-2 py-0.5 mt-1 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-bold uppercase tracking-wider shadow-[0_0_10px_rgba(99,102,241,0.2)]">
               {pair.aiResult.verifiedCategory}
             </span>
          )}
        </div>

        <div className="flex-1 p-3 truncate flex items-center gap-2">
           <FileVideo size={14} className="text-purple-400 shrink-0"/>
           <span className="text-xs truncate text-gray-200" title={pair.videoFile.filename}>{pair.videoFile.baseName}</span>
        </div>
      </div>

      {/* Action / Data Footer */}
      <div className="bg-gray-900/80 px-3 py-2 flex items-center justify-between border-t border-gray-700/50">
        <div className="flex items-center gap-3">
           {pair.status === 'ollama' && (
             <button onClick={onUnlink} title="Unlink Mistake" className="text-gray-500 hover:text-red-400 transition">
               <Unlink size={14} />
             </button>
           )}
           
           {pair.aiResult ? (
             <div className="flex items-center gap-2 text-xs">
               <span className="text-indigo-400 border border-indigo-500/30 rounded px-1.5 py-0.5">{pair.aiResult.verifiedCategory}</span>
               {pair.aiResult.isOfficialVideo && <span className="text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5">Official</span>}
               <span className="text-gray-400 max-w-[120px] truncate" title={pair.aiResult.cleanName}>{pair.aiResult.cleanName}</span>
             </div>
           ) : pair.classification ? (
             <div className="flex items-center gap-2 text-xs">
               <span className="text-primary-400 border border-primary-500/30 rounded px-1.5 py-0.5">{pair.classification.genre}</span>
               <span className="text-gray-400 max-w-[120px] truncate" title={pair.classification.cleanName}>{pair.classification.cleanName}</span>
             </div>
           ) : (
             <button disabled={analyzing} onClick={onAnalyze} className="text-[11px] font-medium text-gray-400 hover:text-white flex items-center gap-1 bg-gray-800 px-2 py-1 rounded transition">
               {analyzing ? <span className="animate-pulse">Validating...</span> : <><HelpCircle size={12}/> Needs AI Validation</>}
             </button>
           )}
        </div>
      </div>
    </div>
  );
}

export default App;
