export type Idle = { kind: "idle"; open: false };
export type Busy = { kind: "busy"; open: boolean };
export function idle(): Idle | Busy {
  return { kind: "idle", open: false };
}
export function describe(s: Idle | Busy): string {
  return s.kind + " " + (s.open ? "open" : "closed");
}

export type Kept = { name: "kept"; open: false };
export const kept: Kept = { name: "kept", open: false };
export function readByItsOwnType(k: Kept): string {
  const { open } = k;
  return [k.open ? "open" : "closed", open, k.open === false, `${k.open}`, k.open || "falsy", k.open ?? "nothing"].join(" ");
}

export type Unarmed = { timer: null; label: string };
export function unarmed(): Unarmed {
  return { timer: null, label: "t" };
}
export function describeTimer(s: { timer: number | null; label: string }): string {
  return s.label + " " + s.timer;
}

export type Inner = { tag: "inner"; done: false };
export function holder(): { state: Inner | { tag: "other"; done: boolean } } {
  return { state: { tag: "inner", done: false } };
}

export const constant = { shown: false, n: 1 } as const;

export type Settings = { verbose: boolean; names: string[] };
export function define<T extends Settings>(settings: T): T {
  return settings;
}
export const defined = define({ verbose: false, names: [] });
export const frozen = Object.freeze({ verbose: false, names: [] as string[] });
export function copyOfFrozen() {
  return { ...frozen };
}
export function describeSettings(s: Settings): string {
  return (s.verbose ? "verbose" : "quiet") + " " + s.names.length;
}

export class Panel {
  readonly pinned = false;
  describe(): string {
    return this.pinned ? "pinned" : "loose";
  }
}

export type OnlyNarrowed = { kind: "a"; on: false } | { kind: "b"; on: boolean };
export function narrowedA(): OnlyNarrowed {
  return { kind: "a", on: false };
}
export function narrowedB(): OnlyNarrowed {
  return { kind: "b", on: false };
}
