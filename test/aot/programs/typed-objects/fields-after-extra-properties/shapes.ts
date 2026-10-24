export class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
    this.path = "/";
    this.secure = false;
  }
  fillBackwards(port: number): void {
    this.secure = true;
    this.path = "/back";
    this.port = port;
    this.host = "remote";
  }
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
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
    this.path = "/";
    this.secure = false;
  }
  fillBackwards(port: number): void {
    this.secure = true;
    this.path = "/back";
    this.port = port;
    this.host = "remote";
  }
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
export class Extended {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
    this.path = "/";
    this.secure = false;
  }
  fillBackwards(port: number): void {
    this.secure = true;
    this.path = "/back";
    this.port = port;
    this.host = "remote";
  }
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
export class Wide {
  declare f0?: unknown; declare f1?: unknown; declare f2?: unknown; declare f3?: unknown; declare f4?: unknown; declare f5?: unknown;
  declare f6?: unknown; declare f7?: unknown; declare f8?: unknown; declare f9?: unknown; declare f10?: unknown; declare f11?: unknown;
  declare f12?: unknown; declare f13?: unknown; declare f14?: unknown; declare f15?: unknown; declare f16?: unknown; declare f17?: unknown;
  declare f18?: unknown; declare f19?: unknown; declare f20?: unknown; declare f21?: unknown; declare f22?: unknown; declare f23?: unknown;
  declare f24?: unknown; declare f25?: unknown; declare f26?: unknown; declare f27?: unknown; declare f28?: unknown; declare f29?: unknown;
  declare f30?: unknown; declare f31?: unknown; declare f32?: unknown; declare f33?: unknown; declare f34?: unknown; declare f35?: unknown;
  declare f36?: unknown; declare f37?: unknown; declare f38?: unknown; declare f39?: unknown; declare f40?: unknown; declare f41?: unknown;
  always = 1;
  fill(port: number): void {
    this.f0 = "localhost";
    this.f13 = port;
    this.f27 = "/";
    this.f41 = false;
  }
  fillBackwards(port: number): void {
    this.f41 = true;
    this.f27 = "/back";
    this.f13 = port;
    this.f0 = "remote";
  }
  setHost(host: string): void {
    this.f40 = host;
  }
  setPort(port: number): void {
    this.f1 = port;
  }
  setPath(path: string): void {
    this.f39 = path;
  }
  setSecure(secure: boolean): void {
    this.f2 = secure;
  }
}
export type Settings = { id: number; host?: string; port?: number; path?: string; secure?: boolean };
export function makeSettings(id: number): Settings {
  return { id };
}
export function fillSettings(settings: Settings, port: number): void {
  settings.host = "localhost";
  settings.port = port;
  settings.path = "/";
  settings.secure = false;
}
export function fillSettingsBackwards(settings: Settings, port: number): void {
  settings.secure = true;
  settings.path = "/back";
  settings.port = port;
  settings.host = "remote";
}
export function makeTagAndFill(port: number): Options {
  const made = new Options();
  (made as any).tag = port;
  made.host = "localhost";
  made.port = port;
  (made as any).later = port;
  made.path = "/";
  made.secure = false;
  return made;
}
