// The build can lower the files of a program in two passes, each with a type checker that knows nothing yet. That takes less
// memory and more time: the second pass works out again what the first knew about the files that its own refer to. So there are
// two passes only where a run has measured its memory and the program does not fit, which is also what makes `bun test --aot`
// build several programs. A build with room has one pass, and so has every `bun build --compile --aot`.
//
// With BUN_JSC_logAOTPhaseTimes=1 a build that takes more than one pass says so in a line for each.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

const moduleCount = 64;

// Files of one size, so that no pass would wait for a large one.
function moduleText(index: number) {
  const before = index ? `import { Step${index - 1} } from "./step${index - 1}";\n` : "";
  const below = index ? `new Step${index - 1}(this.start).total()` : "this.start";
  return `${before}export class Step${index} {
  constructor(readonly start: number) {}
  own(): number {
    return ${1000 + index} % 7;
  }
  total(): number {
    return this.own() + ${below};
  }
}
`;
}

function files() {
  const all: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "esnext", module: "esnext" } }),
    "main.ts": `import { Step${moduleCount - 1} } from "./step${moduleCount - 1}";\nconsole.log(new Step${moduleCount - 1}(1).total());\n`,
  };
  for (let index = 0; index < moduleCount; index++) all[`step${index}.ts`] = moduleText(index);
  for (const name of ["a", "b", "c"]) {
    all[`${name}.test.ts`] = `import { expect, test } from "bun:test";
import { Step${moduleCount - 1} } from "./step${moduleCount - 1}";
test("${name}", () => {
  console.log("${name} sees", new Step${moduleCount - 1}(${name.charCodeAt(0)}).total());
  expect(new Step0(2).total()).toBe(${(1000 % 7) + 2});
});
import { Step0 } from "./step0";
`;
  }
  return all;
}

const passesIn = (output: string) =>
  output.split("\n").filter(line => line.startsWith("AOT pass of the checker | ")).length;
const logging = { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" };

test("an executable is built in one pass", async () => {
  using dir = tempDir("aot-one-pass-for-an-executable", files());
  const directory = String(dir);
  const expected = await run([bunExe(), "main.ts"], directory, bunEnv);
  expect(expected.exitCode).toBe(0);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    directory,
    logging,
  );
  expect(built.exitCode).toBe(0);
  // The log is on: the build says when each round of the checker ends.
  expect(built.stderr + built.stdout).toContain("AOT round of the checker | ");
  expect(passesIn(built.stderr + built.stdout)).toBe(0);
  expect((await run([executable], directory, bunEnv)).stdout).toBe(expected.stdout);
});

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof report>>;
async function report(...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), logging);
  return {
    passes: passesIn(stdout + stderr),
    answers: {
      seen: (stdout + stderr)
        .split("\n")
        .filter(line => line.includes(" sees "))
        .sort(),
      results: [...stderr.matchAll(/^\((pass|fail|skip)\) (\S+)/gm)].map(match => `${match[1]} ${match[2]}`).sort(),
      exitCode,
    },
  };
}
beforeAll(async () => {
  dir = tempDir("aot-two-passes-where-memory-is-short", files());
  plain = await report();
});
afterAll(() => dir?.[Symbol.dispose]());

test("what plain Bun answers", () => {
  expect(plain.answers.results).toEqual(["pass a", "pass b", "pass c"]);
  expect(plain.answers.exitCode).toBe(0);
});

const forms: [string, string[]][] = [
  ["in one process", []],
  ["in two processes", ["--parallel=2"]],
];

test.each(forms)("a test run with room takes one pass, and answers the same: %s", async (_, form) => {
  expect(await report("--aot", ...form, "--aot-memory-limit=64GB")).toEqual({ passes: 0, answers: plain.answers });
});

test.each(forms)("a test run takes two passes where its memory is short, and answers the same: %s", async (_, form) => {
  // No build fits into this.
  const short = await report("--aot", ...form, "--aot-memory-limit=64KB");
  expect(short.answers).toEqual(plain.answers);
  expect(short.passes).toBeGreaterThanOrEqual(2);
});
