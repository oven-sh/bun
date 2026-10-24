import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "../aot/harness/run";
import { withoutCoreDump, withoutCrashReport } from "../aot/run-programs";
import { describe, test } from "../aot/supported";

// --aot keeps references between objects in 32 bits, which limits each thread to 32 GB of objects. --aot-huge-heap compiles with
// 64-bit references instead. These tests shrink the limit to 64 MB so that a small program reaches it.

const smallHeap = { BUN_JSC_markedBlockCageSizeInMB: "64" };

const program = `type Entry = { id: number; next: Entry | null };
let head: Entry | null = null;
for (let i = 0; i < 4_000_000; i++) head = { id: i, next: head };
let sum = 0;
for (let entry: Entry | null = head; entry; entry = entry.next) sum += entry.id;
console.log("kept", sum);
`;
const printed = "kept 7999998000000\n";

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}

describe.concurrent("--aot-huge-heap", () => {
  test("an executable built with it goes past the limit", async () => {
    using folder = tempDir("aot-huge-heap", { "program.ts": program });
    const cwd = String(folder);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "--aot-huge-heap", "program.ts", "--outfile", "program"],
      cwd,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    const { stdout, exitCode } = await run([join(cwd, "program")], cwd, smallHeap);
    expect({ stdout, exitCode }).toEqual({ stdout: printed, exitCode: 0 });
  }, 120_000);

  // The error says what to do, also where the loop stands in a try. A Bun built with AddressSanitizer may have nothing left to make the error of: then the process ends and says the same.
  test("an executable built without it stops at the limit", async () => {
    using folder = tempDir("aot-huge-heap", {
      "program.ts": `try {\n${program}} finally {\n  console.log("finally");\n}\n`,
    });
    const cwd = String(folder);
    const built = await run([bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"], cwd);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run(withoutCoreDump([join(cwd, "program")]), cwd, {
      ...smallHeap,
      ...withoutCrashReport,
    });
    expect(stderr).toMatch(
      isASAN
        ? /(RangeError: Out of memory:|FATAL: out of memory\.) Each thread of a compiled executable can use/
        : /RangeError: Out of memory: Each thread of a compiled executable can use/,
    );
    expect(stderr).toContain("--aot-huge-heap");
    expect(stdout).not.toContain("kept");
    expect(exitCode).not.toBe(0);
    if (!isASAN) expect({ stdout, exitCode }).toEqual({ stdout: "finally\n", exitCode: 1 });
  }, 120_000);

  test("bun run --debug-aot, which builds, takes it too", async () => {
    using folder = tempDir("aot-huge-heap", { "program.ts": program });
    const { stdout, exitCode } = await run(
      [bunExe(), "run", "--debug-aot", "--aot-huge-heap", "program.ts"],
      String(folder),
      smallHeap,
    );
    expect({ stdout, exitCode }).toEqual({ stdout: printed, exitCode: 0 });
  }, 120_000);

  test("bun test --debug-aot takes it too", async () => {
    using folder = tempDir("aot-huge-heap", {
      "program.test.ts": 'import { expect, test } from "bun:test";\ntest("runs", () => expect(1 + 1).toBe(2));\n',
    });
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--debug-aot", "--aot-huge-heap", "program.test.ts"],
      String(folder),
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  }, 120_000);

  const small = {
    "program.ts": 'console.log("ran");\n',
    "program.test.ts": 'import { test } from "bun:test";\ntest("runs", () => {});\n',
  };

  test("it requires --aot", async () => {
    using folder = tempDir("aot-huge-heap", small);
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot-huge-heap", "program.ts", "--outfile", "program"],
      String(folder),
    );
    expect(stderr).toContain("--aot-huge-heap requires --aot");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test.each([
    [["run", "--aot", "--aot-huge-heap", "program.ts"]],
    [["--aot", "--aot-huge-heap", "program.ts"]],
    [["test", "--aot", "--aot-huge-heap", "program.test.ts"]],
    [["run", "--aot-huge-heap", "program.ts"]],
    [["test", "--aot-huge-heap", "program.test.ts"]],
  ])("nothing is built here, so it is an error: bun %j", async args => {
    using folder = tempDir("aot-huge-heap", small);
    const { stdout, stderr, exitCode } = await run([bunExe(), ...args], String(folder));
    expect(stderr).toContain("error: --aot-huge-heap is only valid with bun build --compile --aot and bun compile\n");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test.each([
    [["build"], true],
    [["compile"], true],
    [[], false],
    [["run"], false],
    [["test"], false],
  ] as [string[], boolean][])("bun %j --help lists it: %p", async (command, lists) => {
    using folder = tempDir("aot-huge-heap", {});
    const { stdout, stderr } = await run([bunExe(), ...command, "--help"], String(folder));
    expect((stdout + stderr).includes("--aot-huge-heap")).toBe(lists);
  });
});
