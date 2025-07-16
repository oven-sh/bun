import { test, expect } from "bun:test";
import { bunExe } from "harness";

test("console.log output", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/consolelog.fixture.ts"],
    stdio: ["inherit", "pipe", "pipe"],
  });
  await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(stdout).toMatchInlineSnapshot(`
    "--- begin ---
    {
      a: a,
      multiline: "pub fn main() !void {
           std.log.info(\\"Hello, {s}\\", .{name});
       }",
      error: 1 | console.log("--- begin ---");
    2 | console.log({
    3 |   a: "a",
    4 |   multiline: 'pub fn main() !void {\\n    std.log.info("Hello, {s}", .{name});\\n}',
    5 |   error: new Error("Hello, world!"),
                 ^
    error: Hello, world!
          at /Users/pfg/Dev/Node/bun/test/js/bun/test/printing/consolelog.fixture.ts:5:10
          at loadAndEvaluateModule (7:44)
          at asyncFunctionResume (9:85)
          at promiseReactionJobWithoutPromiseUnwrapAsyncContext (14:20)
          at promiseReactionJob (31:60)
    ,
    }
    --- end ---
    "
  `);
});
