import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("--randomize flag randomizes test execution order", async () => {
  // Create a test file with multiple tests that output their names
  using dir = tempDir("test-randomize", {});
  const testFile = join(String(dir), "order.test.js");

  await Bun.write(
    testFile,
    `
    import { test } from "bun:test";

    test("test-01", () => {
      console.log("test-01");
    });

    test("test-02", () => {
      console.log("test-02");
    });

    test("test-03", () => {
      console.log("test-03");
    });

    test("test-04", () => {
      console.log("test-04");
    });

    test("test-05", () => {
      console.log("test-05");
    });

    test("test-06", () => {
      console.log("test-06");
    });

    test("test-07", () => {
      console.log("test-07");
    });

    test("test-08", () => {
      console.log("test-08");
    });
  `,
  );

  // Run without --randomize to get the default order
  await using defaultProc = Bun.spawn({
    cmd: [bunExe(), "test", testFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    cwd: String(dir),
  });

  const [defaultOut, defaultErr, defaultExit] = await Promise.all([
    defaultProc.stdout.text(),
    defaultProc.stderr.text(),
    defaultProc.exited,
  ]);

  expect(defaultExit).toBe(0);

  // Extract test execution order from output
  const defaultTests = defaultOut.match(/test-\d+/g) || [];
  expect(defaultTests.length).toBe(8);

  // Run multiple times WITH --randomize to find a different order
  let foundDifferentOrder = false;
  const maxAttempts = 20; // Increase attempts since randomization might occasionally match

  for (let i = 0; i < maxAttempts; i++) {
    await using randomProc = Bun.spawn({
      cmd: [bunExe(), "test", testFile, "--randomize"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [randomOut, randomErr, randomExit] = await Promise.all([
      randomProc.stdout.text(),
      randomProc.stderr.text(),
      randomProc.exited,
    ]);

    expect(randomExit).toBe(0);

    const randomTests = randomOut.match(/test-\d+/g) || [];
    expect(randomTests.length).toBe(8);

    // Check if all tests ran (just different order)
    const sortedRandom = [...randomTests].sort();
    const sortedDefault = [...defaultTests].sort();
    expect(sortedRandom).toEqual(sortedDefault);

    // Check if order is different
    const orderIsDifferent = randomTests.some((test, index) => test !== defaultTests[index]);
    if (orderIsDifferent) {
      foundDifferentOrder = true;
      break;
    }
  }

  // With 8 tests and 20 attempts, the probability of not finding a different order
  // by pure chance is (1/8!)^20 which is astronomically small
  expect(foundDifferentOrder).toBe(true);
}, 30000); // 30 second timeout for this test

test("--randomize flag works with describe blocks", async () => {
  using dir = tempDir("test-randomize-describe", {});
  const testFile = join(String(dir), "describe.test.js");

  await Bun.write(
    testFile,
    `
    import { test, describe } from "bun:test";

    describe("Suite-A", () => {
      test("A1", () => {
        console.log("A1");
      });

      test("A2", () => {
        console.log("A2");
      });

      test("A3", () => {
        console.log("A3");
      });
    });

    describe("Suite-B", () => {
      test("B1", () => {
        console.log("B1");
      });

      test("B2", () => {
        console.log("B2");
      });
    });

    describe("Suite-C", () => {
      test("C1", () => {
        console.log("C1");
      });

      test("C2", () => {
        console.log("C2");
      });
    });
  `,
  );

  // Run without --randomize
  await using defaultProc = Bun.spawn({
    cmd: [bunExe(), "test", testFile],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    cwd: String(dir),
  });

  const [defaultOut, defaultErr, defaultExit] = await Promise.all([
    defaultProc.stdout.text(),
    defaultProc.stderr.text(),
    defaultProc.exited,
  ]);

  expect(defaultExit).toBe(0);

  const defaultTests = defaultOut.match(/[ABC]\d/g) || [];
  expect(defaultTests.length).toBe(7);

  // Run with --randomize multiple times
  let foundDifferentOrder = false;

  for (let i = 0; i < 20; i++) {
    await using randomProc = Bun.spawn({
      cmd: [bunExe(), "test", testFile, "--randomize"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [randomOut, randomErr, randomExit] = await Promise.all([
      randomProc.stdout.text(),
      randomProc.stderr.text(),
      randomProc.exited,
    ]);

    expect(randomExit).toBe(0);

    const randomTests = randomOut.match(/[ABC]\d/g) || [];
    expect(randomTests.length).toBe(7);

    // Verify all tests ran
    expect([...randomTests].sort()).toEqual([...defaultTests].sort());

    // Check if order is different
    const orderIsDifferent = randomTests.some((test, index) => test !== defaultTests[index]);
    if (orderIsDifferent) {
      foundDifferentOrder = true;
      break;
    }
  }

  expect(foundDifferentOrder).toBe(true);
}, 30000);

test("without --randomize flag tests run in consistent order", async () => {
  using dir = tempDir("test-consistent", {});
  const testFile = join(String(dir), "consistent.test.js");

  await Bun.write(
    testFile,
    `
    import { test } from "bun:test";

    test("test-1", () => { console.log("1"); });
    test("test-2", () => { console.log("2"); });
    test("test-3", () => { console.log("3"); });
    test("test-4", () => { console.log("4"); });
    test("test-5", () => { console.log("5"); });
  `,
  );

  const runs = [];

  // Run 5 times without --randomize
  for (let i = 0; i < 5; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", testFile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const order = out.match(/\d/g) || [];
    runs.push(order.join(""));
  }

  // All runs should have the same order
  const firstRun = runs[0];
  for (const run of runs) {
    expect(run).toBe(firstRun);
  }
}, 20000);
