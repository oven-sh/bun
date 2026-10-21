// Every parser records source positions as an i32 byte offset, so a source of
// 2**31 bytes or more used to abort the process once the parser reached a
// position past i32::MAX: `panic: int cast: TryFromIntError(PosOverflow)` from
// the JS lexer, TOML, YAML and JSON5, and a failed length assertion in the XML
// indexer.
// `Bun.TOML.parse` and friends already rejected such inputs at the API boundary;
// the parsers themselves did not, and they are what `bun build`, `bun run`,
// `import` and `Bun.Transpiler` feed. They now reject the source by length
// before reading any of it, so the content below is irrelevant to the behavior
// under test. It starts with a line that is a syntax error in every format, so
// a build without the length check fails fast on line 1 (with a different
// message) instead of scanning the remaining 2 GiB to report its error.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { truncateSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";

const SIZE = 2 ** 31;
const FIRST_LINE = "%\n";

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

test("Bun.Transpiler reports the limit for every loader that records positions", async () => {
  // Only the first line of the Uint8Array is ever written or read; the rest
  // stays untouched virtual memory, so this costs neither time nor RSS.
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `
      const input = new Uint8Array(${SIZE});
      input.set(Buffer.from(${JSON.stringify(FIRST_LINE)}));
      const transpiler = new Bun.Transpiler();
      const results = {};
      for (const loader of ["js", "ts", "toml", "yaml", "xml", "json", "jsonc", "json5"]) {
        try {
          transpiler.transformSync(input, loader);
          results[loader] = "no error";
        } catch (e) {
          results[loader] = e.name + ": " + e.message;
        }
      }
      console.log(JSON.stringify(results, null, 2));
    `,
  ]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify(
      {
        js: "BuildMessage: File is too large to parse (2 GiB maximum)",
        ts: "BuildMessage: File is too large to parse (2 GiB maximum)",
        toml: "BuildMessage: TOML document is too large to parse (2 GiB maximum)",
        yaml: "BuildMessage: YAML document is too large to parse (2 GiB maximum)",
        xml: "BuildMessage: XML document is too large to parse (2 GiB maximum)",
        json: "BuildMessage: JSON document is too large to parse (2 GiB maximum)",
        jsonc: "BuildMessage: JSON document is too large to parse (2 GiB maximum)",
        json5: "BuildMessage: JSON5 document is too large to parse (2 GiB maximum)",
      },
      null,
      2,
    ),
    stderr: "",
    exitCode: 0,
  });
});

// The text loader parses nothing, so it has no 2 GiB limit. Its text is one AST
// string, and the length of an AST string is a u32: the text of 2**32 bytes was
// an empty string, with no error. The array is never written or read, so it
// takes address space and no memory. A small machine can refuse to reserve it.
test.skipIf(totalmem() < 8 * 1024 ** 3)("Bun.Transpiler reports the limit of the text loader", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `
      try {
        const text = new Bun.Transpiler().transformSync(new Uint8Array(2 ** 32), "text");
        console.log("no error: " + JSON.stringify(text));
      } catch (e) {
        console.log(e.name + ": " + e.message);
      }
    `,
  ]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "BuildMessage: File is too large (4294967296 bytes, 4 GiB maximum)",
    stderr: "",
    exitCode: 0,
  });
});

// Each file is sparse: everything past the first line is a hole, so it takes no
// disk space and reads back as NUL bytes. Reading it costs the child process
// the size of the file in memory (and, in debug builds, tens of seconds of
// allocator bookkeeping), so the blocks skip on small machines (the gate
// fs-oom.test.ts uses for its 2 GiB cases) and each entry point gets a single file.
function sparseFile(dir: string, name: string, size: number) {
  const file = join(dir, name);
  writeFileSync(file, FIRST_LINE);
  truncateSync(file, size);
  return file;
}

describe.skipIf(totalmem() < 10 * 1024 ** 3)("a 2 GiB file", () => {
  test("is a build error in bun build", async () => {
    using dir = tempDir("source-too-large-build", {});
    const file = sparseFile(String(dir), "big.xml", SIZE);
    const { stdout, stderr, exitCode } = await run([bunExe(), "build", file, "--outdir", join(String(dir), "out")]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: XML document is too large to parse (2 GiB maximum)
          at <dir>/big.xml"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  }, 120_000);

  test("is an error instead of running in bun run", async () => {
    using dir = tempDir("source-too-large-run", {});
    const file = sparseFile(String(dir), "big.js", SIZE);
    const { stdout, stderr, exitCode } = await run([bunExe(), file]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: File is too large to parse (2 GiB maximum)
          at <dir>/big.js

      Bun v<bun-version>"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  }, 120_000);
});

// The bundler reads the whole file from the disk before it refuses it.
describe.skipIf(totalmem() < 10 * 1024 ** 3)("a 4 GiB text file", () => {
  test("is a build error in bun build", async () => {
    using dir = tempDir("source-too-large-text", {
      "entry.js": `import text from "./big.txt"; console.log(text.length);`,
    });
    sparseFile(String(dir), "big.txt", 2 ** 32 + 32);
    const { stdout, stderr, exitCode } = await run([
      bunExe(),
      "build",
      join(String(dir), "entry.js"),
      "--outdir",
      join(String(dir), "out"),
    ]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: File is too large (4294967328 bytes, 4 GiB maximum)
          at <dir>/big.txt

      note: To copy the file to the output directory as-is, import it with { type: "file" }"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  }, 120_000);
});
