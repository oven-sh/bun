// Usage: bun overrun.js <old> <new> <idle|shared|every> <variant;...> [rounds]
// What timers that overrun get done, and how long a request waits for them: alone, with one busy process on the same CPU, and with every CPU busy.
const net = require("net");
const now = () => performance.now();
const stall = ms => {
  for (const end = now() + ms; now() < end;);
};
const pin = mask =>
  mask &&
  require("bun:ffi")
    .dlopen("kernel32.dll", { SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" } })
    .symbols.SetProcessAffinityMask(-1n, BigInt(mask));
const at = (list, q) => list.sort((a, b) => a - b)[Math.floor(q * (list.length - 1))];
const SECONDS = +(process.env.SECONDS ?? 1.3);
const timers = {
  "2 ms of work every 1 ms": done => setInterval(() => (stall(2), done()), 1),
  "50 ms of work every 1 ms": done => setInterval(() => (stall(50), done()), 1),
  "3 ms of work every 40 ms, and a ticker": done => (
    setInterval(() => (stall(3), done()), 40),
    setInterval(() => {}, 1)
  ),
  "30 ms blocked every 10 ms": done => setInterval(() => (Bun.sleepSync(30), done()), 10),
  "bursts of 3 x 20 ms every 150 ms": done => setInterval(() => { for (let i = 0; i < 3; i++) setTimeout(() => (stall(20), done()), 1 + i * 10); }, 150),
  "1000 short intervals": done => {
    for (let i = 0; i < 1000; i++) setInterval(() => (stall(0.005), done()), 20 + (i % 37));
  },
};
const [mode, ...args] = process.argv.slice(2);
if (mode === "--burn") {
  pin(args[0]);
  if (args[1] === "low") require("os").setPriority(require("os").constants.priority.PRIORITY_BELOW_NORMAL);
  for (const end = Date.now() + 250000; Date.now() < end;);
} else if (mode === "--serve") {
  pin(args[1]);
  let count = 0;
  const server = net.createServer(c => {
    const start = now();
    timers[args[0]](() => count++);
    c.setNoDelay(true).on("data", d =>
      d[0] === 120 ? c.write(d) : c.end(String((count * 1000) / (now() - start)), () => process.exit(0)),
    );
  });
  server.listen(0, "127.0.0.1", () => console.log(server.address().port));
} else if (mode === "--ask") {
  pin(args[2]);
  const c = net.connect(+args[0], "127.0.0.1").setNoDelay(true);
  const waits = [];
  let end = Infinity;
  let sent;
  const ask = () => ((sent = now()), c.write(sent > end ? "q" : "x"));
  c.on("data", d => {
    if (d[0] !== 120) return (console.log(+d, at(waits, 0.5), at(waits, 0.95), at(waits, 1)), process.exit(0));
    if (end === Infinity) end = now() + SECONDS * 1000 - 1;
    else waits.push(now() - sent);
    setTimeout(ask, +args[1]);
  });
  ask();
} else {
  const [fresh, condition, only, variants, rounds = 3, seconds = SECONDS] = args;
  process.env.SECONDS = seconds;
  const columns = [[mode, "old"], ...variants.split(";").map(v => [v === "before" ? process.env.BEFORE_BUN : fresh, v])];
  const isShared = condition === "shared" || condition === "low";
  const burners = (
    isShared
      ? ["4"]
      : condition === "every"
        ? require("os")
            .cpus()
            .map(() => "")
        : []
  ).map(mask => Bun.spawn([mode, __filename, "--burn", mask, condition], { stdio: ["ignore", "ignore", "ignore"] }));
  (async () => {
    console.log(
      `cond overrun ${condition}: callbacks a second, and ms that an echo takes (median, 95 %, most), medians of ${rounds}`,
    );
    for (const name of Object.keys(timers).filter(it => only.split(",").some(part => it.startsWith(part))))
      for (const pause of [7, 1e9]) {
        const seen = columns.map(() => []);
        for (let round = 0; round < rounds; round++)
          for (let turn = 0; turn < columns.length; turn++) {
            const i = (turn + round) % columns.length;
            const env = { ...process.env, BUN_TMP_TUNE: i ? columns[i][1] : "" };
            const server = Bun.spawn([columns[i][0], __filename, "--serve", name, isShared ? "4" : ""], {
              env,
              timeout: 20000,
              stderr: "inherit",
            });
            const port = parseInt(Buffer.from((await server.stdout.getReader().read()).value));
            const asker = Bun.spawn(
              [mode, __filename, "--ask", port, Math.min(pause, seconds * 1000), isShared ? "1" : ""],
              { env, timeout: 20000, stderr: "inherit" },
            );
            seen[i].push((await asker.stdout.text()).trim().split(" ").map(Number));
            server.kill();
          }
        const cell = list => {
          const [rate, ...waits] = [0, 1, 2, 3].map(k =>
            at(
              list.map(it => it[k]),
              0.5,
            ),
          );
          return `${rate?.toFixed(0)}/s${pause === 7 ? " " + waits.map(it => it?.toFixed(1)).join(" ") : ""}`;
        };
        console.log(
          `cond   ${name}, ${pause === 7 ? "asked" : "left alone"}: ${seen.map((list, i) => `${columns[i][1] || "as is"} ${cell(list)}`).join(" | ")}`,
        );
      }
    for (const it of burners) it.kill();
  })();
}
