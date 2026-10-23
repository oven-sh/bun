import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const files = {
  "main.cjs": String.raw`
const http = require("node:http");
const net = require("node:net");
const stream = require("node:stream");
const takesGeneralRoad = process.argv[2] === "general";
const bit = value => (value === true ? "1" : value === false ? "0" : value === null ? "n" : value === undefined ? "u" : "[" + String(value) + "]");
const brief = value => (value === null || (typeof value !== "object" && typeof value !== "function") ? String(value) : Array.isArray(value) ? "[" + value.length + "]" : typeof value);
function digest(object) {
  let hash = 5381;
  for (const key of Reflect.ownKeys(object)) {
    if (key === "resume") continue;
    const found = Object.getOwnPropertyDescriptor(object, key);
    const text = String(key) + "=" + ("value" in found ? brief(found.value) : "accessor") + ";";
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}
let lines = [];
const say = text => lines.push(text);
function sample(req, tag) {
  const state = req._readableState;
  const socket = req.socket;
  say(
    tag + " " +
      [req.complete, req._dumped, req._consuming, req.readable, req.readableFlowing, req.readableEnded, req.readableDidRead, req.destroyed, req.closed, req.aborted, req.readableAborted, req.isPaused(), req.readableLength].map(bit).join("") + " " +
      [state.ended, state.endEmitted, state.reading, state.sync, state.needReadable, state.emittedReadable, state.readableListening, state.resumeScheduled, state.readingMore, state.dataEmitted, state.destroyed, state.closed, state.closeEmitted, state.errorEmitted, state.flowing, state.constructed, state.length].map(bit).join("") + " " +
      [socket == null ? socket : socket.parser == null ? socket.parser : socket.parser.incoming === req, socket && socket.readableFlowing, socket && socket.isPaused(), socket && socket.destroyed].map(bit).join("") + " " +
      req.eventNames().map(String).join() + " " + Object.getOwnPropertySymbols(req).length + " " + Object.keys(req).filter(name => name !== "resume").length + " " + digest(req) + " " + digest(state),
  );
}
const events = ["readable", "data", "end", "close", "error", "pause", "resume", "aborted"];
const listen = (req, name) => req.on(name, argument => say("  event " + name + (argument === undefined ? "" : " " + String(argument))));
const actions = {
  nothing() {},
  ...Object.fromEntries(events.map(name => ["on " + name, req => listen(req, name)])),
  "on all"(req) { for (const name of events) listen(req, name); },
  "once end, once close"(req) { req.once("end", () => say("  once end")); req.once("close", () => say("  once close")); },
  "read()"(req) { say("  read " + req.read()); },
  "read(0)"(req) { say("  read " + req.read(0)); },
  "pause()"(req) { req.pause(); },
  "resume()"(req) { req.resume(); },
  "pause() resume()"(req) { req.pause(); req.resume(); },
  "destroy()"(req) { req.destroy(); },
  "destroy(error)"(req) { listen(req, "error"); req.destroy(new Error("mine")); },
  "unshift"(req) { listen(req, "error"); try { req.unshift(Buffer.from("x")); } catch (error) { say("  throws " + error.code); } },
  "push"(req) { listen(req, "error"); try { say("  push " + req.push(Buffer.from("x"))); } catch (error) { say("  throws " + error.code); } },
  "push(null)"(req) { say("  push " + req.push(null)); },
  "setEncoding"(req) { req.setEncoding("utf8"); },
  "pipe"(req) { req.pipe(new stream.Writable({ write(chunk, encoding, callback) { say("  written"); callback(); }, final(callback) { say("  final"); callback(); } })); },
  "finished"(req) { stream.finished(req, error => say("  finished " + (error ? error.code : "well"))); },
  "for await"(req) { (async () => { try { for await (const chunk of req) say("  chunk"); say("  iterated"); } catch (error) { say("  iteration throws " + error.code); } })(); },
  "removeAllListeners"(req) { req.removeAllListeners(); },
  "_dump()"(req) { req._dump(); },
  "emit replaced"(req) { const emit = req.emit; req.emit = function (name) { say("  emit " + String(name)); return emit.apply(this, arguments); }; },
  "read replaced"(req) { const read = req.read; req.read = function (n) { say("  read called " + n); return read.call(this, n); }; },
  "_read replaced"(req) { const read = req._read; req._read = function (n) { say("  _read called"); return read.call(this, n); }; },
  "push replaced"(req) { const push = req.push; req.push = function (chunk) { say("  push called " + chunk); return push.call(this, chunk); }; },
  "destroy replaced"(req) { const destroy = req.destroy; req.destroy = function (error) { say("  destroy called"); return destroy.call(this, error); }; },
  "_destroy replaced"(req) { const destroy = req._destroy; req._destroy = function (error, callback) { say("  _destroy called"); return destroy.call(this, error, callback); }; },
  "resume replaced"(req) { const resume = req.resume; req.resume = function () { say("  resume called"); return resume.call(this); }; },
  "listenerCount replaced"(req) { const listenerCount = req.listenerCount; req.listenerCount = function (name) { say("  listenerCount called " + String(name)); return listenerCount.call(this, name); }; },
  "removeAllListeners replaced"(req) { const removeAllListeners = req.removeAllListeners; req.removeAllListeners = function (name) { say("  removeAllListeners called " + String(name)); return removeAllListeners.call(this, name); }; },
  "complete = false"(req) { req.complete = false; },
  "_consuming = true"(req) { req._consuming = true; },
  "writable = true"(req) { req.writable = true; },
  "state.emitClose = false"(req) { req._readableState.emitClose = false; },
  "state.autoDestroy = false"(req) { req._readableState.autoDestroy = false; },
  "state.flowing = false"(req) { req._readableState.flowing = false; },
  "state.ended = true"(req) { req._readableState.ended = true; },
  "another state"(req) { req._readableState = new stream.Readable()._readableState; },
  "socket.destroy()"(req) { req.socket?.destroy(); },
  "socket.resume replaced"(req) { const socket = req.socket; if (!socket) return; const resume = socket.resume; socket.resume = function () { say("  socket.resume called"); return resume.call(this); }; },
  "socket.pause()"(req) { req.socket?.pause(); },
  "socket = null"(req) { req.socket = null; },
  "another prototype"(req) { Object.setPrototypeOf(req, Object.create(http.IncomingMessage.prototype)); },
};
process.on("uncaughtException", error => say("  UNCAUGHT " + String(error && error.name)));
const TICKS = 9;
let current;
const server = http.createServer((req, res) => {
  const { action, at } = current;
  const connection = req.socket;
  if (takesGeneralRoad) {
    const { resume } = req;
    req.resume = function () {
      return resume.call(this);
    };
  }
  if (at === -1) actions[action](req);
  sample(req, "handler");
  let hasFinished = false;
  res.on("finish", () => {
    hasFinished = true;
    step(0);
  });
  res.on("close", () => {
    if (hasFinished) return;
    sample(req, "closed");
    setImmediate(current.done, true);
  });
  function step(k) {
    sample(req, "tick " + k);
    if (k === at) actions[action](req);
    if (k < TICKS) process.nextTick(step, k + 1);
    else setImmediate(() => { sample(req, "later"); current.done(connection.destroyed); });
  }
  res.end("ok");
  if (at === -2) actions[action](req);
});
function request(socket) {
  return new Promise(resolve => {
    let text = "";
    const onData = chunk => { text += chunk; if (text.endsWith("ok")) { socket.off("data", onData); resolve(); } };
    socket.on("data", onData);
    socket.on("close", resolve);
    socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
}
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (const action of Object.keys(actions)) {
    for (let at = -2; at <= 6; at++) {
      if (action === "nothing" && at !== 0) continue;
      const socket = net.connect(port, "127.0.0.1");
      socket.setEncoding("latin1");
      socket.on("error", () => {});
      await new Promise(resolve => socket.on("connect", resolve));
      for (let round = 0; round < 2; round++) {
        lines = [];
        const done = new Promise(resolve => (current = { action, at, done: resolve }));
        const answered = request(socket);
        const ended = await Promise.race([Promise.all([done, answered]), new Promise(resolve => setTimeout(resolve, 5000, "late"))]);
        if (ended === "late") say("  LATE");
        console.log("== " + action + " at " + at + ", request " + round + "\n" + lines.join("\n"));
        if (ended === "late" || ended[0] || socket.destroyed) break;
      }
      socket.destroy();
    }
  }
  server.close();
  server.closeAllConnections();
});
`,
};

function firstDifference(a: string, b: string) {
  if (a === b) return "";
  const left = a.split("\n");
  const right = b.split("\n");
  let scene = "";
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]?.startsWith("== ")) scene = left[i];
    if (left[i] !== right[i]) return [scene, left[i], right[i]].join("\n");
  }
  return "";
}

test.skipIf(!!unsupported)(
  "a request without a body ends the same whether or not anybody watches it",
  async () => {
    using dir = tempDir("aot-request-without-a-body", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const compiledEnv = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
    const [general, plain, compiledGeneral, compiled] = await Promise.all([
      run([bunExe(), "run", "main.cjs", "general"], String(dir), bunEnv),
      run([bunExe(), "run", "main.cjs"], String(dir), bunEnv),
      run([executable, "general"], String(dir), compiledEnv),
      run([executable], String(dir), compiledEnv),
    ]);
    expect([general.exitCode, plain.exitCode, compiledGeneral.exitCode, compiled.exitCode]).toEqual([0, 0, 0, 0]);
    expect(general.stdout.split("\n").filter(line => line.startsWith("== ")).length).toBeGreaterThan(800);
    expect(firstDifference(general.stdout, plain.stdout)).toBe("");
    expect(firstDifference(general.stdout, compiledGeneral.stdout)).toBe("");
    expect(firstDifference(general.stdout, compiled.stdout)).toBe("");
  },
  240_000,
);
