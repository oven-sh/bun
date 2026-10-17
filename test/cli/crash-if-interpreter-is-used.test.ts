import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { unsupported, withoutCoreDump } from "../aot/run-programs";

test("BUN_JSC_crashIfInterpreterIsUsed names the code and crashes", async () => {
  await using proc = Bun.spawn({
    cmd: withoutCoreDump([bunExe(), "-e", "console.log(1)"]),
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("crashIfInterpreterIsUsed: ");
  expect(exitCode).not.toBe(0);
});

test.skipIf(isWindows || !!unsupported)("it spares Bun's debugger module in a compiled program that is started with BUN_INSPECT", async () => {
  using folder = tempDir("crash-if-interpreter", { "program.mjs": `await new Promise(resolve => setTimeout(resolve, 100)); console.log("done");` });
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"], cwd: String(folder), env: bunEnv, stdout: "ignore", stderr: "pipe" });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  await using proc = Bun.spawn({
    cmd: [join(String(folder), "program")],
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_INSPECT: "ws://127.0.0.1:0/crash-if-interpreter" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
  expect({ stdout, signal: proc.signalCode, exitCode }).toEqual({ stdout: "done\n", signal: null, exitCode: 0 });
}, 120_000);

test.skipIf(isWindows || !!unsupported)("BUN_INSPECT spares nothing but the debugger module", async () => {
  using folder = tempDir("crash-if-interpreter", {
    "program.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(process.cwd() + "/late.cjs", "module.exports = 1;"); console.log(require(process.cwd() + "/late.cjs"));`,
  });
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"], cwd: String(folder), env: bunEnv, stdout: "ignore", stderr: "pipe" });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  await using proc = Bun.spawn({
    cmd: withoutCoreDump([join(String(folder), "program")]),
    cwd: String(folder),
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_INSPECT: "ws://127.0.0.1:0/crash-if-interpreter" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toMatch(/^crashIfInterpreterIsUsed: .*late\.cjs/m);
  expect(stderr).not.toContain("internal:debugger");
  expect(exitCode).not.toBe(0);
}, 120_000);

async function runCompiled(files: Record<string, string>, isExecutable: boolean) {
  using folder = tempDir("crash-if-interpreter", files);
  if (isExecutable) {
    await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"], cwd: String(folder), env: bunEnv, stdout: "ignore", stderr: "pipe" });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  }
  await using proc = Bun.spawn({
    cmd: withoutCoreDump(isExecutable ? [join(String(folder), "program")] : [bunExe(), "run", "--debug-aot", "program.mjs"]),
    cwd: String(folder),
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

const text = "export default 6; export function f() { return 7 }";
test.skipIf(isWindows || !!unsupported).each([
  ["a data: URL", "bun run --aot", `"data:text/javascript,${text}"`, false],
  ["a data: URL", "an executable", `"data:text/javascript,${text}"`, true],
  ["a blob: URL", "bun run --aot", `URL.createObjectURL(new Blob(["${text}"], { type: "text/javascript" }))`, false],
  ["a blob: URL", "an executable", `URL.createObjectURL(new Blob(["${text}"], { type: "text/javascript" }))`, true],
])(
  "it spares a module made from a string at run time: %s, %s",
  async (_kind, _form, url, isExecutable) => {
    const { stdout, stderr, exitCode, signal } = await runCompiled({ "program.mjs": `const url = ${url}; const made = await import(url); console.log(made.default, made.f());` }, isExecutable);
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, signal, exitCode }).toEqual({ stdout: "6 7\n", signal: null, exitCode: 0 });
  },
  120_000,
);

test.skipIf(isWindows || !!unsupported)("it does not spare a file that is loaded by a name made at run time", async () => {
  const { stderr, exitCode } = await runCompiled({ "on-disk.mjs": "export default 1;", "program.mjs": `const made = await import("./on-" + ["disk"][0] + ".mjs"); console.log(made.default);` }, false);
  expect(stderr).toMatch(/^crashIfInterpreterIsUsed: .*on-disk\.mjs/m);
  expect(exitCode).not.toBe(0);
}, 120_000);
