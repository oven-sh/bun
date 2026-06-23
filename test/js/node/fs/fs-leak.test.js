// This file is a .cjs file so you can run it in node+jest to verify node behaves exactly the same.
const { expect, test } = require("bun:test");
const fs = require("fs");
const { tmpdir, devNull } = require("os");
const { fsStreamInternals } = require("bun:internal-for-testing");
const { bunExe, bunEnv, tempDir } = require("harness");

function getMaxFd() {
  const dev_null = fs.openSync(devNull, "r");
  fs.closeSync(dev_null);
  return dev_null;
}

test("createWriteStream does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(path, {});

    stream.on("error", reject);

    stream.on("open", () => {
      for (let i = 0; i < 100; i++) {
        stream.write("hello world");
      }
      stream.end();
    });

    stream.on("close", () => {
      resolve();
    });
  });

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
});

test("createReadStream does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;
  fs.writeFileSync(path, "hello world\n".repeat(1000));

  let n_bytes = 0;

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(path, {});

    stream.on("error", reject);

    stream.on("data", chunk => {
      n_bytes += chunk.length;
    });

    stream.on("close", () => {
      resolve();
    });
  });

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
  expect(n_bytes).toBe("hello world\n".repeat(1000).length);
});

test("createWriteStream file handle does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;

  const fd = await fs.promises.open(path, "w");
  let closed = false;
  fd.on("close", () => {
    closed = true;
  });

  await new Promise((resolve, reject) => {
    const stream = fd.createWriteStream();
    expect(stream.autoClose).toBe(true);

    stream.on("error", reject);
    stream.on("open", () => {
      reject(new Error("fd is already open. open event should not be called"));
    });

    stream.on("close", () => {
      resolve();
    });

    for (let i = 0; i < 100; i++) {
      stream.write("hello world");
    }
    stream.end();
  });

  expect(closed).toBe(true);

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
});

test("createReadStream file handle does not leak file descriptors", async () => {
  let start = getMaxFd();
  const path = `${tmpdir()}/${Date.now()}.leakTest.txt`;
  fs.writeFileSync(path, "hello world\n".repeat(1000));

  let n_bytes = 0;

  const fd = await fs.promises.open(path, "r");

  await new Promise((resolve, reject) => {
    const stream = fd.createReadStream({});

    stream.on("error", reject);

    stream.on("data", chunk => {
      n_bytes += chunk.length;
    });

    stream.on("close", () => {
      resolve();
    });
  });

  await fd.close();
  await fd.close();

  // If this is larger than the start value, it means that the file descriptor was not closed
  expect(getMaxFd()).toBe(start);
  expect(n_bytes).toBe("hello world\n".repeat(1000).length);
});

// https://github.com/oven-sh/bun/issues/32191
test("async fs ops with Buffer path arguments do not leak the path argument", async () => {
  const N = 64;
  const WARM = 16;
  const script = `
    const fs = require("node:fs");
    const util = require("node:util");
    const { heapStats } = require("bun:jsc");

    const N = ${N};
    const WARM = ${WARM};

    function liveCounts(types) {
      Bun.gc(true);
      const counts = heapStats().objectTypeCounts;
      return types.map(t => counts[t] ?? 0);
    }

    // Returns the worst delta across the observed heap types.
    async function measure(types, op) {
      if (!Array.isArray(types)) types = [types];
      for (let i = 0; i < WARM; i++) await op(N + i);
      const before = liveCounts(types);
      for (let i = 0; i < N; i++) await op(i);
      const after = liveCounts(types);
      return Math.max(...after.map((v, idx) => v - before[idx]));
    }

    // Expect the exact error so a parse-time rejection cannot silently skip
    // the async path and make a segment vacuous.
    const expectEnoent = e => {
      if (e.code !== "ENOENT") throw e;
    };
    const expectAborted = e => {
      if (e.name !== "AbortError") throw e;
    };

    const deltas = {};
    deltas.accessBufferPath = await measure("Uint8Array", i =>
      fs.promises.access(Buffer.from("missing-" + i)).catch(expectEnoent),
    );
    deltas.accessArrayBufferPath = await measure("ArrayBuffer", i => {
      const bytes = Buffer.from("missing-" + i);
      const path = new ArrayBuffer(bytes.length);
      new Uint8Array(path).set(bytes);
      return fs.promises.access(path).catch(expectEnoent);
    });
    deltas.writeFileBufferPath = await measure("Uint8Array", i =>
      fs.promises.writeFile(Buffer.from("out-" + (i % 2) + ".txt"), "x"),
    );
    deltas.abortedWriteFileBufferPath = await measure("Uint8Array", i =>
      fs.promises
        .writeFile(Buffer.from("out-aborted.txt"), Buffer.from("data-" + i), { signal: AbortSignal.abort() })
        .catch(expectAborted),
    );
    // writev/readv buffers take per-element roots at parse and the array root
    // at schedule; both must be released at completion, so watch both the
    // element buffers and the array wrapper.
    const writev = util.promisify(fs.writev);
    const readv = util.promisify(fs.readv);
    const vfd = fs.openSync("vec.txt", "w+");
    deltas.writevBuffers = await measure(["Uint8Array", "Array"], i =>
      writev(vfd, [Buffer.from("vec-a-" + i), Buffer.from("vec-b-" + i)], 0),
    );
    deltas.readvBuffers = await measure(["Uint8Array", "Array"], i =>
      readv(vfd, [Buffer.alloc(8), Buffer.alloc(8)], 0),
    );
    fs.closeSync(vfd);
    // readdir is a separate hand-written binding (Binding::readdir) from the
    // generic run_async path above, so exercise its Buffer-path root too.
    // (cp is the other hand-written binding, but its JS wrapper rejects
    // non-string paths, so a Buffer path never reaches the native binding.)
    deltas.readdirBufferPath = await measure("Uint8Array", i => fs.promises.readdir(Buffer.from(".")));
    if (!fs.existsSync("out-0.txt") || !fs.existsSync("out-1.txt")) {
      throw new Error("writeFile segment did not write its files");
    }
    console.log(JSON.stringify(deltas));
  `;

  using dir = tempDir("fs-buffer-path-leak", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  let deltas;
  try {
    deltas = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`fixture did not produce JSON (exit ${exitCode}):\nstdout: ${stdout}\nstderr: ${stderr}`);
  }

  // Before the fix, every async call with a Buffer/ArrayBuffer path argument
  // left the argument permanently gcProtect'ed, so each delta equaled N.
  const verdict = Object.fromEntries(
    Object.entries(deltas).map(([op, delta]) => [op, delta < N / 4 ? "ok" : `leaked ${delta} objects over ${N} calls`]),
  );
  expect(verdict).toEqual({
    accessBufferPath: "ok",
    accessArrayBufferPath: "ok",
    writeFileBufferPath: "ok",
    abortedWriteFileBufferPath: "ok",
    writevBuffers: "ok",
    readvBuffers: "ok",
    readdirBufferPath: "ok",
  });
  expect(exitCode).toBe(0);
});
