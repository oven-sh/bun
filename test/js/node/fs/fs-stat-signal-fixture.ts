// fs-stat-signal.test.ts runs this under Bun and under Node.js: each function that a program can replace throws, and the output says what a stat with a signal gave and how often a replacement ran.
const file = process.env.STAT_SIGNAL_FILE!;
const missing = `${file}.missing`;

type Target = [owner: any, key: string, label: string];
const beforeTheLoad: Target[] = [
  [Promise, "resolve", "Promise.resolve"],
  [Promise, "race", "Promise.race"],
  [String.prototype, "indexOf", "String.prototype.indexOf"],
  [String.prototype, "includes", "String.prototype.includes"],
];
// A module loader may call these two, so they are replaced only after the load.
const afterTheLoad: Target[] = [
  ...beforeTheLoad,
  [globalThis, "Symbol", "Symbol"],
  [globalThis, "queueMicrotask", "queueMicrotask"],
];

function replaceAll(targets: Target[]) {
  const calls: Record<string, number> = {};
  const restores: (() => void)[] = [];
  for (const [owner, key, label] of targets) {
    const original = owner[key];
    calls[label] = 0;
    owner[key] = function () {
      calls[label]++;
      throw new RangeError("replaced");
    };
    restores.push(() => void (owner[key] = original));
  }
  return { calls, restore: () => restores.forEach(restore => restore()) };
}

async function outcome(call: () => Promise<any>) {
  try {
    const stats = await call();
    return stats && typeof stats.isFile === "function" ? "Stats" : typeof stats;
  } catch (e: any) {
    return e.code || `${e.name}: ${e.message}`;
  }
}

function calledBackWith(call: (callback: (error: Error | null) => void) => void) {
  let name = "no callback";
  try {
    call(error => void (name = error ? error.name : "no error"));
    return name;
  } catch (e: any) {
    return e.code || `${e.name}: ${e.message}`;
  }
}

// The first load of node:fs sees the replacements. `signal` is not in the types of @types/node yet.
let replaced = replaceAll(beforeTheLoad);
const fs: any = await import("node:fs");
const fsp = fs.promises;
const live = () => ({ signal: new AbortController().signal });
const aborted = () => ({ signal: AbortSignal.abort() });
function abortsWhileRead() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    get bigint() {
      controller.abort();
      return false;
    },
  };
}

async function everyForm(handle: any) {
  return {
    "fsPromises.stat": await outcome(() => fsp.stat(file, live())),
    "fsPromises.lstat": await outcome(() => fsp.lstat(file, live())),
    "filehandle.stat": await outcome(() => handle.stat(live())),
    "fsPromises.stat, aborted while its options are read": await outcome(() => fsp.stat(file, abortsWhileRead())),
    // The callback forms look at the path when the signal is already aborted.
    "fs.stat": calledBackWith(callback => fs.stat(file, aborted(), callback)),
    "fs.lstat": calledBackWith(callback => fs.lstat(file, aborted(), callback)),
    "fs.stat, null byte in the path": calledBackWith(callback => fs.stat("a\0b", aborted(), callback)),
  };
}

let handle = await fsp.open(file, "r");
const beforeLoad = { results: await everyForm(handle), calls: { ...replaced.calls } };
replaced.restore();
await handle.close();

handle = await fsp.open(file, "r");
replaced = replaceAll(afterTheLoad);
const afterLoad = { results: await everyForm(handle), calls: { ...replaced.calls } };
replaced.restore();
await handle.close();

// A stat with a signal that fails or is aborted, with no handler on its promise, is still reported.
const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason: any) => void unhandled.push(reason?.code));
for (const stat of [fsp.stat, fsp.lstat]) {
  stat(missing, live());
  const controller = new AbortController();
  stat(file, { signal: controller.signal });
  controller.abort();
}
// The four stats keep the process alive until each one has ended and its rejection is reported.
process.once("beforeExit", () => {
  console.log(JSON.stringify({ beforeLoad, afterLoad, unhandled: unhandled.sort() }));
});
