import { expect, test } from "bun:test";
import { bunRun } from "harness";
import path from "path";

test.concurrent(
  "pathToFileURL doesn't leak memory",
  async () => {
    const { stdout, stderr, exitCode } = await bunRun(path.join(import.meta.dir, "pathToFileURL-leak-fixture.js"));
    if (exitCode !== 0) console.error(stderr || stdout);
    expect(exitCode).toBe(0);
  },
  300_000,
);

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
