export class Options {
  declare host?: string;
  declare port?: number;
  declare maybe?: undefined | number;
  always = 1;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
  }
  setMaybe(): void {
    this.maybe = undefined;
  }
}
export class Packed {
  declare host?: unknown;
  declare port?: unknown;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
  }
}
export class Extended {
  declare host?: string;
  declare port?: number;
  always = 1;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
  }
}
export type Settings = { id: number; host?: string; port?: number };
export function makeSettings(id: number): Settings {
  return { id };
}
export function fillSettings(settings: Settings, port: number): void {
  settings.host = "localhost";
  settings.port = port;
}
export function tag(o: object, value: number): void {
  (o as any).tag = value;
}
