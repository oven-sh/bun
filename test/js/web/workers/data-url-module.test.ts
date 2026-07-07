import { expect, test } from "bun:test";

// A long data: URL must resolve via the data-URL resolver, not be rejected as
// an overlong file path. The guard trips at MAX_PATH_BYTES * 1.5 (~147KB on
// Windows), so pad past that to exercise the limit on every platform.
// https://github.com/oven-sh/bun/issues/33596 https://github.com/oven-sh/bun/issues/20374
const padding = Buffer.alloc(200_000, "x").toString();

test.concurrent("new Worker() runs a long base64 data: URL", async () => {
  const source = `/* ${padding} */\nself.onmessage = e => postMessage(e.data + 1);\n`;
  const url = `data:application/javascript;base64,${Buffer.from(source).toString("base64")}`;
  expect(url.length).toBeGreaterThan(150_000);

  const worker = new Worker(url);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  worker.onerror = e => reject(new Error(e.message));
  worker.onmessage = e => resolve(e.data);
  worker.postMessage(41);
  try {
    expect(await promise).toBe(42);
  } finally {
    worker.terminate();
  }
});

test.concurrent("import() loads a long base64 data: URL", async () => {
  const source = `/* ${padding} */\nexport default 42;\n`;
  const url = `data:application/javascript;base64,${Buffer.from(source).toString("base64")}`;
  expect(url.length).toBeGreaterThan(150_000);

  const module = await import(url);
  expect(module.default).toBe(42);
});
