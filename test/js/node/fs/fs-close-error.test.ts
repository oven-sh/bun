// A file system can report a write error first at close(2): NFS, SMB and FUSE
// do that for ENOSPC, EDQUOT and EIO. The write itself returned success, so the
// close is the only report. Node passes the error of the close to the caller.
//
// CI has no such mount. An LD_PRELOAD shim (fs-close-error-shim.c) fails the
// close of each file named "<name>.<errno>.close-fault" that is open for
// writing, after the descriptor is released, and writes one line to stderr for
// it. The shim interposes libc's syscall(), so these tests need glibc.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isGlibc, tempDir } from "harness";
import { constants } from "node:os";
import { join } from "node:path";

const cc = isGlibc ? Bun.which("cc") || Bun.which("gcc") || Bun.which("clang") : null;
const { ENOSPC, EDQUOT, EIO, EINTR, EINPROGRESS } = constants.errno;
const fault = `${ENOSPC}.close-fault`;
const failed = (...errnos: number[]) => errnos.map(errno => `close-fault: errno ${errno}`);
const writeApis = [
  "writeFileSync",
  "writeFile",
  "promises.writeFile",
  "appendFileSync",
  "appendFile",
  "promises.appendFile",
];

// `settle(fn)` is what the call did: "returned", or the code and the syscall of its error.
const settle = /* js */ `
  const settle = async fn => {
    try {
      await fn();
      return "returned";
    } catch (e) {
      return e.code + " " + e.syscall;
    }
  };
`;

const nodeFsFixture = /* js */ `
  const fs = require("node:fs");
  const data = Buffer.alloc(4096, "a");
  ${settle}
  const out = { closeSync: {} };

  for (const [name, errno] of Object.entries(${JSON.stringify({ ENOSPC, EDQUOT, EIO, EINTR, EINPROGRESS })})) {
    const fd = fs.openSync("closeSync." + errno + ".close-fault", "w");
    fs.writeSync(fd, data);
    out.closeSync[name] = await settle(() => fs.closeSync(fd));
  }

  const fd = fs.openSync("close.${fault}", "w");
  fs.writeSync(fd, data);
  out.close = await settle(() => new Promise((resolve, reject) => fs.close(fd, e => (e ? reject(e) : resolve()))));

  const handle = await fs.promises.open("FileHandle.${fault}", "w");
  await handle.write(data);
  out.fileHandle = { close: await settle(() => handle.close()), fd: handle.fd };

  const stream = fs.createWriteStream("stream.${fault}");
  out.createWriteStream = await settle(
    () => new Promise((resolve, reject) => stream.on("error", reject).on("close", resolve).end(data)),
  );

  // fs.promises.writeFile with an iterable closes the file itself, after its writer closed a duplicate of the
  // descriptor. The shim fails both closes. On NFS and SMB only the first one gets the error, and the writer drops it.
  async function* chunks(then) {
    yield data;
    if (then) yield then();
  }
  const codes = e => ({ code: e.code, errors: e.errors?.map(inner => inner.code) });
  const writeFile = (path, then, signal) => fs.promises.writeFile(path, chunks(then), { signal }).then(() => "returned", codes);
  const early = new AbortController();
  const abortedAfterOpen = writeFile("abort-early.${fault}", undefined, early.signal);
  early.abort();
  const late = new AbortController();
  out.writeFileIterable = {
    close: await settle(() => fs.promises.writeFile("iterable.${fault}", chunks())),
    iterableAndClose: await writeFile("iterable-error.${fault}", () => {
      throw Object.assign(new Error("from the iterable"), { code: "EITER" });
    }),
    abortAfterOpenAndClose: await abortedAfterOpen,
    abortInIterableAndClose: await writeFile("abort-late.${fault}", () => (late.abort(), data), late.signal),
  };

  // writeFile and appendFile by path close the file themselves.
  const withCallback = (fn, path) => new Promise((resolve, reject) => fn(path, data, e => (e ? reject(e) : resolve())));
  const byPath = {
    "writeFileSync": path => fs.writeFileSync(path, data),
    "writeFile": path => withCallback(fs.writeFile, path),
    "promises.writeFile": path => fs.promises.writeFile(path, data),
    "appendFileSync": path => fs.appendFileSync(path, data),
    "appendFile": path => withCallback(fs.appendFile, path),
    "promises.appendFile": path => fs.promises.appendFile(path, data),
  };
  out.byPath = {};
  for (const [api, write] of Object.entries(byPath)) {
    const path = api + ".${fault}";
    let error = "returned";
    try {
      await write(path);
    } catch (e) {
      error = { code: e.code, syscall: e.syscall, path: e.path, fd: e.fd };
    }
    out.byPath[api] = { error, size: fs.statSync(path).size };
  }

  // Bun.write closes its own descriptor and drops the result of the close.
  await settle(() => Bun.write("bun-write.${fault}", data));
  out.afterInternalCloses = "alive";

  console.log(JSON.stringify(out));
`;

// respondWithFile opens the file for reading. "/cancelled": statCheck cancels the send, and http2 closes the
// descriptor. "/sent": the read stream closes it after the last byte, and the trailers keep the http2 stream open
// until the callback of that close has run.
const http2Fixture = /* js */ `
  const fs = require("node:fs");
  const http2 = require("node:http2");

  const sentFileClosed = Promise.withResolvers();
  const close = fs.close;
  fs.close = (fd, callback) => {
    if (!fs.readlinkSync("/proc/self/fd/" + fd).endsWith("sent.${EIO}.close-fault")) return close(fd, callback);
    close(fd, err => {
      callback(err);
      sentFileClosed.resolve();
    });
  };

  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    if (headers[":path"] === "/cancelled") {
      stream.respondWithFile("cancelled.${EIO}.close-fault", {}, {
        statCheck() {
          stream.respond({ ":status": 200 });
          stream.end("from statCheck");
          return false;
        },
      });
      return;
    }
    stream.on("error", () => {});
    stream.on("wantTrailers", async () => {
      await sentFileClosed.promise;
      setImmediate(() => stream.closed || stream.sendTrailers({ "x-file": "closed" }));
    });
    stream.respondWithFile("sent.${EIO}.close-fault", {}, { waitForTrailers: true });
  });

  // What the client got: the body, and the code that closed the stream (0 is NGHTTP2_NO_ERROR).
  const get = (client, path) =>
    new Promise(resolve => {
      const request = client.request({ ":path": path });
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => (body += chunk));
      request.on("error", () => {});
      request.on("close", () => resolve({ body, rstCode: request.rstCode }));
      request.end();
    });

  server.listen(0, "127.0.0.1", async () => {
    const client = http2.connect("http://127.0.0.1:" + server.address().port);
    const out = { cancelled: await get(client, "/cancelled"), sent: await get(client, "/sent") };
    client.close();
    server.close();
    console.log(JSON.stringify(out));
  });
`;

describe.skipIf(!cc)("a close(2) that reports an error", () => {
  let shimDir: ReturnType<typeof tempDir> | undefined;
  let shim: string;
  // A debug build on a loaded machine needs up to 6 s for one fixture, and a test has 5 s. Other builds keep the default.
  const timeout = isDebug ? 30_000 : undefined;

  beforeAll(async () => {
    shimDir = tempDir("fs-close-error-shim", {});
    shim = join(String(shimDir), "shim.so");
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(import.meta.dir, "fs-close-error-shim.c"), "-ldl"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, compiled] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
    if (compiled !== 0) throw new Error(`Failed to build the shim:\n${err || out}`);
  });

  afterAll(() => {
    shimDir?.[Symbol.dispose]();
  });

  // Runs main.mjs of `cwd` under the shim. Each close that the shim fails is one line of stderr.
  async function run(cwd: string, env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: { ...bunEnv, LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let parsed: unknown = stdout;
    try {
      parsed = JSON.parse(stdout);
    } catch {}
    return {
      stdout: parsed,
      stderr: stderr.split("\n").filter(line => line.length > 0 && !line.startsWith("WARNING: ASAN interferes")),
      exitCode,
    };
  }

  test.concurrent(
    "fs.close, FileHandle.close, write streams, writeFile and appendFile report it",
    async () => {
      using dir = tempDir("fs-close-error", { "main.mjs": nodeFsFixture });
      expect(await run(String(dir))).toEqual({
        stdout: {
          closeSync: {
            ENOSPC: "ENOSPC close",
            EDQUOT: "EDQUOT close",
            EIO: "EIO close",
            // libuv: "The close is in progress, not an error."
            EINTR: "returned",
            EINPROGRESS: "returned",
          },
          close: "ENOSPC close",
          fileHandle: { close: "ENOSPC close", fd: -1 },
          createWriteStream: "ENOSPC close",
          writeFileIterable: {
            close: "ENOSPC close",
            // Node's handleFdClose: the error that came first keeps its place, in an AggregateError.
            iterableAndClose: { code: "EITER", errors: ["EITER", "ENOSPC"] },
            abortAfterOpenAndClose: { code: "ABORT_ERR", errors: ["ABORT_ERR", "ENOSPC"] },
            abortInIterableAndClose: { code: "ABORT_ERR", errors: ["ABORT_ERR", "ENOSPC"] },
          },
          // As in node, the error names only the syscall, and the file stays.
          byPath: Object.fromEntries(
            writeApis.map(api => [api, { error: { code: "ENOSPC", syscall: "close" }, size: 4096 }]),
          ),
          // A debug build asserts on a close whose result bun drops. The assert is for EBADF, a use after close.
          afterInternalCloses: "alive",
        },
        // Each descriptor is closed once: 5 for closeSync, then 17 that report ENOSPC.
        stderr: failed(ENOSPC, EDQUOT, EIO, EINTR, EINPROGRESS, ...Array(17).fill(ENOSPC)),
        exitCode: 0,
      });
    },
    timeout,
  );

  // The descriptor was only read, so nothing can act on the result of its close. Node asserts on the
  // first close, and destroys the stream with the error of the second.
  test.concurrent(
    "http2 respondWithFile ignores it",
    async () => {
      using dir = tempDir("fs-close-error", {
        "main.mjs": http2Fixture,
        // Written here, without the shim. The http2 server only reads them.
        [`cancelled.${EIO}.close-fault`]: "hello",
        [`sent.${EIO}.close-fault`]: "hello",
      });
      expect(await run(String(dir), { CLOSE_FAULT_READERS: "1" })).toEqual({
        stdout: { cancelled: { body: "from statCheck", rstCode: 0 }, sent: { body: "hello", rstCode: 0 } },
        stderr: failed(EIO, EIO),
        exitCode: 0,
      });
    },
    timeout,
  );
});
