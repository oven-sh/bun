import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

// Every test body below logs its name, so stdout lists exactly the tests whose bodies ran.
async function runTestFile(source: string, args: string[] = []) {
  using dir = tempDir("failure-skip-describe", { "fixture.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, join(String(dir), "fixture.test.ts")],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout), stderr, exitCode };
}

describe("a failing beforeAll skips only the tests of its own describe", () => {
  const siblingDescribesAndTopLevelTest = `
    import { beforeAll, describe, it } from "bun:test";
    describe("a", () => {
      beforeAll(() => {
        throw new Error("a beforeAll failed");
      });
      it("a1", () => console.log("ran a1"));
    });
    describe("b", () => {
      beforeAll(async () => {
        throw new Error("b beforeAll failed");
      });
      it("b1", () => console.log("ran b1"));
    });
    describe("c", () => {
      it("c1", () => console.log("ran c1"));
    });
    it("d", () => console.log("ran d"));
  `;

  test.concurrent.each([[[]], [["--concurrent"]]])("sibling describes and top-level tests still run %p", async args => {
    const { stdout, stderr, exitCode } = await runTestFile(siblingDescribesAndTopLevelTest, args);
    expect(stdout).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      ran c1
      ran d"
    `);
    expect(stderr).toContain("a beforeAll failed");
    expect(stderr).toContain("b beforeAll failed");
    expect(exitCode).toBe(1);
  });

  test.concurrent("describe.concurrent sibling", async () => {
    const { stdout, exitCode } = await runTestFile(`
      import { beforeAll, describe, it } from "bun:test";
      describe.concurrent("a", () => {
        beforeAll(() => {
          throw new Error("a beforeAll failed");
        });
        it("a1", () => console.log("ran a1"));
      });
      describe.concurrent("b", () => {
        it("b1", () => console.log("ran b1"));
      });
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      ran b1"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("it.concurrent sibling", async () => {
    const { stdout, exitCode } = await runTestFile(`
      import { beforeAll, describe, it } from "bun:test";
      describe("a", () => {
        beforeAll(() => {
          throw new Error("a beforeAll failed");
        });
        it.concurrent("a1", () => console.log("ran a1"));
      });
      it.concurrent("b", () => console.log("ran b"));
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      ran b"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("nested describes: the skip ends with the describe that owns the hook", async () => {
    const { stdout, exitCode } = await runTestFile(
      `
        import { beforeAll, describe, it } from "bun:test";
        describe("outer", () => {
          describe("a", () => {
            beforeAll(() => {
              throw new Error("a beforeAll failed");
            });
            it("a1", () => console.log("ran a1"));
            describe("inner", () => {
              it("a2", () => console.log("ran a2"));
            });
          });
          it("outer1", () => console.log("ran outer1"));
        });
        it("top", () => console.log("ran top"));
      `,
      ["--concurrent"],
    );
    expect(stdout).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      ran outer1
      ran top"
    `);
    expect(exitCode).toBe(1);
  });

  // The tests of a describe with a beforeAll form their own concurrent group (as they already do
  // for a describe with an afterAll), so a failing hook can never skip past the describe. Tests
  // after it still share a group with each other.
  test.concurrent("a describe with a beforeAll ends its concurrent group", async () => {
    const { stdout, stderr, exitCode } = await runTestFile(
      `
        import { beforeAll, describe, it } from "bun:test";
        const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));
        async function body(name: string) {
          console.log("start " + name);
          await yieldToEventLoop();
          console.log("end " + name);
        }
        describe("a", () => {
          beforeAll(() => {});
          it("a1", () => body("a1"));
        });
        it("b", () => body("b"));
        it("c", () => body("c"));
      `,
      ["--concurrent"],
    );
    expect(stdout).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      start a1
      end a1
      start b
      start c
      end b
      end c"
    `);
    expect(stderr).toContain(" 3 pass\n");
    expect(exitCode).toBe(0);
  });
});
