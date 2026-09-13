import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "parse-shared-buffer-fixture.ts");

// Each parser reads a byte more than once: the TypeScript lexer re-reads the
// digits of a numeric literal after it counts the separators, the markdown
// block parser scans a heading line twice, YAML asserts the byte its scanner
// read, and TOML measures a string before it converts it. A worker that writes
// the SharedArrayBuffer between the two reads aborted the process.
//
// The call counts: a debug build that parses the shared bytes in place aborts
// within 200 calls, and within 50 of `transformSync`, which costs the most.
test.concurrent.each([
  ["transpiler", 300],
  ["markdown", 1000],
  ["ansi", 1000],
  ["yaml", 1000],
  ["toml", 1000],
])("%s parses a SharedArrayBuffer a worker writes", async (api, calls) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, api, String(calls)],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({ stdout: "ok", stderr: "" });
  expect(exitCode).toBe(0);
});

// A macro runs in the middle of the parse. `transformSync` and `scan` read the
// rest of the source after it returns, and read names and string literals back
// from the source when they print. The macro is user code, so it can take the
// bytes away: `resize()` gives the trimmed pages of a resizable ArrayBuffer
// back, a write changes a fixed-length one in place, and `transfer()` moves its
// bytes to a buffer nothing holds. `Bun.markdown` has the resizable cases next
// to its other buffer input tests, in test/js/bun/md/md-render-callback.test.ts.
test.concurrent.each([
  {
    macro: "shrinks the resizable input",
    buffer: "new ArrayBuffer(bytes.length, { maxByteLength: bytes.length })",
    takeAway: "globalThis.input.resize(0);",
  },
  {
    macro: "overwrites the input and detaches it",
    buffer: "new ArrayBuffer(bytes.length)",
    takeAway: "new Uint8Array(globalThis.input).fill(0x20); globalThis.input.transfer(); Bun.gc(true);",
  },
])("transformSync and scan parse the bytes they were given when a macro $macro", async ({ buffer, takeAway }) => {
  using dir = tempDir("transpiler-macro-takes-input", {
    "macro.ts": `
      export function takeAway() {
        ${takeAway}
        return "from the macro";
      }
    `,
    "index.ts": `
      import { join } from "node:path";

      const macro = join(import.meta.dir, "macro.ts");
      const source =
        "import { takeAway } from " + JSON.stringify(macro) + ' with { type: "macro" };\\n' +
        "export const fromTheMacro = takeAway();\\n" +
        "export const filler = " + JSON.stringify(Buffer.alloc(100_000, "x").toString()) + ";\\n" +
        "export const afterTheMacro = 'after the macro';\\n";

      function input() {
        const bytes = new TextEncoder().encode(source);
        globalThis.input = ${buffer};
        const view = new Uint8Array(globalThis.input);
        view.set(bytes);
        return view;
      }

      const transpiler = new Bun.Transpiler({ loader: "ts" });
      const code = transpiler.transformSync(input());
      const { exports, imports } = transpiler.scan(input());
      console.log(
        JSON.stringify({
          byteLength: globalThis.input.byteLength,
          transformSync: [
            code.includes('fromTheMacro = "from the macro"'),
            code.includes('afterTheMacro = "after the macro"'),
          ],
          exports: exports.sort(),
          imports: imports.map(({ path }) => path === macro),
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // A debug build logs each macro call to stdout first.
  expect({ result: stdout.trim().split("\n").at(-1), stderr: stderr.trim() }).toEqual({
    result: JSON.stringify({
      byteLength: 0,
      transformSync: [true, true],
      exports: ["afterTheMacro", "filler", "fromTheMacro"],
      imports: [true],
    }),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
