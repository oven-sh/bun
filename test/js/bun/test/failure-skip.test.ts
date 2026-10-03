import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function testFailureSkip(failurePoints: string[]): Promise<string[]> {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/failure-skip.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, FAILURE_POINTS: failurePoints.join(",") },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  const messages = stdout.matchAll(/%%<([^>]+)>%%/g);

  return [...messages].map(([_, msg]) => msg).join(",");
}

describe("failure-skip", async () => {
  test("none", async () => {
    expect(await testFailureSkip([])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("beforeall1", async () => {
    // expect(await testFailureSkip(["beforeall1"])).toMatchInlineSnapshot(`"beforeall1"`);
    expect(await testFailureSkip(["beforeall1"])).toMatchInlineSnapshot(`"beforeall1,afterall1,afterall2"`); // breaking change
  });
  test("beforeall2", async () => {
    // expect(await testFailureSkip(["beforeall2"])).toMatchInlineSnapshot(`"beforeall1,beforeall2"`);
    expect(await testFailureSkip(["beforeall2"])).toMatchInlineSnapshot(`"beforeall1,beforeall2,afterall1,afterall2"`); // breaking change
  });
  test("beforeeach1", async () => {
    expect(await testFailureSkip(["beforeeach1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,aftereach1,aftereach2,beforeeach1,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("beforeeach2", async () => {
    expect(await testFailureSkip(["beforeeach2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,aftereach1,aftereach2,beforeeach1,beforeeach2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("test1", async () => {
    expect(await testFailureSkip(["test1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("test2", async () => {
    expect(await testFailureSkip(["test2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("aftereach1", async () => {
    expect(await testFailureSkip(["aftereach1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,beforeeach1,beforeeach2,test2,aftereach1,afterall1,afterall2"`,
    );
  });
  test("aftereach2", async () => {
    expect(await testFailureSkip(["aftereach2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
  test("afterall1", async () => {
    expect(await testFailureSkip(["afterall1"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1"`,
    );
  });
  test("afterall2", async () => {
    expect(await testFailureSkip(["afterall2"])).toMatchInlineSnapshot(
      `"beforeall1,beforeall2,beforeeach1,beforeeach2,test1,aftereach1,aftereach2,beforeeach1,beforeeach2,test2,aftereach1,aftereach2,afterall1,afterall2"`,
    );
  });
});

// Native code can return with a JS exception still pending on the VM. The runner must not read
// that as "the next callback returned": every later hook, test, describe body and file still
// runs and gets its own verdict.
describe("an exception left pending by native code", () => {
  const prelude = `
    import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
    const log = marker => console.log("%%<" + marker + ">%%");
  `;

  // Left by the runner's own print: to report a failure the error printer reads `message`, this
  // getter throws, and the printer returns with that exception pending.
  const printLeavesException =
    prelude +
    `
    class ErrorWithThrowingMessage extends Error {
      get message() {
        throw new TypeError("getter throws");
      }
    }
  `;

  // Left outside the runner: a fetch handler returns a value that is not a Response, the server
  // prints it, its inspect hook throws, and the server's response path returns with that
  // exception pending. `done()` is called first, so the runner's next step is already queued.
  // The client is a raw socket: the completion of a `fetch()` can meet the exception before the
  // runner does.
  const serverLeavesException =
    prelude +
    `
    const notAResponse = {
      [Symbol.for("nodejs.util.inspect.custom")]() {
        throw new TypeError("inspect throws");
      },
    };
    const servers = [];
    function leaveExceptionPending(done) {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          done();
          return notAResponse;
        },
      });
      servers.push(server);
      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n");
          },
          data() {},
          close() {},
          error() {},
        },
      });
    }
  `;

  const nextFile = `
    import { expect, test } from "bun:test";
    const log = marker => console.log("%%<" + marker + ">%%");
    log("next-file-loaded");
    test("in the next file", () => {
      log("next-file");
      expect(1).toBe(2);
    });
  `;

  async function run(files: Record<string, string>, flags: string[] = []) {
    using dir = tempDir("failure-skip-pending-exception", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...flags, ...Object.keys(files).map(name => "./" + name)],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const stderr = rawStderr.replaceAll("\r\n", "\n");
    const junit = Bun.file(join(String(dir), "junit.xml"));
    return {
      markers: [...stdout.matchAll(/%%<([^>]+)>%%/g)].map(([, marker]) => marker).join(","),
      verdicts: [...stderr.matchAll(/\((pass|fail)\) (.+?)(?: \[[^\]]+\])?$/gm)].map(
        ([, verdict, name]) => `${verdict} ${name}`,
      ),
      summary: [...stderr.matchAll(/^ *(\d+ (?:pass|fail|errors?))$/gm)].map(([, count]) => count).join(", "),
      exitCode,
      junit: (await junit.exists()) ? await junit.text() : undefined,
    };
  }

  // The runner reports an exception that was left outside of it as an unhandled error: one more
  // `error` in the summary. A fix in the server removes the exception and that count with it, so
  // these cases do not assert the count.
  async function runWithoutErrorCount(files: Record<string, string>, flags: string[] = []) {
    const result = await run(files, flags);
    return { ...result, summary: result.summary.replace(/, \d+ errors?$/, "") };
  }

  test.concurrent("print: later hooks and tests run, and each failure is in the JUnit report", async () => {
    const { junit, ...result } = await run(
      {
        "hooks.test.js":
          printLeavesException +
          `
          beforeEach(() => log("beforeeach"));
          afterEach(() => log("aftereach"));
          afterAll(() => log("afterall"));
          test("throws", () => {
            log("throws");
            throw new ErrorWithThrowingMessage();
          });
          test("fails", () => {
            log("fails");
            expect(1).toBe(2);
          });
          test("rejects", async () => {
            log("rejects");
            await Promise.reject(new Error("rejected"));
          });
        `,
      },
      ["--reporter=junit", "--reporter-outfile=junit.xml"],
    );
    expect({
      ...result,
      testcases: junit?.match(/<testcase /g)?.length,
      failures: junit?.match(/<failure /g)?.length,
    }).toEqual({
      markers: "beforeeach,throws,aftereach,beforeeach,fails,aftereach,beforeeach,rejects,aftereach,afterall",
      verdicts: ["fail throws", "fail fails", "fail rejects"],
      summary: "0 pass, 3 fail",
      exitCode: 1,
      testcases: 3,
      failures: 3,
    });
  });

  test.concurrent("print: an error that throws each time it is printed", async () => {
    expect(
      await run({
        "again.test.js":
          prelude +
          `
          class ErrorWithSelfSimilarMessage extends Error {
            get message() {
              throw new ErrorWithSelfSimilarMessage();
            }
          }
          afterEach(() => log("aftereach"));
          afterAll(() => log("afterall"));
          test("throws", () => {
            log("throws");
            throw new ErrorWithSelfSimilarMessage();
          });
          test("fails", () => {
            log("fails");
            expect(1).toBe(2);
          });
        `,
      }),
    ).toEqual({
      markers: "throws,aftereach,fails,aftereach,afterall",
      verdicts: ["fail throws", "fail fails"],
      summary: "0 pass, 2 fail",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent("print: a retried test runs again, and the run is not green", async () => {
    expect(
      await run({
        "retry.test.js":
          printLeavesException +
          `
          let attempt = 0;
          test(
            "flaky",
            () => {
              log("flaky-" + ++attempt);
              if (attempt === 1) throw new ErrorWithThrowingMessage();
            },
            { retry: 2 },
          );
          test("fails", () => {
            log("fails");
            expect(1).toBe(2);
          });
        `,
      }),
    ).toEqual({
      markers: "flaky-1,flaky-2,fails",
      verdicts: ["pass flaky (attempt 2)", "fail fails"],
      summary: "1 pass, 1 fail",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent("print: later describe bodies run, and their tests are collected", async () => {
    expect(
      await run({
        "describe.test.js":
          printLeavesException +
          `
          describe("a", () => {
            log("describe-a");
            throw new ErrorWithThrowingMessage();
          });
          describe("b", () => {
            log("describe-b");
            describe("c", () => {
              log("describe-c");
              test("in c", () => {
                log("in-c");
                expect(1).toBe(2);
              });
            });
            test("in b", () => {
              log("in-b");
              expect(1).toBe(2);
            });
          });
          test("top level", () => {
            log("top-level");
            expect(1).toBe(2);
          });
        `,
      }),
    ).toEqual({
      markers: "describe-a,describe-b,describe-c,in-c,in-b,top-level",
      verdicts: ["fail b > c > in c", "fail b > in b", "fail top level"],
      // the error is the throw of describe "a"
      summary: "0 pass, 3 fail, 1 error",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent("print: a throw from a timer does not skip what follows", async () => {
    expect(
      await run({
        "timer.test.js":
          printLeavesException +
          `
          afterEach(() => log("aftereach"));
          test("a timer throws", () => {
            log("timer");
            return new Promise(() => {
              setTimeout(() => {
                throw new ErrorWithThrowingMessage();
              }, 0);
            });
          });
          test("fails", () => {
            log("fails");
            expect(1).toBe(2);
          });
        `,
      }),
    ).toEqual({
      markers: "timer,aftereach,fails,aftereach",
      verdicts: ["fail a timer throws", "fail fails"],
      summary: "0 pass, 2 fail",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent("print: a concurrent test that is in flight resumes", async () => {
    expect(
      await run({
        "in-flight.test.js":
          printLeavesException +
          `
          test.concurrent("in flight", async () => {
            log("in-flight-started");
            await new Promise(resolve => setImmediate(resolve));
            log("in-flight-resumed");
          });
          test.concurrent("throws", () => {
            log("throws");
            throw new ErrorWithThrowingMessage();
          });
          test("after", () => {
            log("after");
          });
        `,
      }),
    ).toEqual({
      markers: "in-flight-started,throws,in-flight-resumed,after",
      verdicts: ["fail throws", "pass in flight", "pass after"],
      summary: "2 pass, 1 fail",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent.each([[[]], [["--isolate"]]])("print: the next file runs %j", async flags => {
    expect(
      await run(
        {
          "a.test.js":
            printLeavesException +
            `
            test("last callback of the file throws", () => {
              log("throws");
              throw new ErrorWithThrowingMessage();
            });
          `,
          "b.test.js": nextFile,
        },
        flags,
      ),
    ).toEqual({
      markers: "throws,next-file-loaded,next-file",
      verdicts: ["fail last callback of the file throws", "fail in the next file"],
      summary: "0 pass, 2 fail",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent("server: the next callback runs, with its done callback, also for test.failing", async () => {
    expect(
      await runWithoutErrorCount({
        "server.test.js":
          serverLeavesException +
          `
          afterAll(() => {
            for (const server of servers) server.stop(true);
          });
          test("leaves an exception pending 1", done => {
            log("leak-1");
            leaveExceptionPending(done);
          });
          test("fails", () => {
            log("fails");
            expect(1).toBe(2);
          });
          test("leaves an exception pending 2", done => {
            log("leak-2");
            leaveExceptionPending(done);
          });
          test("done-style", done => {
            log("done:" + typeof done);
            done();
          });
          test("leaves an exception pending 3", done => {
            log("leak-3");
            leaveExceptionPending(done);
          });
          test.failing("failing whose body throws", () => {
            log("failing");
            throw new Error("expected");
          });
        `,
      }),
    ).toEqual({
      markers: "leak-1,fails,leak-2,done:function,leak-3,failing",
      verdicts: [
        "pass leaves an exception pending 1",
        "fail fails",
        "pass leaves an exception pending 2",
        "pass done-style",
        "pass leaves an exception pending 3",
        "pass failing whose body throws",
      ],
      summary: "5 pass, 1 fail",
      exitCode: 1,
      junit: undefined,
    });
  });

  test.concurrent.each([[[]], [["--isolate"]]])("server: the next file runs %j", async flags => {
    expect(
      await runWithoutErrorCount(
        {
          "a.test.js":
            serverLeavesException +
            `
            test("last callback of the file leaves an exception pending", done => {
              log("leak");
              leaveExceptionPending(done);
            });
          `,
          "b.test.js": nextFile,
        },
        flags,
      ),
    ).toEqual({
      markers: "leak,next-file-loaded,next-file",
      verdicts: ["pass last callback of the file leaves an exception pending", "fail in the next file"],
      summary: "1 pass, 1 fail",
      exitCode: 1,
      junit: undefined,
    });
  });
});
