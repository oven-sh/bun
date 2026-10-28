// What `bun check --aot` and `bun build --compile --aot` say about their own flags, and about a store that replaces a member of a built-in object.
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";

async function bun(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { stdout, stderr, exitCode };
}
const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    noEmit: true,
    types: [],
  },
});
const reports = "text, json, guards, guards-json, trim, missed-optimizations, allocations, statistics";

// Adding a name to Array.prototype is allowed. Replacing one is not, and here the store always runs.
const replaces = `(Array.prototype as any).last = function () {};\n(Array.prototype as any).push = function () {};\n`;

describe.concurrent.skipIf(!!unsupported)("a store that replaces a member of a built-in object and always runs", () => {
  test("is an error of bun check --aot, at its line", async () => {
    using dir = tempDir("aot-check-errors", { "wrong.ts": replaces, "tsconfig.json": tsconfig });
    const { stdout, stderr, exitCode } = await bun(String(dir), "check", "--aot", "wrong.ts");
    expect(
      [...(stdout + stderr).matchAll(/wrong\.ts\((\d+),\d+\): error (TS1000\d\d)/g)].map(([, line, code]) => [
        line,
        code,
      ]),
    ).toEqual([["2", "TS100014"]]);
    expect(exitCode).toBe(1);
  }, 120_000);

  test("is no error of bun check", async () => {
    using dir = tempDir("aot-check-plain", { "wrong.ts": replaces, "tsconfig.json": tsconfig });
    expect(await bun(String(dir), "check", "wrong.ts")).toMatchObject({ exitCode: 0 });
  }, 120_000);

  test("stops the build", async () => {
    using dir = tempDir("aot-build-errors", { "wrong.ts": replaces, "tsconfig.json": tsconfig });
    const { stdout, stderr, exitCode } = await bun(
      String(dir),
      "build",
      "--compile",
      "--aot",
      "wrong.ts",
      "--outfile",
      "wrong",
    );
    expect(stdout + stderr).toContain("TS100014");
    expect(exitCode).toBe(1);
  }, 120_000);

  test("is in the logs of Bun.build", async () => {
    using dir = tempDir("aot-build-api-errors", {
      "wrong.ts": replaces,
      "tsconfig.json": tsconfig,
      "build.ts": `const result = await Bun.build({ entrypoints: ["./wrong.ts"], throw: false, compile: { outfile: "./wrong", aot: true } });
console.log(result.success, result.logs.filter(log => String(log.message).includes("TS100014")).length);
`,
    });
    expect((await bun(String(dir), "build.ts")).stdout).toBe("false 1\n");
  }, 120_000);
});

describe.concurrent("bun check flags that --aot governs", () => {
  test.each([
    [["--explain", "a.ts"], "error: --explain requires --aot"],
    [["--define", "A=1", "a.ts"], "error: --define requires --aot"],
    [["--aot"], "error: --aot needs an entry point: bun check --aot src/index.ts"],
    [["--aot", "--build"], "error: --aot does not support --build"],
    [
      ["--aot", "--strict", "a.ts"],
      "error: --aot does not take compiler options (--strict). It checks with the tsconfig.json that bun compile would use",
    ],
    [
      ["--aot", "--explain=nonsense", "a.ts"],
      `error: Invalid value for --explain: "nonsense". Must be one of ${reports}`,
    ],
    [
      ["--aot", "--disallow-code-generation-from-strings=strcit", "a.ts"],
      'error: Invalid value for --disallow-code-generation-from-strings: "strcit". Must be "strict", or no value',
    ],
  ] as [string[], string][])("bun check %p", async (flags, message) => {
    using dir = tempDir("aot-check-usage", { "a.ts": "export const a = 1;\n" });
    const { stderr, exitCode } = await bun(String(dir), "check", ...flags);
    expect(stderr).toContain(message);
    expect(exitCode).toBe(1);
  });
});

test.skipIf(!!unsupported)(
  "an unknown report name is an error of the build that lists the valid names",
  async () => {
    using dir = tempDir("aot-build-unknown", { "a.ts": "export const a = 1;\n" });
    const { stdout, stderr, exitCode } = await bun(
      String(dir),
      "build",
      "--compile",
      "--aot",
      "--explain=nonsense",
      "a.ts",
      "--outfile",
      "a",
    );
    expect(stdout + stderr).toContain(`Must be one of ${reports}`);
    expect(exitCode).not.toBe(0);
  },
  120_000,
);

describe.concurrent("--help", () => {
  test.each([
    [[], ["--aot ", "--aot-log-type-mismatches"]],
    [["run"], ["--aot ", "--aot-log-type-mismatches"]],
    [["test"], ["--aot", "--aot-log-type-mismatches"]],
    [["build"], ["--aot ", "--explain", "--aot-log-type-mismatches", "--aot-huge-heap"]],
    [["check"], ["--aot ", "--explain"]],
  ] as [string[], string[]][])("bun %p", async (command, flags) => {
    using dir = tempDir("aot-help", {});
    const { stdout, stderr } = await bun(String(dir), ...command, "--help");
    const help = stdout + stderr;
    for (const flag of flags) expect(help).toContain(flag);
    for (const flag of [
      "--aot-graph-fd",
      "--compile-run",
      "--rewrite-jest-for-tests",
      "--expose-internals",
      "--builtins-manifest",
    ])
      expect(help).not.toContain(flag);
  });
});
