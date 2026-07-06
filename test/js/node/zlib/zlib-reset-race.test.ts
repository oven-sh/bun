// reset() mutates the z_stream (zlib) or destroys and re-creates the encoder
// instance (brotli/zstd). While an async write is running on the threadpool
// that state is owned by the worker thread, so node refuses the call with
// `Error: Cannot reset zlib stream while a write is in progress` instead of
// racing it. Bun used to defer the reset until the write retired, so every
// state below silently returned undefined.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import zlib from "zlib";

const MESSAGE = "Cannot reset zlib stream while a write is in progress";

// node throws a plain Error here, without a `code`.
const REFUSED = { threw: true, name: "Error", code: undefined, message: MESSAGE };
const ALLOWED = { threw: false };

function resetOutcome(z: any) {
  try {
    z.reset();
    return { threw: false };
  } catch (e: any) {
    return { threw: true, name: e.name, code: e.code, message: e.message };
  }
}

// Incompressible enough that a 300 KB write needs several threadpool round
// trips, matching the report's reproduction.
function payload(size = 300_000) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 13;
  return buf;
}

test("reset() inside end()'s finish callback is refused", async () => {
  const z = zlib.createDeflateRaw();
  z.resume();
  const { promise, resolve, reject } = Promise.withResolvers<ReturnType<typeof resetOutcome>>();
  z.on("error", reject);
  z.write("hello");
  // `_final` calls back immediately and `_flush` issues the implicit Z_FINISH
  // write from 'prefinish', so that write is still in flight here.
  z.end(() => resolve(resetOutcome(z)));
  expect(await promise).toEqual(REFUSED);
  z.destroy();
});

test("reset() inside a decompressor's finish callback is refused", async () => {
  const z = zlib.createGunzip();
  z.resume();
  const { promise, resolve, reject } = Promise.withResolvers<ReturnType<typeof resetOutcome>>();
  z.on("error", reject);
  z.end(zlib.gzipSync("hello"), () => resolve(resetOutcome(z)));
  expect(await promise).toEqual(REFUSED);
  z.destroy();
});

test("reset() with a queued write is refused and leaves the stream intact", async () => {
  const input = payload();
  const z = zlib.createDeflateRaw({ level: 6 });
  const out: Buffer[] = [];
  z.on("data", chunk => out.push(chunk));

  z.write(input);
  expect(resetOutcome(z)).toEqual(REFUSED);
  z.write(input.subarray(0, 1000));
  expect(resetOutcome(z)).toEqual(REFUSED);

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  z.on("error", reject);
  z.on("end", resolve);
  z.end();
  await promise;

  const expected = Buffer.concat([input, input.subarray(0, 1000)]);
  const inflated = zlib.inflateRawSync(Buffer.concat(out));
  expect({ length: inflated.length, matches: inflated.equals(expected) }).toEqual({
    length: expected.length,
    matches: true,
  });
});

test.each([
  ["gzip", () => zlib.createGzip()],
  ["brotli", () => zlib.createBrotliCompress()],
  ["zstd", () => zlib.createZstdCompress()],
] as const)("reset() with a queued write is refused (%s)", async (_name, create) => {
  const z = create();
  z.on("data", () => {});
  z.write(payload());
  expect(resetOutcome(z)).toEqual(REFUSED);

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  z.on("error", reject);
  z.on("end", resolve);
  z.end();
  await promise;
});

// The guard must only fire while the native write is actually outstanding:
// every state below is accepted on node too.
test("reset() is allowed before any write", () => {
  const z = zlib.createDeflateRaw();
  expect(resetOutcome(z)).toEqual(ALLOWED);
  z.destroy();
});

test("reset() is allowed from the write callback", async () => {
  const z = zlib.createDeflateRaw();
  z.resume();
  const { promise, resolve, reject } = Promise.withResolvers<ReturnType<typeof resetOutcome>>();
  z.on("error", reject);
  z.write(payload(), () => resolve(resetOutcome(z)));
  expect(await promise).toEqual(ALLOWED);
  z.destroy();
});

test("reset() is allowed from a 'data' handler", async () => {
  const z = zlib.createDeflateRaw();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let outcome: ReturnType<typeof resetOutcome> | undefined;
  z.on("error", reject);
  z.on("end", resolve);
  z.on("data", () => {
    outcome ??= resetOutcome(z);
  });
  z.end(payload());
  await promise;
  expect(outcome).toEqual(ALLOWED);
});

test("reset() is allowed after flush()", async () => {
  const z = zlib.createDeflateRaw();
  z.resume();
  z.write("hello");
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  z.on("error", reject);
  z.flush(resolve);
  await promise;
  expect(resetOutcome(z)).toEqual(ALLOWED);
  z.destroy();
});

// Subprocess fixtures: refusing the call is what keeps reset() off state a
// worker thread is still inside doWork() on. Before the guard existed, zstd
// read freed memory here (heap-use-after-free under ASAN) and brotli silently
// corrupted its encoder. The spin keeps the worker mid-compression, so a
// regression resurfaces as a fault rather than just a missing throw.
const fixture = (create: string, busyMs: number, buf: string) => /* js */ `
  const zlib = require("zlib");
  const crypto = require("crypto");

  const buf = ${buf};

  let remaining = 0;
  for (let i = 0; i < 4; i++) {
    remaining++;
    const z = ${create};
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    // Spin so the threadpool is inside the compression call before reset().
    const start = Date.now();
    while (Date.now() - start < ${busyMs}) {}
    let message;
    try { z.reset(); } catch (e) { message = e.message; }
    if (message !== ${JSON.stringify(MESSAGE)}) {
      console.error("expected reset() to be refused, got: " + message);
      process.exit(1);
    }
  }
`;

const zstdFixture = fixture(
  `zlib.createZstdCompress({
      chunkSize: 1024 * 1024,
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 },
    })`,
  30,
  "crypto.randomBytes(1024 * 1024)",
);

const brotliFixture = fixture(
  `zlib.createBrotliCompress({
      chunkSize: 1024 * 1024,
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    })`,
  10,
  `Buffer.alloc(2 * 1024 * 1024, "abcdefgh")`,
);

const deflateFixture = fixture(
  `zlib.createDeflate({ chunkSize: 2 * 1024 * 1024, level: 9 })`,
  10,
  "crypto.randomBytes(2 * 1024 * 1024)",
);

// These tests are intentionally sequential (not test.concurrent): each
// subprocess launches several threadpool compression jobs at high quality
// levels, and running three of them at once makes individual test wall
// times highly variable under CPU contention. Sequential keeps each test
// comfortably under the default timeout.
async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("zstd: reset() while an async write is in flight does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(zstdFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("brotli: reset() while an async write is in flight does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(brotliFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("deflate: reset() while an async write is in flight does not race", async () => {
  const { stdout, stderr, exitCode } = await run(deflateFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
