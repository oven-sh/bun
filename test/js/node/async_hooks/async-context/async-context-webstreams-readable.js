process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();
const store = () => asyncLocalStorage.getStore() ?? "-";
let failed = false;

async function row(name, expected, body) {
  const seen = [];
  await body(seen);
  const actual = seen.join(" ");
  if (actual !== expected) {
    console.error(`FAIL: ${name}: expected "${expected}", got "${actual}"`);
    failed = true;
  }
}

// A source made outside any store, so that pull() reads the store of the code that caused the pull.
// highWaterMark 0: pull() runs only for a read that waits.
async function pullSource(seen, { type, pull = () => {} } = {}) {
  let pulls = 0;
  const stream = new ReadableStream(
    {
      type,
      pull(controller) {
        seen.push(store());
        if (pulls++ < 4) controller.enqueue(new Uint8Array(1));
        else controller.close();
        return pull();
      },
    },
    { highWaterMark: 0 },
  );
  // Lets start() settle, so that the first read() calls pull() synchronously.
  await new Promise(resolve => setImmediate(resolve));
  return stream;
}

(async () => {
  // Only the first pull() runs in the reader's frame. Each later one starts when the one before it completes.
  for (const [kind, options] of [
    ["pull() returns undefined", {}],
    ["pull() is an async function that does not await", { pull: async () => {} }],
    ["byte stream", { type: "bytes" }],
  ]) {
    await row(`5 reads that wait, ${kind}`, "u1 u1 u1 u1 u1", async seen => {
      const reader = (await pullSource(seen, options)).getReader();
      await asyncLocalStorage.run("u1", () => Promise.all(Array.from({ length: 5 }, () => reader.read())));
    });
  }

  await row("pulls continue in the store of the read() that started the source", "u0 u0 u0 u0 u0", async seen => {
    const reader = (await pullSource(seen)).getReader();
    const reads = [];
    for (let i = 0; i < 5; i++) asyncLocalStorage.run("u" + i, () => reads.push(reader.read()));
    await Promise.all(reads);
  });

  await row("the source of a tee() with both branches read", "u1 u1 u1 u1 u1", async seen => {
    const stream = await pullSource(seen);
    await asyncLocalStorage.run("u1", async () => {
      const readers = stream.tee().map(branch => branch.getReader());
      for (;;) {
        const results = await Promise.all(readers.map(reader => reader.read()));
        if (results.every(result => result.done)) break;
      }
    });
  });

  process.exit(failed ? 1 : 0);
})();
