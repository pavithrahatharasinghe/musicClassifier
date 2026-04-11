import { FileAudio, FileVideo, Wand2, Unlink, CheckCircle2, HelpCircle, Link2 } from 'lucide-react';
import type { MatchedPair } from '../types';

interface MatchedPairCardProps {
  pair: MatchedPair;
  onUnlink: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

function MatchedPairCard({ pair, onUnlink, onAnalyze, analyzing }: MatchedPairCardProps) {
  const statusBadge = () => {
    if (pair.status === 'exact') {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 border border-emerald-400/25 rounded px-1.5 py-0.5">
          <Link2 size={8} /> Exact
        </span>
      );
    }
    if (pair.status === 'downloaded') {
      return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-sky-400 bg-sky-400/10 border border-sky-400/25 rounded px-1.5 py-0.5">
          <CheckCircle2 size={8} /> Downloaded
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-violet-400 bg-violet-400/10 border border-violet-400/25 rounded px-1.5 py-0.5">
        <Wand2 size={8} /> AI Linked
      </span>
    );
  };

  return (
    <div className="flex flex-col rounded-lg border border-gray-700/60 bg-gray-800/70 overflow-hidden hover:border-gray-600 transition-colors group">
      {/* File names row */}
      <div className="flex items-stretch justify-between divide-x divide-gray-700/60">
        <div className="flex-1 p-3 flex items-center gap-2 min-w-0 overflow-hidden">
          <FileAudio size={14} className="text-blue-400 shrink-0" />
          <span className="text-xs truncate text-gray-200" title={pair.audioFile.filename}>
            {pair.audioFile.baseName}
          </span>
        </div>

        {/* Center connector */}
        <div className="px-3 flex flex-col items-center justify-center bg-gray-900/40 shrink-0 gap-1 min-w-[90px]">
          {statusBadge()}
          {pair.aiResult && (
            <span className="px-1.5 py-0.5 mt-0.5 bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 rounded text-[9px] font-bold uppercase tracking-wider">
              {pair.aiResult.verifiedCategory}
            </span>
          )}
        </div>

        <div className="flex-1 p-3 flex items-center gap-2 min-w-0 overflow-hidden">
          <FileVideo size={14} className="text-purple-400 shrink-0" />
          <span className="text-xs truncate text-gray-200" title={pair.videoFile.filename}>
            {pair.videoFile.baseName}
          </span>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="bg-gray-900/50 px-3 py-2 flex items-center justify-between border-t border-gray-700/50">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {pair.aiResult ? (
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-indigo-400 border border-indigo-500/30 rounded px-1.5 py-0.5 shrink-0">
                {pair.aiResult.verifiedCategory}
              </span>
              {pair.aiResult.isOfficialVideo && (
                <span className="text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5 shrink-0">
                  Official
                </span>
              )}
              <span className="text-gray-400 truncate" title={pair.aiResult.cleanName}>
                {pair.aiResult.cleanName}
              </span>
            </div>
          ) : pair.classification ? (
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-primary-400 border border-primary-500/30 rounded px-1.5 py-0.5 shrink-0">
                {pair.classification.genre}
              </span>
              <span className="text-gray-400 truncate" title={pair.classification.cleanName}>
                {pair.classification.cleanName}
              </span>
            </div>
          ) : (
            <button
              disabled={analyzing}
              onClick={onAnalyze}
              className="text-[11px] font-medium text-gray-400 hover:text-white flex items-center gap-1 bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition"
            >
              {analyzing ? (
                <span className="animate-pulse">Validating...</span>
              ) : (
                <>
                  <HelpCircle size={12} /> Needs AI Validation
                </>
              )}
            </button>
          )}
        </div>

        {/* Unlink button — visible for ALL pair types */}
        <button
          onClick={onUnlink}
          title="Unlink this pair"
          className="ml-3 shrink-0 text-gray-600 hover:text-red-400 transition p-1 rounded hover:bg-red-400/10"
        >
          <Unlink size={13} />
        </button>
      </div>
    </div>
  );
}

export default MatchedPairCard;
