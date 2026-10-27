// Prints what a listener can observe between two events of one fs.watch watcher.
// fs.watch.test.ts runs this file with Bun and with Node.js and compares the two outputs.
// argv[2] is an empty directory to work in. The caller removes it.
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2];
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

// Node's recursive watcher on Linux reports a new directory and the entries it finds in it from
// one callback, so nothing runs between those events. The event after them is a callback of its own.
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/recursive_watch.js#L224-L238
if (process.platform === "linux") {
  const root = path.join(base, "tree");
  const moved = path.join(base, "outside", "moved");
  fs.mkdirSync(root);
  fs.mkdirSync(moved, { recursive: true });
  for (const name of ["a", "b", "c"]) fs.writeFileSync(path.join(moved, name), "x");
  fs.writeFileSync(path.join(root, "gone"), "x");
  const early = { inside: false, after: false };
  let events = 0;
  let nextTicks = 0;
  const sawGone = Promise.withResolvers();
  const watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
    if (filename === "gone") {
      if (nextTicks !== events) early.after = true;
      sawGone.resolve();
    } else if (events < 4 && nextTicks !== 0) {
      early.inside = true;
    }
    events++;
    process.nextTick(() => nextTicks++);
  });
  watcher.once("error", sawGone.reject);
  try {
    fs.renameSync(moved, path.join(root, "moved"));
    fs.unlinkSync(path.join(root, "gone"));
    await sawGone.promise;
  } finally {
    watcher.close();
  }

  observed["a nextTick ran between the events of a directory moved into a recursive watcher"] = early.inside;
  observed["the event after that directory arrived before a nextTick of its events"] = early.after;
}

console.log(JSON.stringify(observed, null, 2));
