import { spawn } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

setDefaultTimeout(60_000);

const files = {
  "sum.ts": `export function sum(a: number, b: number): number {\n  return a + b;\n}\n`,
  "sum.test.ts": `import { expect, test } from "bun:test";\nimport { sum } from "./sum";\ntest("sum", () => {\n  expect(sum(1, 2)).toBe(3);\n});\n`,
};
const warning = "warn: --coverage is ignored with --aot";

async function ran(flags: string[]) {
  using dir = tempDir("test-aot-coverage", files);
  await using proc = spawn({ cmd: [bunExe(), "test", ...flags], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
  return stdout + stderr;
}

test.skipIf(isWindows)("bun test --aot --coverage warns that coverage is not measured", async () => {
  const said = await ran(["--aot", "--coverage"]);
  expect(said).toContain(warning);
  expect(said).not.toContain("% Funcs");
});

test.skipIf(isWindows)("either flag alone prints no such warning", async () => {
  expect(await ran(["--aot"])).not.toContain(warning);
  const covered = await ran(["--coverage"]);
  expect(covered).not.toContain(warning);
  expect(covered).toContain("% Funcs");
});
