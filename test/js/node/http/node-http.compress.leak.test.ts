import { expect, test } from "bun:test";
import { bunExe } from "harness";
import path from "node:path";

// test does still leak but not as bad
// prettier-ignore
test.todo("http.Server + compression integration", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const proc = Bun.spawn([bunExe(), path.resolve(import.meta.dir, "fixtures", "http.compress.leak.server.ts")], {
    stdio: ["ignore", "inherit", "inherit"],
    async ipc(message) {
      if (typeof message === "string") {
        const port = message;

        for (let i = 0; i < 1_000; i++) {
          const a = await Promise.all(
            Array(10)
              .fill(0)
              .map(v => fetch(`http://localhost:${port}`, { headers: { "Accept-Encoding": "gzip" } })),
          );
          const b = await Promise.all(a.map(v => v.arrayBuffer()));
        }
        return;
      }
      if (typeof message === "object") {
        const { baseline, after } = message;
        console.log(baseline);
        console.log(after);
        console.log("-", after - baseline);
        console.log("-", 1024 * 1024 * 20);
        expect(after - baseline).toBeLessThan(1024 * 1024 * 20);
        process.kill(proc.pid); // cleanup
        resolve();
      }
    },
  });
  await promise;
}, 0);
