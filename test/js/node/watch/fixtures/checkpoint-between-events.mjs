// Prints what a listener can observe between two events of one fs.watch watcher.
// fs.watch.test.ts runs this file with Bun and with Node.js and compares the two outputs.
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "fs-watch-checkpoint-"));
const observed = {};

// The OS hands over several events at once when 40 files are written in a row.
{
  const root = path.join(base, "flat");
  fs.mkdirSync(root);
  const storage = new AsyncLocalStorage();
  const early = { nextTick: false, microtask: false, store: false };
  let events = 0;
  let nextTicks = 0;
  let microtasks = 0;
  let seenByOnceLoop = 0;
  const sawLast = Promise.withResolvers();
  const watcher = fs.watch(root);
  watcher.on("change", (_eventType, filename) => {
    if (nextTicks !== events) early.nextTick = true;
    if (microtasks !== events) early.microtask = true;
    if (storage.getStore() !== undefined) early.store = true;
    storage.enterWith(filename);
    events++;
    process.nextTick(() => nextTicks++);
    queueMicrotask(() => microtasks++);
    if (filename === "last") sawLast.resolve();
  });
  watcher.once("error", sawLast.reject);

  const stop = new AbortController();
  const onceLoop = (async () => {
    for (;;) {
      await once(watcher, "change", { signal: stop.signal });
      seenByOnceLoop++;
    }
  })().catch(() => {});

  // On macOS the watcher can start after fs.watch() returns, so the burst repeats until it is seen.
  const interval = setInterval(() => {
    for (let i = 0; i < 39; i++) fs.writeFileSync(path.join(root, `file${i}`), "x");
    fs.writeFileSync(path.join(root, "last"), "x");
  }, 20);
  try {
    await sawLast.promise;
  } finally {
    clearInterval(interval);
    watcher.close();
    stop.abort();
  }
  await onceLoop;

  observed["an event arrived before a nextTick of the event before it"] = early.nextTick;
  observed["an event arrived before a microtask of the event before it"] = early.microtask;
  observed["an event saw the enterWith() store of the event before it"] = early.store;
  observed["a loop of `await once(watcher, 'change')` saw every event"] = seenByOnceLoop === events;
}

fs.rmSync(base, { recursive: true, force: true });
console.log(JSON.stringify(observed, null, 2));
