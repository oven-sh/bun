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
test.concurrent("--randomize and --seed work", async () => {
  const fixture = import.meta.dir + "/test-randomize.fixture.ts";

  // with --randomize (and the no-flag run, which is independent)
  const [{ order: randomizedOrder, seed: randomizedSeed }, { order: unseededOrder, seed: unseededSeed }] =
    await Promise.all([runFixture([fixture, "--randomize"]), runFixture([fixture])]);
  expect(randomizedSeed).toBeFinite();
  expect(randomizedOrder.toSorted(sortNumbers)).toEqual(unsortedOrder);
  expect(randomizedOrder).not.toEqual(unsortedOrder);

  // different randomized run is different; runs that depend on the first seed can run alongside it
  const [
    { order: differentRandomizedOrder, seed: differentRandomizedSeed },
    { order: seededOrder, seed: seededSeed },
    { order: randomizedAndSeededOrder, seed: randomizedAndSeededSeed },
  ] = await Promise.all([
    runFixture([fixture, "--randomize"]),
    runFixture([fixture, "--seed", "" + randomizedSeed]),
    runFixture([fixture, "--randomize", "--seed", "" + randomizedSeed]),
  ]);
  expect(differentRandomizedOrder.toSorted(sortNumbers)).toEqual(unsortedOrder);
  expect(differentRandomizedOrder).not.toEqual(unsortedOrder);
  expect(differentRandomizedOrder).not.toEqual(randomizedOrder);
  expect(differentRandomizedSeed).not.toEqual(randomizedSeed);

  // with same seed as first run
  expect(seededOrder).toEqual(randomizedOrder);
  expect(seededSeed).toEqual(randomizedSeed);

  // with both randomize and seed parameter
  expect(randomizedAndSeededOrder).toEqual(randomizedOrder);
  expect(randomizedAndSeededSeed).toEqual(randomizedSeed);

  // without seed
  expect(unseededOrder).toEqual(unsortedOrder);
  expect(unseededSeed).toBeNull();
});

test.concurrent("randomizes order of files", async () => {
  const dir = tempDirWithFiles(
    "randomize-order-of-files",
    Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `test${i + 1}.test.ts`,
        `test("test ${i + 1}", () => { console.log(${i + 1}); });`,
      ]),
    ),
  );

  const [
    { order: unrandomizedOrder, seed: unrandomizedSeed },
    { order: anotherUnrandomizedOrder, seed: anotherUnrandomizedSeed },
    { order: randomizedOrder, seed: randomizedSeed },
  ] = await Promise.all([runFixture([dir]), runFixture([dir]), runFixture([dir, "--randomize"])]);
  expect(unrandomizedSeed).toBeNull();
  expect(anotherUnrandomizedSeed).toBeNull();
  expect(anotherUnrandomizedOrder).toEqual(unrandomizedOrder);

  expect(randomizedSeed).toBeFinite();
  expect(unrandomizedOrder).not.toEqual(randomizedOrder);

  const [{ order: anotherRandomizedOrder, seed: anotherRandomizedSeed }, { order: seededOrder, seed: seededSeed }] =
    await Promise.all([runFixture([dir, "--randomize"]), runFixture([dir, "--seed", "" + randomizedSeed])]);
  expect(anotherRandomizedOrder).not.toEqual(randomizedOrder);
  expect(anotherRandomizedSeed).not.toEqual(randomizedSeed);

  // test with --seed
  expect(seededOrder).toEqual(randomizedOrder);
  expect(seededSeed).toEqual(randomizedSeed);
});
