import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test("Worker from a Blob", async () => {
  const worker = new Worker(
    URL.createObjectURL(
      new Blob(
        [
          `self.onmessage = e => {
            self.postMessage(e.data);
          };`,
        ],
        { type: "application/javascript" },
      ),
    ),
  );

  const result = await new Promise(resolve => {
    worker.onmessage = e => {
      worker.onmessage = () => {};
      resolve(e.data);
    };
    worker.postMessage("hello");
  });

  expect(result).toBe("hello");
});

test("TypeScript Worker from a Blob", async () => {
  const worker = new Worker(
    URL.createObjectURL(
      new File(
        [
          `
            export function supportsTypescript(): boolean {
              return true;
            }

            self.onmessage = e => {
              self.postMessage(supportsTypescript() ? e.data : "typescript not supported" );
            };
            `,
        ],
        "worker.ts",
      ),
    ),
  );

  const result = await new Promise(resolve => {
    worker.onmessage = e => {
      worker.onmessage = () => {};
      resolve(e.data);
    };
    worker.postMessage("i support typescript");
  });

  expect(result).toBe("i support typescript");
});

test("Worker from a blob errors on invalid blob", async () => {
  const { promise, reject } = Promise.withResolvers();
  const worker = new Worker("blob:i dont exist!");
  worker.addEventListener("error", e => reject(e.message));
  expect(promise).rejects.toBe('BuildMessage: ModuleNotFound resolving "blob:i dont exist!" (entry point)');
});

test("Revoking an object URL after a Worker is created before it loads should throw an error", async () => {
  const blob = new Blob([`self.postMessage("I survived. I should not have survived. That is a bug.");`], {
    type: "application/javascript",
  });

  // This is inherently kind of racy.
  // So we try a few times to make sure it's not just a fluke.
  for (let attempt = 0; attempt < 10; attempt++) {
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);

    try {
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = reject;
        worker.onerror = resolve;
      });
      expect(result).toBeInstanceOf(ErrorEvent);
      expect((result as ErrorEvent).message).toBe("BuildMessage: Blob URL is missing");
      break;
    } catch (e) {
      if (attempt === 9) {
        throw e;
      }
    }
  }
});

test("Worker on a revoked blob still works", async () => {
  const blob = new Blob(
    [
      `self.onmessage = e => {
        self.postMessage(e.data);
      };`,
    ],
    { type: "application/javascript" },
  );

  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  const result = await new Promise(resolve => {
    worker.onmessage = e => {
      worker.onmessage = () => {};
      resolve(e.data);
    };
    worker.postMessage("hello");
  });
  expect(result).toBe("hello");

  const revoked = await new Promise(resolve => {
    URL.revokeObjectURL(url);
    worker.onmessage = e => {
      worker.onmessage = () => {};
      resolve(e.data);
    };
    worker.postMessage("revoked.");
  });

  expect(revoked).toBe("revoked.");
});

// The blob-URL registry is process-global. Before the per-owner sweep, an entry
// registered inside a worker stayed in the map after the worker exited, and the
// duped blob store pinned the payload for the lifetime of the process (roughly
// 1 MB retained per MB minted per dead worker). After the sweep, a dead
// worker's URL resolves like a revoked URL and the payload is released.
test("blob URLs created inside a Worker are released when the Worker exits", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const workerBody = ${JSON.stringify(`
          const urls = [];
          for (let i = 0; i < 4; i++) {
            const u8 = new Uint8Array(1 << 20);
            u8.fill(65);
            urls.push(URL.createObjectURL(new Blob([u8])));
          }
          postMessage(urls);
        `)};
        const src = URL.createObjectURL(
          new Blob([workerBody], { type: "application/javascript" }),
        );

        async function runWorker() {
          const w = new Worker(src);
          const urls = await new Promise((resolve, reject) => {
            w.onmessage = e => resolve(e.data);
            w.onerror = e => reject(new Error("worker errored: " + e.message));
          });
          await new Promise(r => w.addEventListener("close", r, { once: true }));
          return urls;
        }

        // Establish the allocator high-water mark before measuring.
        for (let i = 0; i < 3; i++) await runWorker();
        Bun.gc(true);
        Bun.gc(true);

        const rss0 = process.memoryUsage.rss();
        let deadUrl;
        for (let i = 0; i < 30; i++) {
          const urls = await runWorker();
          deadUrl ??= urls[0];
        }
        Bun.gc(true);
        Bun.gc(true);
        const growthMB = (process.memoryUsage.rss() - rss0) / 2 ** 20;

        let deadUrlServed = false;
        try {
          await fetch(deadUrl);
          deadUrlServed = true;
        } catch {}

        // The parent-minted worker-source URL must survive the sweep.
        const parentUrlStillResolves = (await (await fetch(src)).text()) === workerBody;

        console.log(JSON.stringify({ growthMB, deadUrlServed, parentUrlStillResolves }));
      `,
    ],
    env: {
      ...bunEnv,
      // Under ASAN the 1 MB payload frees go into the quarantine (default
      // quarantine_size_mb=256) instead of being returned, so the RSS delta
      // measures the quarantine rather than the registry. Disable it so the
      // threshold is meaningful on ASAN builds.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { growthMB, deadUrlServed, parentUrlStillResolves } = JSON.parse(stdout);
  if (!isWindows) {
    // 30 workers * 4 MB: when leaking, growth is ~120 MB; when swept, growth
    // is allocator noise (typically under 15 MB even on debug builds). RSS
    // does not drop after worker threads exit on Windows (per-thread mimalloc
    // arenas stay committed), so the threshold is meaningless there.
    expect(growthMB).toBeLessThan(40);
  }
  expect(deadUrlServed).toBe(false);
  expect(parentUrlStillResolves).toBe(true);
  expect(exitCode).toBe(0);
}, 60_000);
