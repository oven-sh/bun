export type Level = "low" | "mid" | "high";
export type Mode = "on" | "off";
export enum Flag { None = 0, A = 1, B = 2 }
export class Gauge {
  level: Level = "low";
  mode: Mode = "off";
  count: number = 0;
  ratio: number = 0.5;
  label: string = "gauge";
  flag: Flag = Flag.None;
  note?: string;
  maybe: number | null = null;
  either: number | string = 0;
  big: bigint = 1n;
  mark: symbol = Symbol.for("gauge");
  on: boolean = false;
  list: number[] = [];
  inner: { level: Level; n: number } = { level: "mid", n: 1 };
  raise(): Level { return (this.level = this.level === "low" ? "mid" : "high"); }
  isHigh(): boolean { return this.level === "high"; }
  summary(): string { return [this.level, this.mode, this.count, this.ratio, this.label, this.flag, this.note, this.maybe, this.either, this.big, this.on, this.list.length, this.inner.level, this.inner.n].join("|"); }
}
export function setLevel(g: Gauge, level: Level): Level { g.level = level; return g.level; }
export function levelOf(g: { level: Level }): Level { return g.level; }
export function rank(level: Level): number { switch (level) { case "low": return 1; case "mid": return 2; case "high": return 3; } }
export function sameLevel(a: Level, b: Level): boolean { return a === b; }
export function fill(g: Gauge, n: number): Gauge { g.count = n; g.ratio = n / 2; g.either = n % 2 ? n : "s" + n; g.maybe = n % 3 ? n : null; g.on = n % 2 === 0; g.flag = n % 3; g.list.push(n); g.inner = { level: n % 2 ? "high" : "low", n }; if (n % 4 === 0) g.note = "note" + n; return g; }
export const levels: readonly Level[] = ["low", "mid", "high"];
export let current: Level = "mid";
export function setCurrent(level: Level): void { current = level; }
export const defaultsOfGauge: { level: Level; mode: Mode } = { level: "high", mode: "on" };
export function makeRecord(n: number): { level: Level; n: number; tag?: Mode } { return n % 2 ? { level: "low", n } : { level: "high", n, tag: "on" }; }
