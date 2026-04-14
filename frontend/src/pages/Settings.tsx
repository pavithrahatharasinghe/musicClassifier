import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Loader2, FolderOpen, Cpu, Video, ShieldCheck } from 'lucide-react';
import type { AppConfig } from '../types';

const API_BASE = 'http://localhost:3001/api';

function Settings() {
  const [config, setConfig] = useState<AppConfig>({
    audioDir: '',
    videoDir: '',
    destDir: '',
    downloadDir: '',
    ollamaModel: 'llama3',
    noVideoDestDir: '',
    qualityCheckDir: '',
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([axios.get(`${API_BASE}/config`), axios.get(`${API_BASE}/models`)])
      .then(([configRes, modelsRes]) => {
        let loadedConfig = configRes.data.success
          ? configRes.data.config
          : { audioDir: '', videoDir: '', destDir: '', downloadDir: '', ollamaModel: 'llama3' };

        if (modelsRes.data.success) {
          const models = modelsRes.data.models;
          setAvailableModels(models);
          if (models.length > 0 && (!loadedConfig.ollamaModel || !models.includes(loadedConfig.ollamaModel))) {
            loadedConfig.ollamaModel = models[0];
            axios.post(`${API_BASE}/config`, loadedConfig).catch(console.error);
          }
        }
        setConfig(loadedConfig);
      })
      .catch(console.error);
  }, []);

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setConfigSaving(true);
      const res = await axios.post(`${API_BASE}/config`, config);
      if (res.data.success) {
        setConfig(res.data.config);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Failed to save config', error);
      alert('Failed to save settings');
    } finally {
      setConfigSaving(false);
    }
  };

  const Field = ({
    label,
    description,
    value,
    onChange,
    required = false,
    placeholder = '',
  }: {
    label: string;
    description?: string;
    value: string;
    onChange: (v: string) => void;
    required?: boolean;
    placeholder?: string;
  }) => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-300">{label}</label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-gray-200 font-mono text-xs placeholder:text-gray-600 transition"
      />
    </div>
  );

  return (
    <>
      <header className="h-16 flex items-center px-6 border-b border-gray-800 bg-gray-900/60 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <h1 className="text-base font-semibold text-white tracking-tight">Settings</h1>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <form onSubmit={saveConfig} className="max-w-2xl mx-auto space-y-6">

          {/* Directories */}
          <section className="bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <FolderOpen size={15} className="text-blue-400" /> Directories
            </h2>

            <Field
              label="Audio Files Directory"
              description="Absolute path to scan for .flac audio files"
              value={config.audioDir}
              onChange={(v) => setConfig({ ...config, audioDir: v })}
              required
            />
            <Field
              label="Video Files Directory"
              description="Absolute path to scan for .mp4, .mkv video files"
              value={config.videoDir}
              onChange={(v) => setConfig({ ...config, videoDir: v })}
              required
            />
            <Field
              label="Destination Directory"
              description="Base path for organized files — genre subfolders (e.g. K-Pop, J-Pop) are created here"
              value={config.destDir}
              onChange={(v) => setConfig({ ...config, destDir: v })}
              required
            />
            <Field
              label="Download Directory"
              description="Optional: where yt-dlp downloads files before categorization. Falls back to audio/video dir if empty."
              value={config.downloadDir || ''}
              onChange={(v) => setConfig({ ...config, downloadDir: v })}
            />
          </section>

          {/* AI / Ollama */}
          <section className="bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Cpu size={15} className="text-violet-400" /> AI Model
            </h2>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Ollama Model</label>
              <p className="text-xs text-gray-500">
                Used for Auto-Match (AI) pairing and AI Takeover categorization
              </p>
              <select
                value={config.ollamaModel || 'llama3'}
                onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-200 text-sm transition"
              >
                {availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))
                ) : (
                  <option value="llama3">llama3 (default)</option>
                )}
              </select>
            </div>
          </section>

          {/* Video validation */}
          <section className="bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Video size={15} className="text-cyan-400" /> Video Release Validation
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                "Check Video" button is always visible on unmatched audio — queries MusicBrainz to confirm whether a music video release exists for the track.
              </p>
            </div>

            <Field
              label="No-Video Destination Directory"
              description='When "Send to No-Video Folder" is used, confirmed audio-only songs move here. Uses Destination/genre/no video if left blank.'
              value={config.noVideoDestDir || ''}
              onChange={(v) => setConfig({ ...config, noVideoDestDir: v })}
              placeholder="e.g. D:\NoVideoSongs"
            />
          </section>

          {/* Quality Analysis */}
          <section className="bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <ShieldCheck size={15} className="text-emerald-400" /> Quality Analysis
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Directory scanned by the Quality Analyzer tab. Files are analyzed for FLAC metadata, bitrate, and audio clipping.
              </p>
            </div>

            <Field
              label="Quality Check Directory"
              description="Folder containing FLAC files to quality-check. Sub-folders (validated, recheck, etc.) will be created here when files are moved."
              value={config.qualityCheckDir || ''}
              onChange={(v) => setConfig({ ...config, qualityCheckDir: v })}
              placeholder="e.g. H:\FLAC Musics\inbox"
            />
          </section>

          <div className="flex items-center justify-end gap-3">
            {saveSuccess && (
              <span className="text-xs text-emerald-400 font-medium">✓ Configuration saved</span>
            )}
            <button
              type="submit"
              disabled={configSaving}
              className="inline-flex items-center gap-2 px-5 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-semibold text-sm transition disabled:opacity-50"
            >
              {configSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Save size={14} /> Save Configuration
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default Settings;
