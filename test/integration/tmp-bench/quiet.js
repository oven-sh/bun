// Usage: bun quiet.js <old> <new>...   KiB that a server holds for each named pipe that has gone quiet after one burst.
const net = require("net"), N = 300;
if (process.argv[2] === "--serve") {
  const [name, size] = process.argv.slice(3), kept = [];
  let done = 0, before;
  const now = async () => { for (let i = 0; i < 4; i++) Bun.gc(true), await Bun.sleep(150); return process.memoryUsage.rss(); };
  net.createServer(c => { let n = 0; kept.push(c); c.on("data", d => { if ((n += d.length) === +size) c.write("x"), ++done === N && now().then(after => (console.log(((after - before) / N / 1024).toFixed(0)), process.exit(0))); }); }).listen(name, async () => ((before = await now()), console.log("up")));
} else (async () => {
  const exes = process.argv.slice(2);
  for (const size of [100, 20000, 65536, 100000, 139264, 204800, 300000, 1000000, 1 << 20]) {
    const row = [];
    for (const exe of exes) {
      const name = `\\\\.\\pipe\\quiet-${process.pid}-${size}-${row.length}`, p = Bun.spawn([exe, __filename, "--serve", name, "" + size], { stderr: "inherit", timeout: 30000 }), r = p.stdout.getReader(), b = Buffer.alloc(size, 1), all = [];
      await r.read();
      for (let i = 0; i < N; i++) await new Promise(done => { const c = net.connect(name, () => c.write(b)).on("error", done).once("data", done); all.push(c); });
      row.push(Buffer.from((await r.read()).value ?? "?").toString().trim());
      for (const c of all) c.destroy();
      await p.exited;
    }
    console.log(`cond quiet old, new, KiB for each pipe after ${size} bytes: ${row.join(" | ")}`);
  }
})();
