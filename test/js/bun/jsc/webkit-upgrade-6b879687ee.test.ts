import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Coverage for the WebKit 6b879687ee sync (oven-sh/WebKit#528). Each case pins
// an observable behavior difference between the previous JSC and the new one.
// The previous engine crashes on the first two, so every case runs in a child.

async function run(dir: string, file: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: { ...bunEnv, ...env },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe.concurrent("WebKit 6b879687ee upgrade", () => {
  test("a destructuring pattern nested too deep does not crash bytecode generation (752ab90072)", async () => {
    // ArrayPatternNode::bindValue and ObjectPatternNode::bindValue check
    // isSafeToRecurse. Before, a pattern that passed the parser's recursion
    // guard overflowed the native stack during bytecode generation and the
    // process died with SIGSEGV (Linux x64, debug and release).
    //
    // Two outcomes are correct: the guard throws a RangeError, or the native
    // frames are small enough for the pattern to compile and destructuring
    // undefined at the second level throws a TypeError. Which one wins depends
    // on the frame size of the build and platform, so the test accepts both.
    using dir = tempDir("webkit-6b879687ee-destructuring", {
      "index.js": `
        const depth = 12000;
        const open = Buffer.alloc(depth, "[").toString();
        const close = Buffer.alloc(depth, "]").toString();
        const openObject = Buffer.alloc(depth * 3, "{a:").toString();
        const closeObject = Buffer.alloc(depth, "}").toString();
        const results = [];
        for (const script of [
          "let " + open + "z" + close + " = [];",
          "(function (" + open + "z" + close + ") {})([]);",
          "let " + openObject + "z" + closeObject + " = {};",
        ]) {
          try {
            (0, eval)(script);
            results.push("no error");
          } catch (e) {
            results.push(e.constructor.name);
          }
        }
        let [[[a]]] = [[[42]]];
        let { b: { c } } = { b: { c: 7 } };
        results.push(a, c);
        console.log(JSON.stringify(results));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "index.js");
    expect(stderr).toBe("");
    const results = stdout ? JSON.parse(stdout) : stdout;
    expect(results).toBeArrayOfSize(5);
    for (const outcome of results.slice(0, 3)) {
      expect(["RangeError", "TypeError"]).toContain(outcome);
    }
    expect(results.slice(3)).toEqual([42, 7]);
    expect(exitCode).toBe(0);
  });

  test("an Absence PropertyCondition consults non-reified static property tables (33876268a1)", async () => {
    // Symbol.prototype keeps `description` in its static table. The DFG proved
    // the property absent, folded `symbolObject.description` to the value of
    // Object.prototype.description, and read `.y` off a string.
    using dir = tempDir("webkit-6b879687ee-absence", {
      "index.js": `
        import { noInline } from "bun:jsc";
        let K = {};
        K.y = 13.37;
        Object.prototype.description = K;

        function setup(a) { return a.description; }
        noInline(setup);
        let setupObj = {};
        for (let i = 0; i < 50_000; i++) setup(setupObj);

        let warm = Object(Symbol("warm")); warm.x = 1;
        let leak = Object(Symbol("leak")); leak.x = 1;
        let crash = Object(Symbol()); crash.x = 1;

        function f(a, n) {
          let b = a;
          if (n > 0) {
            let r = a.description;
            let v = r.y;
            return v;
          }
          b.x; b.x; b.x;
          return undefined;
        }
        noInline(f);

        const results = [];
        results.push(String(f(warm, 1)));
        for (let i = 0; i < 500_000; i++) f(warm, 0);
        results.push(String(f(leak, 1)));
        try {
          results.push(String(f(crash, 1)));
        } catch (e) {
          results.push(e.constructor.name);
        }
        console.log(JSON.stringify(results));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "index.js");
    expect(stdout).toBe(JSON.stringify(["undefined", "undefined", "TypeError"]));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("checked arithmetic keeps its overflow and negative zero checks under DCE (9f3eea6f46)", async () => {
    // DFGFixupPhase cleared NodeMustGenerate on Int32 ArithMul, ArithDiv,
    // ArithMod, ArithNegate and ArithAbs even with CheckOverflow selected, so
    // the checks were deleted with the unused result and `(y | 0) === y` was
    // folded to true.
    using dir = tempDir("webkit-6b879687ee-arith", {
      "index.js": `
        import { noInline } from "bun:jsc";
        function mulOverflow(k) { let y = k; y = y * y; return (y | 0) === y; }
        noInline(mulOverflow);
        function mulNegativeZero(a, b) { let y = a; y = y * b; return Object.is(y | 0, y); }
        noInline(mulNegativeZero);
        function divNonInteger(a, b) { let y = a; y = y / b; return (y | 0) === y; }
        noInline(divNonInteger);
        function modNegativeZero(a, b) { let y = a; y = y % b; return Object.is(y | 0, y); }
        noInline(modNegativeZero);
        function negateOverflow(k) { let y = k; y = -y; return (y | 0) === y; }
        noInline(negateOverflow);
        function negateNegativeZero(k) { let y = k; y = -y; return Object.is(y | 0, y); }
        noInline(negateNegativeZero);
        function absOverflow(k) { let y = k; y = Math.abs(y); return (y | 0) === y; }
        noInline(absOverflow);
        for (let i = 0; i < 100_000; ++i) {
          mulOverflow(3);
          mulNegativeZero(3, 2);
          divNonInteger(6, 3);
          modNegativeZero(7, 3);
          negateOverflow(3);
          negateNegativeZero(3);
          absOverflow(-3);
        }
        console.log(JSON.stringify([
          mulOverflow(65536),
          mulNegativeZero(0, -1),
          divNonInteger(7, 2),
          modNegativeZero(-3, 3),
          negateOverflow(-2147483648),
          negateNegativeZero(0),
          absOverflow(-2147483648),
        ]));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "index.js", {
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "1000",
    });
    expect(stdout).toBe(JSON.stringify([false, false, false, false, false, false, false]));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
