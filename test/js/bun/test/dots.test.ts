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

test("a console call whose message is not printed does not break the line of dots", async () => {
  using dir = tempDir("dots-no-message", {
    "no-message.test.ts": `
      import { expect, test } from "bun:test";
      test("before", () => {});
      test("the message throws", () => {
        const value = {
          [Symbol.for("nodejs.util.inspect.custom")]() {
            throw new Error("no message");
          },
        };
        expect(() => console.log("not printed", value)).toThrow("no message");
        expect(() => console.error("not printed", value)).toThrow("no message");
      });
      test("after", () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--dots", "./no-message.test.ts"],
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
    stderr: "...\n\n3 pass\n0 fail\n2 expect() calls\nRan 3 tests across 1 file.",
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

// A message of the Worker over 64 KiB is on stderr in part, and its hook waits. The main thread then prints to
// stderr too. The line feed that ends the line of dots is written after the message of the Worker, as the output
// of the main thread is. In a "nested" round the hook of the Worker prints, and the line feed is before "inner".
test("a console call does not end the line of dots inside a message of another thread on the same stream", async () => {
  // The state of the message of the main thread when its first byte is written.
  const kinds = ["stage", "direct", "heap", "streaming", "nested"];
  const rounds = 2 * kinds.length;
  using dir = tempDir("dots-inside-message", {
    "inside-message.test.ts": `
      import { afterAll, beforeAll, test } from "bun:test";
      const kinds = ${JSON.stringify(kinds)};
      const text = (length: number) => ({
        [Symbol.for("nodejs.util.inspect.custom")]: () => Buffer.alloc(length, "m").toString(),
      });
      const print = {
        stage: () => console.error("main"),
        direct: () => console.error("main", Buffer.alloc(5000, "m").toString()),
        heap: () => console.error("main", text(5000)),
        streaming: () => console.error("main", text(70_000)),
        nested: () => {},
      };
      // [0]: the round. [1]: the message of that round is on the stream in part.
      // [2]: the Worker can complete the message. [3]: the message is complete.
      const shared = new Int32Array(new SharedArrayBuffer(16));
      let worker: Worker;
      beforeAll(async () => {
        worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const ready = new Promise(resolve => (worker.onmessage = resolve));
        worker.postMessage(shared.buffer);
        await ready;
      });
      afterAll(() => worker.terminate());
      for (let round = 1; round <= ${rounds}; round++) {
        // The dot of this test is printed while the Worker is inside its message.
        test("the Worker starts a message " + round, () => {
          Atomics.store(shared, 0, round);
          Atomics.notify(shared, 0);
          while (Atomics.load(shared, 1) !== round) Atomics.wait(shared, 1, round - 1);
        });
        test("the main thread prints " + round, () => {
          Atomics.store(shared, 2, round);
          Atomics.notify(shared, 2);
          print[kinds[(round - 1) % kinds.length]]();
          while (Atomics.load(shared, 3) !== round) Atomics.wait(shared, 3, round - 1);
        });
      }
    `,
    "worker.ts": `
      const kinds = ${JSON.stringify(kinds)};
      self.onmessage = ({ data }) => {
        const shared = new Int32Array(data);
        postMessage("ready");
        const start = "START" + Buffer.alloc(70_000, "a").toString();
        const end = Buffer.alloc(300_000, "b").toString() + "END";
        for (let round = 1; ; round++) {
          Atomics.wait(shared, 0, round - 1);
          const hook = {
            [Symbol.for("nodejs.util.inspect.custom")]() {
              Atomics.store(shared, 1, round);
              Atomics.notify(shared, 1);
              Atomics.wait(shared, 2, round - 1);
              if (kinds[(round - 1) % kinds.length] === "nested") console.error("inner");
              return "hook";
            },
          };
          console.error(start, hook, end);
          Atomics.store(shared, 3, round);
          Atomics.notify(shared, 3);
        }
      };
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--dots", "./inside-message.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The dot of the first test of a round is in the message of the Worker, after the bytes that were written.
  const short = (line: string) =>
    line
      .replace(/^STARTa+\.a*/, "START<a>.")
      .replace(/a{100,}/g, "<a>")
      .replace(/b{100,}/g, "<b>")
      .replace(/m{100,}/g, "<m>");
  const lines = ["", "inside-message.test.ts:"];
  for (let round = 0; round < rounds; round++) {
    const kind = kinds[round % kinds.length];
    if (kind === "nested") lines.push("START<a>. ", "inner", "hook <b>END", ".");
    else lines.push("START<a>. hook <b>END", "", kind === "stage" ? "main" : "main <m>", ".");
  }
  expect({
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    lines: stderr.split("\n").slice(0, lines.length).map(short),
    exitCode,
  }).toEqual({
    stdout: "bun test <version> (<revision>)",
    lines,
    exitCode: 0,
  });
});
