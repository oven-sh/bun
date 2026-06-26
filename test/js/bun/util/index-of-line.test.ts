import { indexOfLine } from "bun";
import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";

test("indexOfLine handles non-number offset", () => {
  // Regression test: passing a non-number offset should not crash
  expect(indexOfLine(new Uint8ClampedArray(), {})).toBe(-1);
  expect(indexOfLine(new Uint8Array(), {})).toBe(-1);

  // Various non-number offsets should coerce properly
  expect(indexOfLine(new Uint8Array(), null)).toBe(-1);
  expect(indexOfLine(new Uint8Array(), undefined)).toBe(-1);
  expect(indexOfLine(new Uint8Array(), NaN)).toBe(-1);

  // With actual content
  const buf = new Uint8Array([104, 101, 108, 108, 111, 10, 119, 111, 114, 108, 100]); // "hello\nworld"
  expect(indexOfLine(buf, {})).toBe(5); // {} coerces to NaN -> 0
  expect(indexOfLine(buf, "2")).toBe(5); // "2" coerces to 2, newline is at 5
});

test("indexOfLine", () => {
  const source = `
        const a = 1;

        const b = 2;

        😋const c = 3; // handles unicode

        😋 Get Emoji — All Emojis to ✂️

        const b = 2;

        const c = 3;
`;
  var i = 0;
  var j = 0;
  const buffer = Buffer.from(source);
  var nonEmptyLineCount = 0;
  while (i < buffer.length) {
    const prev = j;
    j = source.indexOf("\n", j);
    i = indexOfLine(buffer, i);

    const delta = Buffer.byteLength(source.slice(0, j), "utf8") - j;
    console.log(source.slice(prev + 1, j));
    if (i === -1) {
      expect(j).toBe(-1);
      expect(nonEmptyLineCount).toBe(6);
      break;
    }
    expect(i++ - delta).toBe(j++);
    nonEmptyLineCount++;
  }
});

test("indexOfLine returns the newline index for a SharedArrayBuffer view", () => {
  const bytes = new Uint8Array(new SharedArrayBuffer(32));
  bytes.fill(0x41);
  bytes[10] = 0x0a;
  expect(indexOfLine(bytes, 0)).toBe(10);
});

test("indexOfLine re-reads the buffer after offset coercion detaches it", () => {
  const ab = new ArrayBuffer(32);
  const bytes = new Uint8Array(ab);
  bytes[0] = 0x0a;

  // Coercing the offset runs JS that detaches the first argument. indexOfLine
  // must re-read the buffer after coercion instead of scanning the freed store.
  const offset = {
    valueOf() {
      structuredClone(ab, { transfer: [ab] });
      return 0;
    },
  };

  expect(indexOfLine(bytes, offset as any)).toBe(-1);
});

const supportsGrowableSharedArrayBuffer = (() => {
  try {
    return new SharedArrayBuffer(32, { maxByteLength: 64 }).growable === true;
  } catch {
    return false;
  }
})();

test.skipIf(!supportsGrowableSharedArrayBuffer)("indexOfLine accepts a growable SharedArrayBuffer", () => {
  const gsab = new SharedArrayBuffer(32, { maxByteLength: 64 });
  const bytes = new Uint8Array(gsab);
  bytes[7] = 0x0a;
  expect(indexOfLine(bytes, 0)).toBe(7);
});

// indexOfLine must snapshot a SharedArrayBuffer before scanning, so a worker
// mutating the same bytes can't race the SIMD newline scanner into a debug
// crash. Before the fix this reliably SIGILLs.
test("indexOfLine is safe while a worker concurrently mutates a SharedArrayBuffer", async () => {
  const sab = new SharedArrayBuffer(64 * 1024);
  const bytes = new Uint8Array(sab);
  bytes.fill(0x41);
  bytes[bytes.length - 1] = 0x0a;
  // state[0]: 0 = wait, 1 = run, 2 = stop; state[1]: worker write counter
  const state = new Int32Array(new SharedArrayBuffer(8));

  const worker = new Worker(
    `
      const { workerData } = require("node:worker_threads");
      const bytes = new Uint8Array(workerData.sab);
      const state = new Int32Array(workerData.state);
      while (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0);
      let prev = bytes.length - 1;
      let i = 0;
      while (Atomics.load(state, 0) === 1) {
        bytes[prev] = 0x41;
        prev = (i++ * 131) % bytes.length;
        bytes[prev] = 0x0a;
        Atomics.add(state, 1, 1);
      }
    `,
    { eval: true, workerData: { sab, state: state.buffer } },
  );

  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
  // Wait until the worker is actively mutating before scanning. Poll without
  // blocking the test runner's main thread (the worker side still uses
  // Atomics.wait to park until signalled).
  while (Atomics.load(state, 1) < 50) {
    await Bun.sleep(0);
  }

  const results: number[] = [];
  for (let i = 0; i < 4000; i++) results.push(indexOfLine(bytes, 0));

  Atomics.store(state, 0, 2);
  await worker.terminate();

  // Reaching here means the snapshot prevented the data-race crash; every
  // result is a valid index, and the worker really did mutate concurrently.
  expect(results.every(r => r >= -1 && r < bytes.length)).toBe(true);
  expect(Atomics.load(state, 1)).toBeGreaterThan(50);
});
