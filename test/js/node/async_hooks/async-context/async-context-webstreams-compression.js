process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { randomBytes } = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

function check(what) {
  if (asyncLocalStorage.getStore()?.test !== "CompressionStream") {
    console.error(`FAIL: ${what} lost context`);
    failed = true;
  }
}

asyncLocalStorage.run({ test: "CompressionStream" }, async () => {
  // Incompressible chunks of 160 KiB: Bun codes a chunk over 128 KiB on its thread pool, and the
  // compressed chunks are over 128 KiB too.
  let chunks = 2;
  const source = new ReadableStream({
    pull(controller) {
      if (chunks-- > 0) controller.enqueue(randomBytes(160 * 1024));
      else controller.close();
    },
  });

  await source
    .pipeThrough(new CompressionStream("gzip"))
    .pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          check("transform() after CompressionStream");
          controller.enqueue(chunk);
        },
      }),
    )
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeTo(
      new WritableStream({
        write() {
          check("write() after DecompressionStream");
        },
        close() {
          check("close() after DecompressionStream");
        },
      }),
    );

  process.exit(failed ? 1 : 0);
});
