import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

// A call of a function that always returns one primitive folds to that value
// while the file is visited, so the branch it guards folds like a `--define`.
describe("bundler", () => {
  for (const minifySyntax of [false, true]) {
    const suffix = minifySyntax ? "Minify" : "";

    itBundled(`inline_calls/SameFileValues${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          export {};
          console.log(before());
          function before() { return "before"; }
          function isDev() { return process.env.NODE_ENV === "development"; }
          function hasFlag() { if (FLAG) { return true; } return false; }
          function version() { return "1.2.3"; }
          function count() { return 42; }
          function nothing() {}
          function nil() { return null; }
          function viaIf() { if (isDev()) return "dev"; else { return "prod"; } }
          if (isDev()) console.log("DROP dev");
          if (hasFlag()) console.log("flag"); else console.log("DROP no flag");
          console.log(version(), count(), nothing(), nil(), viaIf(), isDev() ? "DROP" : "kept");
        `,
      },
      define: { "process.env.NODE_ENV": '"production"', FLAG: "true" },
      minifySyntax,
      dce: true,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).not.toContain("function");
        for (const name of ["before", "isDev", "hasFlag", "version", "count", "nothing", "nil", "viaIf"]) {
          expect(out).not.toContain(name + "(");
        }
      },
      run: { stdout: "before\nflag\n1.2.3 42 undefined null prod kept" },
    });

    itBundled(`inline_calls/DeadBranchIsNeverResolved${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          function isDev() { return DEV; }
          if (isDev()) {
            require("./does-not-exist");
            import("./does-not-exist-either");
          }
          const tools = isDev() ? require("./also-missing") : null;
          console.log(tools, isDev() && require("./missing-too"));
        `,
      },
      define: { DEV: "false" },
      minifySyntax,
      run: { stdout: "null false" },
    });
  }

  // A function is visited before the statements above it only in a file with
  // import or export syntax. In every file, a call below the declaration folds.
  itBundled("inline_calls/CallAboveTheDeclarationInCommonJS", {
    files: {
      "/entry.js": /* js */ `
        console.log(above(), exports.late);
        function above() { return "above"; }
        function readsExport() { return exports.late; }
        exports.late = "late";
        console.log(above(), readsExport());
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("console.log(above(),");
      expect(out).toContain('console.log("above",');
    },
    run: { stdout: "above undefined\nabove late" },
  });

  itBundled("inline_calls/ConstLocalPrefixIsVisitedFirst", {
    files: {
      "/entry.js": /* js */ `
        const config = load();
        const DEV = false;
        export function isDev() { return DEV; }
        if (isDev()) console.log("DROP");
        function load() { return globalThis.config; }
        console.log(config, isDev());
      `,
    },
    minifySyntax: true,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("DEV");
    },
    run: { stdout: "undefined false" },
  });

  itBundled("inline_calls/FeatureFlag", {
    files: {
      "/entry.js": /* js */ `
        import { feature } from "bun:bundle";
        function hasOn() { return feature("ON") ? true : false; }
        function hasOff() { if (feature("OFF")) { return true; } return false; }
        if (hasOn()) console.log("on");
        if (hasOff()) console.log("DROP off");
        if (!hasOn()) console.log("DROP not on");
      `,
    },
    features: ["ON"],
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("hasOn");
      expect(out).not.toContain("hasOff");
    },
    run: { stdout: "on" },
  });

  itBundled("inline_calls/UnusedImportIsDropped", {
    files: {
      "/entry.js": /* js */ `
        import { heavy } from "./heavy";
        function isDev() { return false; }
        if (isDev()) heavy();
        console.log("done");
      `,
      "/heavy.js": /* js */ `
        export function heavy() { console.log("DROP heavy"); }
      `,
    },
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("heavy");
    },
    run: { stdout: "done" },
  });

  itBundled("inline_calls/ArgumentSideEffectsStay", {
    files: {
      "/entry.js": /* js */ `
        let n = 0;
        const xs = { *[Symbol.iterator]() { n += 10; } };
        function nothing() {}
        function one() { return 1; }
        console.log(nothing(n++), one(n++, n++), one(...xs), one(n), n);
        if (one(n++)) console.log("yes", n);
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("nothing(");
      expect(out).not.toContain("one(");
    },
    run: { stdout: "undefined 1 1 1 13\nyes 14" },
  });

  itBundled("inline_calls/OtherUsesAreKept", {
    files: {
      "/entry.js": /* js */ `
        function one() { return 1; }
        const tag = one\`x\`;
        console.log(one(), new one() instanceof one, one.call(null), one?.(), tag, [one].length, typeof one);
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("function one()");
      expect(out).toContain("new one");
      expect(out).toContain("one.call(null)");
      expect(out).toContain("one?.()");
      expect(out).toContain("console.log(1,");
    },
    run: { stdout: "1 true 1 1 1 1 function" },
  });

  itBundled("inline_calls/NotAConstantFunction", {
    files: {
      "/entry.js": /* js */ `
        let calls = 0;
        async function asyncOne() { return 1; }
        function* genOne() { return 1; }
        function withDefault(a = calls++) { return 1; }
        function withPattern({ a }) { return 1; }
        function readsState() { return calls; }
        function twoValues(x) { if (x) return 1; return 2; }
        console.log(
          asyncOne() instanceof Promise,
          typeof genOne().next,
          withDefault(),
          calls,
          withPattern({ get a() { calls++; return 1; } }),
          readsState(),
          twoValues(0),
        );
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      for (const name of ["asyncOne()", "genOne()", "withDefault()", "withPattern(", "readsState()", "twoValues(0)"]) {
        expect(out).toContain(name);
      }
    },
    run: { stdout: "true function 1 1 1 2 2" },
  });

  itBundled("inline_calls/LongStringStaysInTheFunction", {
    files: {
      "/entry.js": /* js */ `
        function shader() { return "${Buffer.alloc(100, "precision mediump float; ").toString()}"; }
        function short() { return "short"; }
        console.log(shader().length, shader().length, short());
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("shader().length, shader().length");
      expect(out).toIncludeRepeated("precision mediump float; ", 4);
      expect(out).not.toContain("short()");
    },
    run: { stdout: "100 100 short" },
  });

  itBundled("inline_calls/LateAssignment", {
    files: {
      "/entry.js": /* js */ `
        function f() { return 1; }
        function viaF() { return f(); }
        function untouched() { return "same"; }
        console.log(f(), viaF(), untouched());
        f = () => 2;
        console.log(f(), viaF(), untouched());
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("f()");
      expect(out).not.toContain("untouched");
    },
    run: { stdout: "1 1 same\n2 2 same" },
  });

  itBundled("inline_calls/AssignmentInDestructuring", {
    files: {
      "/entry.js": /* js */ `
        function f() { return 1; }
        function g() { return 1; }
        function h() { return 1; }
        console.log(f(), g(), h());
        [f] = [() => 2];
        ({ g } = { g: () => 3 });
        for (h of [() => 4]);
        console.log(f(), g(), h());
      `,
    },
    run: { stdout: "1 1 1\n2 3 4" },
  });

  itBundled("inline_calls/DirectEval", {
    files: {
      "/entry.js": /* js */ `
        function f() { return 1; }
        console.log(f());
        eval("f = () => 2");
        console.log(f());
      `,
    },
    run: { stdout: "1\n2" },
  });

  // In sloppy mode a function declaration in a block also assigns the function-scope binding.
  itBundled("inline_calls/SloppyBlockFunction", {
    files: {
      "/entry.js": /* js */ `
        function test() {
          function f() { return 1; }
          const before = f();
          { function f() { return 2; } }
          if (before) { function g() { return 3; } }
          return [before, f(), g()].join(" ");
        }
        console.log(test());
      `,
    },
    run: { stdout: "1 2 3" },
  });

  itBundled("inline_calls/MergedWithVar", {
    files: {
      "/entry.js": /* js */ `
        function test() {
          var a = () => "var a";
          function a() { return "function a"; }
          function b() { return "function b"; }
          { var b = () => "var b"; }
          function last() { return 1; }
          function last() { return 2; }
          return [a(), b(), last()].join(" ");
        }
        console.log(test());
      `,
    },
    run: { stdout: "var a var b 2" },
  });

  itBundled("inline_calls/DirectiveKeepsTheCall", {
    files: {
      "/entry.js": /* js */ `
        function strict() { "use strict"; return 1; }
        function action() { "use server"; return 1; }
        console.log(strict(), action());
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("strict()");
      expect(out).toContain("action()");
    },
    run: { stdout: "1 1" },
  });

  itBundled("inline_calls/InsideWith", {
    files: {
      "/entry.js": /* js */ `
        function f() { return "function"; }
        with ({ f() { return "property"; } }) {
          console.log(f());
        }
        console.log(f());
      `,
    },
    run: { stdout: "property\nfunction" },
  });

  itBundled("inline_calls/ShadowedName", {
    files: {
      "/entry.js": /* js */ `
        function f() { return "outer"; }
        function test(f) { return f(); }
        function test2() { let f = () => "inner"; return f(); }
        console.log(f(), test(() => "param"), test2());
      `,
    },
    run: { stdout: "outer param inner" },
  });

  itBundled("inline_calls/NestedFunctions", {
    files: {
      "/entry.js": /* js */ `
        function outer(x) {
          function isOn() { return false; }
          if (isOn()) return "DROP";
          return x;
        }
        console.log(outer("kept"));
      `,
    },
    dce: true,
    run: { stdout: "kept" },
  });

  itBundled("inline_calls/ConstArrowInPrefix", {
    files: {
      "/entry.js": /* js */ `
        const isOn = () => false;
        const name = function () { return "name"; };
        console.log(isOn() ? "DROP" : "off", name());
        console.log(isLate());
        const isLate = () => true;
      `,
    },
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("isOn");
      expect(out).toContain("isLate()");
    },
    run: { error: "ReferenceError: Cannot access 'isLate' before initialization." },
  });

  // A function is one way to keep a specifier away from the bundler.
  itBundled("inline_calls/ImportSpecifierStaysOpaque", {
    files: {
      "/entry.js": /* js */ `
        function name() { return "./not-on-disk.js"; }
        console.log(typeof name());
        if (process.argv.length > 99) {
          require(name());
          require.resolve(name());
          import(name());
        }
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("require(name())");
      expect(out).toContain("require.resolve(name())");
      expect(out).toContain("import(name())");
    },
    run: { stdout: "string" },
  });

  itBundled("inline_calls/ExportedFunctionKeepsDeclaration", {
    files: {
      "/entry.js": /* js */ `
        export function isOn() { return true; }
        export default function () { return isOn() ? "on" : "DROP"; }
      `,
      "/run.js": /* js */ `
        import render, { isOn } from "./out.js";
        console.log(render(), isOn());
      `,
    },
    dce: true,
    format: "esm",
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("function isOn()");
    },
    run: { file: "/run.js", stdout: "on true" },
  });

  itBundled("inline_calls/TypeScript", {
    files: {
      "/entry.ts": /* ts */ `
        export function isInternal(): boolean { return process.env.BUILD === "internal"; }
        function label(this: void): string { return "public"; }
        if (isInternal()) console.log("DROP internal");
        console.log(label(), isInternal() as boolean);
      `,
    },
    define: { "process.env.BUILD": '"public"' },
    dce: true,
    run: { stdout: "public false" },
  });

  itBundled("inline_calls/CommonJS", {
    files: {
      "/entry.js": /* js */ `
        function isOn() { return false; }
        module.exports = { value: isOn() ? "DROP" : "off" };
        console.log(module.exports.value);
      `,
    },
    dce: true,
    run: { stdout: "off" },
  });

  itBundled("inline_calls/TranspileOnlyIsUnchanged", {
    files: {
      "/entry.js": /* js */ `
        function isOn() { return false; }
        if (isOn()) console.log("kept");
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("if (isOn())");
    },
  });
});
