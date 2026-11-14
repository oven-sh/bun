process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Writable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
const store = () => asyncLocalStorage.getStore() ?? "-";
const chunk = new Uint8Array(1);
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

// A sink that records the store each of its callbacks reads.
function recordingSink(seen, write = () => {}) {
  return {
    write() {
      seen.push(store());
      return write();
    },
    close() {
      seen.push("close:" + store());
    },
    abort() {
      seen.push("abort:" + store());
    },
  };
}

// Lets start() settle, so that the first write() runs the sink synchronously.
const started = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // Only the first write() runs in the caller's frame. Each later one starts when the one before it completes.
  for (const [kind, write] of [
    ["returns undefined", () => {}],
    ["async function that does not await", async () => {}],
    ["returns a resolved promise", () => Promise.resolve()],
    ["returns a promise that resolves later", () => new Promise(resolve => setImmediate(resolve))],
  ]) {
    await row(`4 queued writes and close(), sink write() ${kind}`, "u1 u1 u1 u1 close:u1", async seen => {
      await asyncLocalStorage.run("u1", async () => {
        const writer = new WritableStream(recordingSink(seen, write)).getWriter();
        for (let i = 0; i < 4; i++) writer.write(chunk);
        await writer.close();
      });
    });
  }

  await row("queued writes continue in the store of the write() that started the sink", "u0 u0 u0 u0", async seen => {
    const stream = new WritableStream(recordingSink(seen));
    await started();
    const writer = stream.getWriter();
    const writes = [];
    for (let i = 0; i < 4; i++) asyncLocalStorage.run("u" + i, () => writes.push(writer.write(chunk)));
    await Promise.all(writes);
  });

  await row("a second burst starts in its own store", "u1 u1 u2 u2 close:u2", async seen => {
    const stream = new WritableStream(recordingSink(seen));
    await started();
    const writer = stream.getWriter();
    for (const name of ["u1", "u2"]) {
      await asyncLocalStorage.run(name, () => Promise.all([writer.write(chunk), writer.write(chunk)]));
    }
    await asyncLocalStorage.run("u2", () => writer.close());
  });

  await row("a first write() outside any store starts a chain with no store", "- - - - close:-", async seen => {
    const stream = new WritableStream(recordingSink(seen));
    await started();
    const writer = stream.getWriter();
    writer.write(chunk);
    await asyncLocalStorage.run("u1", async () => {
      for (let i = 0; i < 3; i++) writer.write(chunk);
      await writer.close();
    });
  });

  await row("writes made before start() settled run in the store of the constructor", "u0 u0 close:u0", async seen => {
    const writer = asyncLocalStorage.run("u0", () => new WritableStream(recordingSink(seen)).getWriter());
    await asyncLocalStorage.run("u1", async () => {
      writer.write(chunk);
      writer.write(chunk);
      await writer.close();
    });
  });

  await row("close() behind a write in flight runs in the store of that write", "u0 close:u0", async seen => {
    const stream = new WritableStream(recordingSink(seen));
    await started();
    const writer = stream.getWriter();
    asyncLocalStorage.run("u0", () => writer.write(chunk));
    await asyncLocalStorage.run("u9", () => writer.close());
  });

  await row("abort() behind a write in flight runs in the store of that write", "u0 abort:u0", async seen => {
    const stream = new WritableStream(recordingSink(seen));
    await started();
    const writer = stream.getWriter();
    asyncLocalStorage.run("u0", () => writer.write(chunk).catch(() => {}));
    await asyncLocalStorage.run("u9", () => writer.abort(new Error("abort")));
  });

  await row("Writable.fromWeb(): 4 queued writes and end()", "u1 u1 u1 u1 close:u1", async seen => {
    const stream = new WritableStream(recordingSink(seen));
    await started();
    await asyncLocalStorage.run("u1", async () => {
      const writable = Writable.fromWeb(stream);
      for (let i = 0; i < 4; i++) writable.write("chunk");
      await new Promise(resolve => writable.end(resolve));
    });
  });

  // Last, because it leaves a store behind: the queued write of one stream does not read a store that the sink of
  // another stream entered.
  await row("enterWith() in the sink of another stream", "a:- b:- a:- b:- a:entered b:-", async seen => {
    const a = new WritableStream({
      write(entersStore) {
        seen.push("a:" + store());
        if (entersStore) asyncLocalStorage.enterWith("entered");
      },
    });
    const b = new WritableStream({
      write() {
        seen.push("b:" + store());
      },
    });
    await started();
    const writerA = a.getWriter();
    const writerB = b.getWriter();
    await Promise.all([
      writerA.write(false),
      writerA.write(true),
      writerB.write(0),
      writerB.write(1),
      writerA.write(false),
      writerB.write(2),
    ]);
  });

  process.exit(failed ? 1 : 0);
})();
