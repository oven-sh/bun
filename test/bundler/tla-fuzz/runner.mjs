// Usage: node runner.mjs <abs path of entry module> [pumpDelayMs]
// Installs the tracing globals, import()s the entry, prints the trace as JSON at exit.
import { pathToFileURL } from "node:url";
const trace = [];
const unhandled = [];
const TICKS = 48;
globalThis.__log = s => void trace.push(s);
let started = false;
globalThis.__start = () => {
  if (started) return;
  started = true;
  if (process.env.NO_TICKER) return;
  let i = 0;
  const t = () => {
    if (i++ < TICKS) {
      trace.push("|");
      Promise.resolve().then(t);
    }
  };
  Promise.resolve().then(t);
};
globalThis.__probe = (tag, d) => {
  let i = 0;
  const t = () => {
    trace.push(tag + "~" + i);
    if (++i < d) Promise.resolve().then(t);
  };
  Promise.resolve().then(t);
};
globalThis.__tick = n => {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => {});
  return p;
};
// What a value that a module made out of its imports holds, without names that a bundler may change.
globalThis.__show = x =>
  typeof x === "function"
    ? "K" + (Object.hasOwn(x, "id") ? x.id + ">" + __show(Object.getPrototypeOf(x)) : "")
    : Array.isArray(x)
      ? "(" + x.map(__show).join(" ") + ")"
      : x && typeof x === "object"
        ? x.id + __show(x.a) + __show(x.lazy())
        : String(x);
const chans = {};
const chan = c =>
  (chans[c] ??= (() => {
    let r;
    const p = new Promise(x => (r = x));
    return { p, r };
  })());
globalThis.__chan = c => chan(c).p;
globalThis.__fire = c => chan(c).r();
// Deterministic virtual clock: one timer fires per macrotask, earliest (time, seq) first.
const pumpDelay = Number(process.argv[3] ?? 0);
let vnow = 0,
  seq = 0,
  pumping = false;
const q = [];
const schedule = () => {
  if (!pumping) {
    pumping = true;
    setTimeout(pump, pumpDelay);
  }
};
function pump() {
  pumping = false;
  if (!q.length) return;
  q.sort((a, b) => a.t - b.t || a.s - b.s);
  const e = q.shift();
  vnow = e.t;
  trace.push("@" + vnow);
  e.r();
  if (q.length) schedule();
}
globalThis.__sleep = k =>
  new Promise(r => {
    q.push({ t: vnow + k, s: seq++, r });
    schedule();
  });
process.on("unhandledRejection", e => void unhandled.push(String(e?.message ?? e)));
process.on("uncaughtException", e => void unhandled.push("uncaught:" + String(e?.message ?? e)));
let result = "PENDING";
process.on("exit", () => {
  process.stdout.write(JSON.stringify({ trace, result, unhandled }) + "\n");
});
import(pathToFileURL(process.argv[2]).href).then(
  () => {
    result = "OK";
    trace.push("<OK>");
  },
  e => {
    result = "ERR " + (e?.message ?? e);
    trace.push("<" + result + ">");
  },
);
