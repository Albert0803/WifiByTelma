import React from 'react';
import { TimerData, GeneratedFile } from '../types';

interface ToolsPanelProps {
  timers: TimerData[];
  generatedFiles: GeneratedFile[];
  onScreenShare: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isSharing: boolean;
}

const ToolsPanel: React.FC<ToolsPanelProps> = ({ timers, generatedFiles, onScreenShare, onFileUpload, isSharing }) => {
  return (
    <div className="fixed right-8 top-1/2 -translate-y-1/2 flex flex-col gap-6 z-[200]">
      {/* Contrôles d'entrée */}
      <div className="bg-cyan-950/30 backdrop-blur-lg p-3 rounded-2xl border border-cyan-500/20 flex flex-col gap-4 shadow-2xl">
        <button 
          onClick={onScreenShare}
          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isSharing ? 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-400 hover:text-black'}`}
          title="Partage d'écran"
        >
          <i className={`fas ${isSharing ? 'fa-stop' : 'fa-desktop'}`}></i>
        </button>
        
        <label className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center cursor-pointer border border-cyan-500/20 hover:bg-cyan-400 hover:text-black transition-all">
          <i className="fas fa-file-arrow-up"></i>
          <input 
            type="file" 
            className="hidden" 
            onChange={onFileUpload} 
            accept="image/*,application/pdf,.docx,.pptx"
          />
        </label>
      </div>

      {/* Archives de téléchargement (Nouveau) */}
      {generatedFiles.length > 0 && (
        <div className="bg-cyan-950/40 p-4 rounded-xl border border-cyan-500/20 w-56 animate-in fade-in slide-in-from-right-4">
          <h3 className="text-[10px] text-cyan-400 font-bold uppercase mb-3 flex items-center gap-2">
            <i className="fas fa-folder-open text-xs"></i>
            Archives de Transfert
          </h3>
          <div className="space-y-3 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            {generatedFiles.map(file => (
              <a 
                key={file.id} 
                href={file.url} 
                download={file.name}
                className="group flex items-center gap-3 p-2 bg-cyan-400/5 hover:bg-cyan-400/20 border border-cyan-500/10 rounded-lg transition-all"
              >
                <div className="w-8 h-8 rounded bg-cyan-500/10 flex items-center justify-center">
                  <i className={`fas ${file.type === 'pdf' ? 'fa-file-pdf text-red-400' : 'fa-file-word text-blue-400'} text-xs`}></i>
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-[10px] font-mono text-cyan-200 truncate group-hover:text-cyan-400">{file.name}</span>
                  <span className="text-[7px] text-cyan-500/60 uppercase">Prêt pour transfert</span>
                </div>
                <i className="fas fa-download ml-auto text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"></i>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Processus Actifs (Minuteurs) */}
      {timers.length > 0 && (
        <div className="bg-cyan-950/40 p-4 rounded-xl border border-cyan-500/20 w-56 animate-in fade-in slide-in-from-right-4">
          <h3 className="text-[10px] text-cyan-400 font-bold uppercase mb-2">Processus Temporels</h3>
          {timers.map(t => (
            <div key={t.id} className="flex justify-between text-xs font-mono text-cyan-300">
              <span>{t.label}</span>
              <span>{Math.floor(t.remaining / 60)}:{(t.remaining % 60).toString().padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 229, 255, 0.2); }
      `}</style>
    </div>
  );
};

export default ToolsPanel;