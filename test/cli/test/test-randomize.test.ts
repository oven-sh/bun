import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// test:
// --randomize randomizes
// output produces a seed which produces the same result
// --seed produces the same result twice

const unsortedOrder = Array.from({ length: 100 }, (_, i) => i + 1);
async function runFixture(flags: string[]): Promise<{ order: number[]; seed: number | null }> {
  const proc = await Bun.spawn([bunExe(), "test", ...flags], {
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
  const fixture = import.meta.dir + "/test-randomize.fixture.ts";

  // with --randomize
  const { order: randomizedOrder, seed: randomizedSeed } = await runFixture([fixture, "--randomize"]);
  expect(randomizedSeed).toBeFinite();
  expect(randomizedOrder.toSorted(sortNumbers)).toEqual(unsortedOrder);
  expect(randomizedOrder).not.toEqual(unsortedOrder);

  // different randomized run is different
  const { order: differentRandomizedOrder, seed: differentRandomizedSeed } = await runFixture([fixture, "--randomize"]);
  expect(differentRandomizedOrder.toSorted(sortNumbers)).toEqual(unsortedOrder);
  expect(differentRandomizedOrder).not.toEqual(unsortedOrder);
  expect(differentRandomizedOrder).not.toEqual(randomizedOrder);
  expect(differentRandomizedSeed).not.toEqual(randomizedSeed);

  // with same seed as first run
  const { order: seededOrder, seed: seededSeed } = await runFixture([fixture, "--seed", "" + randomizedSeed]);
  expect(seededOrder).toEqual(randomizedOrder);
  expect(seededSeed).toEqual(randomizedSeed);

  // with both randomize and seed parameter
  const { order: randomizedAndSeededOrder, seed: randomizedAndSeededSeed } = await runFixture([
    fixture,
    "--randomize",
    "--seed",
    "" + randomizedSeed,
  ]);
  expect(randomizedAndSeededOrder).toEqual(randomizedOrder);
  expect(randomizedAndSeededSeed).toEqual(randomizedSeed);

  // without seed
  const { order: unseededOrder, seed: unseededSeed } = await runFixture([fixture]);
  expect(unseededOrder).toEqual(unsortedOrder);
  expect(unseededSeed).toBeNull();
});

test("randomizes order of files", async () => {
  const dir = tempDirWithFiles(
    "randomize-order-of-files",
    Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `test${i + 1}.test.ts`,
        `test("test ${i + 1}", () => { console.log(${i + 1}); });`,
      ]),
    ),
  );

  const { order: unrandomizedOrder, seed: unrandomizedSeed } = await runFixture([dir]);
  const { order: anotherUnrandomizedOrder, seed: anotherUnrandomizedSeed } = await runFixture([dir]);
  expect(unrandomizedSeed).toBeNull();
  expect(anotherUnrandomizedSeed).toBeNull();
  expect(anotherUnrandomizedOrder).toEqual(unrandomizedOrder);

  const { order: randomizedOrder, seed: randomizedSeed } = await runFixture([dir, "--randomize"]);
  expect(randomizedSeed).toBeFinite();
  expect(unrandomizedOrder).not.toEqual(randomizedOrder);

  const { order: anotherRandomizedOrder, seed: anotherRandomizedSeed } = await runFixture([dir, "--randomize"]);
  expect(anotherRandomizedOrder).not.toEqual(randomizedOrder);
  expect(anotherRandomizedSeed).not.toEqual(randomizedSeed);

  // test with --seed
  const { order: seededOrder, seed: seededSeed } = await runFixture([dir, "--seed", "" + randomizedSeed]);
  expect(seededOrder).toEqual(randomizedOrder);
  expect(seededSeed).toEqual(randomizedSeed);
});
