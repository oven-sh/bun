import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

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

test("object URLs for Bun.file(Buffer) blobs can be resolved and revoked from a Worker", async () => {
  // The registry shares one file store across VMs. Its Buffer path is held by a
  // ref on the main VM's ArrayBuffer, so the worker letting go of the last
  // reference must hand the release back to the main thread rather than touch
  // that refcount itself — in both directions (main-owned released by worker,
  // worker-owned released by main after the worker is gone).
  using dir = tempDir("worker-objecturl-buffer-path", {
    "data.txt": "hello",
    "worker.js": `
      const mine = [];
      for (let i = 0; i < 20; i++) mine.push(URL.createObjectURL(Bun.file(Buffer.from(process.argv[2] + "/data.txt"))));
      self.onmessage = async e => {
        let ok = 0;
        for (const u of e.data) {
          if ((await (await fetch(u)).text()) === "hello") ok++;
          URL.revokeObjectURL(u);
        }
        Bun.gc(true);
        postMessage({ ok, mine });
      };
    `,
    "main.js": `
      const dir = process.argv[2];
      const urls = [];
      for (let i = 0; i < 50; i++) {
        urls.push(URL.createObjectURL(Bun.file(Buffer.from(dir + "/data.txt"))));
        urls.push(URL.createObjectURL(Bun.file(new TextEncoder().encode(dir + "/data.txt").buffer)));
      }
      Bun.gc(true);
      const w = new Worker(dir + "/worker.js", { argv: [dir] });
      w.postMessage(urls);
      const { ok, mine } = await new Promise((resolve, reject) => {
        w.onmessage = e => resolve(e.data);
        w.onerror = e => reject(e.error ?? new Error(e.message));
      });
      const fromWorker = [];
      for (const u of mine) fromWorker.push(await (await fetch(u)).text());
      await w.terminate();
      Bun.gc(true);
      Bun.gc(true);
      const stillResolves = await fetch(urls[0]).then(() => true, () => false);
      console.log(JSON.stringify({ ok, fromWorker: fromWorker.every(t => t === "hello") && fromWorker.length, stillResolves }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "main.js"), String(dir)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ ok: 100, fromWorker: 20, stillResolves: false });
  expect(exitCode).toBe(0);
});
