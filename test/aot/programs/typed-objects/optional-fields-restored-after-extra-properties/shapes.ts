export class Inner {
  value = 1;
}
export class Other {
  name = "other";
}
export class Options {
  declare host?: string;
  declare port?: number;
  declare secure?: boolean;
  declare path?: string | null;
  declare inner?: Inner;
  declare whatever?: unknown;
  declare big?: bigint;
  declare mode?: "a" | "b";
  declare either?: number | string;
  declare mark?: symbol;
  always = 1;
  fill(round: number): void {
    this.host = "localhost";
    this.port = round;
    this.secure = true;
    this.path = "/";
    this.inner = new Inner();
    this.whatever = round;
    this.big = 1n;
    this.mode = "a";
    this.either = round;
    this.mark = Symbol.iterator;
  }
  describe(): string {
    return [this.host, this.port, this.secure, this.path, this.inner === undefined ? "none" : this.inner.value, String(this.whatever), this.big, this.mode, this.either, String(this.mark)].join("|");
  }
}
export type Settings = { id: number; host?: string; port?: number; secure?: boolean; inner?: Inner };
export function makeSettings(id: number): Settings {
  return { id };
}
export function fillSettings(settings: Settings, round: number): void {
  settings.host = "localhost";
  settings.port = round;
  settings.secure = false;
  settings.inner = new Inner();
}
export function describeSettings(settings: Settings): string {
  return [settings.id, settings.host, settings.port, settings.secure, settings.inner === undefined ? "none" : settings.inner.value].join("|");
}
