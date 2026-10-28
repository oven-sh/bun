import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

test("--aot-separate-programs compiles every entry point as a program of its own, and BUN_AOT_START_AT starts any of them", async () => {
  using dir = tempDir("separate-programs", {
    "a/first.ts": `console.log("first", import.meta.main, Bun.isMainThread, process.argv.slice(2).join());`,
    "a/evaluates.js": `console.log("evaluates", import.meta.main, eval("1 + 1")); process.exit(3);`,
    "b/typed.ts": `class A { x: number = 1 } console.log("typed", new A().x, import.meta.path.replaceAll("\\\\", "/").split("/root/")[1]);`,
  });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "all.exe" : "all");
  const flags = ["--aot-separate-programs", "--root=.", "--aot-report=report.json", "--aot-report-detail=summary"];
  const entryPoints = ["./a/first.ts", "./a/evaluates.js", "./b/typed.ts"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, ...entryPoints, "--outfile", executable],
    cwd,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(readFileSync(join(cwd, "report.json"), "utf8")).statistics.EngineRuns).toBe(3);

  const startAt = async (name?: string) => {
    const { stdout, exitCode } = await run([executable, "x", "y"], cwd, { ...bunEnv, BUN_AOT_START_AT: name });
    return { stdout, exitCode };
  };
  expect(await startAt()).toEqual({ stdout: "first true true x,y\n", exitCode: 0 });
  if (!isCanary) return;
  expect(await startAt("a/first.ts")).toEqual({ stdout: "first true true x,y\n", exitCode: 0 });
  expect(await startAt("a/evaluates.js")).toEqual({ stdout: "evaluates true 2\n", exitCode: 3 });
  expect(await startAt("b/typed.ts")).toEqual({ stdout: "typed 1 b/typed.ts\n", exitCode: 0 });
  expect(await startAt("b/none.ts")).toEqual({ stdout: "", exitCode: 1 });
});

test.skipIf(!isCanary)("BUN_AOT_START_AT starts any entry point of one program too", async () => {
  using dir = tempDir("one-program-started-anywhere", {
    "first.ts": `console.log("first", import.meta.main);`,
    "second.ts": `console.log("second", import.meta.main, process.argv.slice(2).join());`,
  });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "all.exe" : "all");
  const flags = ["--root=.", "--aot-report=report.json", "--aot-report-detail=summary"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "./first.ts", "./second.ts", "--outfile", executable],
    cwd,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(readFileSync(join(cwd, "report.json"), "utf8")).statistics.EngineRuns).toBe(1);
  const startAt = async (name?: string) => {
    const { stdout, exitCode } = await run([executable, "x"], cwd, { ...bunEnv, BUN_AOT_START_AT: name });
    return { stdout, exitCode };
  };
  expect(await startAt()).toEqual({ stdout: "first true\n", exitCode: 0 });
  expect(await startAt("second.ts")).toEqual({ stdout: "second true x\n", exitCode: 0 });
  expect(await startAt("none.ts")).toEqual({ stdout: "", exitCode: 1 });
});

test("each program of an executable holds the module of Bun's library that it imports", async () => {
  using dir = tempDir("separate-programs-each-its-own-module", {
    "main.mjs": `import found from "node:punycode";
console.log("main", typeof found.toASCII, typeof found.parse);
new Worker("./worker.mjs");
`,
    "worker.mjs": `import found from "node:querystring";
console.log("worker", typeof found.toASCII, typeof found.parse);
`,
  });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "all.exe" : "all");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.mjs", "./worker.mjs", "--outfile", executable],
    cwd,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { stdout, exitCode } = await run([executable], cwd, bunEnv);
  expect({ stdout, exitCode }).toEqual({
    stdout: "main function undefined\nworker undefined function\n",
    exitCode: 0,
  });
});

// Which of Bun's own code stands behind a member that is read by its name is a guess. The engine follows values: a program that it finds
// to run code that it was not handed is compiled again with that code. The other programs of the build stay as they are.
test("of the programs of one build only the one that was handed too little of Bun's own code is compiled again", async () => {
  using dir = tempDir("separate-programs-one-compiled-again", {
    "computed.ts": `const names = ["map", "filter"];
const list: any = [1, 2, 3];
console.log(list[names[Date.now() < 0 ? 1 : 0]]((x: number) => x + 1).join());
`,
    "prints.ts": `console.log("a line");\n`,
    "named.ts": `console.log([1, 2, 3].map(x => x + 1).join());\n`,
  });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "all.exe" : "all");
  const flags = ["--aot-separate-programs", "--root=.", "--aot-report=report.json", "--aot-report-detail=summary"];
  const entryPoints = ["./computed.ts", "./prints.ts", "./named.ts"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, ...entryPoints, "--outfile", executable],
    cwd,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(readFileSync(join(cwd, "report.json"), "utf8")).statistics.EngineRuns).toBe(4);
  expect(built.stderr + built.stdout).not.toMatch(/error|warn/i);
  const { stdout, exitCode } = await run([executable], cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  expect({ stdout, exitCode }).toEqual({ stdout: "2,3,4\n", exitCode: 0 });
});
