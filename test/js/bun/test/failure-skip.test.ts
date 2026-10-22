import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function testFailureSkip(failurePoints: string[]): Promise<string> {
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

describe("an error that throws while the runner prints it", () => {
  const prelude = `
    import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
    const log = marker => console.log("%%<" + marker + ">%%");
    class ErrorWithThrowingMessage extends Error {
      get message() {
        throw new TypeError("getter throws");
      }
    }
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
    return {
      markers: [...stdout.matchAll(/%%<([^>]+)>%%/g)].map(([, marker]) => marker).join(","),
      verdicts: [...stderr.matchAll(/\((pass|fail)\) (.+?)(?: \[[^\]]+\])?$/gm)].map(
        ([, verdict, name]) => `${verdict} ${name}`,
      ),
      summary: [...stderr.matchAll(/^ *(\d+ (?:pass|fail|errors?))$/gm)].map(([, count]) => count).join(", "),
      exitCode,
    };
  }

  test.concurrent("later hooks and tests still run", async () => {
    expect(
      await run({
        "hooks.test.js":
          prelude +
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
        `,
      }),
    ).toEqual({
      markers: "beforeeach,throws,aftereach,beforeeach,fails,aftereach,afterall",
      verdicts: ["fail throws", "fail fails"],
      summary: "0 pass, 2 fail",
      exitCode: 1,
    });
  });

  test.concurrent("later tests still run when printing keeps throwing new errors", async () => {
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
      markers: "throws,fails",
      verdicts: ["fail throws", "fail fails"],
      summary: "0 pass, 2 fail",
      exitCode: 1,
    });
  });

  test.concurrent.each([[[]], [["--isolate"]]])("the next file still runs %j", async flags => {
    expect(
      await run(
        {
          "a.test.js":
            prelude +
            `
            test("last callback of the file throws", () => {
              log("throws");
              throw new ErrorWithThrowingMessage();
            });
          `,
          "b.test.js": `
            import { expect, test } from "bun:test";
            test("in the next file", () => {
              console.log("%%<next-file>%%");
              expect(1).toBe(2);
            });
          `,
        },
        flags,
      ),
    ).toEqual({
      markers: "throws,next-file",
      verdicts: ["fail last callback of the file throws", "fail in the next file"],
      summary: "0 pass, 2 fail",
      exitCode: 1,
    });
  });
});
