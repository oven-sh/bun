import { expect, test } from "bun:test";

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
