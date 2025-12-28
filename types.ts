export enum AppStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export interface MapData {
  uri: string;
  title: string;
}

export interface TimerData {
  id: string;
  duration: number;
  remaining: number;
  label: string;
  isActive: boolean;
}

export interface GeneratedFile {
  id: string;
  name: string;
  url: string;
  type: 'pdf' | 'docx';
  timestamp: number;
}

export interface DisplayedContent {
  title: string;
  content: string;
  type: 'text' | 'code' | 'correction';
}