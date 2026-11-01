// The type checker of the typescript package (./servers/typescript-check.ts imports it: nine megabytes of JavaScript that nobody wrote with this compiler in mind) is built, and then
// checks one fixed text. The small programs do not reach what this one reaches. For x64 ./servers/budgets-of-typescript.test.ts builds it anyway, and asks it there.
import { expect } from "bun:test";
import { cpSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/declare";
import { compileCommand } from "./harness/flags";
import { wanted } from "./harness/shares";
import { beforeAll, describe, test } from "./supported";

async function run(cmd: string[], cwd: string, seconds: number) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: stderr.split("\n").slice(-30).join("\n"), exitCode, signal: proc.signalCode };
}

// A debug build or one with ASAN takes an hour.
describe.skipIf(wanted === "quick" || process.arch === "x64")("compile/aot/the TypeScript compiler", () => {
  const folder = String(tempDir("aot-typescript-checks-a-text", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  beforeAll(() => {
    cpSync(join(import.meta.dir, "servers", "typescript-check.ts"), join(folder, "typescript-check.ts"));
    mkdirSync(join(folder, "node_modules"));
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(folder, "node_modules", "typescript"));
  });

  test("checks a text", async () => {
    const executable = join(folder, "check");
    const build = await run(
      [bunExe(), ...compileCommand, ...withoutDebugInformation(), "./typescript-check.ts", "--outfile", executable],
      folder,
      1500,
    );
    expect({ step: "build", stderr: build.stderr, exitCode: build.exitCode, signal: build.signal }).toEqual({
      step: "build",
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
      signal: null,
    });
    expect({ step: "run", ...(await run([executable, "2"], folder, 600)) }).toEqual({
      step: "run",
      stdout: "2322 2345 2322\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 2_400_000);
});
