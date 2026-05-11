import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/30477
// experimentalDecorators was silently dropped across tsconfig extends chains.

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

test.concurrent("experimentalDecorators: true is preserved through an extends chain", async () => {
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
  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(exitCode).toBe(0);
});

test.concurrent("experimentalDecorators inherited from the base tsconfig still wins", async () => {
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
  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(exitCode).toBe(0);
});

// The following two cases pin down TypeScript's per-key override semantics for
// `extends`: a child's explicit value wins over the parent's, even when the
// child's value is `false`. Without this, `or`-merging made `true` sticky —
// a base config could force legacy decorators on every child that extended it.
test.concurrent("child experimentalDecorators: false overrides parent true (disables legacy)", async () => {
  using dir = tempDir("bun-30477-child-false-exp", {
    "base-tsconfig.json": JSON.stringify({
      compilerOptions: { target: "esnext", experimentalDecorators: true },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./base-tsconfig.json",
      compilerOptions: { module: "esnext", experimentalDecorators: false },
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

  // Child explicitly opts out of legacy decorators — stage-3 should win.
  expect(stdout).toBe("stage-3\nOK\n");
  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(exitCode).toBe(0);
});

test.concurrent("child emitDecoratorMetadata: false overrides parent true", async () => {
  // When emitDecoratorMetadata is true, Bun emits __legacyMetadataTS(...)
  // calls into __legacyDecorateClassTS. A child that sets it back to false
  // must prevent that emission.
  const META_SOURCE = `
function probe(target: unknown, key: unknown) { /* legacy signature */ }

class Foo {
  @probe
  foo(a: number) {}
}

console.log(typeof Foo);
`;
  using dir = tempDir("bun-30477-child-false-meta", {
    "base-tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "esnext",
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./base-tsconfig.json",
      compilerOptions: { module: "esnext", emitDecoratorMetadata: false },
    }),
    "index.ts": META_SOURCE,
  });

  // `bun build` lets us inspect the transpiled output directly.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target", "bun", "./index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // __legacyMetadataTS is only emitted when emitDecoratorMetadata is on.
  // Child opted out, so the bundled output must NOT contain it.
  expect(stdout).not.toContain("__legacyMetadataTS");
  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(exitCode).toBe(0);
});

test.concurrent("--tsconfig-override picks up experimentalDecorators via extends", async () => {
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

  expect(stdout).toBe("legacy\nOK\n");
  // The bogus "Internal error: directory mismatch" warning from the
  // override-fd path must not appear — the resolver now passes an
  // invalid dirname_fd when the override path isn't a child of the
  // directory being iterated.
  expect(stderr).not.toContain("directory mismatch");
  expect(exitCode).toBe(0);
});
