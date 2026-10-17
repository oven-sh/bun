export class Extended {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
  readHost(): string | undefined {
    return this.host;
  }
  readPort(): number | undefined {
    return this.port;
  }
  hasHost(): boolean {
    return "host" in this;
  }
  hasPort(): boolean {
    return "port" in this;
  }
  setHost(host: string): void {
    this.host = host;
  }
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
    this.path = "/";
    this.secure = false;
  }
}
export class Second {
  declare host?: string;
  declare port?: number;
  always = 2;
  readHost(): string | undefined {
    return this.host;
  }
  readPort(): number | undefined {
    return this.port;
  }
  hasHost(): boolean {
    return "host" in this;
  }
  hasPort(): boolean {
    return "port" in this;
  }
  setHost(host: string): void {
    this.host = host;
  }
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
  }
}
export type Settings = { id: number; host?: string; port?: number };
export function makeSettings(id: number): Settings {
  return { id };
}
export function readHostOf(settings: Settings): string | undefined {
  return settings.host;
}
export function hasHostIn(settings: Settings): boolean {
  return "host" in settings;
}
export function setHostOf(settings: Settings, host: string): void {
  settings.host = host;
}
