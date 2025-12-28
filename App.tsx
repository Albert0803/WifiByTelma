import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AppStatus, TimerData, DisplayedContent, GeneratedFile } from './types';
import { encode, decode, decodeAudioData } from './utils/audio';
import HUD from './components/HUD';
import ToolsPanel from './components/ToolsPanel';
import DataDisplay from './components/DataDisplay';

// Config PDF.js
if (typeof window !== 'undefined' && 'pdfjsLib' in window) {
  (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [timers, setTimers] = useState<TimerData[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [displayedContent, setDisplayedContent] = useState<DisplayedContent | null>(null);
  const [lastSuggestion, setLastSuggestion] = useState<string | null>(null);
  
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(document.createElement('video'));
  const screenIntervalRef = useRef<number | null>(null);

  const functions: FunctionDeclaration[] = [
    {
      name: 'setTimer',
      parameters: {
        type: Type.OBJECT,
        properties: {
          duration: { type: Type.NUMBER, description: 'Durée en secondes.' },
          label: { type: Type.STRING, description: 'Libellé du minuteur.' }
        },
        required: ['duration']
      }
    },
    {
      name: 'displayContent',
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: 'Titre de la fenêtre.' },
          content: { type: Type.STRING, description: 'Contenu textuel, synthèse ou code.' },
          type: { type: Type.STRING, enum: ['text', 'code', 'correction'], description: 'Type de formatage.' }
        },
        required: ['title', 'content', 'type']
      }
    },
    {
      name: 'generateFile',
      parameters: {
        type: Type.OBJECT,
        properties: {
          filename: { type: Type.STRING, description: 'Le nom du fichier (avec extension .pdf ou .docx).' },
          content: { type: Type.STRING, description: 'Le contenu textuel complet à mettre dans le document.' },
          format: { type: Type.STRING, enum: ['pdf', 'docx'], description: 'Le format de sortie souhaité.' }
        },
        required: ['filename', 'content', 'format']
      }
    },
    {
      name: 'suggestAction',
      parameters: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: 'Courte suggestion à afficher à l\'écran.' }
        },
        required: ['text']
      }
    }
  ];

  const handleGenerateFile = async (filename: string, content: string, format: 'pdf' | 'docx') => {
    try {
      let blob: Blob;
      if (format === 'pdf') {
        const { jsPDF } = (window as any).jspdf;
        const doc = new jsPDF();
        // Gestion rudimentaire du wrapping de texte pour le PDF
        const splitText = doc.splitTextToSize(content, 180);
        doc.text(splitText, 10, 10);
        blob = doc.output('blob');
      } else {
        const docx = (window as any).docx;
        const doc = new docx.Document({
          sections: [{
            properties: {},
            children: content.split('\n').map((line: string) => new docx.Paragraph({
              children: [new docx.TextRun(line)],
            })),
          }],
        });
        blob = await docx.Packer.toBlob(doc);
      }

      const url = URL.createObjectURL(blob);
      const newFile: GeneratedFile = {
        id: Math.random().toString(36).substr(2, 9),
        name: filename.includes('.') ? filename : `${filename}.${format}`,
        url,
        type: format,
        timestamp: Date.now()
      };

      setGeneratedFiles(prev => [newFile, ...prev]);
      setLastSuggestion(`Monsieur, le document "${newFile.name}" a été compilé et archivé.`);
      setTimeout(() => setLastSuggestion(null), 5000);
      return `Succès: Fichier ${filename} généré avec succès. Informez l'utilisateur qu'il peut le télécharger dans le panneau latéral.`;
    } catch (err) {
      console.error("Erreur de génération de fichier:", err);
      return "Erreur lors de la génération du fichier.";
    }
  };

  const connect = async () => {
    try {
      setStatus(AppStatus.CONNECTING);
      
      if (!inputCtxRef.current) {
        inputCtxRef.current = new AudioContext({ sampleRate: 16000 });
        outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      if (inputCtxRef.current.state === 'suspended') await inputCtxRef.current.resume();
      if (outputCtxRef.current.state === 'suspended') await outputCtxRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: 'Puck' }
            } 
          },
          systemInstruction: `Vous êtes J.A.R.V.I.S., l'IA de Tony Stark. 
          VOTRE MISSION :
          - Analyser, modifier et générer des documents pour Monsieur.
          - Appelez TOUJOURS l'utilisateur "Monsieur".
          - Si Monsieur vous demande de "corriger un document", de "rédiger une lettre en Word" ou de "transformer ceci en PDF", utilisez impérativement l'outil 'generateFile'.
          - Après avoir généré un fichier, confirmez-le vocalement à Monsieur.
          - Utilisez 'displayContent' pour montrer le texte à l'écran avant ou pendant la génération pour validation.`,
          tools: [{ functionDeclarations: functions }, { googleSearch: {} }]
        },
        callbacks: {
          onopen: () => {
            setStatus(AppStatus.LISTENING);
            const source = inputCtxRef.current!.createMediaStreamSource(stream);
            const processor = inputCtxRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(data.length);
              for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
              sessionPromise.then(s => {
                if (s) s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(processor);
            processor.connect(inputCtxRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio && outputCtxRef.current) {
              setStatus(AppStatus.SPEAKING);
              if (outputCtxRef.current.state === 'suspended') await outputCtxRef.current.resume();
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtxRef.current.currentTime);
              
              try {
                const buffer = await decodeAudioData(decode(audio), outputCtxRef.current, 24000, 1);
                const source = outputCtxRef.current.createBufferSource();
                source.buffer = buffer;
                source.connect(outputCtxRef.current.destination);
                
                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) setStatus(AppStatus.LISTENING);
                };
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
                sourcesRef.current.add(source);
              } catch (err) { console.error(err); }
            }
            
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                let response = { result: "Action effectuée, Monsieur." };
                
                if (fc.name === 'setTimer') {
                  setTimers(prev => [...prev, { id: Math.random().toString(), duration: fc.args.duration, remaining: fc.args.duration, label: fc.args.label || 'Minuteur', isActive: true }]);
                } else if (fc.name === 'displayContent') {
                  setDisplayedContent({ title: fc.args.title, content: fc.args.content, type: fc.args.type });
                } else if (fc.name === 'generateFile') {
                  setIsProcessingFile(true);
                  const result = await handleGenerateFile(fc.args.filename, fc.args.content, fc.args.format);
                  response = { result };
                  setIsProcessingFile(false);
                } else if (fc.name === 'suggestAction') {
                  setLastSuggestion(fc.args.text);
                  setTimeout(() => setLastSuggestion(null), 8000);
                }

                sessionRef.current?.sendToolResponse({ 
                  functionResponses: [{ id: fc.id, name: fc.name, response }] 
                });
              }
            }

            if (msg.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setStatus(AppStatus.LISTENING);
            }
          },
          onerror: (e) => setStatus(AppStatus.ERROR),
          onclose: () => setStatus(AppStatus.IDLE)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { 
      console.error(e);
      setStatus(AppStatus.ERROR); 
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionRef.current) return;
    setIsProcessingFile(true);
    try {
      let extractedText = "";
      if (file.type === 'application/pdf') {
        const pdfjsLib = (window as any).pdfjsLib;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          extractedText += textContent.items.map((item: any) => item.str).join(' ') + "\n";
          // On envoie aussi un visuel
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          canvas.height = viewport.height; canvas.width = viewport.width;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
          sessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
        }
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await (window as any).mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = (ev.target?.result as string).split(',')[1];
          sessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
        };
        reader.readAsDataURL(file);
      }

      if (extractedText) {
        sessionRef.current.sendRealtimeInput([{ 
          text: `Monsieur, j'ai scanné le document : ${file.name}. Contenu extrait : \n\n ${extractedText.substring(0, 10000)}... Que souhaitez-vous en faire ?` 
        }]);
      }
    } catch (err) { console.error(err); }
    finally {
      setIsProcessingFile(false);
      e.target.value = '';
    }
  };

  const shareScreen = async () => {
    if (isSharingScreen) {
      if (screenIntervalRef.current) clearInterval(screenIntervalRef.current);
      setIsSharingScreen(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      setIsSharingScreen(true);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      screenIntervalRef.current = window.setInterval(() => {
        if (!ctx || !videoRef.current.videoWidth) return;
        canvas.width = 960; canvas.height = 540;
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (blob && sessionRef.current) {
            const reader = new FileReader();
            reader.onload = () => sessionRef.current.sendRealtimeInput({ media: { data: (reader.result as string).split(',')[1], mimeType: 'image/jpeg' } });
            reader.readAsDataURL(blob);
          }
        }, 'image/jpeg', 0.5);
      }, 3000);
    } catch (e) { setIsSharingScreen(false); }
  };

  useEffect(() => {
    const timer = setInterval(() => setTimers(prev => prev.map(t => ({ ...t, remaining: Math.max(0, t.remaining - 1) })).filter(t => t.remaining > 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center relative bg-[#010409]">
      <div className="absolute inset-0 hologram-flicker pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] h-[120vh] border-[1px] border-cyan-500/5 rounded-full"></div>
      </div>

      <HUD status={status} isProcessing={isProcessingFile} />
      
      {isSharingScreen && <div className="scanning-line" />}

      {lastSuggestion && (
        <div className="fixed top-1/4 left-1/2 -translate-x-1/2 z-[250] animate-in fade-in zoom-in duration-300">
           <div className="bg-cyan-500/10 backdrop-blur-xl border border-cyan-400/30 p-4 rounded-2xl flex items-center gap-4 shadow-[0_0_30px_rgba(0,229,255,0.2)]">
             <div className="w-10 h-10 rounded-full border border-cyan-400 flex items-center justify-center animate-pulse">
               <i className="fas fa-robot text-cyan-400"></i>
             </div>
             <div className="flex flex-col">
               <span className="text-[8px] font-mono text-cyan-500/60 uppercase font-bold tracking-widest mb-1">Système J.A.R.V.I.S.</span>
               <p className="text-cyan-100 text-sm font-medium">{lastSuggestion}</p>
             </div>
           </div>
        </div>
      )}

      <DataDisplay data={displayedContent} onClose={() => setDisplayedContent(null)} />
      
      {status === AppStatus.IDLE ? (
        <button 
          onClick={connect} 
          className="mt-12 group relative px-12 py-5 border-2 border-cyan-500 overflow-hidden transition-all duration-300 hover:scale-105"
        >
          <div className="absolute inset-0 bg-cyan-500/10 group-hover:bg-cyan-500/20 transition-all"></div>
          <span className="relative z-10 text-cyan-400 font-black tracking-[0.6em] text-sm flex items-center gap-3">
            INITIALISER PROTOCOLE J.A.R.V.I.S.
            <i className="fas fa-power-off text-xs animate-pulse"></i>
          </span>
        </button>
      ) : (
        <ToolsPanel 
          timers={timers} 
          generatedFiles={generatedFiles}
          onScreenShare={shareScreen} 
          isSharing={isSharingScreen} 
          onFileUpload={handleFileUpload} 
        />
      )}

      <div className="absolute bottom-10 left-10 opacity-60 text-[10px] font-mono text-cyan-400 space-y-2 z-10 select-none">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${status !== AppStatus.IDLE ? 'bg-cyan-400 animate-ping' : 'bg-gray-700'}`}></div>
          <span className="font-black tracking-widest">STARK_SYSTEM_v8.4.1_ACTIVE</span>
        </div>
        <div className="pl-5 border-l border-cyan-500/30 space-y-1">
          <div>UPLINK: <span className="text-cyan-200">SECURE_CHANNEL_ALPHA</span></div>
          <div>MOD_FILE_GEN: <span className="text-green-400 font-bold">READY</span></div>
        </div>
      </div>
    </div>
  );
};

export default App;