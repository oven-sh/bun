// Opens four watchers below argv[2], gives fs.watch batches of FSEvents
// events, and prints what each watcher reported for each step.
import { fsEventsInject } from "bun:internal-for-testing";
import fs from "node:fs";
import path from "node:path";

// kFSEventStreamEventFlag* from <CoreServices/FSEvents.h>.
const MustScanSubDirs = 0x1;
const UserDropped = 0x2;
const KernelDropped = 0x4;
const ItemCreated = 0x100;
const ItemIsFile = 0x10000;
const dropped = MustScanSubDirs | UserDropped;
const created = ItemCreated | ItemIsFile;

const root = fs.realpathSync(process.argv[2]);
const tree = path.join(root, "tree");
const sub = path.join(tree, "sub");
const other = path.join(root, "other");

type Seen = [eventType: string, filename: string | null];
const seen: Record<string, Seen[]> = {};
let marker = Promise.withResolvers<void>();
let markerName = "";
let reports = 0;
const secondReport = Promise.withResolvers<void>();

// FSEvents can still deliver the creation of these directories after the
// stream starts. So a watcher records only what such an event cannot be: no
// name, the name of its own directory, or an injected name.
function watch(who: string, target: string, options: fs.WatchOptions) {
  seen[who] = [];
  const watcher = fs.watch(target, options, (eventType, filename) => {
    const name = filename === null ? null : String(filename);
    if (name === markerName) {
      if (who === "recursive") marker.resolve();
      return;
    }
    if (name === null && who === "recursive" && ++reports === 2) secondReport.resolve();
    if (name === null || name === path.basename(target) || name.includes("injected")) {
      seen[who].push([eventType, name]);
    }
  });
  watcher.on("error", error => {
    console.error(who, error);
    process.exit(1);
  });
  return watcher;
}

const watchers = [
  watch("recursive", tree, { recursive: true }),
  // A second listener on the same native watcher.
  watch("buffer", tree, { recursive: true, encoding: "buffer" }),
  watch("parent", root, {}),
  watch("sibling", other, {}),
];

// fsEventsInject reports a batch to every watcher before it returns, and a
// watcher's events reach its listener in the order they were reported. So
// when the recursive watcher has the marker, every watcher has what came
// before it.
let markers = 0;
async function settled() {
  markerName = `marker-${++markers}`;
  marker = Promise.withResolvers<void>();
  fsEventsInject(path.join(tree, markerName), created);
  await marker.promise;
  const result = structuredClone(seen);
  for (const events of Object.values(seen)) events.length = 0;
  return result;
}

const steps: Record<string, Record<string, Seen[]>> = {};

// No await between these: they are all inside one report interval.
fsEventsInject(tree, dropped);
fsEventsInject("/", KernelDropped);
fsEventsInject(tree, dropped, root, dropped, other, dropped);
fsEventsInject(path.join(sub, "injected-a"), created, tree, dropped, path.join(sub, "injected-b"), created);
// The deadline only ends the wait on a build that never makes the second report.
await Promise.race([secondReport.promise, Bun.sleep(2500)]);
steps["four dropped batches"] = await settled();

fsEventsInject(path.join(sub, "injected"), created);
steps["a created file"] = await settled();

for (const watcher of watchers) watcher.close();
console.log(JSON.stringify(steps));
