// https://github.com/oven-sh/bun/issues/34178
// The assertion diff formatter only detects true cycles, not shared
// references, so a DAG is re-expanded at every occurrence. Without an output
// cap, a failing toEqual() on a ~34-level graph allocates hundreds of MB/s
// until the machine dies.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("assertion diff output is capped", () => {
  // Each level references the same child twice, so the formatter expands
  // 2^16 copies of the leaf: ~8 MB of diff from a 16-object graph.
  const dagFixture = (assertion: string) => `
import { test, expect } from "bun:test";

let o: any = "leaf";
for (let i = 0; i < 16; i++) o = { a: o, b: o };

test("dag", () => {
  ${assertion};
});
`;

  test.each([
    ["received", "expect(o).toEqual(1)"],
    ["expected", "expect(1).toEqual(o)"],
    // Asymmetric matchers render their payload through a different writer
    // bridge (amf_print_as); the cap and traversal halt must survive it.
    ["asymmetric matcher", "expect({}).toEqual(expect.objectContaining(o))"],
  ])("truncates the %s side of a shared-reference object graph", async (_side, assertion) => {
    using dir = tempDir("diff-output-cap", {
      "dag.test.ts": dagFixture(assertion),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "dag.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "ignore",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // 1 MB cap per side plus diff framing; far below the ~8 MB the
    // uncapped formatter emits for this graph.
    expect(stderr.length).toBeLessThan(3 * 1024 * 1024);
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain("[value too large, output truncated]");
    expect(exitCode).toBe(1);
  });
});
