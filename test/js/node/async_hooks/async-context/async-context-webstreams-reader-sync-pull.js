process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const assert = require("assert");

const storage = new AsyncLocalStorage();
const store = () => storage.getStore() ?? "no store";

// One turn of the event loop. After it the stream has started.
const settled = () => new Promise(resolve => setImmediate(resolve));

// pull() returns no promise. The stream calls it again for the reads that wait behind the
// first one, in the context of the reader.
async function main() {
  const seen = {};
  for (const type of [undefined, "bytes"]) {
    const pulls = (seen[type ?? "default"] = []);
    const reader = new ReadableStream(
      {
        type,
        pull(controller) {
          pulls.push(store());
          controller.enqueue(new Uint8Array(1));
        },
      },
      { highWaterMark: 0 },
    ).getReader();
    await settled();

    await storage.run("reader", () => Promise.all([reader.read(), reader.read(), reader.read()]));
  }

  assert.deepStrictEqual(seen, {
    default: ["reader", "reader", "reader"],
    bytes: ["reader", "reader", "reader"],
  });
  process.exit(0);
}

main();
