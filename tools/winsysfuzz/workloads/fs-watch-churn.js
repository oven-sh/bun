// fs.watch churn: the field's #1 actionable crash on Windows is a segfault
// under uv__process_fs_event_req - a directory-change completion delivered
// into a watcher that is already gone (use-after-free of the watcher
// context). This workload lives on that race: watchers created and closed
// rapidly while a writer storms the watched trees, watchers closed WITH
// events still in flight, watched directories deleted out from under live
// watchers, and recursive watches over churning subtrees. Fault delays on
// the completion path widen the close-vs-completion window; page heap
// turns the UAF into an immediate crash instead of a wild-pointer read.
import {
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
console.log("STAGE: setup");
const root = "wsf-watch";
mkdirSync(root, { recursive: true });
const dirs = Array.from({ length: 4 }, (_, i) => join(root, `d${i}`));
for (const d of dirs) mkdirSync(join(d, "sub"), { recursive: true });
let events = 0;
let errors = 0;
const opened = [];

// A writer that never stops churning the trees: creates, renames,
// unlinks - every one a change notification some watcher must process.
console.log("STAGE: churn");
let seq = 0;
const churn = setInterval(() => {
  for (const d of dirs) {
    const f = join(d, `f${seq}.txt`);
    try {
      writeFileSync(f, "x".repeat(50));
      renameSync(f, f + ".renamed");
      writeFileSync(join(d, "sub", `s${seq}.txt`), "y");
      if (seq % 3 === 0) unlinkSync(f + ".renamed");
    } catch {}
  }
  seq++;
}, 1);

// Watcher lifecycle churn: open watchers (some recursive), let a few events
// arrive, close them - deliberately closing while completions may still be
// pending. That close-vs-completion window is the race.
const openWatcher = (dir, recursive) => {
  try {
    const w = watch(dir, { recursive }, () => {
      events++;
    });
    w.on("error", () => {
      errors++;
    });
    opened.push(w);
    return w;
  } catch (e) {
    errors++;
    return null;
  }
};
for (let round = 0; round < 40; round++) {
  const ws = [];
  for (const [i, d] of dirs.entries()) {
    ws.push(openWatcher(d, i % 2 === 0));
    ws.push(openWatcher(join(d, "sub"), false));
  }
  // brief window for events to be in flight (poll-free: a couple of ticks)
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  // close every other watcher immediately, keep the rest a beat longer
  for (const [i, w] of ws.entries()) {
    if (w && i % 2 === 0) {
      try {
        w.close();
      } catch {}
    }
  }
  await new Promise(r => setTimeout(r, 3));
  for (const [i, w] of ws.entries()) {
    if (w && i % 2 === 1) {
      try {
        w.close();
      } catch {}
    }
  }
}

// Delete a watched directory out from under a LIVE watcher: the watcher's
// handle is torn down by the OS mid-flight.
console.log("STAGE: rug-pull");
const doomed = join(root, "doomed");
mkdirSync(doomed, { recursive: true });
const dw = openWatcher(doomed, true);
writeFileSync(join(doomed, "a.txt"), "z");
await new Promise(r => setImmediate(r));
try {
  rmSync(doomed, { recursive: true, force: true });
} catch {}
await new Promise(r => setTimeout(r, 20));
if (dw) {
  try {
    dw.close();
  } catch {}
}

console.log("STAGE: teardown");
clearInterval(churn);
// close anything still open, then let the loop drain pending completions
for (const w of opened) {
  try {
    w.close();
  } catch {}
}
await new Promise(r => setTimeout(r, 30));
console.log(`fs-watch-churn ok events=${events} errors=${errors} seq=${seq}`);
