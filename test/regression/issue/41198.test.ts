import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/41198
// A cyclic array converts to a string with "" for the cycle, like V8, and does not throw RangeError.

async function run(source: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("a cyclic array converts to a string the way Node does", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const a = [];
    a.push(1, a, 2);
    const b = [0];
    b.push([b]);
    const cases = {
      xor: 0 ^ a,
      string: String(a),
      join: a.join("-"),
      joinDefault: a.join(),
      toLocaleString: a.toLocaleString(),
      template: \`\${b}\`,
      equals: a == "1,,2",
      selfOnly: String([(x => (x[0] = x, x))([])]),
      shared: (s => [s, s].join("|"))([1, 2]),
    };
    console.log(JSON.stringify(cases));
    let threw;
    try { JSON.stringify(a); } catch (e) { threw = e.constructor.name; }
    console.log(threw);
  `);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    JSON.stringify({
      xor: 0,
      string: "1,,2",
      join: "1--2",
      joinDefault: "1,,2",
      toLocaleString: "1,,2",
      template: "0,",
      equals: true,
      selfOnly: "",
      shared: "1,2|1,2",
    }),
    "TypeError",
    "",
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("optimized code joins a cyclic array the same way as the interpreter", async () => {
  // The DFG and the FTL compile x.join(sep) to an ArrayJoin node. That node
  // calls its own operation, not Array.prototype.join, so it needs its own
  // cycle guard. The warmup must use the cyclic array itself. A warmup on an
  // Int32 array compiles code for that shape, and the code exits to the
  // baseline tier before ArrayJoin runs on the cyclic array.
  const { stdout, stderr, exitCode } = await run(
    `
    import { numberOfDFGCompiles } from "bun:jsc";
    const a = [];
    a.push(1, a, 2);
    const join = x => x.join("-");
    const convert = x => \`\${x}\`;
    for (let i = 0; i < 2000; i++) {
      const joined = join(a);
      const converted = convert(a);
      if (joined !== "1--2" || converted !== "1,,2") throw new Error(\`iteration \${i}: \${joined} \${converted}\`);
    }
    console.log(JSON.stringify([join(a), convert(a), numberOfDFGCompiles(join) >= 1]));
    `,
    {
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "1000",
    },
  );
  expect(stderr).toBe("");
  expect(stdout).toBe(JSON.stringify(["1--2", "1,,2", true]) + "\n");
  expect(exitCode).toBe(0);
});
