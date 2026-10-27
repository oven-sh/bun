process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const assert = require("assert");

const storage = new AsyncLocalStorage();
const store = () => storage.getStore() ?? "no store";

// write() returns no promise. The writes queued behind the first one, and close(), run after
// it completes, in the context of the writer.
async function main() {
  const seen = [];
  const writer = new WritableStream(
    {
      write(chunk) {
        seen.push(`write ${chunk}: ${store()}`);
      },
      close() {
        seen.push(`close: ${store()}`);
      },
    },
    { highWaterMark: 4 },
  ).getWriter();
  // The stream has started once a write completes.
  await writer.write("first");

  await storage.run("writer", () => {
    writer.write("a");
    writer.write("b");
    writer.write("c");
    return writer.close();
  });

  assert.deepStrictEqual(seen, [
    "write first: no store",
    "write a: writer",
    "write b: writer",
    "write c: writer",
    "close: writer",
  ]);
  process.exit(0);
}

main();
