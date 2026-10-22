import { EventEmitter } from "node:events";

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function guarded(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

const values: [string, unknown][] = [
  ["honest", { x: 1, y: 2 }],
  ["swapped", { y: 2, x: 1 }],
  ["texts", { x: "1", y: "2" }],
  ["partial", { x: 1 }],
  ["a list", [1, 2]],
  ["a map", new Map([["x", 1]])],
  ["bigints", { x: 1n, y: 2n }],
  ["a number", 5],
  ["a text", "xy"],
  ["null", null],
  ["undefined", undefined],
];

const lines: string[] = [];

const channel = new MessageChannel();
const received = new Promise<void>(resolve => {
  let count = 0;
  channel.port2.onmessage = event => {
    const p: Point = event.data;
    const n: number = event.data;
    lines.push("a message, " + values[count][0] + " -> " + guarded(() => [p.x, sum(p)]) + " " + guarded(() => [n + 1 === n + 1, typeof plusOne(n)]));
    if (++count === values.length) resolve();
  };
});
for (const [, value] of values) channel.port1.postMessage(value);
await received;
channel.port1.close();
channel.port2.close();

const target = new EventTarget();
let turn = 0;
target.addEventListener("custom", event => {
  if (!(event instanceof CustomEvent)) return;
  const p: Point = event.detail;
  lines.push("a custom event, " + values[turn][0] + " -> " + guarded(() => [p.x, p.y, sum(p)]));
});
for (const [, value] of values) {
  target.dispatchEvent(new CustomEvent("custom", { detail: value }));
  turn++;
}

const emitter = new EventEmitter();
function onPoint(p: Point, n: number): void {
  lines.push("an emitter, " + values[turn][0] + " -> " + guarded(() => [p.x, sum(p)]) + " " + guarded(() => [n, plusOne(n)]));
}
emitter.on("point", onPoint);
for (let i = 0; i < 2000; i++) emitter.emit("warm", { x: i, y: 1 }, i);
turn = 0;
for (const [, value] of values) {
  emitter.emit("point", value, value);
  turn++;
}
turn = 0;
emitter.emit("point");
emitter.once("once", function (this: Point, n: number) {
  lines.push("this of a listener -> " + guarded(() => [typeof this.x, this === Object(emitter), plusOne(n)]));
});
emitter.emit("once", "1");

const message = new MessageEvent("message", { data: JSON.parse("\"text\"") });
const fromEvent: Point = message.data;
lines.push("a message event made by hand -> " + guarded(() => [fromEvent.x, sum(fromEvent)]));

const failure = new ErrorEvent("error", { error: "no error object" });
const error: Error = failure.error;
lines.push("an error event -> " + guarded(() => [typeof error, error.message]) + " " + guarded(() => error.message.length));

for (const line of lines) console.log(line);
