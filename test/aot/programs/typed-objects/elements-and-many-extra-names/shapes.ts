export class Options {
  declare host?: string;
  declare port?: number;
  always = 1;
}
export class Packed {
  declare host?: unknown;
  declare port?: unknown;
}
export type Settings = { id: number; host?: string };
export function makeSettings(id: number): Settings {
  return { id };
}
