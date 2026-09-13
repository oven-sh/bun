// Fixture for parse-shared-buffer.test.ts.
//
//   bun parse-shared-buffer-fixture.ts <api> <calls>
//
// The main thread parses a SharedArrayBuffer while a worker flips a few of its
// bytes back and forth. Each flipped byte is one the parser reads twice, and
// the second value contradicts what the parser concluded from the first. A
// parser that reads the shared bytes in place aborts the process. One that
// reads a private copy sees one value per byte. Prints "ok" after <calls>
// calls that ran while the worker wrote. A call can return or throw.
import { isMainThread, Worker, workerData } from "node:worker_threads";

type Case = {
  text: string;
  /** The value the worker flips the byte at `at` to, or `byte` to leave it. */
  flip: (byte: number, at: number) => number;
};

// The block parser sees `#`, starts the heading text after it, then scans for
// the end of the line from the `#` again. A newline there ends the line before
// the text starts.
const heading: Case = { text: "# heading\n\nparagraph\n", flip: (byte, at) => (at === 0 ? 0x0a : byte) };

const CASES: Record<string, Case> = {
  // The lexer counts the `_` separators of a numeric literal, allocates
  // `length - count` bytes, then copies every byte that is not a `_`.
  transpiler: { text: "let a = 1_000_000_000_000_000;\n", flip: byte => (byte === 0x5f ? 0x30 : byte) },
  markdown: heading,
  ansi: heading,
  // The scanner reads a byte of a plain scalar, then asserts that the input
  // still holds it when it appends it to the string.
  yaml: { text: "key: value value value value\n", flip: byte => (byte === 0x76 ? 0x77 : byte) },
  // A string is measured in UTF-16 units, then converted in a second pass. A
  // 3-byte sequence that turns into three ASCII letters is three units, not one.
  toml: { text: 'a = "€€€€€€€€€€€€€€€€"\n', flip: byte => (byte > 0x7f ? 0x61 : byte) },
};

const api = process.argv[2];
const calls = Number(process.argv[3]);
const base = new TextEncoder().encode(CASES[api].text);

if (isMainThread) {
  const bytes = new SharedArrayBuffer(base.length);
  // The number of passes the worker has made over the bytes it flips.
  const passes = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { bytes, passes },
    argv: [api, String(calls)],
  });
  worker.unref();

  const input = new Uint8Array(bytes);
  input.set(base);

  // The worker's events cannot reach this thread while it parses in a loop, so
  // a worker that stopped shows only as a pass count that stands still.
  const workerStopped = (): never => {
    console.error("the worker made no pass over the bytes for 10 s");
    process.exit(1);
  };

  if (Atomics.wait(passes, 0, 0, 10_000) === "timed-out") workerStopped();

  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const parse: Record<string, () => unknown> = {
    transpiler: () => transpiler.transformSync(input),
    markdown: () => Bun.markdown.html(input),
    ansi: () => Bun.markdown.ansi(input),
    yaml: () => Bun.YAML.parse(input),
    toml: () => Bun.TOML.parse(input),
  };

  // Count a call only when the worker made a pass while it ran. A debug build
  // is slow enough that every call counts. A release build can make a thousand
  // calls before the worker's thread gets a core of its own.
  let seen = Atomics.load(passes, 0);
  let progressAt = performance.now();
  for (let overlapped = 0; overlapped < calls; ) {
    try {
      parse[api]();
    } catch {}
    const now = Atomics.load(passes, 0);
    if (now !== seen) {
      seen = now;
      overlapped++;
      progressAt = performance.now();
    } else if (performance.now() - progressAt > 10_000) {
      workerStopped();
    }
  }

  console.log("ok");
  process.exit(0);
} else {
  const { bytes, passes } = workerData as { bytes: SharedArrayBuffer; passes: Int32Array };
  const input = new Uint8Array(bytes);

  const at: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < base.length; i++) {
    const other = CASES[api].flip(base[i], i);
    if (other !== base[i]) {
      at.push(i);
      to.push(other);
    }
  }

  // `Atomics.store` so that the compiler keeps every store and the other
  // thread sees each one.
  for (;;) {
    for (let k = 0; k < at.length; k++) Atomics.store(input, at[k], to[k]);
    for (let k = 0; k < at.length; k++) Atomics.store(input, at[k], base[at[k]]);
    if (Atomics.add(passes, 0, 1) === 0) Atomics.notify(passes, 0);
  }
}
