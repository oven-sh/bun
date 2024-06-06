const CONCURRENCY = 20;
const RUN_COUNT = 5;

import { Worker, isMainThread, workerData } from "worker_threads";

const sleep = Bun.sleep;

if (isMainThread) {
  let action = process.argv.at(-1);
  if (process.argv.length === 2) {
    action = "readFile";
  }
  const body = new Blob(["Hello, world!".repeat(100)]);
  let httpCount = 0;
  let onHTTPCount = (a: number) => {};
  const server = Bun.serve({
    port: 0,
    fetch() {
      onHTTPCount(httpCount++);
      return new Response(body);
    },
  });
  let remaining = RUN_COUNT;

  while (remaining--) {
    const promises = [];
    const initialHTTPCount = httpCount;
    let httpCountThisRun = 0;
    let pendingHTTPCountPromises = [];
    onHTTPCount = a => {
      setTimeout(() => {
        pendingHTTPCountPromises[httpCountThisRun++].resolve();
      }, 0);
    };
    for (let i = 0; i < CONCURRENCY; i++) {
      pendingHTTPCountPromises.push(Promise.withResolvers());
      const worker = new Worker(import.meta.url, {
        workerData: {
          action,
          port: server.port,
        },
      });
      worker.ref();
      const { promise, resolve } = Promise.withResolvers();
      promises.push(promise);

      worker.on("online", () => {
        sleep(1)
          .then(() => {
            // if (action === "fetch+blob") {
            //   return pendingHTTPCountPromises[i].promise;
            // }
          })
          .then(() => {
            worker.terminate();
          })
          .finally(resolve);
      });
    }

    await Promise.all(promises);
    console.log(`Spawned ${CONCURRENCY} workers`, "RSS", (process.memoryUsage().rss / 1024 / 1024) | 0, "MB");
    Bun.gc(true);
  }
  server.stop(true);
} else {
  Bun.gc(true);
  const { action, port } = workerData;
  self.addEventListener("message", () => {});

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
      await fetch("http://localhost:" + port);
      break;
    }
    case "fetch-early-exit": {
      fetch("http://localhost:" + port);
      break;
    }
    case "fetch+blob": {
      const resp = await fetch("http://localhost:" + port);
      await resp.blob();
      break;
    }
    case "fetch+blob-early-exit": {
      const resp = await fetch("http://localhost:" + port);
      await resp.blob();
      break;
    }
    case "readFile": {
      await Bun.file(import.meta.path).text();
      break;
    }
    case "readFile-early-exit": {
      await Bun.file(import.meta.path).text();
      break;
    }
  }
}
