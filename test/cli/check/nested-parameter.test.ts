import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

const depth = 10_000;
const pattern = `${"{ a: ".repeat(depth)}b${" }".repeat(depth)}`;

async function check(source: string) {
  using dir = tempDir("check-nested-parameter", { "tsconfig.json": tsconfig, "a.ts": source });
  await using proc = spawn({
    cmd: [bunExe(), "check"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    timeout: longLimit,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const errors = stdout.split("\n").filter(line => line.includes("error TS"));
  return { errors, exitCode, milliseconds: Number(proc.resourceUsage()!.cpuTime.total) / 1000 };
}

// Each element of a parameter's pattern asked whether it is ambient by going up through all the patterns around it.
// That took 16 times what the same pattern takes in a variable. Processor time, so a busy machine does not decide.
test.skipIf(isDebug || isASAN)("a nested pattern costs about as much in a parameter as in a variable", async () => {
  const variable = await check(`export {};\ndeclare let y: any; let ${pattern} = y; let x: string = b;\n`);
  const parameter = await check(`export {};\nfunction f(${pattern}) {}\n`);
  expect({ errors: variable.errors, exitCode: variable.exitCode }).toEqual({ errors: [], exitCode: 0 });
  expect({ errors: parameter.errors, exitCode: parameter.exitCode }).toEqual({
    errors: [`a.ts(2,${12 + 5 * depth}): error TS7031: Binding element 'b' implicitly has an 'any' type.`],
    exitCode: 1,
  });
  expect(parameter.milliseconds / variable.milliseconds).toBeLessThan(6);
});
