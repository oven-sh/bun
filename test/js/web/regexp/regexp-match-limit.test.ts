// When YARR's internal resource limits are reached during a RegExp match, the
// engine must throw instead of silently reporting "no match". Previously the
// interpreter's allocator exhaustion (ErrorNoMemory) and the 100M-call
// matchLimit (ErrorHitLimit) were collapsed to offsetNoMatch, so patterns like
// /^(?:a|b)+$/ over multi-megabyte inputs quietly returned false where Node
// returns true.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(code: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: { ...bunEnv, ...extraEnv },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// Force the interpreter and shrink its BumpPointerPool so the per-iteration
// ParenthesesDisjunctionContext allocations run out after a few thousand
// characters instead of ~1.24M. Keeps the test well under a second.
const smallPool = {
  BUN_JSC_useRegExpJIT: "0",
  BUN_JSC_maxRegExpStackSize: "1048576",
};

const makeInput = (n: number) => `Buffer.alloc(${n}, "a").toString()`;

describe.concurrent("RegExp throws when the YARR interpreter runs out of backtracking memory", () => {
  const input = makeInput(20_000);

  test("RegExp.prototype.test", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + /^(?:a|b)+$/.test(s)); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
      smallPool,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });

  test("RegExp.prototype.exec", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + (/^(?:a|b)+$/.exec(s) === null ? "null" : "match")); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
      smallPool,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });

  test("String.prototype.match", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + (s.match(/^(?:a|b)+$/) === null ? "null" : "match")); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
      smallPool,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });

  test("String.prototype.search", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + s.search(/^(?:a|b)+$/)); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
      smallPool,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });

  test("String.prototype.replace", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + (s.replace(/^(?:a|b)+$/, "x") === s ? "unchanged" : "replaced")); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
      smallPool,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });

  test("patterns without a quantified group are unaffected", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       console.log(/^[ab]+$/.test(s));
       console.log(/^a+$/.test(s));`,
      smallPool,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("true\ntrue");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("RegExp throws at default settings for large inputs", () => {
  // Default pool (128MB), default JIT. Quantified alternation over ~2M chars
  // exhausts it in a few hundred ms (release). This is the shape real
  // validators hit: /^(?:[0-9a-f]{2})+$/ on a multi-MB hex payload.
  const input = makeInput(2_000_000);

  test("test() over a quantified alternation", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + /^(?:a|b)+$/.test(s)); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });

  test("exec() over a quantified capture group", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const s = ${input};
       try { console.log("result=" + (/^(a)*$/.exec(s) === null ? "null" : "match")); }
       catch (e) { console.log("threw=" + e.constructor.name); }`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("threw=RangeError");
    expect(exitCode).toBe(0);
  });
});
