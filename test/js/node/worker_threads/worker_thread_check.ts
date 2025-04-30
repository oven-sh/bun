const CONCURRENCY = 10;
const RUN_COUNT = 5;

import { Worker, isMainThread, workerData } from "worker_threads";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

if (isMainThread) {
  let action = process.argv.at(-1);

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response();
    },
  });
  let remaining = RUN_COUNT;

  while (remaining--) {
    const promises: Promise<unknown>[] = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      const worker = new Worker(import.meta.url, {
        workerData: {
          action,
          port: server.port,
        },
        env: process.env,
      });
      worker.ref();
      const { promise, resolve, reject } = Promise.withResolvers();
      promises.push(promise);

      worker.on("online", () => {
        sleep(10000)
          .then(() => {
            return worker.terminate();
          })
          .finally(resolve);
      });
      worker.on("error", e => reject(e));
    }

    await Promise.all(promises);
    console.log(`Spawned ${CONCURRENCY} workers`, "RSS", (process.memoryUsage().rss / 1024 / 1024) | 0, "MB");
    Bun.gc(true);
  }
  server.stop(true);
} else {
  Bun.gc(true);
  const { action, port } = workerData;

  switch (action) {
    case "Bun.connect": {
      await Bun.connect({
        hostname: "localhost",
        port,
        socket: {
          open() {},
          error() {},
          data() {},
          drain() {},
          close() {},
        },
      });
      break;
    }
    case "Bun.listen": {
      const server = Bun.listen({
        hostname: "localhost",
        port: 0,
        socket: {
          open() {},
          error() {},
          data() {},
          drain() {},
          close() {},
        },
      });
      break;
    }
    case "fetch": {
      const resp = await fetch("http://localhost:" + port);
      await resp.blob();
      break;
    }
  }
}
