// Regression for oven-sh/bun#30477:
// `experimentalDecorators: true` in a tsconfig that `extends` another
// parent was silently dropped during the extends-merge, so Bun emitted
// stage-3 (TC39) decorators instead of legacy ones.
//
// Also covers the `--tsconfig-override` flag path, which attaches the
// tsconfig to the filesystem root DirInfo — the transpiler must pick
// it up via `enclosing_tsconfig_json` for the working directory.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The probe decorator distinguishes legacy vs stage-3 emit at runtime:
// legacy decorators pass exactly one argument (the target class);
// stage-3 decorators pass two (value + context).
const PROBE_SOURCE = `
function probe(...args: unknown[]) {
  if (args.length === 1) {
    console.log("legacy");
  } else {
    console.log("stage-3");
  }
}

@probe
class Foo {}

console.log("OK");
`;

test("experimentalDecorators: true is preserved through an extends chain", async () => {
  using dir = tempDir("bun-30477-extends", {
    "base-tsconfig.json": JSON.stringify({
      compilerOptions: { target: "esnext" },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./base-tsconfig.json",
      compilerOptions: { module: "esnext", experimentalDecorators: true },
    }),
    "index.ts": PROBE_SOURCE,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("legacy\nOK\n");
  expect(exitCode).toBe(0);
});

test("experimentalDecorators inherited from the base tsconfig still wins", async () => {
  using dir = tempDir("bun-30477-base", {
    "base-tsconfig.json": JSON.stringify({
      compilerOptions: { target: "esnext", experimentalDecorators: true },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./base-tsconfig.json",
      compilerOptions: { module: "esnext" },
    }),
    "index.ts": PROBE_SOURCE,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("legacy\nOK\n");
  expect(exitCode).toBe(0);
});

test("--tsconfig-override picks up experimentalDecorators via extends", async () => {
  using dir = tempDir("bun-30477-override", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "esnext" },
    }),
    "tsconfig.bun.json": JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        module: "esnext",
        experimentalDecorators: true,
      },
    }),
    "index.ts": PROBE_SOURCE,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--tsconfig-override", "./tsconfig.bun.json", "./index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The bogus "Internal error: directory mismatch" warning from the
  // override-fd path must not appear — the resolver now passes an
  // invalid dirname_fd when the override path isn't a child of the
  // directory being iterated.
  expect(stderr).not.toContain("directory mismatch");
  expect(stdout).toBe("legacy\nOK\n");
  expect(exitCode).toBe(0);
});
