import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The runtime transpiler runs with minify_syntax enabled (target=bun implies
// tree_shaking, which implies inlining, which implies minify_syntax). Its
// single-use-let inlining previously substituted an anonymous
// function/arrow/class initializer into the use site, dropping the ".name" it
// would have received via NamedEvaluation at the declaration.
// https://github.com/oven-sh/bun/issues/20398
// https://github.com/oven-sh/bun/issues/22770
//
// Block-level function declarations are lowered to exactly that shape
// ("let f = function() {}"), so "{ function f() {} ... }" lost its name at
// runtime when f was referenced exactly once. This was first observed as
// performance.timerify() emitting entries with an empty name.
//
// These tests spawn a fresh bun process so the fixture goes through the
// real runtime transpiler rather than this test file's own transpile.

test("single-use let of an anonymous function keeps its .name at runtime", async () => {
  const src = `
    function t1() {
      let fn = function () {};
      return fn.name;
    }
    function t2() {
      const arrow = () => {};
      return arrow.name;
    }
    function t3() {
      let Cls = class {};
      return Cls.name;
    }
    function t4() {
      // named function expression: inlining is fine, name is intrinsic
      let fn = function named() {};
      return fn.name;
    }
    function t5() {
      // non-function initializer still inlines
      let n = 42;
      return n + 1;
    }
    function t6() {
      // issue #20398: substituted into an array literal
      const f = () => 0;
      const a = [f];
      return a[0].name;
    }
    console.log(JSON.stringify([t1(), t2(), t3(), t4(), t5(), t6()]));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
    out: ["fn", "arrow", "Cls", "named", 43, "f"],
    stderr: "",
    exitCode: 0,
  });
});

test("block-level function declaration keeps its .name at runtime", async () => {
  using dir = tempDir("block-fn-name", {
    // .mjs so the block-level function declaration is a strict-mode let,
    // which is the shape the lowering rewrites to "let f = function() {}".
    "entry.mjs": `
      let a, b;
      {
        function slow() { return 42; }
        a = slow.name;
      }
      {
        function work() {}
        const wrapped = work;
        b = wrapped.name;
      }
      console.log(JSON.stringify([a, b]));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
    out: ["slow", "work"],
    stderr: "",
    exitCode: 0,
  });
});

test("Bun.Transpiler minify.syntax does not inline anonymous function into its single use", () => {
  const transpiler = new Bun.Transpiler({ loader: "js", minify: { syntax: true } });
  const out = transpiler.transformSync(`
    function outer() {
      let fn = function () {};
      return fn.name;
    }
  `);
  // The declaration must survive so JSC's NamedEvaluation assigns "fn".
  expect(out).toContain("let fn = function");
  expect(out).not.toContain("return function");
});
