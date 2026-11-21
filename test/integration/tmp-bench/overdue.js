// Usage: bun overdue.js <old> <new> <rounds>   A timer is overdue when a request starts, or soon after: which of the two is heard first?
const net = require("net"),
  { once } = require("events"),
  stall = ms => {
    for (const end = performance.now() + ms; performance.now() < end;);
  };
if (process.argv[2] !== "--run")
  for (const condition of ["idle", "busy"]) {
    const burners =
      condition === "busy"
        ? require("os")
            .cpus()
            .map(() =>
              Bun.spawn([process.execPath, "-e", "const end = Date.now() + 130000; while (Date.now() < end);"], {
                stdio: ["ignore", "ignore", "ignore"],
              }),
            )
        : [];
    for (const [i, exe] of process.argv.slice(2, 4).entries())
      console.log(
        `cond overdue ${condition} ${i ? "new" : "old"}:\n${Bun.spawnSync([exe, __filename, "--run", condition === "busy" ? process.argv[4] / 5 : process.argv[4]], { timeout: 60000, stderr: "inherit" }).stdout}`,
      );
    for (const it of burners) it.kill();
  }
else
  (async () => {
    const echo = c => c.on("error", () => {}).pipe(c),
      tcp = net.createServer(echo).listen(0, "127.0.0.1"),
      name = `\\\\.\\pipe\\overdue-${process.pid}`;
    net.createServer(echo).listen(name);
    await once(tcp, "listening");
    const port = tcp.address().port;
    const starts = {
      "connect": done => {
        const c = net.connect({ port, host: "127.0.0.1" }, () => (done(), c.destroy()));
      },
      "connect to a pipe": done => {
        const c = net.connect(name, () => (done(), c.destroy()));
      },
      "accept": done => {
        tcp.once("connection", done);
        const c = net.connect({ port, host: "127.0.0.1" }, () => c.destroy());
      },
    };
    for (const [what, start] of Object.entries(starts)) {
      const row = [];
      for (const when of ["before", "after"]) {
        let late = 0;
        for (let i = 0; i < +process.argv[3]; i++)
          await new Promise(resolve =>
            setImmediate(() => {
              let first,
                left = 2;
              const heard = who => () => ((first ??= who), --left || resolve((late += first === "timer")));
              setTimeout(heard("timer"), 1);
              if (when === "before") stall(1.5);
              start(heard("io"));
              if (when === "after") process.nextTick(() => process.nextTick(stall, 1.5));
            }),
          );
        row.push(`stalled ${when} the start, the timer was first ${late} times`);
      }
      console.log(`cond   ${what}: ${row.join("; ")}`);
    }
    process.exit(0);
  })();
