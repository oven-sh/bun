// Fixture for plugins.test.ts.
//
// An onLoad callback returns a Uint8Array over a SharedArrayBuffer as
// `contents` while a worker flips the `_` separators of the numeric literals in
// it to `0` and back. The lexer counts the separators of a literal, allocates
// `length - count` bytes, then copies every byte that is not a `_`. A
// transpiler that reads the shared bytes in place aborts the process when a
// separator turns into a digit between the two passes, and gives the literal a
// wrong value when a digit turns into a separator. One that reads a private
// copy sees one value per byte, and every value of a byte gives a valid module.
// Prints "ok" after `imports` imports that ran while the worker wrote.
import { plugin } from "bun";
import { isMainThread, Worker, workerData } from "node:worker_threads";

const underscore = 0x5f;
const zero = 0x30;

const literals = 64;
const literal = "  1_000_000_000_000_000,\n";
const base = new TextEncoder().encode(
  "export default [\n" + Buffer.alloc(literals * literal.length, literal).toString() + "];\n",
);
// Each separator that reads as `0` makes the literal ten times larger.
const values = new Set([1e15, 1e16, 1e17, 1e18, 1e19, 1e20]);

// An unfixed build fails within 10 imports.
const imports = 50;

if (isMainThread) {
  const bytes = new SharedArrayBuffer(base.length);
  // The number of passes the worker has made over the bytes it flips.
  const passes = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL(import.meta.url), { workerData: { bytes, passes } });
  worker.unref();

  const contents = new Uint8Array(bytes);
  contents.set(base);

  if (Atomics.wait(passes, 0, 0, 30_000) === "timed-out") {
    throw new Error("the worker did not start");
  }

  plugin({
    name: "shared contents",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "shared" }, ({ path }) => ({ path, namespace: "shared" }));
      build.onLoad({ filter: /.*/, namespace: "shared" }, () => ({ contents, loader: "ts" }));
    },
  });

  // Count an import only when the worker made a pass while it ran. A debug
  // build is slow enough that every import counts. A release build can finish
  // many imports before the worker's thread gets a core of its own, so the
  // total is capped: a starved worker ends the run, it does not hang it.
  let seen = Atomics.load(passes, 0);
  for (let overlapped = 0, total = 0; overlapped < imports && total < imports * 20; total++) {
    const { default: exported } = await import("shared:" + total);
    if (exported.length !== literals || !exported.every(value => values.has(value))) {
      throw new Error("import " + total + " gave " + JSON.stringify(exported));
    }

    const now = Atomics.load(passes, 0);
    if (now !== seen) {
      seen = now;
      overlapped++;
    }
  }

  console.log("ok");
  process.exit(0);
} else {
  const { bytes, passes } = workerData as { bytes: SharedArrayBuffer; passes: Int32Array };
  const contents = new Uint8Array(bytes);

  const separators: number[] = [];
  for (let i = 0; i < base.length; i++) {
    if (base[i] === underscore) separators.push(i);
  }

  // `Atomics.store` so that the compiler keeps every store and the other
  // thread sees each one.
  for (;;) {
    for (const at of separators) Atomics.store(contents, at, zero);
    for (const at of separators) Atomics.store(contents, at, underscore);
    if (Atomics.add(passes, 0, 1) === 0) Atomics.notify(passes, 0);
  }
}
