import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  checkPrime,
  checkPrimeSync,
  generatePrime,
  generatePrimeSync,
  randomBytes,
  randomFill,
  randomFillSync,
  randomInt,
} from "crypto";
import { bunEnv, bunExe, isLinux, isMacOS, isMusl, tempDir } from "harness";
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

  // BoringSSL's RNG registers a pthread_atfork handler on first use and abort()s if that
  // fails. macOS caps a process's atfork table (~680 entries on arm64); mimalloc once
  // registered its fork handlers on every mi_heap_new (one per transpiled module) instead
  // of once per process, so a program that imported ~700 modules and then asked for random
  // bytes died with SIGABRT. Other libcs grow the table dynamically, so only Darwin bites.
  it.skipIf(!isMacOS)("still works after transpiling hundreds of modules (atfork table not exhausted)", async () => {
    const files: Record<string, string> = {};
    let entry = "";
    for (let i = 0; i < 800; i++) {
      files[`m/m${i}.ts`] = `export const v${i}: number = ${i};\n`;
      entry += `import "./m/m${i}.ts";\n`;
    }
    entry += `import { randomBytes } from "node:crypto";\nconsole.log("randomBytes", randomBytes(4).length);\n`;
    files["entry.ts"] = entry;
    using dir = tempDir("crypto-random-atfork", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      cwd: String(dir),
      // Each fresh transpile creates a mimalloc heap; a cache hit would skip that.
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("randomBytes 4\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
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

describe.concurrent("generatePrime with safe and add/rem", () => {
  // BoringSSL's BN_generate_prime_ex search for safe primes on a progression
  // (probable_prime_dh_safe) never checks the size of what it walks to and
  // trial-divides small candidates by themselves, so every size below ~13 bits
  // returned the same 13-bit value (7523 for the progressions below), and with
  // an odd `add` it drifted off the progression and frequently never returned.
  // BignumPointer::generate() now walks the progression itself the way
  // OpenSSL's search (the one behind Node's results) does, except that it keeps
  // stepping after a Miller-Rabin failure where OpenSSL restarts from a new
  // random value; see the comment on generateSafePrimeInProgression. Generation
  // happens in a subprocess with a kill guard so that the never-returning
  // inputs fail instead of wedging the test runner (the async form would
  // otherwise leave a threadpool thread spinning forever).
  // Every case goes through generatePrimeSync and through generatePrime (the
  // threadpool job) `runs` times each (default 1). Results are indexed
  // [form][case][run].
  type Case = { bits: number; add: bigint; rem?: bigint; runs?: number };
  type Form = "generatePrimeSync" | "generatePrime";
  const forms: Form[] = ["generatePrimeSync", "generatePrime"];
  type Results = Record<Form, bigint[][]>;

  const label = (c: Case) => `${c.bits} bits, add ${c.add}${c.rem === undefined ? "" : `, rem ${c.rem}`}`;

  async function generateSafePrimes(cases: Case[]): Promise<Results> {
    const serialized = JSON.stringify(cases, (_, v) => (typeof v === "bigint" ? String(v) : v));
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { generatePrime, generatePrimeSync } = require("crypto");
         const cases = ${serialized};
         const options = c => ({
           safe: true,
           bigint: true,
           add: BigInt(c.add),
           ...(c.rem === undefined ? {} : { rem: BigInt(c.rem) }),
         });
         const forms = {
           generatePrimeSync: c => Promise.resolve(generatePrimeSync(c.bits, options(c))),
           generatePrime: c => new Promise((resolve, reject) =>
             generatePrime(c.bits, options(c), (err, p) => (err ? reject(err) : resolve(p)))),
         };
         (async () => {
           const out = {};
           for (const form in forms) {
             out[form] = [];
             for (const c of cases) {
               const primes = [];
               for (let i = 0; i < (c.runs ?? 1); i++) primes.push(String(await forms[form](c)));
               out[form].push(primes);
             }
           }
           process.stdout.write(JSON.stringify(out));
         })();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, signalCode: proc.signalCode, exitCode }).toEqual({ stderr: "", signalCode: null, exitCode: 0 });
    const out: Record<Form, string[][]> = JSON.parse(stdout);
    const toBigInts = (form: string[][]) => form.map(primes => primes.map(BigInt));
    return { generatePrimeSync: toBigInts(out.generatePrimeSync), generatePrime: toBigInts(out.generatePrime) };
  }

  // For sizes this small the set of possible results is fixed: the first safe
  // prime on the progression at or after a random `bits`-bit start. As in
  // OpenSSL, the result is one bit wider than requested when the start is past
  // the last safe prime of that size (263 for 8 bits; 5 for 2 bits, where no
  // safe prime exists). Node returns exactly these sets for the first five
  // rows. The last row pins the two branches Node's output cannot: every 4-bit
  // start lands on 17 (a start of 9 first projects to 7, below 4 bits, and has
  // to be stepped up), 17 passes the sieve but (17 - 1) / 2 = 8 is not prime,
  // and the walk has to step on through 27 and 37 to 47; Node restarts from a
  // fresh 4-bit value here and never returns.
  //
  // `variesBetweenCalls` pools both forms' results. With these run counts the
  // chance that a row with several allowed values returns the same one on every
  // call is below 1e-8 per row (the likeliest 8-bit value has probability 3/8,
  // the two 4-bit values 1/2 each). Runs are kept low because under a debug
  // build every call pays the full Miller-Rabin confirmation of two primes.
  const smallCases: Array<[Case, bigint[]]> = [
    [{ bits: 8, add: 12n, rem: 11n, runs: 10 }, [167n, 179n, 227n, 263n]],
    [{ bits: 8, add: 4n, rem: 3n, runs: 10 }, [167n, 179n, 227n, 263n]],
    [{ bits: 4, add: 4n, rem: 3n, runs: 14 }, [11n, 23n]],
    [{ bits: 3, add: 4n, rem: 3n, runs: 2 }, [7n]],
    [{ bits: 2, add: 2n, rem: 1n, runs: 2 }, [5n]],
    [{ bits: 4, add: 10n, rem: 7n, runs: 10 }, [47n]],
  ];

  it("small sizes return the next safe prime on the progression, not a fixed 13-bit value", async () => {
    const results = await generateSafePrimes(smallCases.map(([c]) => c));
    const summary = smallCases.map(([c, allowed], i) => ({
      case: label(c),
      unexpected: Object.fromEntries(
        forms.map(form => [form, [...new Set(results[form][i].filter(p => !allowed.includes(p)))]]),
      ),
      variesBetweenCalls: new Set(forms.flatMap(form => results[form][i])).size > 1,
    }));
    expect(summary).toEqual(
      smallCases.map(([c, allowed]) => ({
        case: label(c),
        unexpected: { generatePrimeSync: [], generatePrime: [] },
        variesBetweenCalls: allowed.length > 1,
      })),
    );
  });

  // Inputs the old search never returned from or answered incorrectly: an odd
  // `add` took it off the progression (and hung it whenever the random start
  // shared a factor with `add`), `add` without `rem` must use OpenSSL's
  // safe-prime default residue of 3, `add: 1n` divided by zero internally, and
  // the only 3-bit safe prime that is 1 (mod 4) is 5, whose (p - 1) / 2 is 2.
  //
  // The last row has `add` as wide as the requested size, so every 16-bit start
  // projects onto the same value (32771) and the search is deterministic. The
  // progression's first safe prime from there is 1736759 (21 bits), which is
  // what stepping past failed candidates returns; restarting from a new random
  // start after a failure (OpenSSL, and BoringSSL's old search) retests the same
  // first candidate forever, so Node and the old code both hang on this input.
  // Third element: expected bit length when it is not the requested size.
  const residueCases: Array<[Case, bigint, number?]> = [
    [{ bits: 64, add: 5n }, 3n],
    [{ bits: 64, add: 5n, rem: 3n }, 3n],
    [{ bits: 64, add: 5n, rem: 2n }, 2n],
    [{ bits: 64, add: 7n, rem: 2n }, 2n],
    [{ bits: 64, add: 4n }, 3n],
    [{ bits: 64, add: 4n, rem: 3n }, 3n],
    [{ bits: 64, add: 12n, rem: 11n }, 11n],
    [{ bits: 64, add: 1n, rem: 0n }, 0n],
    [{ bits: 3, add: 4n, rem: 1n }, 1n],
    [{ bits: 16, add: 32769n, rem: 2n }, 2n, 21],
  ];

  it("terminates and honors add/rem, including odd add and a missing rem", async () => {
    const results = await generateSafePrimes(residueCases.map(([c]) => c));
    const describePrime = (c: Case, [p]: bigint[]) => ({
      bits: p.toString(2).length,
      residue: p % c.add,
      safePrime: checkPrimeSync(p) && checkPrimeSync((p - 1n) / 2n),
    });
    const summary = residueCases.map(([c], i) => ({
      case: label(c),
      ...Object.fromEntries(forms.map(form => [form, describePrime(c, results[form][i])])),
    }));
    expect(summary).toEqual(
      residueCases.map(([c, rem, resultBits = c.bits]) => {
        const expected = { bits: resultBits, residue: rem, safePrime: true };
        return { case: label(c), generatePrimeSync: expected, generatePrime: expected };
      }),
    );
  });

  it("safe without add, and add without safe, still go through BN_generate_prime_ex", async () => {
    const safe = generatePrimeSync(64, { safe: true, bigint: true });
    expect([safe.toString(2).length, checkPrimeSync(safe), checkPrimeSync((safe - 1n) / 2n)]).toEqual([64, true, true]);

    const { promise, resolve, reject } = Promise.withResolvers<bigint>();
    generatePrime(64, { add: 12n, rem: 11n, bigint: true }, (err, p) => (err ? reject(err) : resolve(p)));
    const onProgression = await promise;
    expect([onProgression.toString(2).length, onProgression % 12n, checkPrimeSync(onProgression)]).toEqual([
      64,
      11n,
      true,
    ]);
  });

  it("a generation that fails (add 0) does not hand back the untested starting value", () => {
    // The binding currently surfaces a failed generation as the untouched 0n
    // output; propagating it as an exception would be fine too. What must not
    // happen is the random value the walk was seeded with coming back as a prime.
    let outcome: bigint | "threw";
    try {
      outcome = generatePrimeSync(64, { safe: true, add: 0n, bigint: true });
    } catch {
      outcome = "threw";
    }
    expect([0n, "threw"]).toContain(outcome);
  });

  it("worker.terminate() interrupts a search on a progression the sieve always rejects", async () => {
    // p == 1 (mod 3) makes (p - 1) / 2 a multiple of 3, so no candidate ever
    // reaches Miller-Rabin and the walk can only stop at its cancellation
    // callback. The kill guard makes an uninterruptible build fail here.
    using dir = tempDir("generate-prime-terminate", {
      "main.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        worker.onmessage = async () => {
          await worker.terminate();
          console.log("terminated");
          process.exit(0);
        };
      `,
      "worker.js": `
        postMessage("started");
        require("crypto").generatePrimeSync(512, { safe: true, add: 6n, rem: 1n });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, signalCode: proc.signalCode, exitCode }).toEqual({
      stdout: "terminated\n",
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
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
