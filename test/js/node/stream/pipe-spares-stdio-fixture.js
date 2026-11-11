// <case>: what Readable.prototype.pipe does with its destination when the source ends.
// It reports to fd 2 through node:fs, so that no case has to read process.stdout or process.stderr to report.
const { Readable, PassThrough, Writable } = require("node:stream");
const fs = require("node:fs");
const say = text => fs.writeSync(2, text + "\n");
const source = () => Readable.from(["a", "b"]);
const sink = () => { const s = new PassThrough(); s.resume(); return s; };
const after = (stream, name) => setTimeout(() => say(`${name}: ended ${stream.writableEnded}`), 20);
switch (process.argv[2]) {
  case "other-stream": { const d = sink(); source().pipe(d); after(d, "other"); break; }
  case "end-false": { const d = sink(); source().pipe(d, { end: false }); after(d, "end-false"); break; }
  case "real-stdout": { source().pipe(process.stdout); after(process.stdout, "\nstdout"); break; }
  case "real-stderr": { source().pipe(process.stderr); after(process.stderr, "\nstderr"); break; }
  case "stdout-read-first": { const d = process.stdout; const o = sink(); source().pipe(o); source().pipe(d); after(d, "\nstdout"); after(o, "other"); break; }
  case "replaced-by-value-before-any-read": { const d = sink(); Object.defineProperty(process, "stdout", { value: d, configurable: true, writable: true }); source().pipe(d); after(d, "replacement"); break; }
  case "replaced-by-value-after-a-read": { const real = process.stdout; const d = sink(); Object.defineProperty(process, "stdout", { value: d, configurable: true, writable: true }); source().pipe(d); source().pipe(real); after(d, "replacement"); after(real, "\noriginal"); break; }
  case "replaced-by-getter": { const d = sink(); let reads = 0; Object.defineProperty(process, "stderr", { get() { reads++; return d; }, configurable: true }); source().pipe(d); setTimeout(() => say(`replacement: ended ${d.writableEnded}, getter ran ${reads > 0}`), 20); break; }
  case "replaced-by-assignment": { const d = sink(); process.stdout = d; source().pipe(d); setTimeout(() => say(`replacement: ended ${d.writableEnded}, holds it ${process.stdout === d}`), 20); break; }
  case "deleted": { delete process.stdout; const d = sink(); source().pipe(d); after(d, "other"); break; }
  case "process-replaced": { const d = sink(); const real = globalThis.process; globalThis.process = { stdout: d, stderr: undefined, nextTick: real.nextTick.bind(real), emitWarning() {} }; source().pipe(d); after(d, "replacement"); break; }
  case "getter-throws": { Object.defineProperty(process, "stdout", { get() { throw new RangeError("no stdout"); }, configurable: true }); try { source().pipe(sink()); say("no throw"); } catch (e) { say(`${e.name}: ${e.message}`); } break; }
  case "process-deleted": { const d = sink(); const s = source(); delete globalThis.process; try { s.pipe(d); say("no error"); } catch (e) { say(`${e.name}: ${e.message}`); } break; }
  case "process-undefined": { const d = sink(); const s = source(); globalThis.process = undefined; try { s.pipe(d); say("no error"); } catch (e) { say(e.name); } break; }
  case "process-shadowed-by-a-global-let": { const d = sink(); const real = process; globalThis.shadow = { stdout: d, stderr: undefined, nextTick: real.nextTick.bind(real), emitWarning() {} }; require("node:vm").runInThisContext("let process = globalThis.shadow;"); source().pipe(d); after(d, "other"); break; }
  case "deleted-and-no-destination": { delete process.stdout; const s = source(); try { s.pipe(undefined); say("no error"); } catch (e) { say(`${e.name}, on end: ${s.listeners("end").map(f => f.name)}`); } break; }
  case "equal-strings": { Object.defineProperty(process, "stdout", { value: "x" + process.argv.length, configurable: true }); const s = source(); try { s.pipe("x" + process.argv.length); say("no error"); } catch (e) { say(`${e.name}, on end: ${s.listeners("end").map(f => f.name)}`); } break; }
  case "order-of-reads": { const order = []; const d = sink(); Object.defineProperty(process, "stdout", { get() { order.push("stdout"); return undefined; }, configurable: true }); Object.defineProperty(process, "stderr", { get() { order.push("stderr"); return d; }, configurable: true }); source().pipe(d, { get end() { order.push("end"); return true; } }); say(order.join()); break; }
  case "first-getter-matches": { const order = []; const d = sink(); Object.defineProperty(process, "stdout", { get() { order.push("stdout"); return d; }, configurable: true }); Object.defineProperty(process, "stderr", { get() { order.push("stderr"); return d; }, configurable: true }); source().pipe(d); say(order.join()); break; }
  case "end-false-reads-nothing": { const order = []; const d = sink(); Object.defineProperty(process, "stdout", { get() { order.push("stdout"); return d; }, configurable: true }); source().pipe(d, { end: false }); say(`reads: ${order.join()}`); break; }
  case "worker": { const { Worker } = require("node:worker_threads"); const w = new Worker(`const { Readable, PassThrough } = require("node:stream"); const d = new PassThrough(); d.resume(); Readable.from(["a"]).pipe(d); Readable.from(["w"]).pipe(process.stdout); setTimeout(() => require("node:worker_threads").parentPort.postMessage([d.writableEnded, process.stdout.writableEnded]), 30);`, { eval: true }); w.on("message", m => say(`\nworker: ${m.join()}`)); break; }
}
