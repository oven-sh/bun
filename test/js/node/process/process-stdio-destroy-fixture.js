// Runs each destroy() scenario on process.stdout, then on process.stderr, and writes the events each one saw as JSON
// to the file named by argv[2]. The same file runs under Node.
"use strict";
const fs = require("node:fs");

let events;
process.on("uncaughtException", err => events.push(`uncaughtException ${err.message}`));

const scenarios = {
  "destroy()"(stream) {
    stream.destroy();
  },
  "destroy(err), 'error' listener"(stream, on) {
    on("error", err => events.push(`error ${err.message}`));
    stream.destroy(new Error("boom"));
  },
  "destroy(err), no 'error' listener"(stream) {
    stream.destroy(new Error("boom"));
  },
  "destroy(err), 'error' listener throws"(stream, on) {
    on("error", err => {
      events.push(`error ${err.message}`);
      throw new Error("thrown by the listener");
    });
    stream.destroy(new Error("boom"));
  },
  "destroy(err, callback), no 'error' listener"(stream) {
    stream.destroy(new Error("boom"), err => events.push(`callback ${err.message}`));
  },
  "destroy(err) twice, no 'error' listener"(stream) {
    stream.destroy(new Error("first"));
    stream.destroy(new Error("second"));
  },
  "destroy(err) again from the 'close' listener"(stream, on) {
    let again = true;
    on("close", () => {
      if (again) stream.destroy(new Error("second"));
      again = false;
    });
    stream.destroy(new Error("first"));
  },
  "destroy(err) between two ticks, no 'error' listener"(stream) {
    process.nextTick(() => events.push("tick queued before destroy"));
    stream.destroy(new Error("boom"));
    process.nextTick(() => events.push("tick queued after destroy"));
  },
};

async function run(stream) {
  const seen = { emitClose: stream._writableState.emitClose };
  for (const name in scenarios) {
    events = seen[name] = [];
    const listeners = [];
    const on = (event, listener) => {
      listeners.push([event, listener]);
      stream.on(event, listener);
    };
    on("close", (...args) => events.push(["close", ...args].join(" ")));
    scenarios[name](stream, on);
    // 'close' comes from a tick, so every event of this scenario is in before an immediate runs.
    await new Promise(resolve => setImmediate(resolve));
    for (const [event, listener] of listeners) stream.off(event, listener);
  }
  return seen;
}

(async () => {
  const stdout = await run(process.stdout);
  const stderr = await run(process.stderr);
  fs.writeFileSync(process.argv[2], JSON.stringify({ stdout, stderr }));
})();
