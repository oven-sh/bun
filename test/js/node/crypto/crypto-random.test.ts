import { describe, expect, it } from "bun:test";
import { randomBytes, randomFill, randomFillSync, randomInt } from "crypto";
import { bunEnv, bunExe } from "harness";

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

  it("async fills the returned buffer (small sizes)", async () => {
    // Small sizes exercise the FastTypedArray path inside
    // ArrayBuffer.alloc — make sure the bytes the callback receives were
    // actually written by the worker and aren't a stale uninitialized copy
    // left behind by a pin-time promotion.
    for (const size of [16, 32, 64]) {
      let allZero = true;
      for (let i = 0; i < 8 && allZero; i++) {
        const buf = await new Promise<Buffer>((resolve, reject) =>
          randomBytes(size, (err, b) => (err ? reject(err) : resolve(b))),
        );
        expect(buf).toBeInstanceOf(Buffer);
        expect(buf.length).toBe(size);
        if (buf.some(x => x !== 0)) allZero = false;
      }
      expect(allZero).toBe(false);
    }
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

describe.concurrent("async crypto does not touch a detached ArrayBuffer backing store", () => {
  // Before the fix, the async variants captured a raw pointer into the
  // ArrayBuffer backing store and only `protect()`ed the JS wrapper. Calling
  // `buffer.transfer()` with a different length frees that storage
  // synchronously, so the worker thread would read from / write to freed
  // gigacage memory. The fix pins the backing ArrayBuffer for the duration
  // of the off-thread work so a concurrent transfer() copies the bytes out
  // instead of detaching. These tests spawn a fresh process so that the
  // observed heap reuse isn't perturbed by the test runner itself.

  it("randomFill does not write through a freed backing store", async () => {
    const src = `
      const crypto = require("crypto");
      const iterations = 8;
      const size = 1 << 16;
      const zero = Buffer.alloc(size);
      const keep = [];
      let pending = iterations;
      let corrupted = 0;
      const nonzero = b => Buffer.compare(Buffer.from(b.buffer, b.byteOffset, b.byteLength), zero) !== 0;
      for (let i = 0; i < iterations; i++) {
        const old = new Uint8Array(size);
        crypto.randomFill(old, () => {
          if (--pending === 0) {
            // re-check after the callbacks fire in case the write raced us
            for (const b of keep) if (nonzero(b)) corrupted++;
            process.stdout.write(String(corrupted));
          }
        });
        // detach + free the backing store before the worker runs
        old.buffer.transfer(0);
        // and hand the same-size allocation back out as an all-zero buffer
        const fresh = new Uint8Array(size);
        keep.push(fresh);
        if (nonzero(fresh)) corrupted++;
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0");
    expect(exitCode).toBe(0);
  });

  it("scrypt pins ArrayBuffer inputs while off-thread", async () => {
    const src = `
      const crypto = require("crypto");
      const size = 1 << 16;
      const password = new Uint8Array(size).fill(0x41);
      const salt = new Uint8Array(16).fill(0x42);
      const expected = crypto.scryptSync(password, salt, 32).toString("hex");
      crypto.scrypt(password, salt, 32, (err, key) => {
        if (err) throw err;
        process.stdout.write(key.toString("hex") === expected ? "ok" : "mismatch:" + key.toString("hex"));
      });
      // free the password backing store and fill the reused storage with junk
      password.buffer.transfer(0);
      const junk = [];
      for (let i = 0; i < 50; i++) junk.push(new Uint8Array(size).fill(0x43));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok");
    expect(exitCode).toBe(0);
  });

  it("pbkdf2 pins ArrayBuffer inputs while off-thread", async () => {
    const src = `
      const crypto = require("crypto");
      const size = 1 << 16;
      const password = new Uint8Array(size).fill(0x41);
      const salt = new Uint8Array(16).fill(0x42);
      const expected = crypto.pbkdf2Sync(password, salt, 1000, 32, "sha256").toString("hex");
      crypto.pbkdf2(password, salt, 1000, 32, "sha256", (err, key) => {
        if (err) throw err;
        process.stdout.write(key.toString("hex") === expected ? "ok" : "mismatch:" + key.toString("hex"));
      });
      password.buffer.transfer(0);
      const junk = [];
      for (let i = 0; i < 50; i++) junk.push(new Uint8Array(size).fill(0x43));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok");
    expect(exitCode).toBe(0);
  });
});
