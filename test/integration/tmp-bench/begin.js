// Usage: bun begin.js <old> <new> <all|affinity mask> <workers> <variant;...> <rounds>   Timers next to busy Workers that begin to read files.
const fs = require("fs"), now = () => performance.now();
if (process.argv[2] === "--one") {
  const f = process.argv[4], code = `const fs = require("fs"), burn = ms => { for (const end = performance.now() + ms; performance.now() < end; ); }; onmessage = async e => { const fd = fs.openSync(${JSON.stringify(f)}), b = Buffer.alloc(4 << 20); burn(300); for (;;) { await new Promise(r => fs.read(fd, b, 0, b.length, 0, r)); Atomics.add(e.data, 0, 1); burn(10); } }; postMessage(0);`;
  const n = new Int32Array(new SharedArrayBuffer(4)), all = await Promise.all(Array.from({ length: +process.argv[3] }, () => new Promise(r => { const w = new Worker("data:text/javascript," + encodeURIComponent(code)); w.onmessage = () => r(w); })));
  for (const w of all) w.postMessage(n);
  const t = now(), turns = [];
  for (let last = t; now() - t < 4000; last = now()) await Bun.sleep(25), turns.push([now() - last, last - t]);
  const top = turns.toSorted((x, y) => y[0] - x[0]).slice(0, 2).map(([ms, at]) => `${ms.toFixed(0)}@${(at / 1000).toFixed(1)}`);
  console.log(`${((now() - t) / turns.length - 25).toFixed(0)} ${top.join(",")} r${n[0]}`);
  process.exit(0);
}
const [old, exe, condition, workers, variants, rounds] = process.argv.slice(2), f = require("os").tmpdir() + "/begin-" + process.pid;
fs.writeFileSync(f, Buffer.alloc(4 << 20));
if (condition !== "all") require("bun:ffi").dlopen("kernel32.dll", { SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" } }).symbols.SetProcessAffinityMask(-1n, BigInt(condition));
const columns = ["old", ...variants.split(";")], seen = columns.map(() => []), end = Date.now() + 225000;
for (let round = 0; round < rounds && Date.now() < end; round++)
  for (let turn = 0; turn < columns.length; turn++) {
    const i = (turn + round) % columns.length;
    seen[i].push(Bun.spawnSync([i ? exe : old, __filename, "--one", workers, f], { env: { ...process.env, BUN_TMP_RING: i ? columns[i] : "" }, timeout: 30000, stdin: "ignore", stderr: "inherit" }).stdout.toString().trim());
  }
console.log(`cond hot begin, cpus ${condition}, ${workers} workers: ms late on average, the two longest turns, reads`);
columns.forEach((it, i) => console.log(`cond   ${it}: ${seen[i].sort((x, y) => parseInt(x) - parseInt(y)).join(" | ")}`));
