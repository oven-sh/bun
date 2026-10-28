// A CommonJS file has `require` in the scope of every direct eval in it. Only the text can name it there: nobody has handed it on.
// So a call of a value that the build can't follow, elsewhere in the program, is no call of that `require`, and the build lists no
// load under a name made at run time. Once the file hands its `require` on itself, such a call may be one.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport, type BuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const wraps = `function wrap(fn) {
  const names = [];
  for (let index = 0; index < fn.length; index++) names.push("argument" + index);
  return eval("(function (" + names.join(", ") + ") { return fn.apply(this, arguments); })");
}
`;
const callsWhatNobodyFollows = `const table = { first: value => value + 1, second: value => value + 2 };
const picked = new CustomEvent("x", { detail: table[process.argv[5] ?? "first"] }).detail;
console.log(wrap((a, b) => a + b)(1, 2), picked(1));
`;
const handsOn = `console.log(typeof new CustomEvent("x", { detail: require }).detail("node:zlib").gzipSync);\n`;

async function compileAndRun(text: string): Promise<{ report: BuildReport; stdout: string }> {
  using dir = tempDir("aot-the-text-of-a-direct-eval", { "main.cjs": text });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const reportPath = join(folder, "report.json");
  built(
    await spawned(
      [bunExe(), ...compileCommand, ...withReport(reportPath, "summary"), "main.cjs", "--outfile", executable],
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

const namesRequire = (report: BuildReport) => report.unseenCode.some(({ builtin }) => builtin === "%ModuleRequire%");

describe.concurrent("compile/aot/the text of a direct eval alone names the require of its file", () => {
  test(
    "a call of a value nobody follows is no call of it",
    () =>
      slot(async () => {
        const { report, stdout } = await compileAndRun(wraps + callsWhatNobodyFollows);
        expect({ stdout, namesRequire: namesRequire(report) }).toEqual({ stdout: "3 2\n", namesRequire: false });
      }),
    600_000,
  );

  test(
    "a file that hands it on gets it back and calls it",
    () =>
      slot(async () => {
        const { report, stdout } = await compileAndRun(wraps + callsWhatNobodyFollows + handsOn);
        expect({ stdout, namesRequire: namesRequire(report) }).toEqual({
          stdout: "3 2\nfunction\n",
          namesRequire: true,
        });
      }),
    600_000,
  );
});
