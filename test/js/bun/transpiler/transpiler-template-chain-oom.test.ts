// minify_syntax (enabled for target:"bun") folds `a${x}` + `b${y}` into one
// template literal. Each step of a long left-associated chain used to copy
// every part accumulated so far into a fresh arena slice and keep the old one,
// giving O(n^2) memory: 44 KB of "`a${x}b` + `a${x}b` + ..." took over 500 MB.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("long template literal `+` chain does not blow up memory with target: bun", async () => {
  const fixture = /* js */ `
    const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
    const n = 4096;
    const input = "capture(" + Array(n).fill("\`a\${x}b\`").join(" + ") + ");";
    const expected = "capture(\`" + Array(n).fill("a\${x}b").join("") + "\`);\\n";
    const before = rss();
    const out = new Bun.Transpiler({ target: "bun" }).transformSync(input);
    const after = rss();
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
  // Before the fix: ~525 MB in release for n=4096. After: under 10 MB in
  // release, ~10 MB in debug+ASAN.
  expect(delta_mb).toBeLessThan(100);
});

test("template literal folding output is unchanged", () => {
  const t = new Bun.Transpiler({ loader: "ts", target: "bun" });
  const cases: Record<string, string> = {
    "capture(`a${x}b` + `c${y}d`)": "capture(`a${x}bc${y}d`);\n",
    "capture(`a${x}b` + `c${y}d` + `e${z}f` + `g${w}h` + `i${v}j`)": "capture(`a${x}bc${y}de${z}fg${w}hi${v}j`);\n",
    // the chain's accumulator starts at the second operand
    "capture(x + `a${y}` + `b${z}` + `c${w}`)": "capture(x + `a${y}b${z}c${w}`);\n",
    // the accumulator takes over the right operand's parts, then grows them
    "capture(`head` + `a${x}` + `b${y}` + `c${z}`)": "capture(`heada${x}b${y}c${z}`);\n",
    "capture('s' + `a${x}` + `b${y}` + 't' + `c${z}`)": "capture(`sa${x}b${y}tc${z}`);\n",
    "capture(`a${x}` + 's' + `b${y}`)": "capture(`a${x}sb${y}`);\n",
    "capture(`a${x}` + 1 + `b${y}` + null + `c${z}`)": "capture(`a${x}1b${y}nullc${z}`);\n",
    "capture(`a${x}` + `b${y}c${z}d` + `e${w}`)": "capture(`a${x}b${y}c${z}de${w}`);\n",
    // non-constant operands split the chain into several accumulators
    "capture(`a${x}` + y + `b${z}` + `c${w}` + v + `d${u}` + `e${s}`)":
      "capture(`a${x}` + y + `b${z}c${w}` + v + `d${u}e${s}`);\n",
    // nested chains inside substitutions fold independently of the outer chain
    "capture(`a${`b${x}` + `c${y}`}d` + `e${`f${z}` + `g${w}`}h` + `i${v}`)":
      "capture(`a${`b${x}c${y}`}de${`f${z}g${w}`}hi${v}`);\n",
    "capture(`a${x}` + (`b${y}` + `c${z}`) + `d${w}`)": "capture(`a${x}b${y}c${z}d${w}`);\n",
    "capture((`a${x}` + `b${y}`) + (`c${z}` + `d${w}`))": "capture(`a${x}b${y}c${z}d${w}`);\n",
    "capture(`${x}` + `${y}` + `${z}`)": "capture(`${x}${y}${z}`);\n",
    "capture(`a${x}` + `` + `b${y}` + ``)": "capture(`a${x}b${y}`);\n",
    "capture(tag`a${x}` + `b${y}` + `c${z}`)": "capture(tag`a${x}` + `b${y}c${z}`);\n",
    "capture(`a${x}` + tag`b${y}` + `c${z}`)": "capture(`a${x}` + tag`b${y}` + `c${z}`);\n",
    "capture(`a${1}` + `b${2}` + `c${'3'}`)": 'capture("a1b2c3");\n',
    "const enum E { A = 'a', B = `b` } capture(`x${y}` + E.A + `z${w}` + E.B)":
      'var E;\n((E) => {\n  E.A = "a";\n  E.B = "b";\n})(E ||= {});\ncapture(`x${y}az${w}b`);\n',
  };
  const got: Record<string, string> = {};
  for (const input of Object.keys(cases)) {
    got[input] = t.transformSync(input);
  }
  expect(got).toEqual(cases);
});
