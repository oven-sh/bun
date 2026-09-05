import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import os from "node:os";

// Same gate as blob-oom.test.ts / buffer.test.js 4 GiB cases: the multi-GiB tests below
// need real memory (Windows commits allocations upfront; Linux would OOM-kill, not throw).
const hasEnoughMemory = os.totalmem() >= 10 * 1024 ** 3;

// The consumer's own promise plumbing must never route through user-patched
// Promise.prototype.then. (A thenable returned by the user's own start() is
// adopted through it, matching the spec and Node.)
test("readableStreamToArrayBuffer does not call a patched Promise.prototype.then", async () => {
  const originalThen = Promise.prototype.then;
  let counter = 0;
  // @ts-ignore
  Promise.prototype.then = function (...args) {
    counter++;
    return originalThen.apply(this, args);
  };
  try {
    const result = await Bun.readableStreamToArrayBuffer(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("bun is"));
          controller.enqueue(new TextEncoder().encode(" awesome!"));
          controller.close();
        },
      }),
    );
    expect(new TextDecoder().decode(result)).toBe("bun is awesome!");
    expect(counter).toBe(0);
  } finally {
    Promise.prototype.then = originalThen;
  }
});

// Mixed string+binary chunk arrays used to be concatenated through a WTF::Vector, whose
// INT32_MAX capacity cap aborts the whole process once the total crosses 2 GiB. The
// result must instead be assembled in an ArrayBuffer (fine up to 4 GiB on 64-bit), and
// totals past the 4 GiB ArrayBuffer maximum must throw a catchable error.
// Subprocess tests: the failure mode is a process abort, and the large allocations
// should not live in the test runner. Each script prints SKIP if this machine cannot
// allocate the inputs.
for (const consumer of ["readableStreamToArrayBuffer", "readableStreamToBytes"]) {
  test.skipIf(!hasEnoughMemory)(`${consumer} handles mixed string+binary chunks totaling over 2 GiB`, async () => {
    // The trailing "!?" makes a string write land at an offset past 2^31, not just past 2^30.
    const script = `
      const GIB = 1073741824;
      let a, b;
      try {
        a = new Uint8Array(GIB);
        b = new ArrayBuffer(GIB);
      } catch {
        console.log("SKIP");
        process.exit(0);
      }
      a[0] = 0xaa;
      a[GIB - 1] = 0xab;
      const bView = new Uint8Array(b);
      bView[0] = 0xba;
      bView[GIB - 1] = 0xbb;
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(a);
          c.enqueue("xyz");
          c.enqueue(b);
          c.enqueue("!?");
          c.close();
        },
      });
      const result = await Bun.${consumer}(stream);
      const r = result instanceof Uint8Array ? result : new Uint8Array(result);
      console.log(
        JSON.stringify({
          constructor: result.constructor.name,
          byteLength: result.byteLength,
          markers: [r[0], r[GIB - 1], r[GIB], r[GIB + 1], r[GIB + 2], r[GIB + 3], r[2 * GIB + 2], r[2 * GIB + 3], r[2 * GIB + 4]],
        }),
      );
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    if (stdout.trim() === "SKIP") return;
    // String comparison instead of JSON.parse: a crashed child diffs against "" here
    // rather than failing with an unrelated parse error.
    expect(stdout.trim()).toBe(
      JSON.stringify({
        constructor: consumer === "readableStreamToBytes" ? "Uint8Array" : "ArrayBuffer",
        byteLength: 2 * 1073741824 + 5,
        markers: [0xaa, 0xab, 0x78, 0x79, 0x7a, 0xba, 0xbb, 0x21, 0x3f],
      }),
    );
    expect(proc.signalCode).toBe(null);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!hasEnoughMemory)(
    `${consumer} throws instead of aborting when mixed chunks exceed the 4 GiB ArrayBuffer maximum`,
    async () => {
      // The inputs are never touched (zero pages on Linux; Windows still commits them,
      // hence the memory gate) and the oversized result allocation fails fast.
      const script = `
      const n = 2200000000;
      let a, b;
      try {
        a = new Uint8Array(n);
        b = new Uint8Array(n);
      } catch {
        console.log("SKIP");
        process.exit(0);
      }
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(a);
          c.enqueue(b);
          c.enqueue("x");
          c.close();
        },
      });
      try {
        await Bun.${consumer}(stream);
        console.log("NO_THROW");
      } catch (e) {
        console.log("THREW RangeError=" + (e instanceof RangeError));
      }
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      if (stdout.trim() === "SKIP") return;
      expect(stdout.trim()).toBe("THREW RangeError=true");
      expect(proc.signalCode).toBe(null);
      expect(exitCode).toBe(0);
    },
  );
}

// The string-encoding half of the mixed arm at scale: a single string chunk whose UTF-8
// size exceeds 2^31. UTF-16 source (U+0808 is 3 UTF-8 bytes: E0 A0 88) so the conversion
// takes the simdutf path; the Latin-1 writer is a scalar loop that takes minutes in debug.
test.skipIf(!hasEnoughMemory)(
  "readableStreamToBytes handles a string chunk larger than 2 GiB",
  async () => {
    const script = `
      const n = 716000000; // 3 * n = 2148000000 > 2^31
      let s, marker;
      try {
        s = Buffer.alloc(2 * n, 0x08).toString("utf16le");
        marker = new Uint8Array([1, 2, 3]);
      } catch {
        console.log("SKIP");
        process.exit(0);
      }
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(s);
          c.enqueue(marker);
          c.close();
        },
      });
      const r = await Bun.readableStreamToBytes(stream);
      console.log(
        JSON.stringify({
          byteLength: r.byteLength,
          markers: [r[0], r[1], r[2], r[3 * n - 3], r[3 * n - 2], r[3 * n - 1], r[3 * n], r[3 * n + 1], r[3 * n + 2]],
        }),
      );
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    if (stdout.trim() === "SKIP") return;
    expect(stdout.trim()).toBe(
      JSON.stringify({
        byteLength: 3 * 716000000 + 3,
        markers: [0xe0, 0xa0, 0x88, 0xe0, 0xa0, 0x88, 1, 2, 3],
      }),
    );
    expect(proc.signalCode).toBe(null);
    expect(exitCode).toBe(0);
  },
  // ~18s under the debug+ASAN build: 3.5 GiB of string building plus a 2 GiB encode.
  60_000,
);

// Array.prototype indexed accessors intercept the consumer's internal chunk-array pushes
// (JSC havingABadTime), so a getter runs during the sizing pass and can resize, detach, or
// grow an already-measured chunk before the write pass copies it. A grown chunk must be
// clamped to its measured size (the result buffer is pre-sized; an unclamped copy would
// overrun it) and a shrunken or detached chunk must yield a result of the actual bytes
// written, never uninitialized memory.
test("chunks mutated by Array.prototype accessor reentry during concatenation are clamped", async () => {
  const script = `
    let log = "";
    let captured = {};
    let mutate = () => {};
    for (let i = 0; i < 2; i++) {
      Object.defineProperty(Array.prototype, String(i), {
        configurable: true,
        set(v) {
          log += "set" + i + ",";
          captured[i] = v;
        },
        get() {
          log += "get" + i + ",";
          if (i === 1) mutate();
          return captured[i];
        },
      });
    }
    // No array literals or pushes below (they would route through the accessors).
    async function run(mutation) {
      captured = {};
      log = "";
      const rab = new ArrayBuffer(64, { maxByteLength: 128 });
      const view = new Uint8Array(rab);
      view.fill(0x41);
      mutate = () => {
        if (mutation === "shrink") rab.resize(3);
        else if (mutation === "transfer") rab.transfer();
        else rab.resize(128);
      };
      let pulls = 0;
      const stream = new ReadableStream(
        {
          async pull(c) {
            pulls++;
            if (pulls === 1) {
              c.enqueue(view);
            } else {
              c.enqueue("x");
              c.close();
            }
          },
        },
        { highWaterMark: 0 },
      );
      const r = new Uint8Array(await Bun.readableStreamToArrayBuffer(stream));
      let allA = true;
      for (let i = 0; i < r.length - 1; i++) allA = allA && r[i] === 0x41;
      console.log(mutation + " " + log + " len=" + r.length + " allA=" + allA + " tail=" + r[r.length - 1]);
    }
    await run("shrink");
    await run("transfer");
    await run("grow");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim().split("\n")).toEqual([
    "shrink set0,set1,get0,get1, len=4 allA=true tail=120",
    "transfer set0,set1,get0,get1, len=1 allA=true tail=120",
    "grow set0,set1,get0,get1, len=65 allA=true tail=120",
  ]);
  expect(proc.signalCode).toBe(null);
  expect(exitCode).toBe(0);
});

test("an async start() promise is adopted observably, like Node", async () => {
  const originalThen = Promise.prototype.then;
  let counter = 0;
  // @ts-ignore
  Promise.prototype.then = function (...args) {
    counter++;
    return originalThen.apply(this, args);
  };
  try {
    const result = await Bun.readableStreamToArrayBuffer(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("bun is"));
          controller.enqueue(new TextEncoder().encode(" awesome!"));
          controller.close();
        },
      }),
    );
    expect(new TextDecoder().decode(result)).toBe("bun is awesome!");
    // Web IDL "a promise resolved with startResult" adopts the user's promise:
    // one observable then() call, exactly as in Node.
    expect(counter).toBe(1);
  } finally {
    Promise.prototype.then = originalThen;
  }
});
