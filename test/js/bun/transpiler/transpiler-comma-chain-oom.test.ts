// bun-fuzz: js parser OOM on long comma chains with target:"bun".
// minify_syntax (enabled for target:"bun") calls simplify_unused_expr on the
// left operand at every level of the comma chain; the simplifier rebuilds the
// whole chain with fresh arena allocations each time, giving O(n^2) time and
// memory. 66KB of "a,b,c,..." drove RSS past 2GB.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("long comma expression does not blow up memory with target: bun", async () => {
  const fixture = `
    const n = 4000;
    const input = Array(n).fill("a").join(",");
    const expected = Array(n).fill("a").join(", ") + ";\\n";
    const before = process.memoryUsage().rss;
    const out = new Bun.Transpiler({ target: "bun" }).transformSync(input);
    const after = process.memoryUsage().rss;
    if (out !== expected) {
      throw new Error("wrong output: " + JSON.stringify(out.slice(0, 80)));
    }
    console.log(JSON.stringify({ delta_mb: (after - before) / 1024 / 1024 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^\{"delta_mb":/),
    exitCode: 0,
  });
  const { delta_mb } = JSON.parse(stdout);
  // Before the fix: ~280 MB in release, ~370 MB in debug+ASAN for n=4000.
  expect(delta_mb).toBeLessThan(100);
}, 60_000);

test("comma simplification output is unchanged", () => {
  const t = new Bun.Transpiler({ target: "bun" });
  const cases: Record<string, string> = {
    "1,2,3": "",
    "a,b,c": "a, b, c;\n",
    "(0,a)()": "a();\n",
    "(a,0)()": "(a, 0)();\n",
    "a,1,b,2,c": "a, b, c;\n",
    "1,2,a,3,4": "a;\n",
    "x(),1,2,y()": "x(), y();\n",
    "a===b,c,d": "a, b, c, d;\n",
    "(1,2,3,a)": "a;\n",
    "a,(b,c),d": "a, b, c, d;\n",
    "1,a,1,b,1,c,1": "a, b, c;\n",
  };
  const got: Record<string, string> = {};
  for (const input of Object.keys(cases)) {
    got[input] = t.transformSync(input);
  }
  expect(got).toEqual(cases);
});
