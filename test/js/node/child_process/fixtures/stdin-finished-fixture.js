// Where the callback of stream.finished(child.stdin) runs, against the events of the stream.
// One cell is a call on child.stdin, the place that makes the call, whether child.stdin was read at
// spawn or first at the call, and how much later finished() is called. A cell logs, in order: the
// stream's 'finish', 'close' and 'error', the callback with its argument, a tick queued right behind
// finished(), and an immediate queued right behind the call.
//   LIST=1   prints the names of the cells as JSON.
//   CELL=<n> runs cell n from the main script and prints its log. One process per cell keeps the
//            place true: cells that share a process start where the one before ended.
//   FLAGS=1  adds the state of the stream when finished() is called.
// `node stdin-finished-fixture.js` with CELL set prints the log of Node.js.
"use strict";
const { spawn } = require("node:child_process");
const { finished } = require("node:stream");
const fs = require("node:fs");

const calls = [
  ['end("abc")', s => s.end("abc")],
  ["end()", s => s.end()],
  ["destroy()", s => s.destroy()],
  ['end("abc"); destroy()', s => (s.end("abc"), s.destroy())],
  ["destroy(error)", s => s.destroy(new Error("given"))],
];

const places = [
  ["main script", (child, run) => run()],
  ["tick", (child, run) => process.nextTick(run)],
  ["promise job", (child, run) => Promise.resolve().then(run)],
  ["'spawn' listener", (child, run) => child.once("spawn", run)],
  ["timer", (child, run) => child.once("spawn", () => setTimeout(run, 1))],
  ["immediate", (child, run) => child.once("spawn", () => setImmediate(run))],
  ["fs callback", (child, run) => child.once("spawn", () => fs.stat(__filename, run))],
  ["'data' listener", (child, run) => child.stdout.once("data", run)],
];

const distances = [
  ["before the call", null],
  ["after the call", register => register()],
  ["one tick later", register => process.nextTick(register)],
  ["one promise job later", register => Promise.resolve().then(register)],
  ["one immediate later", register => setImmediate(register)],
  ["after 'close'", null],
];

const withFlags = process.env.FLAGS === "1";
const only = process.env.ONLY;

function flagsOf(stream) {
  const state = stream._writableState;
  return `[closed ${stream.closed} destroyed ${stream.destroyed} ended ${stream.writableEnded} finished ${stream.writableFinished} pendingcb ${state.pendingcb} constructed ${state.constructed} emitClose ${state.emitClose}]`;
}

function cell(call, place, distance, touched) {
  return new Promise(resolve => {
    const log = [];
    const child = spawn("sh", ["-c", "echo ready; exec cat"], { stdio: ["pipe", "pipe", "inherit"] });
    child.stdout.on("data", () => {});
    let stream;
    let fired = false;
    let closed = false;
    let exited = false;
    let done = false;
    const mark = s => {
      stream = s;
      s.on("error", e => log.push("error " + (e.code || e.message)));
      s.on("finish", () => log.push("finish"));
      s.on("close", () => {
        log.push("close");
        closed = true;
        maybeDone();
      });
    };
    const register = () => {
      if (withFlags) log.push(flagsOf(stream));
      finished(stream, err => {
        log.push("finished " + (err ? err.code || err.message : "ok"));
        fired = true;
        maybeDone();
      });
      process.nextTick(() => log.push("tick"));
    };
    const run = () => {
      if (!touched) mark(child.stdin);
      if (distance[0] === "before the call") register();
      call[1](stream);
      setImmediate(() => log.push("immediate"));
      if (distance[0] === "after 'close'") stream.once("close", () => process.nextTick(register));
      else if (distance[1]) distance[1](register);
    };
    if (touched) mark(child.stdin);
    place[1](child, run);
    child.on("close", () => {
      exited = true;
      maybeDone();
    });
    const timer = setTimeout(() => finish("did not settle"), 5000);
    function maybeDone() {
      if (fired && closed && exited) setImmediate(() => setImmediate(() => finish()));
    }
    function finish(why) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (why) log.push(why);
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(log.join(", "));
    }
  });
}

const cells = [];
for (const call of calls) {
  for (const place of places) {
    for (const touched of [false, true]) {
      if (touched && place[0] === "main script") continue;
      for (const distance of distances) {
        const name = `${call[0]} | ${place[0]} | ${touched ? "stdin read at spawn" : "stdin first read at the call"} | finished() ${distance[0]}`;
        cells.push([name, call, place, distance, touched]);
      }
    }
  }
}

if (process.env.LIST === "1") {
  process.stdout.write(JSON.stringify(cells.map(c => c[0])) + "\n");
} else if (process.env.CELL !== undefined) {
  // One cell per process: the call site really is what its name says, from the main script on.
  const [, call, place, distance, touched] = cells[Number(process.env.CELL)];
  cell(call, place, distance, touched).then(log => process.stdout.write(log + "\n"));
} else {
  // All cells in one process. Each cell then starts where the one before ended: in an immediate.
  (async () => {
    const report = {};
    for (const [name, call, place, distance, touched] of cells) {
      if (only && !name.includes(only)) continue;
      report[name] = await cell(call, place, distance, touched);
    }
    process.stdout.write(JSON.stringify(report, null, 1) + "\n");
  })();
}
