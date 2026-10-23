// The type checker of the typescript package (./servers/typescript-check.ts imports it: nine megabytes of JavaScript that nobody wrote with this compiler in mind) is built under each flag
// with which the compiler checks itself, and then checks one fixed text. Fault after fault has shown on this program alone, and under one of these flags alone: an assertion in a pass, a form
// between two passes that the verifier refuses, a proof that only a validating executable finds false, a function that is only wrong in its cold form. The small programs do not reach them.
//
//   AOT_TYPESCRIPT_FLAGS=1    all five ways: an hour of processor time, where CI gives a file five minutes on four cores. Without it: the build as usual
import { afterAll, expect } from "bun:test";
import { cpSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { buildFlags, compileCommand, withLimit } from "./harness/flags";
import { wanted, withoutDebugInformation } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const ways: [string, string[]][] = [
  ["as usual", []],
  ["every function cold", ["--aot-heat=everything-is-cold"]],
  ["validating", [buildFlags.validate]],
  ["every pass verified", [buildFlags.verifyEachPass]],
  // No function gets a generic version to fall back to: every test that the compiler adds is a guard at each use.
  ["every test a guard", [withLimit("MaxGenericVersionJoinWork", 0)]],
];

const everyWay = !!process.env.AOT_TYPESCRIPT_FLAGS;
if (!everyWay)
  console.error(
    "SKIPPED: test/aot/the-typescript-compiler-under-checking-flags: the four builds under a checking flag: AOT_TYPESCRIPT_FLAGS=1 switches them on",
  );

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

// A debug build or one with ASAN takes an hour for each.
describe.skipIf(wanted === "quick")("compile/aot/the TypeScript compiler under checking flags", () => {
  const folder = String(tempDir("aot-typescript-under-checking-flags", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  beforeAll(() => {
    cpSync(join(import.meta.dir, "servers", "typescript-check.ts"), join(folder, "typescript-check.ts"));
    mkdirSync(join(folder, "node_modules"));
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(folder, "node_modules", "typescript"));
  });

  // One after the other: each build takes every core.
  test.each(ways.filter(([way]) => everyWay || way === "as usual"))(
    "%s",
    async (way, flags) => {
      const executable = join(folder, "check-" + way.replaceAll(" ", "-"));
      const build = await run(
        [
          bunExe(),
          ...compileCommand,
          ...withoutDebugInformation(),
          ...flags,
          "./typescript-check.ts",
          "--outfile",
          executable,
        ],
        folder,
        1500,
      );
      expect({ way, step: "build", stderr: build.stderr, exitCode: build.exitCode, signal: build.signal }).toEqual({
        way,
        step: "build",
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
        signal: null,
      });
      try {
        expect({ way, step: "run", ...(await run([executable, "2"], folder, 600)) }).toEqual({
          way,
          step: "run",
          stdout: "2322 2345 2322\n",
          stderr: "",
          exitCode: 0,
          signal: null,
        });
      } finally {
        rmSync(executable, { force: true });
      }
    },
    2_400_000,
  );
});
