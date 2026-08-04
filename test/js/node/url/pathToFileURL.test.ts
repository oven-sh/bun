import { expect, test } from "bun:test";
import { bunEnv, bunRun } from "harness";
import path from "path";

test.concurrent(
  "pathToFileURL doesn't leak memory",
  async () => {
    const { stdout, stderr, exitCode } = await bunRun(path.join(import.meta.dir, "pathToFileURL-leak-fixture.js"), {
      // ASAN holds freed allocations in a 256 MB quarantine by default, which
      // inflates the fixture's RSS delta and previously forced a separate
      // isASAN threshold. Disabling the quarantine keeps the delta build-type
      // agnostic and lets the fixture use ~40x fewer iterations.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    });
    expect(stderr).toBe("");
    expect(stdout).toStartWith("RSS delta");
    expect(exitCode).toBe(0);
  },
  30_000,
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
