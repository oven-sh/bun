import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "../aot/supported";

const flag = "--aot-crash-if-interpreter-is-used";
const startsChild = `const child = Bun.spawnSync({ cmd: [process.env.CHILD_BUN, "-e", "console.log('child ran')"], stdout: "pipe", stderr: "pipe" });
console.log(JSON.stringify({ stdout: child.stdout.toString(), tripped: child.stderr.toString().includes("crashIfInterpreterIsUsed: "), succeeded: child.exitCode === 0 }));`;
const loadsLateFile = `import { writeFileSync } from "node:fs"; writeFileSync(process.cwd() + "/late.cjs", "module.exports = 1;"); console.log(require(process.cwd() + "/late.cjs"));`;
const childRan = JSON.stringify({ stdout: "child ran\n", tripped: false, succeeded: true }) + "\n";
const childTripped = JSON.stringify({ stdout: "", tripped: true, succeeded: false }) + "\n";
const tripsOnLateFile = /^crashIfInterpreterIsUsed: .*late\.cjs/m;

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: undefined, CHILD_BUN: bunExe(), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function build(cwd: string, ...flags: string[]) {
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "program.mjs", "--outfile", "program"],
    cwd,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  return join(cwd, "program");
}

describe.skipIf(isWindows).concurrent(flag, () => {
  test("a child process of the executable does not inherit it", async () => {
    using folder = tempDir("aot-crash-if-interpreter", { "program.mjs": startsChild });
    const { stdout, stderr, exitCode } = await run([await build(String(folder), flag)], String(folder));
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, exitCode }).toEqual({ stdout: childRan, exitCode: 0 });
  }, 120_000);

  test("the executable started by itself has it too", async () => {
    using folder = tempDir("aot-crash-if-interpreter", {
      "program.mjs": `import { writeFileSync } from "node:fs";
if (process.argv[2] === "as-child") {
  writeFileSync(process.cwd() + "/late.cjs", "module.exports = 1;");
  console.log(require(process.cwd() + "/late.cjs"));
} else {
  const child = Bun.spawnSync({ cmd: [process.execPath, "as-child"], stdout: "pipe", stderr: "pipe" });
  console.log(JSON.stringify({ stdout: child.stdout.toString(), tripped: child.stderr.toString().includes("crashIfInterpreterIsUsed: "), succeeded: child.exitCode === 0 }));
}`,
    });
    const { stdout, exitCode } = await run([await build(String(folder), flag)], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: childTripped, exitCode: 0 });
  }, 120_000);

  test("the environment variable does reach a child process", async () => {
    using folder = tempDir("aot-crash-if-interpreter", { "program.mjs": startsChild });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder), {
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect({ stdout, exitCode }).toEqual({ stdout: childTripped, exitCode: 0 });
  }, 120_000);

  test("the executable crashes on code that was not compiled, unless the environment turns it off", async () => {
    using folder = tempDir("aot-crash-if-interpreter", { "program.mjs": loadsLateFile });
    const program = await build(String(folder), flag);
    const tripped = await run([program], String(folder));
    expect(tripped.stderr).toMatch(tripsOnLateFile);
    expect(tripped.exitCode).not.toBe(0);
    const turnedOff = await run([program], String(folder), { BUN_JSC_crashIfInterpreterIsUsed: "0" });
    expect({ stdout: turnedOff.stdout, exitCode: turnedOff.exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
  }, 120_000);

  test("an executable built without it runs that code", async () => {
    using folder = tempDir("aot-crash-if-interpreter", { "program.mjs": loadsLateFile });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
  }, 120_000);

  test("bun run --aot takes it, and a child process does not inherit it", async () => {
    using folder = tempDir("aot-crash-if-interpreter", { "child.mjs": startsChild, "late.mjs": loadsLateFile });
    const withChild = await run([bunExe(), "run", "--debug-aot", flag, "child.mjs"], String(folder));
    expect({ stdout: withChild.stdout, exitCode: withChild.exitCode }).toEqual({ stdout: childRan, exitCode: 0 });
    const tripped = await run([bunExe(), "run", "--debug-aot", flag, "late.mjs"], String(folder));
    expect(tripped.stderr).toMatch(tripsOnLateFile);
    expect(tripped.exitCode).not.toBe(0);
    const without = await run([bunExe(), "run", "--debug-aot", "late.mjs"], String(folder));
    expect({ stdout: without.stdout, exitCode: without.exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
  }, 120_000);

  test("bun test --aot takes it, and a child process does not inherit it", async () => {
    using folder = tempDir("aot-crash-if-interpreter", {
      "child.test.mjs": `import { expect, test } from "bun:test";
test("child", () => { const child = Bun.spawnSync({ cmd: [process.env.CHILD_BUN, "-e", "console.log('child ran')"], stdout: "pipe", stderr: "pipe" }); expect(child.stdout.toString()).toBe("child ran\\n"); });`,
      "late.test.mjs": `import { expect, test } from "bun:test"; import { writeFileSync } from "node:fs";
test("late", () => { writeFileSync(process.cwd() + "/late.cjs", "module.exports = 1;"); expect(require(process.cwd() + "/late.cjs")).toBe(1); });`,
    });
    const withChild = await run([bunExe(), "test", "--debug-aot", flag, "./child.test.mjs"], String(folder));
    expect(withChild.stderr).toContain("1 pass");
    expect(withChild.exitCode).toBe(0);
    const tripped = await run([bunExe(), "test", "--debug-aot", flag, "./late.test.mjs"], String(folder));
    expect(tripped.stderr).toMatch(tripsOnLateFile);
    expect(tripped.exitCode).not.toBe(0);
    const without = await run([bunExe(), "test", "--debug-aot", "./late.test.mjs"], String(folder));
    expect(without.stderr).toContain("1 pass");
    expect(without.exitCode).toBe(0);
  }, 120_000);

  test("Bun.build() takes it as compile.aotCrashIfInterpreterIsUsed", async () => {
    using folder = tempDir("aot-crash-if-interpreter", {
      "child.mjs": startsChild,
      "late.mjs": loadsLateFile,
      "build.mjs": `for (const name of ["child", "late"]) {
  const result = await Bun.build({ entrypoints: ["./" + name + ".mjs"], compile: { outfile: "./" + name, aot: true, aotCrashIfInterpreterIsUsed: true } });
  if (!result.success) throw new AggregateError(result.logs);
}
console.log("built");`,
    });
    const built = await run([bunExe(), "build.mjs"], String(folder));
    expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({ stdout: "built\n", exitCode: 0 });
    const withChild = await run([join(String(folder), "child")], String(folder));
    expect({ stdout: withChild.stdout, exitCode: withChild.exitCode }).toEqual({ stdout: childRan, exitCode: 0 });
    const tripped = await run([join(String(folder), "late")], String(folder));
    expect(tripped.stderr).toMatch(tripsOnLateFile);
    expect(tripped.exitCode).not.toBe(0);
  }, 120_000);

  test("compile.aotCrashIfInterpreterIsUsed: false leaves it off, and it requires compile.aot", async () => {
    using folder = tempDir("aot-crash-if-interpreter", {
      "late.mjs": loadsLateFile,
      "build.mjs": `const result = await Bun.build({ entrypoints: ["./late.mjs"], compile: { outfile: "./late", aot: true, aotCrashIfInterpreterIsUsed: false } });
if (!result.success) throw new AggregateError(result.logs);
try {
  await Bun.build({ entrypoints: ["./late.mjs"], compile: { outfile: "./other", aotCrashIfInterpreterIsUsed: true } });
  console.log("built without aot");
} catch (error) {
  console.log(error.message);
}`,
    });
    const built = await run([bunExe(), "build.mjs"], String(folder));
    expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({
      stdout: "compile.aotCrashIfInterpreterIsUsed requires compile.aot: true\n",
      exitCode: 0,
    });
    const { stdout, exitCode } = await run([join(String(folder), "late")], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
  }, 120_000);

  test("it requires --aot", async () => {
    using folder = tempDir("aot-crash-if-interpreter", { "program.mjs": "console.log(1);" });
    const { stderr, exitCode } = await run(
      [bunExe(), "build", "--compile", flag, "program.mjs", "--outfile", "program"],
      String(folder),
    );
    expect(stderr).toContain(flag + " requires --aot");
    expect(exitCode).not.toBe(0);
  });

  test("it is not listed in the help", async () => {
    using folder = tempDir("aot-crash-if-interpreter", {});
    const { stdout, stderr } = await run([bunExe(), "build", "--help"], String(folder));
    expect(stdout + stderr).toContain("--aot-type-errors");
    expect(stdout + stderr).not.toContain(flag);
  });
});
