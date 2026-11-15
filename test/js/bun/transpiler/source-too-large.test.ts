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
import { bunEnv, bunExe, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync, truncateSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";

const SIZE = 2 ** 31;
const FIRST_LINE = "%\n";

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
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

// Each file is sparse: everything past the first line is a hole, so it takes no
// disk space and reads back as NUL bytes. Reading it costs the child process
// 2 GiB of memory (and, in debug builds, tens of seconds of allocator
// bookkeeping), so the block skips on small machines (the gate fs-oom.test.ts
// uses for its 2 GiB cases) and each entry point gets a single file. `bun build`
// gets a data-format file because a JS file that fails to parse additionally
// gets an empty fallback AST whose symbol tables are presized from the source
// length, which takes over a minute in debug builds.
describe.skipIf(totalmem() < 10 * 1024 ** 3)("a 2 GiB file", () => {
  function sparseFile(dir: string, name: string) {
    const file = join(dir, name);
    writeFileSync(file, FIRST_LINE);
    truncateSync(file, SIZE);
    return file;
  }

  test("is a build error in bun build", async () => {
    using dir = tempDir("source-too-large-build", {});
    const file = sparseFile(String(dir), "big.xml");
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
    const file = sparseFile(String(dir), "big.js");
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

describe.skipIf(!isLinux).concurrent("a 1 TiB file is a read error", () => {
  test.each([
    ["package.json", ["install"], /^ENOMEM: failed to read '.*package\.json'$/m],
    ["package.json", ["pm", "pack"], /^ENOMEM: failed to read package\.json: .*package\.json$/m],
    ["big.js", ["build", "big.js"], /error: ENOMEM reading file: ".*big\.js"$/m],
    ["big.js", ["big.js"], /error: ENOMEM reading ".*big\.js"$/m],
  ])("%s in bun %j", async (name, args, message) => {
    using dir = tempDir("source-too-large-enomem", { [name]: FIRST_LINE });
    truncateSync(join(String(dir), name), 2 ** 40);
    // The most address space this process had: enough to start, also with ASAN's shadow memory, but not for the file.
    const [, kib] = /^VmPeak:\s+(\d+) kB$/m.exec(readFileSync("/proc/self/status", "utf8"))!;
    const limited = ["sh", "-c", `ulimit -c 0 && ulimit -v ${kib} && exec "$0" "$@"`];
    const { stderr, exitCode } = await run([...limited, bunExe(), ...args], String(dir));
    expect(stderr).toMatch(message);
    expect(exitCode).toBe(1);
  });
});
