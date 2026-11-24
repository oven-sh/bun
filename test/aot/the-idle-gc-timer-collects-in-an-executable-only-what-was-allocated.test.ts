// Runs alone: it judges by a clock and by the memory that a process holds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// An executable built with --aot has no JIT, and its collections are still eden and full ones. So a tick of the idle GC
// timer asks for an eden collection, and JSC turns the tick down if that collection would have nothing to sweep
// (Heap::collectAsyncIfNecessary()). Before, such an executable got a collection at every tick, and its collector
// skipped the marking of the ones that found nothing allocated, and with it what a collection drops that is not a cell.
const program = `
const mode = process.argv[2];
const holder = { n: 0 };
if (mode === "allocates") setInterval(() => void (holder.kept = { a: 1 }), 100);
if (mode === "strings") {
  // A string that is looked up as a property key takes the characters of the atom with the same text, and JSC parks
  // the string's own characters. Each key is an atom, and each string of "copies" has its own copy of its characters.
  const rss = () => process.memoryUsage.rss() / 1048576;
  const text = (i, length) => Buffer.alloc(length, "key" + i + ",").toString();
  function build(count, length) {
    const keys = {};
    const copies = [];
    for (let i = 0; i < count; i++) {
      keys[text(i, length)] = i;
      copies.push(text(i, length));
    }
    return { keys, copies };
  }
  function lookUp({ keys, copies }) {
    for (let i = 0; i < copies.length; i++) holder.n += keys[copies[i]];
  }
  // lookUp() makes here what a function allocates when it first runs.
  for (let round = 0; round < 40; round++) lookUp(build(2048, 8));
  const big = build(2048, 16384); // 32 MB of characters, twice
  setTimeout(() => {
    Bun.gc(true);
    holder.before = rss();
  }, 300);
  setTimeout(lookUp, 700, big);
  setTimeout(() => console.log(JSON.stringify({ released: Math.round(holder.before - rss()), sum: holder.n })), 2400);
}
setTimeout(() => console.error("MARK"), 500);
setTimeout(() => {
  console.error("DONE");
  process.exit(0);
}, 2500);
`;

test("the idle GC timer collects in an executable only when the program allocated", async () => {
  using dir = tempDir("aot-idle-gc-timer", { "main.cjs": program });
  const folder = String(dir);
  const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildStderr, buildExitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({
    stderr: buildStderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: buildExitCode,
  }).toEqual({ stderr: [], exitCode: 0 });

  // 20 ticks pass between the two marks. With two GC markers a collection that lets the program run on before it ends
  // is finished by the next tick on every machine.
  async function run(mode: string) {
    await using ran = Bun.spawn({
      cmd: [executable, mode],
      env: {
        ...bunEnv,
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_GC_TIMER_INTERVAL: "100",
        BUN_IDLE_GC_SECONDS: "0",
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_JSC_numberOfGCMarkers: "2",
        BUN_JSC_logGC: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
    expect(exitCode, stderr).toBe(0);
    const mark = stderr.indexOf("MARK");
    const done = stderr.indexOf("DONE");
    expect(mark, stderr).toBeGreaterThanOrEqual(0);
    expect(done, stderr).toBeGreaterThan(mark);
    return { collections: stderr.slice(mark, done).match(/=> (Eden|Full)Collection/g) ?? [], stdout, stderr };
  }

  const [idle, allocates, strings] = await Promise.all([run("idle"), run("allocates"), run("strings")]);
  expect(idle.collections.length, idle.stderr).toBeLessThanOrEqual(3);
  // On a debug or ASAN build a collection takes longer than a tick, and the memory of a process is not its own.
  if (isASAN || isDebug) return;
  expect(allocates.collections.length, allocates.stderr).toBeGreaterThanOrEqual(6);
  // A tick that JSC turns down drops the characters that the strings left behind. Every string found its key: 40
  // rounds and the one after them, each the sum of 0 to 2047.
  const { released, sum } = JSON.parse(strings.stdout);
  expect(sum).toBe(41 * ((2047 * 2048) / 2));
  if (isLinux) expect(released).toBeGreaterThan(16);
});
