import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { checkPrime, checkPrimeSync, generatePrime, generatePrimeSync, randomBytes, randomFill, randomFillSync, randomInt } from "crypto";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";

describe("randomInt args validation", () => {
  it("default min is 0 so max should be greater than 0", () => {
    expect(() => randomInt(-1)).toThrow(RangeError);
    expect(() => randomInt(0)).toThrow(RangeError);
  });
  it("max should be >= min", () => {
    expect(() => randomInt(1, 0)).toThrow(RangeError);
    expect(() => randomInt(10, 5)).toThrow(RangeError);
  });

  it("we allow negative numbers", () => {
    expect(() => randomInt(-2, -1)).not.toThrow(RangeError);
  });

  it("max/min should not be greater than Number.MAX_SAFE_INTEGER or less than Number.MIN_SAFE_INTEGER", () => {
    expect(() => randomInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });

  it("max - min should be <= 281474976710655", () => {
    expect(() => randomInt(-2, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("accept large negative numbers", () => {
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER + 1)).not.toThrow(RangeError);
  });

  it("should return undefined if called with callback", async () => {
    const { resolve, promise } = Promise.withResolvers();

    expect(
      randomInt(1, 2, (err, num) => {
        expect(err).toBeUndefined();
        expect(num).toBe(1);
        resolve();
      }),
    ).toBeUndefined();

    await promise;
  });
});

describe("randomBytes", () => {
  it("error should be null", async () => {
    const { resolve, promise } = Promise.withResolvers();

    randomBytes(10, (err, buf) => {
      expect(err).toBeNull();
      expect(buf).toBeInstanceOf(Buffer);
      resolve();
    });

    await promise;
  });
});

describe("randomFill bounds checking", () => {
  // f32 can only represent integers exactly up to 2**24 (16777216). Previously the
  // bounds check in assertSize cast the u32 offset to f32 before adding, so an offset
  // of 16777217 rounded down to 16777216 and `size + offset > length` passed when the
  // true sum exceeded the buffer length, leading to a heap write past the end.
  //
  // Without the fix this path writes out of bounds: debug panics on the slice bounds
  // check and release writes past the allocation. Run in a subprocess so the test
  // runner survives and records a clean failure either way.
  it("randomFillSync rejects size + offset > length when offset exceeds 2**24", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { randomFillSync } = require("crypto");
         const length = 2 ** 24 + 2; // 16777218
         const offset = 2 ** 24 + 1; // 16777217 -> rounds to 16777216 as f32
         const size = 2;             // offset + size = 16777219 > 16777218
         try {
           randomFillSync(new ArrayBuffer(length), offset, size);
           console.log("NO_THROW");
         } catch (e) {
           console.log(e.code);
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("ERR_OUT_OF_RANGE");
    expect(exitCode).toBe(0);
  });

  it("randomFillSync still accepts size + offset == length at the f32 precision boundary", () => {
    const length = 2 ** 24 + 2;
    const offset = 2 ** 24 + 1;
    const size = 1; // offset + size = 16777218 == length, should be fine
    const buf = new Uint8Array(length);
    expect(() => randomFillSync(buf, offset, size)).not.toThrow();
  });

  it("randomFill (async) rejects size + offset > length when offset exceeds 2**24", async () => {
    // Validation errors are thrown synchronously even for the async API. Without the
    // fix the check passes and the threadpool writes past the end of the buffer, so
    // run in a subprocess.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { randomFill } = require("crypto");
         try {
           randomFill(new ArrayBuffer(2 ** 24 + 2), 2 ** 24 + 1, 2, () => {});
           console.log("NO_THROW");
         } catch (e) {
           console.log(e.code);
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("ERR_OUT_OF_RANGE");
  });

  it("randomFill (async) still accepts size + offset == length at the f32 precision boundary", async () => {
    const length = 2 ** 24 + 2;
    const offset = 2 ** 24 + 1;
    const size = 1;
    const buf = new Uint8Array(length);
    const { promise, resolve } = Promise.withResolvers<Error | null>();
    randomFill(buf, offset, size, err => resolve(err));
    expect(await promise).toBeNull();
  });
});

describe("randomFill default size with multi-byte typed arrays", () => {
  // In the 3-arg form `randomFill(buf, offset, cb)`, the default size was computed
  // as `buf.len - offset` where `buf.len` is the element count but `offset` had
  // already been scaled to a byte offset by assertOffset. For element_size > 1 this
  // either underflowed (panic in debug) or under-filled the buffer.
  it("randomFill(Float64Array, offset, cb) does not underflow when byte offset > element count", async () => {
    // Without the fix this underflows usize and panics in debug, so run in a subprocess.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { randomFill } = require("crypto");
         // 80 bytes, 10 elements; offset 2 elements = 16 bytes.
         // Previously computed default size as 10 - 16 -> usize underflow.
         randomFill(new Float64Array(10), 2, (err, buf) => {
           if (err) return console.log("ERR:" + err.code);
           console.log("OK", buf[0], buf[1]);
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("OK 0 0");
    expect(exitCode).toBe(0);
  });

  it("randomFill passes the buffer (not 0) to the callback when size is 0", async () => {
    const buf = new Uint8Array(0);
    const { promise, resolve } = Promise.withResolvers<[Error | null, unknown]>();
    randomFill(buf, (err, b) => resolve([err, b]));
    const [err, b] = await promise;
    expect(err).toBeNull();
    expect(b).toBe(buf);
  });

  it("randomFill(Float64Array, offset, cb) fills to the end of the buffer", async () => {
    // Run several times since each byte has a 1/256 chance of being 0 anyway.
    let tailFilled = false;
    for (let i = 0; i < 8 && !tailFilled; i++) {
      const buf = new Float64Array(100); // 800 bytes
      const { promise, resolve } = Promise.withResolvers<Error | null>();
      randomFill(buf, 1, err => resolve(err));
      expect(await promise).toBeNull();
      // Previously only bytes 8..744 were filled; bytes 744..800 stayed zero.
      const bytes = new Uint8Array(buf.buffer);
      if (bytes.subarray(744, 800).some(b => b !== 0)) tailFilled = true;
    }
    expect(tailFilled).toBe(true);
  });
});

describe("generatePrime with add/rem", () => {
  // BoringSSL's probable_prime_dh() applies the safe-prime trial-division
  // criterion (rnd mod p <= 1) to the non-safe search and never re-randomizes,
  // so for any odd prime q dividing `add` a start with rnd mod q == 1 loops
  // forever. It also doesn't clamp the walk to the requested bit length. Bun
  // implements OpenSSL's search in BignumPointer::generate() instead.

  const cases: Array<[number, { add: bigint; rem?: bigint }]> = [
    [16, { add: 3n, rem: 1n }],
    [64, { add: 30n }],
    [64, { add: 30n, rem: 7n }],
    [8, { add: 11n, rem: 4n }],
    [8, { add: 7n, rem: 3n }],
    [32, { add: 12n, rem: 5n }],
    // Cases that already worked previously:
    [64, { add: 4n, rem: 3n }],
    [64, { add: 2n }],
  ];
  const fixture = `
    const { generatePrimeSync, checkPrimeSync } = require("crypto");
    const cases = ${JSON.stringify(cases, (_, v) => (typeof v === "bigint" ? "BIGINT:" + v : v))};
    const revive = o => Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, typeof v === "string" && v.startsWith("BIGINT:") ? BigInt(v.slice(7)) : v]),
    );
    const out = [];
    for (const [bits, rawOpts] of cases) {
      const opts = revive(rawOpts);
      const p = generatePrimeSync(bits, { ...opts, bigint: true });
      out.push({
        bits,
        add: String(opts.add),
        rem: opts.rem !== undefined ? String(opts.rem) : undefined,
        p: String(p),
        numBits: p.toString(2).length,
        mod: String(p % opts.add),
        isPrime: checkPrimeSync(p),
      });
    }
    process.stdout.write(JSON.stringify(out));
  `;

  function checkResults(
    results: Array<{ bits: number; add: string; rem?: string; p: string; numBits: number; mod: string; isPrime: boolean }>,
  ) {
    expect(results).toHaveLength(cases.length);
    for (const r of results) {
      expect({ case: `${r.bits} add=${r.add} rem=${r.rem}`, numBits: r.numBits, mod: r.mod, isPrime: r.isPrime }).toEqual({
        case: `${r.bits} add=${r.add} rem=${r.rem}`,
        numBits: r.bits,
        mod: r.rem ?? "1",
        isPrime: true,
      });
    }
  }

  it("generatePrimeSync terminates and honors the requested bit length", async () => {
    // Run in a subprocess with a kill guard: before the fix these inputs loop
    // forever at 100% CPU and the sync form wedges the whole process.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4500,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, signalCode: proc.signalCode }).toEqual({ stderr: "", signalCode: null });
    expect(exitCode).toBe(0);
    checkResults(JSON.parse(stdout));
  });

  it("generatePrime (async) calls back for add/rem inputs that previously hung", async () => {
    // Run in a subprocess: before the fix each call permanently consumes a
    // threadpool thread at 100% CPU and the callback never fires, so an
    // in-process test would leave spinning threads behind for the rest of the
    // suite even after timing out.
    const asyncFixture = `
      const { generatePrime, checkPrimeSync } = require("crypto");
      const cases = ${JSON.stringify(cases, (_, v) => (typeof v === "bigint" ? "BIGINT:" + v : v))};
      const revive = o => Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, typeof v === "string" && v.startsWith("BIGINT:") ? BigInt(v.slice(7)) : v]),
      );
      Promise.all(cases.map(([bits, rawOpts]) => new Promise((resolve, reject) => {
        const opts = revive(rawOpts);
        generatePrime(bits, { ...opts, bigint: true }, (err, p) => {
          if (err) return reject(err);
          resolve({
            bits,
            add: String(opts.add),
            rem: opts.rem !== undefined ? String(opts.rem) : undefined,
            p: String(p),
            numBits: p.toString(2).length,
            mod: String(p % opts.add),
            isPrime: checkPrimeSync(p),
          });
        });
      }))).then(out => process.stdout.write(JSON.stringify(out)), err => { console.error(err); process.exit(1); });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", asyncFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4500,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, signalCode: proc.signalCode }).toEqual({ stderr: "", signalCode: null });
    expect(exitCode).toBe(0);
    checkResults(JSON.parse(stdout));
  });

  it("generatePrimeSync returns fresh values on repeated calls", async () => {
    // Before the fix, size=8 add=7 rem=3 returned 7703 (13 bits) on every call
    // in every process. 8-bit primes that are 3 (mod 7): 17 of them, so 64
    // independent draws collapsing to one value has probability < 17^-63.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { generatePrimeSync } = require("crypto");
         const seen = new Set();
         for (let i = 0; i < 64; i++) {
           const p = generatePrimeSync(8, { add: 7n, rem: 3n, bigint: true });
           seen.add(String(p));
           if (p.toString(2).length !== 8) { console.log("BADBITS:" + p); process.exit(1); }
         }
         process.stdout.write(String(seen.size));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4500,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout, signalCode: proc.signalCode }).toEqual({
      stderr: "",
      stdout: expect.stringMatching(/^\d+$/),
      signalCode: null,
    });
    expect(Number(stdout)).toBeGreaterThan(1);
    expect(exitCode).toBe(0);
  });

  it("generatePrime without add still works", async () => {
    const p = generatePrimeSync(64, { bigint: true });
    expect(p.toString(2).length).toBe(64);
    expect(checkPrimeSync(p)).toBe(true);

    const q = await new Promise<bigint>((resolve, reject) => {
      generatePrime(64, { bigint: true }, (err, p) => (err ? reject(err) : resolve(p as bigint)));
    });
    expect(q.toString(2).length).toBe(64);
    expect(checkPrimeSync(q)).toBe(true);
  });
});

describe("checkPrime candidate handling", () => {
  it("checkPrimeSync uses the candidate bytes provided at call time", () => {
    expect(checkPrimeSync(Buffer.from([7]), { checks: 1 })).toBe(true);
    expect(checkPrimeSync(Buffer.from([9]), { checks: 1 })).toBe(false);

    const candidate = Buffer.from([7]);
    let checksReads = 0;
    const result = checkPrimeSync(candidate, {
      get checks() {
        checksReads++;
        candidate[0] = 9;
        return 1;
      },
    });
    expect(checksReads).toBe(1);
    expect(result).toBe(true);
  });

  it("checkPrime uses the candidate bytes provided at call time", async () => {
    const candidate = Buffer.from([7]);
    let checksReads = 0;
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    checkPrime(
      candidate,
      {
        get checks() {
          checksReads++;
          candidate[0] = 9;
          return 1;
        },
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    const result = await promise;
    expect(checksReads).toBe(1);
    expect(result).toBe(true);
  });
});

// crypto.random* must use the BoringSSL userspace DRBG, not a kernel syscall
// per call. The Rust port initially routed these through bun_core::csprng,
// which on Linux calls libc getrandom(2) every time, incurring a syscall per
// randomInt()/randomBytes()/randomFillSync() call where the Zig build (and
// Node) incur zero after DRBG seeding.
//
// Verified by interposing libc getrandom via LD_PRELOAD and counting calls.
// Linux/glibc only: musl may inline getrandom as a raw syscall, Windows/macOS
// use different entropy syscalls, and the fix is platform-independent (same
// BoringSSL RAND_bytes on every target).
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.concurrent.skipIf(!isLinux || isMusl || !cc)(
  "crypto.random* uses a userspace DRBG (no getrandom per call)",
  () => {
    const N = 5000;
    // BoringSSL seeds its thread-local CTR-DRBG once from the OS and thereafter
    // runs in userspace. Allow a small budget for process startup, JSC, worker
    // threads, etc.; the regression produced >= N calls.
    const MAX_GETRANDOM_CALLS = 200;
    // On Linux release builds Bun terminates via quick_exit(3), which skips
    // __attribute__((destructor)) and atexit handlers, so the count is
    // persisted to a file on every getrandom call rather than reported from a
    // destructor. The constructor writes "0" so the file exists even when no
    // getrandom calls occur.
    const interposerSrc = `
      #define _GNU_SOURCE
      #include <stdio.h>
      #include <stdlib.h>
      #include <dlfcn.h>
      #include <fcntl.h>
      #include <unistd.h>
      #include <sys/types.h>
      static long count = 0;
      static int out_fd = -1;
      static ssize_t (*real_getrandom)(void *, size_t, unsigned int) = 0;
      static void persist(long n) {
        if (out_fd < 0) return;
        char buf[32];
        int len = snprintf(buf, sizeof(buf), "%ld\\n", n);
        pwrite(out_fd, buf, len, 0);
      }
      __attribute__((constructor)) static void init(void) {
        const char *path = getenv("GETRANDOM_COUNT_FILE");
        if (path) {
          out_fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
          persist(0);
        }
      }
      ssize_t getrandom(void *buf, size_t buflen, unsigned int flags) {
        if (!real_getrandom)
          real_getrandom = (ssize_t (*)(void *, size_t, unsigned int))dlsym(RTLD_NEXT, "getrandom");
        long n = __atomic_add_fetch(&count, 1, __ATOMIC_RELAXED);
        persist(n);
        return real_getrandom(buf, buflen, flags);
      }
    `;

    let so: string;
    let dirPath: string;
    let disposeDir: Disposable;
    beforeAll(async () => {
      const dir = tempDir("crypto-getrandom", { "interpose.c": interposerSrc });
      disposeDir = dir;
      dirPath = String(dir);
      so = join(dirPath, "interpose.so");
      await using ccProc = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-O2", "-o", so, join(dirPath, "interpose.c"), "-ldl"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, ccStderr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
      if (ccExit !== 0) throw new Error("cc failed: " + ccStderr);
    });
    afterAll(() => disposeDir?.[Symbol.dispose]());

    async function countGetrandom(name: string, script: string): Promise<number> {
      const countFile = join(dirPath, `count-${name}.txt`);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, LD_PRELOAD: so, GETRANDOM_COUNT_FILE: countFile },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode, stderr }).toMatchObject({ stdout: "ok", exitCode: 0 });
      const text = await Bun.file(countFile).text();
      const m = text.match(/^(\d+)/);
      if (!m) throw new Error("interposer did not write a count; file=" + JSON.stringify(text));
      return Number(m[1]);
    }

    it.each([
      ["randomInt", `const c=require("crypto");for(let i=0;i<${N};i++)c.randomInt(0,1000);console.log("ok")`],
      ["randomBytes", `const c=require("crypto");for(let i=0;i<${N};i++)c.randomBytes(8);console.log("ok")`],
      [
        "randomFillSync",
        `const c=require("crypto");const b=new Uint8Array(8);for(let i=0;i<${N};i++)c.randomFillSync(b);console.log("ok")`,
      ],
      [
        "randomUUID-disableEntropyCache",
        `const c=require("crypto");for(let i=0;i<${N};i++)c.randomUUID({disableEntropyCache:true});console.log("ok")`,
      ],
      [
        "getRandomValues-large",
        `const b=new Uint8Array(1024);for(let i=0;i<${N};i++)crypto.getRandomValues(b);console.log("ok")`,
      ],
    ])("%s does not call getrandom(2) per iteration", async (name, script) => {
      const calls = await countGetrandom(name, script);
      expect(calls).toBeLessThan(MAX_GETRANDOM_CALLS);
    });
  },
);
