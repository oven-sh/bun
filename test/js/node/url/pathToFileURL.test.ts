import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test("pathToFileURL doesn't leak memory", () => {
  expect([path.join(import.meta.dir, "pathToFileURL-leak-fixture.js")]).toRun();
});

test("pathToFileURL handles relative paths longer than 4096 bytes", async () => {
  const longPath = Buffer.alloc(5000, "a").toString();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const url = Bun.pathToFileURL(Buffer.alloc(5000, "a").toString()); console.log(url.href.endsWith("/${longPath}"))`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});

test("pathToFileURL escapes special characters", () => {
  const cases = [
    ["\0", "%00"], // '\0' == 0x00
    ["\t", "%09"], // '\t' == 0x09
    ["\n", "%0A"], // '\n' == 0x0A
    ["\r", "%0D"], // '\r' == 0x0D
    [" ", "%20"], // ' ' == 0x20
    ['"', "%22"], // '"' == 0x22
    ["#", "%23"], // '#' == 0x23
    ["%", "%25"], // '%' == 0x25
    ["?", "%3F"], // '?' == 0x3F
    ["[", "%5B"], // '[' == 0x5B
    ["]", "%5D"], // ']' == 0x5D
    ["^", "%5E"], // '^' == 0x5E
    ["|", "%7C"], // '|' == 0x7C
    ["~", "%7E"], // '~' == 0x7E
  ];

  for (const [input, expected] of cases) {
    expect(Bun.pathToFileURL(`${input}`).toString()).toInclude(expected);
  }
});
