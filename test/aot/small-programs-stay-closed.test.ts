// --aot proves things about a whole program only while it has seen all the code that can ever run: the program is closed.
// Only a call of an evaluator or a loader that the program can reach opens it. Mentioning a global, reading `process.env`,
// storing a property on the global object or printing an object opens nothing, and pulls in no more of Bun's own library than
// the smallest program needs.
//
// Each program here is a few lines. It must stay closed (the report lists nothing under `unseenCode`) and compile about as many
// functions as `console.log(1 + 2)` does. Its twin is the same program with one real call of `eval` at the end: the build must
// list that call.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport, type BuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
});

const smallest = { text: `console.log(1 + 2);\n`, output: "3\n" };

const programs: Record<string, { text: string; output: string }> = {
  "typeof a global function": {
    text: `console.log(typeof setTimeout === "function" ? 1 : 2);\n`,
    output: "1\n",
  },
  "typeof a name that nothing defines": {
    text: `declare var window: unknown;\nconsole.log(typeof window === "undefined" ? 1 : 2);\n`,
    output: "1\n",
  },
  "a read of process.env": {
    text: `console.log(process.env.NOT_SET_ANYWHERE === undefined ? 1 : 2);\n`,
    output: "1\n",
  },
  "a store to the global object": {
    text: `declare var shared: number;\n(globalThis as any).shared = 3;\nconsole.log(shared + 1);\n`,
    output: "4\n",
  },
  "an object is printed": {
    text: `console.log({ a: 1 });\n`,
    output: "{\n  a: 1,\n}\n",
  },
};

// These need more of Bun's library than the smallest program (timers, promises, the warning printer), so only the first half holds for them: they stay closed.
const programsThatNeedMoreOfTheLibrary: Record<string, { text: string; output: string }> = {
  "a function is made from a constant text with digits after a zero in a string and in a comment": {
    text: `const day = new Function("return '2024-01-08' // 010");\nconsole.log(day());\n`,
    output: "2024-01-08\n",
  },
  "a promise is settled": {
    text: `async function twice(x: number) {\n  return x * 2;\n}\ntwice(21).then(value => console.log(value));\n`,
    output: "42\n",
  },
  "a Map is filled and printed as JSON": {
    text: `const counts = new Map<string, number>();\nfor (const word of "a b a c".split(" ")) counts.set(word, (counts.get(word) ?? 0) + 1);\nconsole.log(JSON.stringify([...counts]));\n`,
    output: `[["a",2],["b",1],["c",1]]\n`,
  },
  "JSON.parse answers an object that is read": {
    text: `const point = JSON.parse('{"x":5,"y":6}') as { x: number; y: number };\nconsole.log(point.x + point.y);\n`,
    output: "11\n",
  },
  "a property of the global object under a registered symbol": {
    text: `const key = Symbol.for("app:store");\n(globalThis as any)[key] ??= { run: () => 7 };\nconsole.log((globalThis as any)[Symbol.for("app:store")].run());\n`,
    output: "7\n",
  },
  "one of a hundred functions is called": {
    text: `const choices = [${Array.from({ length: 100 }, (_, index) => `() => ${index}`).join(", ")}];\nconsole.log(choices[process.argv.length + 40]());\n`,
    output: "42\n",
  },
};

// The string is put together at run time, so the build can't know it.
const callOfEval = `(0, eval)(process.argv.length > 99 ? "1" : "globalThis.ranTheString = true");\nconsole.log((globalThis as any).ranTheString);\n`;

// The folder has Bun's types and not Node's. The declaration stands at the end, so it moves no line.
const declarationOfProcess = `declare var process: { argv: string[]; env: Record<string, string | undefined> };\n`;

async function compileAndRun(text: string): Promise<{ report: BuildReport; stdout: string }> {
  using dir = tempDir("aot-small-programs-stay-closed", {
    "main.ts": text + declarationOfProcess,
    "tsconfig.json": tsconfig,
  });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const reportPath = join(folder, "report.json");
  built(
    await spawned(
      [bunExe(), ...compileCommand, ...withReport(reportPath, "summary"), "main.ts", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const ran = await spawned([executable], folder, bunEnv);
  expect({ signal: ran.signal, exitCode: ran.exitCode, stderr: ran.stderr }).toEqual({
    signal: null,
    exitCode: 0,
    stderr: "",
  });
  return { report: readBuildReport(reportPath), stdout: ran.stdout };
}

describe.concurrent("compile/aot/small programs stay closed", () => {
  let functionsOfSmallest = 0;

  beforeAll(async () => {
    const { report, stdout } = await slot(() => compileAndRun(smallest.text));
    expect({ stdout, unseenCode: report.unseenCode }).toEqual({ stdout: smallest.output, unseenCode: [] });
    functionsOfSmallest = report.summary.functions;
  }, 600_000);

  for (const [name, { text, output }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          const { report, stdout } = await compileAndRun(text);
          expect({ stdout, unseenCode: report.unseenCode }).toEqual({ stdout: output, unseenCode: [] });
          // TODO: on Windows process.env is a Proxy that the library makes in JavaScript, and it brings 489 functions.
          if (isWindows && name === "a read of process.env") return;
          expect(report.summary.functions).toBeLessThanOrEqual(Math.ceil(functionsOfSmallest * 1.25));
        }),
      600_000,
    );

    test(
      `${name}, and eval is called`,
      () =>
        slot(async () => {
          const { report, stdout } = await compileAndRun(text + callOfEval);
          expect(stdout).toBe(output + "true\n");
          const lineOfCall = text.split("\n").length;
          expect(report.unseenCode).toContainEqual({
            cause: "EvaluatesText",
            builtin: "eval",
            location: expect.objectContaining({ file: expect.stringMatching(/main\.ts$/), line: lineOfCall }),
          });
        }),
      600_000,
    );
  }

  for (const [name, { text, output }] of Object.entries(programsThatNeedMoreOfTheLibrary)) {
    test(
      name,
      () =>
        slot(async () => {
          const { report, stdout } = await compileAndRun(text);
          expect({ stdout, unseenCode: report.unseenCode }).toEqual({ stdout: output, unseenCode: [] });
        }),
      600_000,
    );
  }
});
