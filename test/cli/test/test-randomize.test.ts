import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDirWithFiles } from "harness";
import { realpathSync } from "node:fs";
import { join } from "node:path";

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

// https://github.com/oven-sh/bun/issues/30507
// Regression: `TestRunner.getOrPutFile` used to key its index hashmap on
// `@truncate(bun.hash(file_path), u32)`. Two distinct paths whose wyhash
// lower-32-bits collide got the same file_id, the second file's Source was
// dropped, and both ended up reading the first file's path.text when
// deriving the per-file --randomize PRNG seed — so both files ran their
// tests in the same order. The fix switches the map to a string-keyed map.
//
// Not `test.concurrent`: `Bun.hash` is ~170x slower in debug builds, so
// the birthday-paradox collision search takes ~5–10 s (vs ~50 ms release)
// and would starve the sibling concurrent tests past their default 5s
// timeout. A generous per-test timeout covers the slow debug path.
test("--randomize: files whose u32-truncated path hashes collide get distinct per-file orders", async () => {
  // Find two filenames under an unpredictable tempDir prefix whose full
  // wyhash differs but whose lower 32 bits match. Birthday collision on
  // u32 is ~77k filenames at 50% probability; at the 400k cap the miss
  // probability is exp(-400000^2 / 2^33) ~= 8e-9, so the search is
  // effectively guaranteed to succeed. The typical hit still lands around
  // 77k, so the cap only costs time in the astronomically rare tail.
  const tmpRoot = tempDirWithFiles("randomize-hash-collision", {});
  // macOS: /tmp is a symlink to /private/tmp; the test runner resolves
  // the real path, so the collision has to be found on that form.
  const realRoot = isMacOS ? realpathSync(tmpRoot) : tmpRoot;

  let aIdx = -1;
  let bIdx = -1;
  const seen = new Map<number, number>();
  const mask = 0xffffffffn;
  for (let i = 0; i < 400_000; i++) {
    const h = Number(Bun.hash(join(realRoot, `f${i}.test.ts`)) & mask);
    if (seen.has(h)) {
      aIdx = seen.get(h)!;
      bIdx = i;
      break;
    }
    seen.set(h, i);
  }
  if (aIdx < 0) throw new Error("no u32 hash collision found in 400k filenames");

  // 20 items: two independent Fisher–Yates shuffles collide by chance
  // with probability 1/20! (~4e-19), so `orderA != orderB` is effectively
  // a deterministic assertion of "distinct PRNG seeds were used".
  const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
  // Same body in both files so any difference in observed order comes
  // from the per-file PRNG, not the tests themselves. Stdout prefixes
  // let us attribute each "RUN" line to its file.
  const body = (tag: string) => `
      import { test, expect } from "bun:test";
      test.each(${JSON.stringify(words)})(
        "order: %s",
        (word) => { console.log("RUN ${tag} " + word); expect(typeof word).toBe("string"); },
      );
    `;
  await Bun.write(join(tmpRoot, `f${aIdx}.test.ts`), body("A"));
  await Bun.write(join(tmpRoot, `f${bIdx}.test.ts`), body("B"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--randomize", "--seed=42"],
    cwd: tmpRoot,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const orderA = stdout
    .split("\n")
    .filter(l => l.startsWith("RUN A "))
    .map(l => l.slice(6));
  const orderB = stdout
    .split("\n")
    .filter(l => l.startsWith("RUN B "))
    .map(l => l.slice(6));
  const sorted = [...words].sort();
  // Both files must have produced a full run. Under the old truncated-
  // hash key the second file's Source was dropped entirely; loading it
  // still happened via the module system, so its tests do run, but the
  // assertion below is the one that actually catches the regression.
  expect([...orderA].sort()).toEqual(sorted);
  expect([...orderB].sort()).toEqual(sorted);
  // The actual regression: colliding files must get distinct PRNG seeds,
  // so their shuffled orders must differ. With the old truncated-hash
  // key both arrays are identical.
  expect(orderA).not.toEqual(orderB);
  // Surface subprocess stderr if the run exited non-zero before asserting
  // exit code — otherwise a CI failure is just "expected 0, got N".
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 60_000);

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
