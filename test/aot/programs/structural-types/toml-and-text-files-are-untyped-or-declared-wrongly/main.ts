import declared from "./declared.txt";
import honest from "./honest.toml";
import notes from "./notes.txt";
import settings from "./settings.toml";
import asText from "./settings.toml" with { type: "text" };

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Point {
  x: number;
  y: number;
}

interface Settings {
  port: number;
  retries: number;
  name: string;
  tags: string[];
  origin: Point;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

function describe(s: Settings): unknown {
  return [s.port + 1, plusOne(s.retries), s.name + "!", s.tags.map(tag => tag + "?"), sum(s.origin), Object.keys(s).join(), Object.keys(s.origin).join()];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const s: Settings = honest;
  warm += s.port + plusOne(s.retries) + s.name.length + sum(s.origin);
}
console.log("2000 honest rounds: " + warm);

attempt("an honest file", () => describe(honest));
attempt("a file of other kinds", () => describe(settings));
attempt("the length of a name that is a number", () => {
  const s: Settings = settings;
  return s.name.length;
});
attempt("the lengths of the tags", () => {
  const s: Settings = settings;
  return s.tags.map(tag => tag.length);
});
attempt("a member that is not there", () => {
  const n: number = settings.missing;
  const p: Point = settings.nowhere;
  return [n + 1, p];
});
attempt("the file is one object", () => {
  const s: Settings = settings;
  s.retries = 4;
  return [settings.retries, plusOne(settings.retries)];
});
attempt("the same file as text", () => [typeof asText, asText.length > 0, asText.split("\n")[0]]);
attempt("a text file", () => [typeof notes, notes.trim() + 1, notes.length]);
attempt("a text file declared as a number", () => [typeof declared, declared + 1, plusOne(declared), declared * 2]);
