import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("dots 1", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/dots.fixture.ts", "--dots", "-t", "filterin"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": 
    "....................

    test/js/bun/test/dots.fixture.ts:
    (fail) failing filterin
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) failing filterin
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) failing filterin
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    ..........

    10 pass
    10 skip
    10 todo
    3 fail
    Ran 33 tests across 1 file."
    ,
      "stdout": "bun test <version> (<revision>)",
    }
  `);
});

test("dots 2", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/printing/dots/dots1.fixture.ts",
      import.meta.dir + "/printing/dots/dots2.fixture.ts",
      import.meta.dir + "/printing/dots/dots3.fixture.ts",
      "--dots",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stderr: normalizeBunSnapshot(stderr),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": 
    "..........

    test/js/bun/test/printing/dots/dots1.fixture.ts:
    stderr | test/js/bun/test/printing/dots/dots1.fixture.ts > console.log
    Hello, world!
    ...........
    stderr | test/js/bun/test/printing/dots/dots1.fixture.ts > console.log again
    Hello, world!
    .

    test/js/bun/test/printing/dots/dots2.fixture.ts:
    stderr | test/js/bun/test/printing/dots/dots2.fixture.ts > console.log first. it should not add a newline but should show the filename
    Hello, world!
    ...........
    (fail) failing test
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    ....................

    test/js/bun/test/printing/dots/dots3.fixture.ts:
    (fail) failure

    2 tests failed:

    (fail) test/js/bun/test/printing/dots/dots3.fixture.ts:8 > failure
    3 | // unhandled failure. it should print the filename
    4 | test("failure", async () => {
    5 |   const { resolve, reject, promise } = Promise.withResolvers();
    6 |   setTimeout(() => {
    7 |     resolve();
    8 |     throw new Error("unhandled error");
                                             ^
    error: unhandled error
        at <anonymous> (file:NN:NN)


    43 pass
    10 skip
    2 fail
    Ran 55 tests across 3 files."
    ,
    }
  `);
});
