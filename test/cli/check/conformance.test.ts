import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { availableParallelism } from "node:os";
import { join } from "node:path";

// TypeScript's compiler and conformance tests, run as typescript-go's own test runner runs them: in memory, every
// configuration a test asks for. The output has to be the `.errors.txt` that typescript-go commits, byte for byte.
// See typescript-go/README.md.
const reference = "/testdata/baselines/reference";
const suites = [
  ["compiler", "/_submodules/TypeScript/tests/cases/compiler", `${reference}/submodule/compiler`],
  ["conformance", "/_submodules/TypeScript/tests/cases/conformance", `${reference}/submodule/conformance`],
  ["own-compiler", "/testdata/tests/cases/compiler", `${reference}/compiler`],
  ["own-conformance", "/testdata/tests/cases/conformance", `${reference}/conformance`],
].map(([name, cases, baselines]) => `${name}=${cases}=${baselines}=${baselines}/names.txt`);

// A debug build is 10 to 100 times slower, so it runs a sample. It is always the same sample.
const every = isDebug || isASAN ? 40 : 1;

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

test.skipIf(!hasRunner)(
  "TypeScript's tests have the errors that typescript-go reports",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "check",
        "--run-typescript-tests",
        // The paths below are paths in it.
        `--bundle=${join(import.meta.dir, "typescript-go", "bundle.txt")}`,
        "--lib=/internal/bundled/libs",
        "--testlib=/_submodules/TypeScript/tests/lib",
        `--threads=${availableParallelism()}`,
        `--every=${every}`,
        ...(process.env.ONLY ? [`--only=${process.env.ONLY}`] : []),
        ...suites,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // The runner prints the first 50.
    expect(stdout.split("\n").filter(line => line.startsWith("FAIL "))).toEqual([]);
    expect(stdout).toContain("100.00%  byte for byte");
    expect(exitCode).toBe(0);
  },
  10 * 60_000,
);
