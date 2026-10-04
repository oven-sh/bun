import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { join } from "node:path";

// TypeScript's compiler and conformance tests, run as typescript-go's own test runner runs them: in memory, every
// configuration a test asks for. What they produce has to be what typescript-go commits, byte for byte.
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

const dir = tempDir("typescript-go", {});
afterAll(() => dir[Symbol.dispose]());

// One run compares all the kinds.
let ran: Promise<string> | undefined;
const run = () =>
  (ran ??= (async () => {
    const bundle = join(String(dir), "bundle.txt");
    await Bun.write(
      bundle,
      Bun.zstdDecompressSync(await Bun.file(join(import.meta.dir, "typescript-go", "bundle.zst")).bytes()),
    );
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "check",
        "--run-typescript-tests",
        // The paths below are paths in it.
        `--bundle=${bundle}`,
        "--lib=/internal/bundled/libs",
        "--testlib=/_submodules/TypeScript/tests/lib",
        `--threads=${availableParallelism()}`,
        `--every=${every}`,
        "--types-and-symbols",
        "--declarations",
        ...(process.env.ONLY ? [`--only=${process.env.ONLY}`] : []),
        ...suites,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    return await proc.stdout.text();
  })());

test.skipIf(!hasRunner).each([
  ["Errors", "the errors", ".errors.txt"],
  ["Types", "the type of every expression", ".types"],
  ["Symbols", "the symbol of every name", ".symbols"],
  ["Declarations", "the declaration files", ".js, except for the JavaScript in it"],
])(
  "%s: TypeScript's tests have %s that typescript-go has (%s)",
  async kind => {
    const stdout = await run();
    // The runner prints the first 50.
    expect(stdout.split("\n").filter(line => line.startsWith(`FAIL ${kind} `))).toEqual([]);
    expect(stdout).toMatch(new RegExp(`100\\.00%  of \\d+ ${kind}, byte for byte`));
  },
  10 * 60_000,
);
