import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `bun run` transpiles with minify_syntax on. Those rewrites must not change
// the frames or positions that `Error.stack` reports for the source text.
// A call in `return` position is a tail call in strict-mode code, and JSC
// drops the caller's frame for it.
function frames(stack: string): string[] {
  return stack
    .split("\n")
    .slice(1)
    .map(line => {
      const m = line.match(/^\s+at (?:(\S+) \()?.*?index\.ts:(\d+):(\d+)\)?$/);
      return m ? `${m[1] ?? "<top>"} ${m[2]}:${m[3]}` : null;
    })
    .filter((s): s is string => s !== null);
}

async function run(source: string): Promise<string> {
  using dir = tempDir("runtime-stack-frames", { "index.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

describe.concurrent("runtime transpiler keeps stack frames", () => {
  test("a single-use const returned from a function keeps the function's frame", async () => {
    const stdout = await run(`\
function g() { throw new Error("boom"); }
function f() {
  const r = g();
  return r;
}
try { f(); } catch (e) { console.log((e as Error).stack); }
`);
    expect(frames(stdout)).toEqual(["g 1:26", "f 3:13", "<top> 6:7"]);
  });

  test("return new Error() keeps the constructing function's frame", async () => {
    const stdout = await run(`\
function makeError() {
  return new Error("direct");
}
function viaConst() {
  const e = new Error("const");
  return e;
}
console.log(makeError().stack);
console.log("--");
console.log(viaConst().stack);
`);
    const [first, second] = stdout.split("--\n");
    expect(frames(first)).toEqual(["makeError 2:14", "<top> 8:13"]);
    expect(frames(second)).toEqual(["viaConst 5:17", "<top> 10:13"]);
  });

  test("a use of an inlined const literal maps to the use site, not the declaration", async () => {
    const stdout = await run(`\
function h() {
  const obj = null;
  console.log("pad");
  return (obj as any).foo;
}
try { h(); } catch (e) { console.log((e as Error).stack); }
`);
    expect(frames(stdout)).toEqual(["h 4:11", "<top> 6:7"]);
  });

  test("a binding is still inlined into a return that already holds a tail call", async () => {
    // `return x.y()` is a tail call in the source, so `f` is absent with or
    // without the transpiler. The substitution of `x` stays allowed.
    const stdout = await run(`\
function g() { throw new Error("boom"); }
function f() {
  const x = { y: g };
  return x.y();
}
try { f(); } catch (e) { console.log((e as Error).stack); }
`);
    expect(frames(stdout)).toEqual(["g 1:26", "<top> 6:7"]);
  });
});

describe.concurrent("requested minify_syntax", () => {
  const source = `export function k() { return new Error("x"); }`;

  test("bun build --minify-syntax still drops new on a known constructor", async () => {
    using dir = tempDir("runtime-stack-frames-build", { "index.ts": source });
    const result = await Bun.build({
      entrypoints: [`${dir}/index.ts`],
      target: "bun",
      minify: { syntax: true },
    });
    expect(await result.outputs[0].text()).toContain('return Error("x")');
  });

  test("the runtime transpiler keeps new", () => {
    const transpiler = new Bun.Transpiler({ target: "bun" });
    expect(transpiler.transformSync(source)).toContain('return new Error("x")');
  });
});
