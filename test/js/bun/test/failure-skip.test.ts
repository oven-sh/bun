import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
