// https://github.com/oven-sh/bun/issues/34178
// The assertion diff formatter only detects true cycles, not shared
// references, so a DAG is re-expanded at every occurrence. Without an output
// cap, a failing toEqual() on a ~34-level graph allocates hundreds of MB/s
// until the machine dies.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("assertion diff output is capped", () => {
  // Each level references the same child twice, so the formatter reaches the
  // leaf 2^16 times: 64 MB per side from a graph of 17 objects. The formatter
  // reads `$$typeof` once each time it reaches a value, so the getter counts
  // how far the walk goes.
  const dagFixture = (assertion: string) => `
import { test, expect } from "bun:test";

let visits = 0;
const leaf: any = { s: Buffer.alloc(1024, "x").toString() };
Object.defineProperty(leaf, "$$typeof", {
  get() {
    visits++;
    return undefined;
  },
});

let o: any = leaf;
for (let i = 0; i < 16; i++) o = { a: o, b: o };

test("dag", () => {
  try {
    ${assertion};
  } finally {
    console.log(JSON.stringify({ visits }));
  }
});
`;

  test.each([
    ["received", "expect(o).toEqual(1)"],
    ["expected", "expect(1).toEqual(o)"],
    // An asymmetric matcher prints its payload through another entry point of
    // the same formatter. The cap and the stop of the walk apply there too.
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
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The cap is 1 MB per side and one leaf prints about 1 KB, so the walk
    // reaches the leaf about 1,000 times. A cap that only discards the output
    // and lets the walk continue reaches it 65,536 times.
    const line = stdout.split("\n").find(l => l.startsWith('{"visits"'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!).visits).toBeLessThan(5_000);

    // 1 MB per side plus the frame of the diff. The formatter emits 64 MB
    // per side for this graph without the cap.
    expect(stderr.length).toBeLessThan(3 * 1024 * 1024);
    expect(stderr).toContain("expect(received).toEqual(expected)");
    expect(stderr).toContain("[value too large, output truncated]");
    expect(exitCode).toBe(1);
  });
});
