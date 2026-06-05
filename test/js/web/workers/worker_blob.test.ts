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

test("object URLs resolved across workers are isolated from each other", async () => {
  const payload = "hello from main";
  const url = URL.createObjectURL(new File([payload], "original.txt", { type: "text/plain" }));

  const workerSource = URL.createObjectURL(
    new Blob(
      [
        `
        import { resolveObjectURL } from "node:buffer";
        self.onmessage = async e => {
          const { url, iterations, mode, payload } = e.data;
          let mismatches = 0;
          let sample = null;
          for (let i = 0; i < iterations; i++) {
            const resolved = resolveObjectURL(url);
            if (!resolved) {
              mismatches++;
              sample ??= "<unresolved>";
              continue;
            }
            if (mode === "writer") {
              new File([resolved], \`renamed-\${i}.txt\`);
              await resolved.text();
            } else {
              if (resolved.name !== "original.txt") {
                mismatches++;
                sample ??= resolved.name;
              }
              if (!resolved.type.startsWith("text/plain")) {
                mismatches++;
                sample ??= resolved.type;
              }
              const text = await resolved.text();
              if (text !== payload) {
                mismatches++;
                sample ??= text;
              }
            }
          }
          postMessage({ mode, mismatches, sample });
        };
        `,
      ],
      { type: "application/javascript" },
    ),
  );

  function run(worker: Worker, message: { url: string; iterations: number; mode: string; payload: string }) {
    return new Promise<{ mode: string; mismatches: number; sample: string | null }>((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(new Error(e.message));
      worker.postMessage(message);
    });
  }

  const writer = new Worker(workerSource);
  const reader = new Worker(workerSource);
  try {
    // Deterministic phase: the writer renames its resolved copy first, then the
    // reader resolves — the registry must still hand out the original name.
    const firstWrite = await run(writer, { url, iterations: 1, mode: "writer", payload });
    expect(firstWrite.mismatches).toBe(0);
    const readAfterWrite = await run(reader, { url, iterations: 25, mode: "reader", payload });
    expect(readAfterWrite.sample).toBeNull();
    expect(readAfterWrite.mismatches).toBe(0);

    // Concurrent phase: both workers hammer the same URL; the reader must never
    // observe the writer's renames or torn contents.
    const [writerResult, readerResult] = await Promise.all([
      run(writer, { url, iterations: 200, mode: "writer", payload }),
      run(reader, { url, iterations: 200, mode: "reader", payload }),
    ]);
    expect(writerResult.mismatches).toBe(0);
    expect(readerResult.sample).toBeNull();
    expect(readerResult.mismatches).toBe(0);
  } finally {
    writer.terminate();
    reader.terminate();
    URL.revokeObjectURL(url);
    URL.revokeObjectURL(workerSource);
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
