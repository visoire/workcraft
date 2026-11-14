export type BlipTheme = 'blue' | 'indigo' | 'ice' | 'teal' | 'amber' | 'coral' | 'emerald' | 'mono';
export type BlipState = 'idle' | 'walk' | 'startled' | 'error' | 'happy' | 'spin' | 'success' | 'spawn' | 'thinking' | 'loading' | 'coding' | 'working' | 'wave' | 'greeting' | 'sleep' | 'offline' | 'listening';
export type BlipAccessory = '' | 'glasses' | 'headset' | 'crown' | 'coffee' | 'hardhat';

export interface BlipPalette {
  body: string;
  top: string;
  shade: string;
  foot: string;
  ink: string;
  shine: string;
  tip: string;
  blush: string;
  alert: string;
}

export declare const BLIP_PALETTES: Record<BlipTheme, BlipPalette>;
export declare const BLIP_GRID: string[];

export interface BlipIconOptions {
  size?: number;
  theme?: BlipTheme;
  animated?: boolean;
  className?: string;
  label?: string;
}

export interface BlipSvgOptions {
  theme?: BlipTheme;
  className?: string;
  label?: string;
}

export interface CreateBlipOptions {
  state?: BlipState;
  theme?: BlipTheme;
  size?: number | string;
  accessory?: BlipAccessory;
  interactive?: boolean;
  label?: string;
}

export interface BlipInstance {
  el: HTMLDivElement;
  getState(): BlipState;
  setState(nextState: BlipState): BlipInstance;
  trigger(tempState: BlipState, durationMs?: number): BlipInstance;
  setTheme(nextTheme: BlipTheme): BlipInstance;
  setAccessory(nextAcc: BlipAccessory): BlipInstance;
  say(text: string, durationMs?: number): BlipInstance;
}

export declare function snapBlipSize(size: number, dpr?: number): number;
export declare function blipIconSvg(options?: BlipIconOptions): string;
export declare function blipSvg(options?: BlipSvgOptions): string;
export declare function createBlip(options?: CreateBlipOptions): BlipInstance;
export declare function blipAnsi(options?: { theme?: BlipTheme; indent?: string }): string;
