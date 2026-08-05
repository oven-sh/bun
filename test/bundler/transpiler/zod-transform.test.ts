// Tests for the zod transform (BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD): the
// runtime-transpiler path. Fixtures live in ./zod/ and resolve the zod
// package from test/node_modules.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

const fixtureDir = path.join(import.meta.dir, "zod");

async function runFixture(file: string, zodTransform: boolean): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(fixtureDir, file)],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD: zodTransform ? "1" : undefined,
    },
    cwd: fixtureDir,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

test.concurrent(
  "differential: transform on and off produce identical results",
  async () => {
    const [on, off] = await Promise.all([runFixture("diff-fixture.ts", true), runFixture("diff-fixture.ts", false)]);
    const onReport = JSON.parse(on);
    const offReport = JSON.parse(off);
    // Compare schema-by-schema so a mismatch names the schema and input.
    for (const schema of Object.keys(offReport)) {
      expect({ [schema]: onReport[schema] }).toEqual({ [schema]: offReport[schema] });
    }
    expect(Object.keys(onReport).sort()).toEqual(Object.keys(offReport).sort());
  },
  120_000,
);

test.concurrent(
  "memory: schemas are lazy until touched",
  async () => {
    const [on, off] = await Promise.all([
      runFixture("memory-fixture.ts", true),
      runFixture("memory-fixture.ts", false),
    ]);
    const onStats = JSON.parse(on);
    const offStats = JSON.parse(off);
    expect(onStats.canary).toEqual(offStats.canary);
    // 300 six-field schemas: untransformed zod allocates hundreds of objects
    // and closures per schema; the wrapper allocates a handful. Requiring a
    // 4x reduction keeps the assertion far from both sides' noise.
    expect(onStats.objects).toBeLessThan(offStats.objects / 4);
    expect(onStats.functions).toBeLessThan(offStats.functions / 4);
  },
  120_000,
);

test.concurrent("construction-time throws stay at module load", async () => {
  const run = async (on: boolean) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(fixtureDir, "eager-throw-fixture.ts")],
      env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD: on ? "1" : undefined },
      cwd: fixtureDir,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const [on, off] = await Promise.all([run(true), run(false)]);
  expect(off.stderr).toContain("Cannot create literal schema with no valid values");
  expect(off.stdout).toBe("");
  expect(off.exitCode).not.toBe(0);
  expect(on.stderr).toContain("Cannot create literal schema with no valid values");
  expect(on.stdout).toBe("");
  expect(on.exitCode).not.toBe(0);
});

test.concurrent("transform applies in the runtime transpiler", async () => {
  // `bun build --no-bundle` prints the transpiled module, which must contain
  // the wrapper call and the serialized IR when the flag is on.
  const source = path.join(fixtureDir, "memory-fixture.ts");
  const run = async (on: boolean) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", source],
      env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD: on ? "1" : undefined },
      cwd: fixtureDir,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  };
  const on = await run(true);
  // The helper import gets a generated suffix at runtime: `__zod_<hash>`.
  expect(on).toMatch(/__zod[\w$]*\(\(\) =>/);
  expect(on).toContain('from "bun:wrap"');
  expect(on).toContain('"k":"obj"');
  const off = await run(false);
  expect(off).not.toMatch(/__zod[\w$]*\(\(\) =>/);
});
