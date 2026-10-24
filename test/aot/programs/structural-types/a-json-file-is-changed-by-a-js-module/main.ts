import data from "./data.json";
import { spoil } from "./spoil.js";

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
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

function sum(p: Point): number {
  return p.x + p.y;
}

function total(numbers: number[]): number {
  let result = 0;
  for (let i = 0; i < numbers.length; i++) result += numbers[i];
  return result;
}

function report(label: string): void {
  attempt(label + ", count", () => {
    const n: number = data.count;
    return [n, n + 1, typeof n];
  });
  attempt(label + ", name", () => {
    const s: string = data.name;
    return [s, s + "!", typeof s];
  });
  attempt(label + ", the length of name", () => data.name.length);
  attempt(label + ", origin", () => {
    const p: Point = data.origin;
    return [p.x, p.y, sum(p), sum(data.origin)];
  });
  attempt(label + ", sizes", () => [total(data.sizes), data.sizes.length, Array.isArray(data.sizes)]);
  attempt(label + ", sizes mapped", () => data.sizes.map(n => n * 2));
  attempt(label + ", on", () => [data.on === true, data.on ? "on" : "off", typeof data.on]);
  attempt(label + ", the whole", () => [Object.keys(data).join(), JSON.stringify(data)]);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += data.count + sum(data.origin) + total(data.sizes) + data.name.length;
console.log("2000 honest rounds: " + warm);

report("as written");
for (let step = 0; step < 8; step++) {
  spoil(step);
  report("after change " + step);
}
