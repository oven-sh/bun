// https://github.com/oven-sh/bun/issues/13015
// The toEqual diff printer serialized Sets/Maps in insertion order and then
// ran a line-based text diff, so an element present in both collections but at
// a different position showed up as both "-" and "+". The fix sorts entries by
// their serialized form before diffing so only true membership differences are
// reported.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function stripAnsi(s: string) {
  return s.replaceAll(/\x1B\[[0-9;]*m/g, "");
}

function diffBlock(stderr: string, testName: string) {
  // Isolate the diff for a single fixture test: lines between this test's
  // "error:" line and its "(fail) <name>" line.
  const lines = stripAnsi(stderr).split("\n");
  const failIdx = lines.findIndex(l => l.includes(`(fail) ${testName}`));
  if (failIdx < 0) throw new Error(`fixture test "${testName}" not found in stderr`);
  let errIdx = failIdx;
  while (errIdx > 0 && !lines[errIdx].startsWith("error:")) errIdx--;
  let summaryIdx = errIdx;
  while (summaryIdx < failIdx && !lines[summaryIdx].startsWith("- Expected")) summaryIdx++;
  const body = lines
    .slice(errIdx + 1, summaryIdx)
    .filter(l => l.startsWith("+ ") || l.startsWith("- ") || l.startsWith("  "))
    .map(l => l.trimEnd());
  const footer = lines.slice(summaryIdx, summaryIdx + 2).join("\n");
  return { body, footer };
}

describe("issue #13015: toEqual diff for Set/Map is order-insensitive", () => {
  let stderr = "";

  beforeAll(async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", import.meta.dir + "/13015.fixture.ts"],
      env: { ...bunEnv, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    stderr = err;
    expect(code).toBe(1);
  });

  test("Set: shared element is not shown as both removed and added", () => {
    const { body, footer } = diffBlock(stderr, "Set diff shows only membership differences");
    // "xx" and "asdf" are in both sets; they must not appear on a +/- line.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain('"xx"');
        expect(line).not.toContain('"asdf"');
      }
    }
    // "sdf" is only in expected, so it must appear on a "-" line.
    expect(body.some(l => l.startsWith("- ") && l.includes('"sdf"'))).toBe(true);
    expect(footer).toBe("- Expected  - 1\n+ Received  + 0");
  });

  test("Set: numeric members", () => {
    const { body, footer } = diffBlock(stderr, "Set diff with numbers");
    // 1 and 2 are in both sets.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line.trim()).not.toMatch(/^[+-]\s+[12],?$/);
      }
    }
    // 4 is only in expected, 3 is only in received.
    expect(body.some(l => l.startsWith("- ") && /\b4\b/.test(l))).toBe(true);
    expect(body.some(l => l.startsWith("+ ") && /\b3\b/.test(l))).toBe(true);
    expect(footer).toBe("- Expected  - 1\n+ Received  + 1");
  });

  test("Map: shared entry is not shown as both removed and added", () => {
    const { body, footer } = diffBlock(stderr, "Map diff shows only entry differences");
    // "a" => 1 and "b" => 2 are in both maps.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain('"a" => 1');
        expect(line).not.toContain('"b" => 2');
      }
    }
    // "c" => 3 is only in expected.
    expect(body.some(l => l.startsWith("- ") && l.includes('"c" => 3'))).toBe(true);
    expect(footer).toBe("- Expected  - 1\n+ Received  + 0");
  });

  test("Set nested in object", () => {
    const { body, footer } = diffBlock(stderr, "Set nested in object");
    // "x" and "y" are in both sets.
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain('"x"');
        expect(line).not.toContain('"y"');
      }
    }
    // "z" is only in expected.
    expect(body.some(l => l.startsWith("- ") && l.includes('"z"'))).toBe(true);
    expect(footer).toBe("- Expected  - 1\n+ Received  + 0");
  });

  test("Set: shared Promise is order-independent even after a long sibling", () => {
    // Guards the per-entry reset_line() in SortedEntryCollector: without it,
    // formatting a Promise after a >80-char string inserts a leading newline on
    // one side only, and the shared Promise shows as both "-" and "+".
    const { body, footer } = diffBlock(stderr, "Set diff with Promise after long sibling");
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain("Promise");
        expect(line).not.toContain("aaaa");
      }
    }
    expect(body.some(l => l.startsWith("- ") && l.includes('"extra"'))).toBe(true);
    expect(footer).toBe("- Expected  - 1\n+ Received  + 0");
  });

  test("sibling after a Set does not depend on Set insertion order", () => {
    // Guards the reset_line() in Formatter::write_sorted_entries (shared by
    // Tag::Set and Tag::Map): without it, estimated_line_length on exit depends
    // on the last-inserted entry's length, so a Promise sibling right after the
    // collection shows as both "-" and "+".
    const { body, footer } = diffBlock(stderr, "sibling after a Set is order-independent");
    for (const line of body) {
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        expect(line).not.toContain("Promise");
      }
    }
    expect(body.some(l => l.startsWith("- ") && l.includes('"extra"'))).toBe(true);
    expect(footer).toBe("- Expected  - 1\n+ Received  + 0");
  });
});
