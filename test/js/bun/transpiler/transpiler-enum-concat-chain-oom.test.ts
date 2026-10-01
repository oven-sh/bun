// bun-fuzz: folding a long `+` chain of inlined string-enum members was
// quadratic in memory. String folding builds a rope of AST nodes instead of
// copying bytes, and an enum member's rope used to be shared by every
// reference to it. To avoid appending onto that shared rope, each `+` with an
// enum member operand deep-cloned BOTH operands' ropes, so the growing
// left-hand accumulator of `S.A + "k" + S.A + "k" + ...` was re-cloned in full
// at every enum term: 8k terms (49 KB of source) took 1.4 GB. The same chain
// over plain literals stayed flat.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("long `+` chain of inlined enum members folds in linear memory", async () => {
  const fixture = /* js */ `
    const rss = process.memoryUsage.rss;
    const n = 4096;
    // The same chain twice: at top level (folds because target is "bun") and
    // as an enum member initializer (always folds).
    const src =
      'enum S { A = "value", B = "" + ' + '"k" + A + '.repeat(n) + '"" }\\n' +
      'capture1(' + 'S.A + "k" + '.repeat(n) + '"");\\n' +
      'capture2(S.B);\\n' +
      'export {};\\n';
    const before = rss();
    const out = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(src);
    const after = rss();
    const m1 = out.match(/capture1\\("([^"]*)"\\)/);
    const m2 = out.match(/capture2\\("([^"]*)" \\/\\* B \\*\\/\\)/);
    if (!m1 || m1[1] !== "valuek".repeat(n)) throw new Error("capture1 folded wrong: " + JSON.stringify(out.slice(0, 200)));
    if (!m2 || m2[1] !== "kvalue".repeat(n)) throw new Error("capture2 folded wrong: " + JSON.stringify(out.slice(0, 200)));
    console.log(JSON.stringify({ delta_mb: (after - before) / 1024 / 1024 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: expect.stringMatching(/^\{"delta_mb":/),
    stderr: "",
    exitCode: 0,
  });
  const { delta_mb } = JSON.parse(stdout);
  // Before the fix: ~1.5 GB in release for n=4096 (two chains). After: a few MB.
  expect(delta_mb).toBeLessThan(150);
});

test.concurrent("folding onto an inlined enum member leaves the member's own value intact", async () => {
  // B below folds to "12", and every later A.B reference is inlined from the
  // stored member. No way of appending more string to such a reference may
  // reach the member itself: member on the left of "+", on the right, on both
  // sides, inside a template literal, and a member whose name cannot be
  // printed as a trailing /* comment */ because it contains "*/". Before the
  // fix the last two appended onto the member's shared rope, changed its value
  // everywhere and then panicked the transpiler, so this runs out of process.
  const src = /* ts */ `
    enum A {
      B = "1" + "2",
      L = B + "x",
      R = "x" + B,
      LR = B + B,
      M = ("<" + B + ">") + B + "!",
      T = \`t\${B}t\`,
      "*/" = "s" + "t",
      S2 = A["*/"] + "u",
    }
    capture(A.B, A.L, A.R, A.LR, A.M, A.T, A["*/"], A.S2);
    capture(A.B + "y", "y" + A.B, A.B + A.B, \`a\${x}b\` + A.B + "c", A.B + \`b\${x}a\`, \`(\${A.B})\`, A.B);
    capture(A["*/"] + "v", "v" + A["*/"], \`(\${A["*/"]})\`, A["*/"]);
    capture(A);
  `;
  const fixture = /* js */ `
    const out = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(${JSON.stringify(src)});
    const captured = [];
    new Function("capture", "x", out)((...args) => captured.push(args), "X");
    console.log(JSON.stringify({ out, captured }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: expect.stringMatching(/^\{"out":/),
    stderr: "",
    exitCode: 0,
  });
  const { out, captured } = JSON.parse(stdout) as { out: string; captured: unknown[][] };

  // The member references must actually have been inlined and folded for the
  // values below to say anything about rope sharing.
  const captureLines = out.split("\n").filter(l => l.startsWith("capture(") && l !== "capture(A);");
  expect(captureLines).toHaveLength(3);
  for (const line of captureLines) expect(line).not.toMatch(/\bA\b/);

  expect(captured).toEqual([
    ["12", "12x", "x12", "1212", "<12>12!", "t12t", "st", "stu"],
    ["12y", "y12", "1212", "aXb12c", "12bXa", "(12)", "12"],
    ["stv", "vst", "(st)", "st"],
    [{ B: "12", L: "12x", R: "x12", LR: "1212", M: "<12>12!", T: "t12t", "*/": "st", S2: "stu" }],
  ]);
});
