import { expect, test } from "bun:test";
import { resolveObjectURL } from "node:buffer";

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

test("blob URLs created inside a Worker are revoked when the worker terminates", async () => {
  // A blob URL created on the main thread; must survive the worker's teardown.
  const parentUrl = URL.createObjectURL(new Blob(["from parent"]));

  const worker = new Worker(
    URL.createObjectURL(
      new Blob(
        [
          `
          const urls = [];
          for (let i = 0; i < 4; i++) {
            urls.push(URL.createObjectURL(new Blob(["from worker " + i])));
          }
          self.postMessage(urls);
          // Stay alive until the parent terminates us.
          setInterval(() => {}, 1_000_000);
          `,
        ],
        { type: "application/javascript" },
      ),
    ),
  );

  const urls = await new Promise<string[]>(resolve => {
    worker.onmessage = e => resolve(e.data);
  });
  expect(urls).toHaveLength(4);

  // While the worker is alive, its blob URLs are resolvable from the parent.
  const live = resolveObjectURL(urls[0]);
  expect(live).toBeInstanceOf(Blob);
  expect(await live!.text()).toBe("from worker 0");

  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve(), { once: true }));
  worker.terminate();
  await closed;

  // After termination, every URL the worker created must be auto-revoked.
  // Previously these stayed in the process-global ObjectURLRegistry forever.
  for (const url of urls) {
    expect(resolveObjectURL(url)).toBeUndefined();
  }

  // URLs created by the parent context are unaffected.
  const stillThere = resolveObjectURL(parentUrl);
  expect(stillThere).toBeInstanceOf(Blob);
  expect(await stillThere!.text()).toBe("from parent");
  URL.revokeObjectURL(parentUrl);
});

test("blob URLs created inside a Worker are revoked when the worker exits naturally", async () => {
  const worker = new Worker(
    URL.createObjectURL(
      new Blob(
        [`self.postMessage(URL.createObjectURL(new Blob(["bye"])));`],
        { type: "application/javascript" },
      ),
    ),
  );

  const url = await new Promise<string>(resolve => {
    worker.onmessage = e => resolve(e.data);
  });

  await new Promise<void>(resolve => worker.addEventListener("close", () => resolve(), { once: true }));

  expect(resolveObjectURL(url)).toBeUndefined();
});
