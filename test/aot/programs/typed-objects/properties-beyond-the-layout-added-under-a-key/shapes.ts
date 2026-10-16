export class Options {
  declare host?: string;
  declare port?: number;
  always = 1;
  set watched(value: unknown) {
    (this as any).caughtByTheClass = value;
  }
  get watched(): unknown {
    return "of the class";
  }
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
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
