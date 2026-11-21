// Usage: bun turns.js <old> <new> <affinity mask> <variant;...>   A parent that is busy for 50 ms at a time: when does its child get to write?
const fs = require("fs"), wall = () => performance.timeOrigin + performance.now();
if (process.argv[2] === "--write") {
  const start = +process.argv[3], size = +process.argv[5], b = Buffer.alloc(size, 97), bursts = [];
  let last = -9;
  for (let n = 48 << 20; n > 0; n -= size) { const before = wall() - start; fs.writeSync(1, b); const t = wall() - start; t - last > 3 ? bursts.push([Math.round(size > 65536 ? before : t), 1]) : bursts.at(-1)[1]++; last = t; }
  fs.writeFileSync(process.argv[4], bursts.map(it => it.join("x")).join(" ") + ` done ${Math.round(last)}`);
} else if (process.argv[2] === "--read") {
  const file = require("os").tmpdir() + "\\turns-" + process.pid, turns = [], start = wall();
  const busy = setInterval(() => { const t = wall(); turns.push(Math.round(t - start)); while (wall() < t + 50); }, 1);
  const p = Bun.spawn([process.execPath, __filename, "--write", start, file, process.argv[3]], { stdout: "pipe", stderr: "ignore" });
  await p.stdout.bytes();
  const end = Math.round(wall() - start);
  clearInterval(busy), await p.exited;
  console.log(`${end} ms; turns at ${turns.join(" ")}; writes at ${fs.readFileSync(file, "utf8")}`), fs.rmSync(file);
} else {
  const [old, fresh, mask, variants] = process.argv.slice(2);
  require("bun:ffi").dlopen("kernel32.dll", { SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" } }).symbols.SetProcessAffinityMask(-1n, BigInt(mask));
  for (const size of [65536, 48 << 20]) for (const variant of variants.split(";")) {
    const seen = Array.from({ length: +(process.env.ROUNDS ?? 5) }, () => Bun.spawnSync([variant === "old" ? old : fresh, __filename, "--read", size], { env: { ...process.env, BUN_TMP_TUNE: variant === "old" ? "" : variant }, timeout: 30000, stdin: "ignore" }).stdout.toString().trim()).sort((a, b) => parseInt(a) - parseInt(b));
    console.log(`stall turns ${size} ${variant || "as is"}: ${seen.map(it => parseInt(it)).join(" ")}; the median: ${seen[seen.length >> 1]}`);
  }
}
