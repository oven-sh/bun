export class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
  setHost(host: string): void {
    this.host = host;
  }
  setPort(port: number): void {
    this.port = port;
  }
  setPath(path: string): void {
    this.path = path;
  }
  setSecure(secure: boolean): void {
    this.secure = secure;
  }
}
export class Packed {
  declare host?: unknown;
  declare port?: unknown;
  declare path?: unknown;
  declare secure?: unknown;
  setHost(host: string): void {
    this.host = host;
  }
  setPort(port: number): void {
    this.port = port;
  }
  setPath(path: string): void {
    this.path = path;
  }
  setSecure(secure: boolean): void {
    this.secure = secure;
  }
}
export type Settings = { id: number; host?: string; port?: number; path?: string; secure?: boolean };
export function makeSettings(id: number): Settings {
  return { id };
}
export function makeSettingsWithKeys(first: string, second: string): Settings {
  return { [first]: 1, id: 2, [second]: 3, host: "h" };
}
export function setHostOf(settings: Settings, host: string): void {
  settings.host = host;
}
export function setPortOf(settings: Settings, port: number): void {
  settings.port = port;
}
export function setPathOf(settings: Settings, path: string): void {
  settings.path = path;
}
export function setSecureOf(settings: Settings, secure: boolean): void {
  settings.secure = secure;
}
export type Narrow = { id: number };
export type Wider = { id: number; later?: number; other?: string };
export function makeNarrow(id: number): Narrow {
  return { id };
}
export function asWider(narrow: Narrow): Wider {
  return narrow as Wider;
}
export function laterOf(wider: Wider): number | undefined {
  return wider.later;
}
