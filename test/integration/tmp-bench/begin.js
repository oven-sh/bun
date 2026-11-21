// Usage: bun begin.js <old> <new> <all|affinity mask> <workers> <kind;...> <rounds> [nogc]   Timers next to Workers that make a call and compute.
const fs = require("fs"), now = () => performance.now();
if (process.argv[2] === "--one") {
  const [count, f, kind] = process.argv.slice(3), call = { "read 4 MB": "fs.read(fd, b, 0, b.length, 0, r)", "read 4 KB": "fs.read(fd, b, 0, 4096, 0, r)", stat: "fs.stat(f, r)", readFile: "fs.readFile(f + '.small', r)", text: "Bun.file(f + '.small').text().then(r)", immediate: "setImmediate(r)", pbkdf2: "require('crypto').pbkdf2('a', 'b', 100, 32, 'sha256', r)" }[kind];
  const code = `const fs = require("fs"), f = ${JSON.stringify(f)}, burn = ms => { for (const end = performance.now() + ms; performance.now() < end; ); }; onmessage = async e => { const fd = fs.openSync(f), b = Buffer.alloc(4 << 20); for (;;) { await new Promise(r => ${call}); Atomics.add(e.data, 0, 1); burn(10); } }; postMessage(0);`;
  const n = new Int32Array(new SharedArrayBuffer(4)), all = await Promise.all(Array.from({ length: +count }, () => new Promise(r => { const w = new Worker("data:text/javascript," + encodeURIComponent(code)); w.onmessage = () => r(w); })));
  for (const w of all) w.postMessage(n);
  await Bun.sleep(500);
  const t = now(), first = n[0], turns = [];
  for (let last = t; now() - t < 2500; last = now()) await Bun.sleep(25), turns.push(now() - last);
  console.log(`${((now() - t) / turns.length - 25).toFixed(0)}/${Math.max(...turns).toFixed(0)} r${(((n[0] - first) * 1000) / (now() - t)).toFixed(0)}`);
  process.exit(0);
}
const [old, exe, condition, workers, kinds, rounds, nogc] = process.argv.slice(2), f = require("os").tmpdir() + "/begin-" + process.pid;
fs.writeFileSync(f, Buffer.alloc(4 << 20)), fs.writeFileSync(f + ".small", Buffer.alloc(4096));
if (condition !== "all") require("bun:ffi").dlopen("kernel32.dll", { SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" } }).symbols.SetProcessAffinityMask(-1n, BigInt(condition));
console.log(`cond hot begin, cpus ${condition}, ${workers} workers ${nogc ?? ""}: ms late on average / the longest turn, calls/s`);
for (const kind of kinds.split(";")) {
  const seen = [[], []];
  for (let round = 0; round < rounds * 2; round++) seen[(round + (round >> 1)) & 1].push(Bun.spawnSync([(round + (round >> 1)) & 1 ? exe : old, __filename, "--one", workers, f, kind], { env: { ...process.env, BUN_GC_TIMER_DISABLE: nogc && "1" }, timeout: 30000, stdin: "ignore", stderr: "inherit" }).stdout.toString().trim());
  seen.forEach((it, i) => console.log(`cond   ${kind}, ${i ? "new" : "old"}: ${it.sort((x, y) => parseInt(x) - parseInt(y)).join(" | ")}`));
}
