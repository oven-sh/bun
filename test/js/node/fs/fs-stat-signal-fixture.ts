// fs-stat-signal.test.ts runs this under Bun and under Node.js: each function that a program can replace throws, and the output says what a stat with a signal gave and how often a replacement ran.
const file = process.env.STAT_SIGNAL_FILE!;

function replaceAll() {
  const calls: Record<string, number> = {};
  const restores: (() => void)[] = [];
  const targets: [any, string, string][] = [
    [Promise, "resolve", "Promise.resolve"],
    [Promise, "race", "Promise.race"],
    [String.prototype, "indexOf", "String.prototype.indexOf"],
    [String.prototype, "includes", "String.prototype.includes"],
  ];
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
let replaced = replaceAll();
const fs: any = await import("node:fs");
const fsp = fs.promises;
const live = () => ({ signal: new AbortController().signal });
const aborted = () => ({ signal: AbortSignal.abort() });

async function everyForm() {
  const handle = await fsp.open(file, "r");
  try {
    return {
      "fsPromises.stat": await outcome(() => fsp.stat(file, live())),
      "fsPromises.lstat": await outcome(() => fsp.lstat(file, live())),
      "filehandle.stat": await outcome(() => handle.stat(live())),
      // The callback forms look at the path when the signal is already aborted.
      "fs.stat": calledBackWith(callback => fs.stat(file, aborted(), callback)),
      "fs.lstat": calledBackWith(callback => fs.lstat(file, aborted(), callback)),
      "fs.stat, null byte in the path": calledBackWith(callback => fs.stat("a\0b", aborted(), callback)),
    };
  } finally {
    await handle.close();
  }
}

const beforeLoad = { results: await everyForm(), calls: { ...replaced.calls } };
replaced.restore();

replaced = replaceAll();
const afterLoad = { results: await everyForm(), calls: { ...replaced.calls } };
replaced.restore();

console.log(JSON.stringify({ beforeLoad, afterLoad }));
