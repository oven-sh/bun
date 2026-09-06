import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

test("object URL created in one worker is usable and revocable across threads", async () => {
  using dir = tempDir("worker-object-url", {
    "main.mjs": `import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
      if (isMainThread) {
        const a = new Worker(new URL(import.meta.url), { workerData: "a" });
        const b = new Worker(new URL(import.meta.url), { workerData: "b" });
        a.on("message", urls => b.postMessage(urls));
        b.on("message", result => { console.log(JSON.stringify(result)); a.postMessage("revoke"); });
        a.on("exit", code => { console.log("a exited", code); b.terminate(); });
      } else if (workerData === "a") {
        const urls = [];
        globalThis.files = [];
        for (let i = 0; i < 100; i++) {
          const f = new File(["x"], "ignored");
          f.name = "nm" + i + Math.random().toString(36).slice(2);
          files.push(f);
          urls.push(URL.createObjectURL(f));
        }
        parentPort.postMessage(urls);
        parentPort.on("message", () => {
          for (const url of urls) URL.revokeObjectURL(url);
          globalThis.files = null;
          Bun.gc(true);
          Bun.gc(true);
          process.exit(0);
        });
      } else {
        parentPort.on("message", async urls => {
          let count = 0, ok = true;
          for (const url of urls) {
            const blob = await (await fetch(url)).blob();
            const o = {};
            o[blob.name] = 1; // use the name as a property key on this thread
            ok &&= blob.name.startsWith("nm");
            count++;
          }
          Bun.gc(true);
          Bun.gc(true);
          parentPort.postMessage({ count, ok });
          setInterval(() => {}, 1000); // stay alive while "a" drops the last references
        });
      }
      `,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "main.mjs"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe('{"count":100,"ok":true}\na exited 0');
  expect(exitCode).toBe(0);
});
