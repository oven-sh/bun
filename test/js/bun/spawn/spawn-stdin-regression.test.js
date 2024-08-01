import { bunExe } from "harness";

const jsc = require("bun:jsc");

test(`this used to crash`, async () => {
  for (let i = 0; i < 30; i++) {
    const buffer = Buffer.alloc(1024 * 1024, "a");

    async function getStdin() {
      {
        let subprocess = Bun.spawn({
          cmd: [bunExe(), "-e", "Bun.sleep(100)"],
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
  }
}, 30_000);
