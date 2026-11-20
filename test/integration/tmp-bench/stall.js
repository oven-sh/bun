// Usage: bun stall.js <old> <new> <variant;...>   With every CPU busy: who waits while a child streams to its parent, and at which priority.
const fs = require("fs"), MB = 1 << 20, TOTAL = +(process.env.TOTAL ?? 128) * MB, now = () => performance.now();
function watcher() {
  const nt = require("bun:ffi").dlopen("ntdll.dll", { NtQueryInformationThread: { args: ["i64", "u32", "ptr", "u32", "ptr"], returns: "i32" }, NtGetCurrentProcessorNumber: { args: [], returns: "u32" } }).symbols, info = new Int32Array(12), priorities = {}, gaps = [];
  let last = now(), cpu = -1, moves = 0, n = 0, since = 0;
  return {
    step() { const t = now(); nt.NtQueryInformationThread(-2n, 0, info, 48, null); const p = info[10], c = nt.NtGetCurrentProcessorNumber(); priorities[p] = (priorities[p] ?? 0) + 1; moves += +(c !== cpu), (cpu = c); if (t - last > 1.5) gaps.push([t - last, n - since, p]), (since = n); n++, (last = t); },
    text: () => `priorities ${Object.entries(priorities).map(([p, k]) => `${p}:${Math.round((100 * k) / n)}%`).join(" ")}, ${moves} moves, ${gaps.length} gaps of ${Math.round(gaps.reduce((s, g) => s + g[0], 0))} ms [${gaps.slice(3, 13).map(g => `${g[0].toFixed(0)}ms+${g[1]}@${g[2]}`).join(" ")}]`,
  };
}
if (process.argv[2] === "--write") {
  const b = Buffer.alloc(65536, 97), w = watcher();
  for (let n = TOTAL; n > 0; n -= b.length) fs.writeSync(1, b), w.step();
  fs.writeFileSync(process.argv[3], w.text());
} else if (process.argv[2] === "--read") {
  const { BUN_JSC_logGC, ...env } = process.env, file = require("os").tmpdir() + "\\stall-" + process.pid, p = Bun.spawn([process.execPath, __filename, "--write", file], { stdout: "pipe", stderr: "ignore", env }), w = watcher();
  let t, n = 0;
  for await (const c of p.stdout) (t ??= now()), (n += c.length), w.step();
  const ms = now() - t;
  await p.exited;
  console.log(`${Math.round(n / MB / (ms / 1000))} MB/s in ${Math.round(ms)} ms | reader ${w.text()} | writer ${fs.readFileSync(file, "utf8")}`), fs.rmSync(file);
} else {
  const [old, fresh, variants] = process.argv.slice(2), burners = require("os").cpus().map(() => Bun.spawn([old, "-e", "const end = Date.now() + 600000; while (Date.now() < end);"], { stdio: ["ignore", "ignore", "ignore"] }));
  await Bun.sleep(1000);
  for (const variant of variants.split(";")) {
    const parts = variant.split(","), env = { ...process.env, BUN_JSC_logGC: "1", BUN_TMP_TUNE: parts.filter(it => /^\d/.test(it)).join(), ...Object.fromEntries(parts.filter(it => /^[A-Z]/.test(it)).map(it => it.split("="))) }, seen = [];
    for (let i = 0; i < +(process.env.ROUNDS ?? 5); i++) {
      const it = Bun.spawnSync([parts.includes("old") ? old : fresh, __filename, "--read"], { env, timeout: 40000, stdin: "ignore" }), cycles = [...it.stderr.toString().matchAll(/cycle ([\d.]+)ms/g)].map(m => +m[1]);
      seen.push(`${it.stdout.toString().trim()} | ${cycles.length} collections, ${Math.round(cycles.reduce((a, b) => a + b, 0))} ms`);
    }
    seen.sort((a, b) => parseInt(a) - parseInt(b));
    console.log(`stall ${variant || "as is"}: ${seen.map(it => parseInt(it)).join(" ")} MB/s; the median: ${seen[seen.length >> 1]}`);
  }
  for (const it of burners) it.kill();
}
