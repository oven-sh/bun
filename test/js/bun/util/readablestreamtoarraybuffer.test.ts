import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
  test(`${consumer} handles mixed string+binary chunks totaling over 2 GiB`, async () => {
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
          c.close();
        },
      });
      const result = await Bun.${consumer}(stream);
      const r = result instanceof Uint8Array ? result : new Uint8Array(result);
      console.log(
        JSON.stringify({
          constructor: result.constructor.name,
          byteLength: result.byteLength,
          markers: [r[0], r[GIB - 1], r[GIB], r[GIB + 1], r[GIB + 2], r[GIB + 3], r[2 * GIB + 2]],
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
    expect(JSON.parse(stdout)).toEqual({
      constructor: consumer === "readableStreamToBytes" ? "Uint8Array" : "ArrayBuffer",
      byteLength: 2 * 1073741824 + 3,
      markers: [0xaa, 0xab, 0x78, 0x79, 0x7a, 0xba, 0xbb],
    });
    expect(proc.signalCode).toBe(null);
    expect(exitCode).toBe(0);
  });

  test(`${consumer} throws instead of aborting when mixed chunks exceed the 4 GiB ArrayBuffer maximum`, async () => {
    // The inputs are never touched, so they stay lazily-mapped zero pages and the
    // oversized result allocation fails fast: this test is cheap despite the sizes.
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
  });
}

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
