import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// test:
// --randomize randomizes
// output produces a seed which produces the same result
// --seed produces the same result twice

const unsortedOrder = Array.from({ length: 100 }, (_, i) => i + 1);
async function runFixture(flags: string[]): Promise<{ order: number[]; seed: number | null }> {
  const proc = await Bun.spawn([bunExe(), "test", import.meta.dir + "/test-randomize.fixture.ts", ...flags], {
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitCode = await proc.exited;
  const stdout = await proc.stdout.text();
  const stderr = await proc.stderr.text();
  expect(exitCode).toBe(0);
  const stdoutOrder = stdout
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !isNaN(+l))
    .map(l => +l);
  const seed = stderr.includes("--seed") ? +(stderr.match(/--seed=(-?\d+)/)?.[1] + "") : null;
  return { order: stdoutOrder, seed: seed };
}

const sortNumbers = (a: number, b: number) => a - b;
test("--randomize and --seed work", async () => {
  // with --randomize
  const { order: randomizedOrder, seed: randomizedSeed } = await runFixture(["--randomize"]);
  expect(randomizedSeed).toBeFinite();
  expect(randomizedOrder.toSorted(sortNumbers)).toEqual(unsortedOrder);
  expect(randomizedOrder).not.toEqual(unsortedOrder);

  // different randomized run is different
  const { order: differentRandomizedOrder, seed: differentRandomizedSeed } = await runFixture(["--randomize"]);
  expect(differentRandomizedOrder.toSorted(sortNumbers)).toEqual(unsortedOrder);
  expect(differentRandomizedOrder).not.toEqual(unsortedOrder);
  expect(differentRandomizedOrder).not.toEqual(randomizedOrder);
  expect(differentRandomizedSeed).not.toEqual(randomizedSeed);

  // with same seed as first run
  const { order: seededOrder, seed: seededSeed } = await runFixture(["--seed", "" + randomizedSeed]);
  expect(seededOrder).toEqual(randomizedOrder);
  expect(seededSeed).toEqual(randomizedSeed);

  // with both randomize and seed parameter
  const { order: randomizedAndSeededOrder, seed: randomizedAndSeededSeed } = await runFixture([
    "--randomize",
    "--seed",
    "" + randomizedSeed,
  ]);
  expect(randomizedAndSeededOrder).toEqual(randomizedOrder);
  expect(randomizedAndSeededSeed).toEqual(randomizedSeed);

  // without seed
  const { order: unseededOrder, seed: unseededSeed } = await runFixture([]);
  expect(unseededOrder).toEqual(unsortedOrder);
  expect(unseededSeed).toBeNull();
});
