import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

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

test("a console group with no label does not break the line of dots", async () => {
  using dir = tempDir("dots-empty-group", {
    "empty-group.test.ts": `
      import { test } from "bun:test";
      test("before", () => {});
      test("group", () => {
        console.group();
        console.groupEnd();
      });
      test("between", () => {});
      test("groupCollapsed", () => {
        console.groupCollapsed();
        console.groupEnd();
      });
      test("after", () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--dots", "./empty-group.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  }).toEqual({
    stdout: "bun test <version> (<revision>)",
    stderr: ".....\n\n5 pass\n0 fail\nRan 5 tests across 1 file.",
    exitCode: 0,
  });
});

// The console call of a Worker tells the reporter that output follows, on its own thread. The two console
// calls of a pair are made at the same moment: the line of dots ends once.
test("console calls of two threads end the line of dots once", async () => {
  const pairs = 50;
  using dir = tempDir("dots-two-threads", {
    "two-threads.test.ts": `
      import { afterAll, beforeAll, test } from "bun:test";
      // [0]: the pair. [1]: the Worker is ready for that pair. [2]: print now. [3]: the Worker printed.
      const shared = new Int32Array(new SharedArrayBuffer(16));
      let worker: Worker;
      beforeAll(async () => {
        worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const ready = new Promise(resolve => (worker.onmessage = resolve));
        worker.postMessage(shared.buffer);
        await ready;
      });
      afterAll(() => worker.terminate());
      for (let pair = 1; pair <= ${pairs}; pair++) {
        test("quiet " + pair, () => {});
        test("both threads print " + pair, () => {
          Atomics.store(shared, 0, pair);
          Atomics.notify(shared, 0);
          while (Atomics.load(shared, 1) !== pair) Atomics.wait(shared, 1, pair - 1);
          Atomics.store(shared, 2, pair);
          console.log("main");
          while (Atomics.load(shared, 3) !== pair) Atomics.wait(shared, 3, pair - 1);
        });
      }
    `,
    "worker.ts": `
      self.onmessage = ({ data }) => {
        const shared = new Int32Array(data);
        postMessage("ready");
        for (let pair = 1; ; pair++) {
          Atomics.wait(shared, 0, pair - 1);
          Atomics.store(shared, 1, pair);
          Atomics.notify(shared, 1);
          // No wait here, so that this thread prints when the main thread does.
          while (Atomics.load(shared, 2) !== pair);
          console.error("worker");
          Atomics.store(shared, 3, pair);
          Atomics.notify(shared, 3);
        }
      };
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--dots", "./two-threads.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  }).toEqual({
    stdout: "bun test <version> (<revision>)\n" + "main\n".repeat(pairs).trimEnd(),
    stderr:
      ".\n\ntwo-threads.test.ts:\n" +
      "worker\n..\n".repeat(pairs - 1) +
      `worker\n.\n\n${2 * pairs} pass\n0 fail\nRan ${2 * pairs} tests across 1 file.`,
    exitCode: 0,
  });
});
