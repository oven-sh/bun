const jsc = require("bun:jsc");

for (let i = 0; i < 30; i++) {
  test(`this used to crash :: ${i}`, async () => {
    const buffer = Buffer.alloc(1024 * 1024, "a");

    async function getStdin() {
      {
        let subprocess = Bun.spawn({
          cmd: [process.argv0, "-e", "Bun.sleep(100)"],
          stdio: ["pipe", "ignore", "ignore"],
        });
        subprocess.unref();
        subprocess.stdin.write(buffer);
        process.kill(subprocess.pid, "SIGKILL");
        await subprocess.stdin.end().catch(() => {});
      }
    }

    async function iter() {
      await getStdin();
    }

    await Promise.all(Array.from({ length: 200 }, () => iter()));
    Bun.gc(true);
    await Bun.sleep(10);
    const { objectTypeCounts } = jsc.heapStats();
    console.log("objectTypeCounts:", objectTypeCounts.FileSink, objectTypeCounts.Subprocess);
    console.log("RSS", (process.memoryUsage.rss() / 1024 / 1024) | 0, "MB");
  });
}
