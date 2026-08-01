// https://github.com/oven-sh/bun/issues/13015
// The toEqual diff printer serialized Sets/Maps in insertion order and then
// ran a line-based text diff, so an element present in both collections but at
// a different position showed up as both "-" and "+". The fix sorts entries by
// their serialized form before diffing so only true membership differences are
// reported.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function stripAnsi(s: string) {
  return s.replaceAll(/\x1B\[[0-9;]*m/g, "");
}

function diffLines(stderr: string, testName: string) {
  // Pull out the diff body for a single test: lines starting with "+ " / "- " / "  "
  // between the "error:" line and the "- Expected" summary.
  const lines = stripAnsi(stderr).split("\n");
  const start = lines.findIndex(l => l.includes(`(fail) ${testName}`));
  // walk backwards from the (fail) line to the preceding "error:" for this test
  let errIdx = start;
  while (errIdx > 0 && !lines[errIdx].startsWith("error:")) errIdx--;
  let summaryIdx = errIdx;
  while (summaryIdx < start && !lines[summaryIdx].startsWith("- Expected")) summaryIdx++;
  return lines
    .slice(errIdx + 1, summaryIdx)
    .filter(l => l.startsWith("+ ") || l.startsWith("- ") || l.startsWith("  "))
    .map(l => l.trimEnd());
}

describe("issue #13015: toEqual diff for Set/Map is order-insensitive", () => {
  let stderr = "";
  let exitCode = -1;

  test("run fixture", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", import.meta.dir + "/13015.fixture.ts"],
      env: { ...bunEnv, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    stderr = err;
    exitCode = code;
    expect(exitCode).toBe(1);
  });

  test("Set: shared element is not shown as both removed and added", () => {
    const body = diffLines(stderr, "Set diff shows only membership differences");
    // "xx" is in both sets; it must not appear on a +/- line.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain('"xx"');
        expect(line).not.toContain('"asdf"');
      }
    }
    // "sdf" is only in expected, so it must appear on a "-" line.
    expect(body.some(l => l.startsWith("- ") && l.includes('"sdf"'))).toBe(true);
    // The footer should count exactly 1 expected-only and 0 received-only lines.
    expect(stripAnsi(stderr)).toContain("- Expected  - 1");
    expect(stripAnsi(stderr)).toContain("+ Received  + 0");
  });

  test("Set: numeric members", () => {
    const body = diffLines(stderr, "Set diff with numbers");
    // 1 and 2 are in both sets.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line.trim()).not.toMatch(/^[+-]\s+[12],?$/);
      }
    }
    // 4 is only in expected, 3 is only in received.
    expect(body.some(l => l.startsWith("- ") && /\b4\b/.test(l))).toBe(true);
    expect(body.some(l => l.startsWith("+ ") && /\b3\b/.test(l))).toBe(true);
  });

  test("Map: shared entry is not shown as both removed and added", () => {
    const body = diffLines(stderr, "Map diff shows only entry differences");
    // "a" => 1 and "b" => 2 are in both maps.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain('"a" => 1');
        expect(line).not.toContain('"b" => 2');
      }
    }
    // "c" => 3 is only in expected.
    expect(body.some(l => l.startsWith("- ") && l.includes('"c" => 3'))).toBe(true);
  });

  test("Set nested in object", () => {
    const body = diffLines(stderr, "Set nested in object");
    // "x" and "y" are in both sets.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain('"x"');
        expect(line).not.toContain('"y"');
      }
    }
    // "z" is only in expected.
    expect(body.some(l => l.startsWith("- ") && l.includes('"z"'))).toBe(true);
  });
});
