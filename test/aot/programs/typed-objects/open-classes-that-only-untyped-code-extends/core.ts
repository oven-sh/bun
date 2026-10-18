export interface Settings {
  name: string;
  base?: string;
  limit?: number;
}

export class Core {
  key: string | undefined = "k";
  marks: { n: boolean; h?: boolean } = { n: true };
  listeners = new Set<string>();
  committed: Array<number> = [];
  settings!: Settings;
  origin!: string;
  base!: string;
  limit!: number;
  later?: string;
  count = 0;
  #secret = 7;
  constructor(settings: Settings) {
    this.update({ limit: 5, ...settings });
  }
  update = (next: Settings) => {
    this.settings = { ...this.settings, ...next };
    this.base = this.settings.base ?? "/";
    this.origin = "http://" + this.settings.name;
    this.limit = this.settings.limit ?? 1;
  };
  step(n: number): number {
    this.count += n;
    this.committed.push(n);
    return this.count + this.limit + this.base.length + this.origin.length;
  }
  secret(): number {
    return this.#secret++;
  }
  #hidden(): string {
    return "hidden " + this.base;
  }
  reveal(): string {
    return this.#hidden();
  }
  static is(value: unknown): boolean {
    return value instanceof Core;
  }
}

export function describe(core: Core): string {
  return core.origin + core.base + " " + core.count + " " + core.limit + " " + core.key + " " + core.later;
}

export function rename(core: Core, name: string): void {
  core.update({ name });
  core.later = name;
}

export class Made {
  width: number;
  constructor(width: number) {
    this.width = width;
  }
  twice(): number {
    return this.width * 2;
  }
}

export function widthOf(made: Made): number {
  return made.width + made.twice();
}

export function makeOne(width: number): Made {
  return new Made(width);
}

export class OnlyExtended {
  label: string = "only";
  size!: number;
  seen: Array<string> = [];
  late?: string;
  constructor(size: number) {
    this.size = size;
  }
  grow(by: number): number {
    this.size += by;
    this.seen.push(this.label + this.size);
    return this.size;
  }
}

export function sizeOf(one: OnlyExtended): string {
  return one.label + " " + one.size + " " + one.seen.length + " " + one.late;
}
