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
    Hello, world!
    ...........
    Hello, world!
    .

    test/js/bun/test/printing/dots/dots2.fixture.ts:
    Hello, world!
    ...........
    (fail) failing test
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    ....................

    test/js/bun/test/printing/dots/dots3.fixture.ts:
    3 | // unhandled failure. it should print the filename
    4 | test("failure", async () => {
    5 |   const { resolve, reject, promise } = Promise.withResolvers();
    6 |   setTimeout(() => {
    7 |     resolve();
    8 |     throw new Error("unhandled error");
                                             ^
    error: unhandled error
        at <anonymous> (file:NN:NN)
    (fail) failure


    43 pass
    10 skip
    2 fail
    Ran 55 tests across 3 files."
    ,
    }
  `);
});

// console.timeEnd, console.timeLog and console.assert(false) print on stderr like console.warn. The dots line
// ends and the file name shows before the first of them, as it does for console.warn in "dots 2".
test("dots 3", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/printing/dots/dots4.fixture.ts", "--dots"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stderr: normalizeBunSnapshot(stderr.replace(/\[[\d.]+m?s\] timer/g, "<elapsed> timer")),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "stderr": 
    ".....

    test/js/bun/test/printing/dots/dots4.fixture.ts:
    <elapsed> timer
    ......
    Assertion failed
    ......
    <elapsed> timer value
    .

    18 pass
    0 fail
    Ran 18 tests across 1 file."
    ,
    }
  `);
});
