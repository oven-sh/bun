import { expect, test } from "bun:test";
import { bunExe } from "harness";

test("Bun.inspect", async () => {
  expect(Bun.inspect("abc\ndef\nghi")).toMatchInlineSnapshot(`
    ""abc
     def
     ghi""
  `);
  expect(Bun.inspect({ a: "abc\ndef\nghi" })).toMatchInlineSnapshot(`
    "{
      a: "abc
       def
       ghi",
    }"
  `);
});

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
    }
    --- end ---
    "
  `);
});
