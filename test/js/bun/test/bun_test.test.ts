import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("describe/test", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/bun_test.fixture.ts"],
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
    "test/js/bun/test/bun_test.fixture.ts:

    # Unhandled error between tests
    -------------------------------
    45 |     });
    46 |   });
    47 |   describe("failed describe inner 2", () => {
    48 |     console.log("failed describe inner 2");
    49 |   });
    50 |   throw "failed describe: error";
                 ^
    error: failed describe: error
        at <anonymous> (file:NN:NN)
    -------------------------------

    76 | 
    77 | describe("actual tests", () => {
    78 |   test("more functions called after delayed done", done => {
    79 |     process.nextTick(() => {
    80 |       done();
    81 |       throw "uh oh";
                     ^
    error: uh oh
        at <anonymous> (file:NN:NN)
    (fail) actual tests > more functions called after delayed done
    (pass) actual tests > another test
    (pass) concurrent describe 1 > item 1
    (pass) concurrent describe 1 > item 2
    (pass) concurrent describe 1 > snapshot in concurrent group
    (pass) LINE 66
    (skip) LINE 67
    (fail) LINE 68
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (todo) LINE 69
    (pass) LINE 70
    (pass) LINE 70
    (pass) LINE 70
    (pass) LINE 71
    (skip) LINE 72
    (pass) LINE 74
    (todo) failing todo passes
    (pass) failing failing passes
    (fail) this test times out
      ^ this test timed out after 1ms.
    (fail) this test times out with done
      ^ this test timed out after 1ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
    (pass) addition 1 + 2 = 3
    (pass) addition 2 + 3 = 5
    (pass) addition 3 + 4 = 7
    AssertionError: expected 1 assertion, but test ended with 0 assertions
    (fail) expect.assertions
    (pass) expect.assertions not yet supported in concurrent tests
    (pass) expect.assertions not yet supported in concurrent tests
    (pass) expect.assertions works
    (fail) expect.assertions combined with timeout
      ^ this test timed out after 1ms.

    # Unhandled error between tests
    -------------------------------
    159 | 
    160 | // === timing edge case ===
    161 | test.failing("more functions called after delayed done", done => {
    162 |   process.nextTick(() => {
    163 |     done();
    164 |     expect(true).toBe(false);
                           ^
    error: expect(received).toBe(expected)

    Expected: false
    Received: true
        at <anonymous> (file:NN:NN)
    -------------------------------

    (fail) more functions called after delayed done
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (pass) another test
    (pass) misattributed error

    # Unhandled error between tests
    -------------------------------
    167 | test("another test", async () => {});
    168 | 
    169 | // === an error of an earlier test is not the failure that test.failing expects ===
    170 | test("misattributed error", () => {
    171 |   setTimeout(() => {
    172 |     expect(true).toBe(false);
                           ^
    error: expect(received).toBe(expected)

    Expected: false
    Received: true
        at <anonymous> (file:NN:NN)
    -------------------------------

    (fail) does not pass because of the misattributed error
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (pass) hooks > test1
    (pass) hooks > test2
    (pass) done parameter > instant done
    (pass) done parameter > delayed done
    (pass) done parameter > done combined with promise > done combined with promise, promise resolves first
    (pass) done parameter > done combined with promise > done combined with promise, done resolves first
    224 |   });
    225 |   describe("done combined with promise", () => {
    226 |     let completion = 0;
    227 |     beforeEach(() => (completion = 0));
    228 |     afterEach(() => {
    229 |       if (completion != 2) throw "completion is not 2";
                                           ^
    error: completion is not 2
        at <anonymous> (file:NN:NN)
    (fail) done parameter > done combined with promise > fails when completion is not incremented
    error: test error
    test error
    error: promise error
    promise error
    (fail) done parameter > done combined with promise error conditions > both error and done resolves first
    error: done error
    done error
    (fail) done parameter > done combined with promise error conditions > done errors only
    error: promise error
    promise error
    (fail) done parameter > done combined with promise error conditions > promise errors only
    (pass) done parameter > second call of done callback ignores triggers error

    # Unhandled error between tests
    -------------------------------
    264 |     done("uh oh!");
    265 |   });
    266 | });
    267 | 
    268 | test.failing("microtasks and rejections are drained after the test callback is executed", () => {
    269 |   Promise.reject(new Error("uh oh!"));
                               ^
    error: uh oh!
        at <anonymous> (file:NN:NN)
    -------------------------------

    (fail) microtasks and rejections are drained after the test callback is executed
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (pass) after inside test > the test 1
    (pass) after inside test > the test 2
    (pass) beforeEach inside test fails

    2 tests skipped:
    (skip) LINE 67
    (skip) LINE 72


    2 tests todo:
    (todo) LINE 69
    (todo) failing todo passes


    13 tests failed:
    (fail) actual tests > more functions called after delayed done
    (fail) LINE 68
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) this test times out
      ^ this test timed out after 1ms.
    (fail) this test times out with done
      ^ this test timed out after 1ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
    (fail) expect.assertions
    (fail) expect.assertions combined with timeout
      ^ this test timed out after 1ms.
    (fail) more functions called after delayed done
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) does not pass because of the misattributed error
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) done parameter > done combined with promise > fails when completion is not incremented
    (fail) done parameter > done combined with promise error conditions > both error and done resolves first
    (fail) done parameter > done combined with promise error conditions > done errors only
    (fail) done parameter > done combined with promise error conditions > promise errors only
    (fail) microtasks and rejections are drained after the test callback is executed
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works

     29 pass
     2 skip
     2 todo
     13 fail
     4 errors
     2 snapshots, 10 expect() calls
    Ran 46 tests across 1 file."
    ,
      "stdout": 
    "bun test <version> (<revision>)
    enter
    exit
    describe 1
    describe 2
    describe 3
    describe 4
    describe 5
    describe 6
    describe 7
    describe 8
    describe each 1
    describe each 1a
    describe each 1b
    describe each 1c
    describe each 1d
    describe each 2
    describe each 2a
    describe each 2b
    describe each 2c
    describe each 2d
    describe each 3
    describe each 3a
    describe each 3b
    describe each 3c
    describe each 3d
    describe each 4
    describe each 4a
    describe each 4b
    describe each 4c
    describe each 4d
    failed describe
    async describe 1
    async describe 2
    async describe 3
    async describe 4
    async describe 5
    async describe 6
    snapshot in concurrent group
    LINE 66
    LINE 68
    LINE 70 1
    LINE 70 2
    LINE 70 3
    LINE 71
    LINE 74
    adding: 1 + 2 = 3
    adding: 2 + 3 = 5
    adding: 3 + 4 = 7
    beforeAll1
    beforeAll2
    beforeEach1
    beforeEach2
    test1
    afterEach1
    afterEach2
    beforeEach1
    beforeEach2
    test2
    afterEach1
    afterEach2
    afterAll1
    afterAll2
    after-inside-test: the test 1
    after-inside-test: afterAll1
    after-inside-test: afterEach1
    after-inside-test: afterEach3
    after-inside-test: the test 2
    after-inside-test: afterAll2
    after-inside-test: afterEach2
    after-inside-test: afterEach3
    after-inside-test: afterAll3"
    ,
    }
  `);
});

test("cross-file safety", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/cross-file-safety/test1.ts",
      import.meta.dir + "/cross-file-safety/test2.ts",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(stderr).toInclude("Snapshot matchers cannot be used outside of a test");
  expect(exitCode).toBe(1);
});

test("multi-file", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/scheduling/multi-file/test1.fixture.ts",
      import.meta.dir + "/scheduling/multi-file/test2.fixture.ts",
      "--preload",
      import.meta.dir + "/scheduling/multi-file/preload.ts",
    ],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    preload: before first file
    preload: beforeEach
    test1
    preload: afterEach
    preload: beforeEach
    test2
    preload: afterEach
    preload: after last file"
  `);
});

test.concurrent("hooks may be registered during preload, test/describe may not", async () => {
  using dir = tempDir("bun-test-preload-scope", {
    "preload.ts": `
      import { test, describe, beforeAll } from "bun:test";
      beforeAll(() => console.log("preload beforeAll ran"));
      for (const [name, fn] of [
        ["test", () => test("in preload", () => {})],
        ["describe", () => describe("in preload", () => {})],
      ] as const) {
        try {
          fn();
          console.log(name + ": did not throw");
        } catch (e) {
          console.log(name + ": " + (e as Error).message);
        }
      }
    `,
    "a.test.ts": `
      import { test } from "bun:test";
      test("a", () => console.log("a ran"));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--preload", "./preload.ts", "./a.test.ts"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    test: Cannot use test during preload.
    describe: Cannot use describe during preload.
    preload beforeAll ran
    a ran"
  `);
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test.concurrent("test/describe and hooks throw outside of the test runner", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { test, describe, beforeAll } from "bun:test";
        for (const fn of [() => test("x", () => {}), () => describe("x", () => {}), () => beforeAll(() => {})]) {
          try {
            fn();
            console.log("did not throw");
          } catch (e) {
            console.log(e.message);
          }
        }
      `,
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toMatchInlineSnapshot(`
    "Cannot use test outside of the test runner. Run "bun test" to run tests.
    Cannot use describe outside of the test runner. Run "bun test" to run tests.
    Cannot use beforeAll() outside of the test runner. Run "bun test" to run tests.
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("--only flag with multiple files", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/only-flag-fixtures/file0.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file1.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file2.fixture.ts",
      "--only",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  // Should only run test 1.0 which has `.only()`
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    file1.0 (only)"
  `);
  expect(exitCode).toBe(0);
});

test("no --only flag with multiple files", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/only-flag-fixtures/file0.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file1.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file2.fixture.ts",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  // Should run tests from other files, but only test 1.0 for file1.test.ts
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    file0.0
    file0.1
    file1.0 (only)
    file2.0
    file2.1"
  `);
  expect(exitCode).toBe(0);
});

describe.concurrent("the callbacks of a test run with the event loop entered", () => {
  async function printedBy(files: Record<string, string>) {
    using dir = tempDir("bun-test-event-loop-entered", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", `./${Object.keys(files)[0]}`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const printed = stdout
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line));
    return { printed, stderr, exitCode };
  }

  test("a native call in a promise job of a test returns before the next promise job runs", async () => {
    const { printed, stderr, exitCode } = await printedBy({
      "native-call.test.ts": `
        import { afterAll, test } from "bun:test";
        import { once } from "node:events";
        import net from "node:net";

        const opened = Promise.withResolvers();
        const server = Bun.serve({
          port: 0,
          fetch: (request, server) => (server.upgrade(request, { data: {} }) ? undefined : new Response(null, { status: 400 })),
          websocket: {
            open: opened.resolve,
            message() {},
            close: socket => void socket.data.order.push("close handler"),
          },
        });
        const client = new WebSocket("ws://localhost:" + server.port);
        const serverSocket = await opened.promise;
        const tcpServer = net.createServer(socket => socket.on("error", () => {})).listen(0, "127.0.0.1");
        await once(tcpServer, "listening");
        const tcpSocket = net.connect(tcpServer.address().port, "127.0.0.1");
        await once(tcpSocket, "connect");
        afterAll(() => {
          server.stop(true);
          tcpServer.close();
        });

        async function cell(where, call, native) {
          const order = [];
          await 0;
          Promise.resolve().then(() => order.push("promise job"));
          native(order);
          order.push("returned");
          await 0;
          console.log(JSON.stringify({ where, call, order }));
        }
        // An HTMLRewriter handler runs in a promise job, and reader.cancel() settles a promise from native code.
        async function cancelsReader(where) {
          let controller;
          const input = new ReadableStream({ start: c => void (controller = c) });
          const order = [];
          const response = new HTMLRewriter()
            .on("p", {
              element() {
                order.push("handler start");
                reader.cancel();
                order.push("handler end");
              },
            })
            .transform(new Response(input));
          const reader = response.body.getReader();
          const closed = reader.closed.then(() => order.push("reader.closed"));
          controller.enqueue(new TextEncoder().encode("<p>x</p>"));
          controller.close();
          await closed;
          console.log(JSON.stringify({ where, call: "reader.cancel()", order }));
        }

        // The file has loaded, and no test before these waits for the event loop.
        const first = "the first tests of a file";
        test(first + ": ServerWebSocket.close() calls the close handler", () =>
          cell(first, "ServerWebSocket.close()", order => {
            serverSocket.data.order = order;
            serverSocket.close();
          }));
        test(first + ": net.Socket.destroy()", () => cell(first, "net.Socket.destroy()", () => tcpSocket.destroy()));
        test(first + ": reader.cancel()", () => cancelsReader(first));
        test("a test that waits for a real timer", () => new Promise(resolve => setTimeout(resolve, 1)));
        test("a later test: reader.cancel()", () => cancelsReader("a later test"));
      `,
    });
    const first = "the first tests of a file";
    expect({ printed, exitCode }, stderr).toEqual({
      printed: [
        { where: first, call: "ServerWebSocket.close()", order: ["close handler", "returned", "promise job"] },
        { where: first, call: "net.Socket.destroy()", order: ["returned", "promise job"] },
        { where: first, call: "reader.cancel()", order: ["handler start", "handler end", "reader.closed"] },
        { where: "a later test", call: "reader.cancel()", order: ["handler start", "handler end", "reader.closed"] },
      ],
      exitCode: 0,
    });
  });

  // The task that reports a timeout runs the next steps, up to the first one that waits for the event loop.
  // Their callbacks have one more entry below them.
  test("in the steps that follow a test that timed out", async () => {
    const { printed, stderr, exitCode } = await printedBy({
      "after-timeout.test.ts": `
        import { afterEach, describe, jest, test } from "bun:test";

        test("times out", () => new Promise(() => {}), 1);

        test("a fake timer control runs no promise job before it returns", async () => {
          await 0;
          jest.useFakeTimers();
          const order = [];
          setTimeout(async () => {
            order.push("timer 1");
            await 0;
            order.push("after the await of timer 1");
          }, 1);
          setTimeout(() => order.push("timer 2"), 2);
          jest.advanceTimersByTime(2);
          order.push("returned");
          jest.useRealTimers();
          console.log(JSON.stringify({ order }));
        });

        describe("afterEach runs before an immediate that is pending", () => {
          let where = "";
          let fired = Promise.withResolvers();
          const seen = [];
          const callback = () => {
            seen.push(where);
            fired.resolve();
          };
          afterEach(async () => {
            where = "afterEach";
            await fired.promise;
            fired = Promise.withResolvers();
          });
          test("when the test only waited for a promise job", async () => {
            setImmediate(callback);
            await 0;
            where = "after the test";
          });
          test("when an earlier immediate resumed the test", async () => {
            const resumed = new Promise(resolve => setImmediate(resolve));
            setImmediate(callback);
            await resumed;
            where = "after the test";
          });
          test("prints", () => {
            fired.resolve();
            console.log(JSON.stringify({ seen }));
          });
        });
      `,
    });
    expect({ printed, exitCode }, stderr).toEqual({
      printed: [{ order: ["timer 1", "timer 2", "returned"] }, { seen: ["afterEach", "afterEach"] }],
      exitCode: 1,
    });
    expect(stderr).toContain("(fail) times out");
    expect(stderr).toContain(" 4 pass");
  });
});
