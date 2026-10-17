export class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
}
export class Packed {
  declare host?: unknown;
  declare port?: unknown;
  declare path?: unknown;
  declare secure?: unknown;
}
export class Extended {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
}
export type Settings = { id: number; host?: string; port?: number; path?: string; secure?: boolean };
export function makeSettings(id: number): Settings {
  return { id };
}
export function tagOptions(o: Options, tag: number): void {
  (o as any).tag = tag;
}
export function tagPacked(o: Packed, tag: number): void {
  (o as any).tag = tag;
}
export function tagSettings(o: Settings, tag: number): void {
  (o as any).tag = tag;
}
export class Wide {
  declare f0?: number;
  declare f1?: string;
  declare f2?: number;
  declare f3?: string;
  declare f4?: number;
  declare f5?: string;
  declare f6?: number;
  declare f7?: string;
  declare f8?: number;
  declare f9?: string;
  declare f10?: number;
  declare f11?: string;
  always = 1;
}
export function tagWide(o: Wide, tag: number): void {
  (o as any).tag = tag;
}
