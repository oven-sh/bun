// Usage: bun fair.js <old> <new> <all|busy> <case,...> <variant;...> [rounds]   New copies of both, neither of them burns or drives, and old is measured twice.
const fs = require("fs"), MB = 1 << 20, now = () => performance.now(), [mode, ...args] = process.argv.slice(2);
const spawn = (role, options) => Bun.spawn([process.execPath, __filename, "--role", role], { stderr: "inherit", ...options }), TOTAL = +(process.env.TOTAL ?? 64) * MB;
const roles = {
  spew() { const b = Buffer.alloc(65536, 97); for (let n = TOTAL; n > 0; n -= b.length) fs.writeSync(1, b); },
  async drain() { console.log("up"); console.log((await Bun.stdin.bytes()).length); },
  serve() { console.log(Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("hello") }).port); },
};
const cases = {
  async stream() { const t = now(), p = spawn("spew"); let first; for await (const c of p.stdout) first ??= now(); return [first - t, now() - first]; },
  async buffered() { const t = now(); await spawn("spew").stdout.bytes(); return [0, now() - t]; },
  async stdin(total = TOTAL) { const b = Buffer.alloc(total), t = now(), r = spawn("drain", { stdin: b }).stdout.getReader(); await r.read(); const first = now(); while (!(await r.read()).done); return [first - t, now() - first]; },
  stdin48: () => cases.stdin(48 * MB),
  stdin70: () => cases.stdin(70 * MB),
  stdin256: () => cases.stdin(256 * MB),
  async start() { const t = now(); for (let i = 0; i < 5; i++) await Bun.spawn([process.execPath, "-e", "1"]).exited; return [0, (now() - t) / 5]; },
  async fetch16() { const t = now(), p = spawn("serve"), url = `http://127.0.0.1:${parseInt(Buffer.from((await p.stdout.getReader().read()).value))}/`, first = now(); let left = 600; await Promise.all(Array.from({ length: 16 }, async () => { while (left-- > 0) await (await fetch(url)).text(); })); const end = now(); p.kill(); return [first - t, end - first]; },
  async stat() { const t = now(); for (let i = 0; i < 300; i++) await fs.promises.stat(__filename); return [0, now() - t]; },
  async reads32() { const fd = fs.openSync(__filename), b = Buffer.alloc(512), t = now(); for (let i = 0; i < 40; i++) await Promise.all(Array.from({ length: 32 }, () => new Promise(done => fs.read(fd, b, 0, 512, 0, done)))); return [0, now() - t]; },
};
if (mode === "--role") roles[args[0]]();
else if (mode === "--case") cases[args[0]]().then(it => (console.log(it.join(" ")), process.exit(0)));
else {
  const [fresh, condition, only, variants, rounds = 15] = args, dir = fs.mkdtempSync(require("os").tmpdir() + "\\fair-");
  const copy = (from, name) => (fs.mkdirSync(`${dir}\\${name}`), fs.copyFileSync(from, `${dir}\\${name}\\bun.exe`), `${dir}\\${name}\\bun.exe`);
  const [a, b, n, burner] = [copy(mode, "a"), copy(mode, "b"), copy(fresh, "n"), copy(mode, "burner")], columns = [[a, "old"], [b, "old again"], ...variants.split(";").map(v => [v === "before" ? copy(process.env.BEFORE_BUN, "before") : n, v])];
  for (const exe of [a, b, n]) for (let i = 0; i < 3; i++) Bun.spawnSync([exe, "-e", "1"]);
  const burners = condition === "busy" ? require("os").cpus().map(() => Bun.spawn([burner, "-e", "const end = Date.now() + 1500000; while (Date.now() < end);"], { stdio: ["ignore", "ignore", "ignore"] })) : [];
  Bun.sleepSync(500);
  console.log(`cond fair ${condition}: ms until the child is up + ms of work, medians of ${rounds} (quartiles of the work)`);
  for (const name of only.split(",")) {
    const seen = columns.map(() => []);
    for (let round = 0; round < rounds; round++) for (let turn = 0; turn < columns.length; turn++) {
      const i = (turn + round) % columns.length;
      seen[i].push(Bun.spawnSync([columns[i][0], __filename, "--case", name], { env: { ...process.env, BUN_TMP_TUNE: i > 1 ? columns[i][1] : "" }, timeout: 40000, stdin: "ignore" }).stdout.toString().trim().split(" ").map(Number));
    }
    const at = (l, k, q) => l.map(it => it[k]).sort((x, y) => x - y)[Math.floor(q * (l.length - 1) + 0.5)]?.toFixed(0);
    console.log("cond", name.padEnd(9), seen.map((l, i) => `${columns[i][1] || "as is"}: ${at(l, 0, 0.5)}+${at(l, 1, 0.5)} (${at(l, 1, 0.25)}-${at(l, 1, 0.75)})`).join(" | "));
  }
  for (const it of burners) it.kill();
  Bun.sleepSync(300), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
