// Usage: bun handshake.js <old> <new> <burners for each CPU> <seconds>   A request that times out after 50 ms without an answer: what has each side heard of it?
const net = require("net"),
  http = require("http");
if (process.argv[2] !== "--run") {
  const [old, now, factor, seconds] = process.argv.slice(2),
    seen = { old: {}, new: {} };
  const burners = Array.from({ length: factor * require("os").cpus().length }, () =>
    Bun.spawn([old, "-e", "const end = Date.now() + 260000; while (Date.now() < end);"], {
      stdio: ["ignore", "ignore", "ignore"],
    }),
  );
  (async () => {
    for (let round = 0; round < 4; round++) {
      const [name, exe] = round % 3 ? ["new", now] : ["old", old];
      for (const text of await Promise.all(
        [1, 2, 3, 4].map(() =>
          Bun.spawn([exe, __filename, "--run", seconds / 2], {
            timeout: (seconds / 2 + 20) * 1000,
            stderr: "inherit",
          }).stdout.text(),
        ),
      ))
        for (const [key, n] of Object.entries(JSON.parse(text || '{"no output":1}')))
          seen[name][key] = (seen[name][key] ?? 0) + n;
    }
    for (const it of burners) it.kill();
    console.log("cond handshake", JSON.stringify(seen));
  })();
} else {
  const seen = {},
    end = Date.now() + process.argv[3] * 1000;
  const one = () =>
    new Promise(resolve => {
      const heard = new Set(),
        finish = () => (clearTimeout(limit), peer?.destroy(), server.close(), resolve([...heard].join(" "))),
        hear = what => () => (
          heard.add(what),
          heard.has("closed") && heard.has("head") && heard.has("end") && finish()
        );
      let peer;
      const limit = setTimeout(() => (heard.add("STUCK"), finish()), 4000);
      const server = net
        .createServer(
          { allowHalfOpen: true },
          c => (
            (peer = c),
            hear("accepted")(),
            c
              .on("error", e => heard.add(e.code))
              .on("data", hear("head"))
              .on("end", hear("end"))
              .on("close", hear("end"))
          ),
        )
        .listen(0, "127.0.0.1", () => {
          const createConnection = ({ timeout }) =>
            net.connect({ port: server.address().port, host: "127.0.0.1", timeout }).on("connect", hear("connected"));
          const request = http.request({
            host: "nowhere.invalid",
            port: 1234,
            timeout: 50,
            createConnection,
            headers: { Connection: "Upgrade", Upgrade: "websocket" },
          });
          request
            .on("timeout", () => (heard.add("timeout"), request.abort()))
            .on("error", e => heard.has("timeout") || heard.add(e.code))
            .on("close", hear("closed"))
            .end();
        });
    });
  Promise.all(
    Array.from({ length: 6 }, async () => {
      while (Date.now() < end) {
        const key = await one();
        seen[key] = (seen[key] ?? 0) + 1;
      }
    }),
  ).then(() => (console.log(JSON.stringify(seen)), process.exit(0)));
}
