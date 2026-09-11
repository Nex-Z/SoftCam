export interface Source {
  kind: "window" | "monitor";
  id: number;
  title: string;
  width: number;
  height: number;
  pid?: number;
  process?: string;
  thumbnail?: string;
  icon?: string;
  crop?: Crop;
}
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Settings {
  closeBehavior: "quit" | "tray";
  outputDirectory: string;
  codec: string;
  fps: number;
  quality: string;
  cursor: boolean;
  recordShortcut: string;
  shotShortcut: string;
}
export interface Video {
  path: string;
  url: string;
  duration: number;
  size: number;
  width: number;
  height: number;
  fps: string;
  codec: string;
}
export interface Shot {
  path: string;
  url: string;
  width: number;
  height: number;
}
export interface AppEvent {
  event: string;
  data: any;
}
declare global {
  interface Window {
    softcam: {
      call: (method: string, params?: any) => Promise<any>;
      on: (handler: (message: AppEvent) => void) => () => void;
    };
  }
}
export const api = (method: string, params?: any) =>
  window.softcam.call(method, params);
export const size = (bytes: number) =>
  bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(2)} GB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
export const duration = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
export const basename = (p: string) => p.split(/[\\/]/).pop();
export const shortcutLabel = (s: string) =>
  s
    .replace(/CommandOrControl|Control/gi, "Ctrl")
    .split("+")
    .join(" + ");
