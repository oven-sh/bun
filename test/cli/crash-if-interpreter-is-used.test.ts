import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported, withoutCoreDump, withoutCrashReport } from "../aot/run-programs";

test.skipIf(!!unsupported)("BUN_JSC_crashIfInterpreterIsUsed names the code and crashes", async () => {
  const { stderr, exitCode } = await run(withoutCoreDump([bunExe(), "-e", "console.log(1)"]), undefined, {
    ...bunEnv,
    ...withoutCrashReport,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
  });
  expect(stderr).toContain("crashIfInterpreterIsUsed: ");
  expect(exitCode).not.toBe(0);
});

test.skipIf(isWindows || !!unsupported)(
  "a compiled program started with BUN_INSPECT does not crash on Bun's debugger module",
  async () => {
    using folder = tempDir("crash-if-interpreter", {
      "program.mjs": `await new Promise(resolve => setTimeout(resolve, 100)); console.log("done");`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "--compile-inspector", "program.mjs", "--outfile", "program"],
      cwd: String(folder),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    await using proc = Bun.spawn({
      cmd: [join(String(folder), "program")],
      env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_INSPECT: "ws://127.0.0.1:0/crash-if-interpreter" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, signal: proc.signalCode, exitCode }).toEqual({ stdout: "done\n", signal: null, exitCode: 0 });
  },
  120_000,
);

async function runCompiled(
  files: Record<string, string>,
  isExecutable: boolean,
  buildFlags: string[] = [],
  env: Record<string, string> = {},
) {
  using folder = tempDir("crash-if-interpreter", files);
  if (isExecutable) {
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", ...buildFlags, "program.mjs", "--outfile", "program"],
      cwd: String(folder),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
  }
  await using proc = Bun.spawn({
    cmd: withoutCoreDump(
      isExecutable ? [join(String(folder), "program")] : [bunExe(), "run", "--debug-aot", "program.mjs"],
    ),
    cwd: String(folder),
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

const forms: [string, boolean][] = [
  ["bun run --aot", false],
  ["an executable", true],
];
const text = "export default 6; export function f() { return 7 }";
const importing = (url: string) => ({
  "program.mjs": `const url = ${url}; const made = await import(url); console.log(made.default, made.f());`,
});

test.skipIf(isWindows || !!unsupported).each(forms)(
  "a module in a data: URL that the program spells out runs: %s",
  async (_form, isExecutable) => {
    const { stdout, stderr, exitCode, signal } = await runCompiled(
      importing(`"data:text/javascript,${text}"`),
      isExecutable,
    );
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, signal, exitCode }).toEqual({ stdout: "6 7\n", signal: null, exitCode: 0 });
  },
  120_000,
);

describe.each([
  ["a data: URL", `"data:text/javascript," + process.env.TEXT`],
  ["a blob: URL", `URL.createObjectURL(new Blob([process.env.TEXT], { type: "text/javascript" }))`],
])("a module made from a string at run time: %s", (_kind, url) => {
  test.skipIf(isWindows || !!unsupported).each(forms)(
    "is refused by an error, which is no crash: %s",
    async (_form, isExecutable) => {
      const { stdout, stderr, exitCode, signal } = await runCompiled(importing(url), isExecutable, [], { TEXT: text });
      expect(stderr).toMatch(
        /^EvalError: Code generation from strings disallowed for this context|^error: Cannot load '(?:blob|data):[^']*': it isn't in this executable,/m,
      );
      expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
      expect({ stdout, signal, exitCode }).toEqual({ stdout: "", signal: null, exitCode: 1 });
    },
    120_000,
  );
});

test.skipIf(isWindows || !!unsupported)(
  "a file that a computed name with a constant start can reach is compiled",
  async () => {
    const { stdout, stderr, exitCode } = await runCompiled(
      {
        "on-disk.mjs": "export default 1;",
        "program.mjs": `const made = await import("./on-" + ["disk"][0] + ".mjs"); console.log(made.default);`,
      },
      false,
    );
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
  },
  120_000,
);

const namedAtRunTime = {
  "on-disk.mjs": "export default 1;",
  "program.mjs": `const made = await import(process.cwd() + process.env.LATE); console.log(made.default);`,
};

test.skipIf(isWindows || !!unsupported).each(forms)(
  "a file that is loaded by a name made at run time is refused by an error, which is no crash: %s",
  async (_form, isExecutable) => {
    const { stdout, stderr, exitCode } = await runCompiled(namedAtRunTime, isExecutable, [], { LATE: "/on-disk.mjs" });
    expect(stderr).toMatch(
      /^error: Cannot load '[^']*on-disk\.mjs': it isn't in this executable, which only runs code that was compiled into it\. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk\.$/m,
    );
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  },
  120_000,
);
