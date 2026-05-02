// Regression test: node:zlib stored a raw pointer into the user-supplied
// dictionary ArrayBuffer and read it lazily from the threadpool
// (inflateSetDictionary on Z_NEED_DICT, and on reset()). Caching the JS view
// does not prevent the underlying ArrayBuffer from being detached —
// ArrayBuffer.prototype.transfer(newLength) with a different length
// synchronously frees the old backing store, leaving the native handle with
// a dangling pointer. Under ASAN this is a heap-use-after-free in
// adler32()/inflateSetDictionary() on the worker thread.
//
// The fix copies the dictionary into an owned buffer in Context.init(),
// matching Node.js (ZlibContext::dictionary_ is a std::vector).

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Malloc=1 routes JSC ArrayBuffer allocations through system malloc instead
// of bmalloc/libpas so that ASAN poisons freed ArrayBuffer backing stores.
// Without it bmalloc keeps the freed region in its own free list and ASAN
// never sees the UAF.
//
// detect_leaks=0: Malloc=1 also exposes pre-existing small runtime leaks
// (parser/transpiler allocations normally hidden behind bmalloc) to
// LeakSanitizer, which would print them to stderr at exit. We only care
// about the heap-use-after-free here.
// symbolize=0: when this test is run against an unfixed build, ASAN aborts
// and symbolizing the debug binary takes longer than the default test
// timeout. We only care that the subprocess prints "OK" and exits 0.
// allow_user_segv_handler=1 suppresses JSC's "ASAN interferes with JSC
// signal handlers" stderr banner on ASAN builds where bunEnv didn't set it.
const asanOptions = [bunEnv.ASAN_OPTIONS, "allow_user_segv_handler=1", "symbolize=0", "detect_leaks=0"]
  .filter(Boolean)
  .join(":");
const env = { ...bunEnv, Malloc: "1", ASAN_OPTIONS: asanOptions };

const inflateFixture = /* js */ `
  const zlib = require("zlib");

  const expected = Buffer.alloc(64, "a").toString();
  const ab = new ArrayBuffer(4096);
  const dict = Buffer.from(ab);
  dict.fill("a");

  // Deflate with a dictionary so the stream sets FDICT and inflate() will
  // return Z_NEED_DICT, which triggers inflateSetDictionary() on the
  // threadpool with the stored dictionary pointer.
  const payload = zlib.deflateSync(Buffer.alloc(64, "a"), { dictionary: dict });

  const inf = zlib.createInflate({ dictionary: dict });
  inf.on("error", err => {
    console.error("error:", err.message);
    process.exitCode = 1;
  });
  let out = Buffer.alloc(0);
  inf.on("data", chunk => {
    out = Buffer.concat([out, chunk]);
  });
  inf.on("end", () => {
    console.log(out.toString() === expected ? "OK" : "WRONG: " + out.toString());
  });

  // transfer() with a different length allocates a new backing, memcpy's, and
  // synchronously frees the old backing (Gigacage::free -> system free under
  // Malloc=1). The native zlib handle still holds a pointer into it.
  ab.transfer(1);

  inf.write(payload, () => inf.end());
`;

const resetFixture = /* js */ `
  const zlib = require("zlib");

  const expected = Buffer.alloc(64, "a").toString();
  const ab = new ArrayBuffer(4096);
  const dict = Buffer.from(ab);
  dict.fill("a");

  const payload = zlib.deflateRawSync(Buffer.alloc(64, "a"), { dictionary: dict });

  // INFLATERAW applies the dictionary synchronously in init(), and reset()
  // re-applies it via setDictionary() — both read the stored pointer.
  const inf = zlib.createInflateRaw({ dictionary: dict });
  inf.on("error", err => {
    console.error("error:", err.message);
    process.exitCode = 1;
  });
  let out = Buffer.alloc(0);
  inf.on("data", chunk => {
    out = Buffer.concat([out, chunk]);
  });
  inf.on("end", () => {
    console.log(out.toString() === expected ? "OK" : "WRONG: " + out.toString());
  });

  ab.transfer(1);

  // reset() re-applies the dictionary from the stored (now stale) pointer.
  inf.reset();
  inf.write(payload, () => inf.end());
`;

const deflateResetFixture = /* js */ `
  const zlib = require("zlib");

  const expected = Buffer.alloc(64, "a").toString();
  const ab = new ArrayBuffer(4096);
  const dict = Buffer.from(ab);
  dict.fill("a");
  const dictCopy = Buffer.from(dict);

  const def = zlib.createDeflate({ dictionary: dict });
  def.on("error", err => {
    console.error("error:", err.message);
    process.exitCode = 1;
  });
  let out = Buffer.alloc(0);
  def.on("data", chunk => {
    out = Buffer.concat([out, chunk]);
  });
  def.on("end", () => {
    const result = zlib.inflateSync(out, { dictionary: dictCopy }).toString();
    console.log(result === expected ? "OK" : "WRONG: " + result);
  });

  ab.transfer(1);

  // reset() calls deflateReset() then deflateSetDictionary() with the stored
  // pointer on the JS thread.
  def.reset();
  def.end(Buffer.alloc(64, "a"));
`;

async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent(
  "inflate: detaching the dictionary ArrayBuffer after createInflate does not use-after-free",
  async () => {
    const { stdout, stderr, exitCode } = await run(inflateFixture);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("inflateRaw: reset() after detaching the dictionary ArrayBuffer does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(resetFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test.concurrent("deflate: reset() after detaching the dictionary ArrayBuffer does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(deflateResetFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
