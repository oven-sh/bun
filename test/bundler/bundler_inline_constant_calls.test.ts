import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { itBundled } from "./expectBundled";

// With `minifySyntax`, a call of a function that always returns `true`, `false`,
// `null` or `undefined` folds to that value while the file is visited, so the
// branch it guards folds like a `--define`.
const define = { T: "true", F: "false" };
const minifySyntax = true;

describe("bundler", () => {
  itBundled("inline_calls/BuildTimeValues", {
    files: {
      "/entry.js": /* js */ `
        function isDev() { return process.env.NODE_ENV === "development"; }
        function hasFlag() { if (FLAG) { return true; } return false; }
        function nothing() { if (isDev()) return 1; }
        function nil() { return isDev() ? 0 : null; }
        function viaIf() { if (isDev()) return true; else { return false; } }
        function empty() {}
        if (isDev()) console.log("DROP dev");
        if (hasFlag()) console.log("flag"); else console.log("DROP no flag");
        if (viaIf()) console.log("DROP via if");
        console.log(nothing(), nil(), empty(), isDev() ? "DROP" : "kept", !isDev());
      `,
    },
    define: { "process.env.NODE_ENV": '"production"', FLAG: "true" },
    minifySyntax,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("function");
    },
    run: { stdout: "flag\nundefined null undefined kept true" },
  });

  // The switch is the one of the values of `const` declarations.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`inline_calls/${backend}/NotWithoutMinifySyntax`, {
      backend,
      files: {
        "/entry.js": /* js */ `
          import { imported } from "./flags.js";
          function isDev() { return process.env.NODE_ENV === "development"; }
          function isOff() { return F; }
          const arrow = () => F;
          console.log(isDev() ? "a" : "b", isOff() ? "a" : "b", arrow() ? "a" : "b", imported() ? "a" : "b");
        `,
        "/flags.js": /* js */ `
          export function imported() { return T; }
        `,
      },
      define,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        for (const call of ["isDev()", "isOff()", "arrow()", "imported()"]) expect(out).toContain(call + " ?");
      },
      run: { stdout: "b b b a" },
    });
  }

  itBundled("inline_calls/OnlyTrueFalseNullUndefined", {
    files: {
      "/entry.js": /* js */ `
        function mode() { return MODE; }
        function count() { return COUNT; }
        function big() { return 1n; }
        function zero() { return 0; }
        if (mode() === "dev") console.log("never");
        console.log(count() > 1 ? "many" : "few", mode(), typeof big(), zero() ? "yes" : "no");
      `,
    },
    define: { MODE: '"prod"', COUNT: "2" },
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      for (const call of ["mode()", "count()", "big()", "zero()"]) expect(out).toContain(call);
    },
    run: { stdout: "many prod bigint no" },
  });

  itBundled("inline_calls/DeadBranchIsNeverResolved", {
    files: {
      "/entry.js": /* js */ `
        function isDev() { return F; }
        if (isDev()) {
          require("./does-not-exist");
          import("./does-not-exist-either");
        }
        const tools = isDev() ? require("./also-missing") : null;
        console.log(tools, isDev() && require("./missing-too"));
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "null false" },
  });

  // A function is one way to keep a specifier away from the bundler.
  itBundled("inline_calls/ImportSpecifierStaysOpaque", {
    files: {
      "/entry.js": /* js */ `
        function useB() { return T; }
        function load() {
          return [
            require(useB() ? "./b.js" : "./a.js"),
            require.resolve(useB() ? "./b.js" : "./a.js"),
            import(useB() ? "./b.js" : "./a.js"),
          ];
        }
        console.log(typeof load, useB());
      `,
      "/a.js": `module.exports = "a";`,
      "/b.js": `module.exports = "b";`,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toIncludeRepeated("useB() ?", 3);
      expect(out).toContain("console.log(typeof load, !0)");
    },
    run: { stdout: "function true" },
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
    minifySyntax,
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
        function isDev() { return F; }
        if (isDev()) heavy();
        console.log("done");
      `,
      "/heavy.js": /* js */ `
        export function heavy() { console.log("DROP heavy"); }
      `,
    },
    define,
    minifySyntax,
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
        function nothing() { if (F) return 1; }
        function yes() { return T; }
        console.log(nothing(n++), yes(n++, n++), yes(...xs), yes(n), n);
        if (yes(n++)) console.log("yes", n);
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("nothing(");
      expect(out).not.toContain("yes(");
    },
    run: { stdout: "undefined true true true 13\nyes 14" },
  });

  itBundled("inline_calls/OtherUsesAreKept", {
    files: {
      "/entry.js": /* js */ `
        function yes() { return T; }
        const tag = yes\`x\`;
        console.log(yes(), new yes() instanceof yes, yes.call(null), yes?.(), tag, [yes].length, typeof yes);
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("function yes()");
      expect(out).toContain("new yes");
      expect(out).toContain("yes.call(null)");
      expect(out).toContain("yes?.()");
      expect(out).toContain("console.log(!0,");
    },
    run: { stdout: "true true true true true 1 function" },
  });

  // A value in place of the call makes \`a || b\` the same as \`b\`. As the target of a call, \`b\` has another \`this\`.
  for (const flags of [{ minifySyntax }, { minifySyntax, minifyWhitespace: true, minifyIdentifiers: true }]) {
    itBundled(`inline_calls/ThisOfACallTarget${flags.minifyWhitespace ? "Minify" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          function off() { return F; }
          function on() { return T; }
          function nil() { return F ? 1 : null; }
          const o = {
            m() { return this === o ? "o" : String(this); },
            tag(strings) { return this === o ? "o" : String(this); },
          };
          console.log(
            (off() || o.m)(),
            (on() && o.m)(),
            (nil() ?? o.m)(),
            (off(), o.m)(),
            (on() ? o.m : 0)(),
          );
          console.log(
            (off() || o.m)?.(),
            (on() && o.m)?.(),
            (nil() ?? o.m)?.(),
            (off(), o.m)?.(),
            (on() ? o.m : 0)?.(),
          );
          console.log(
            (off() || o.tag)\`x\`,
            (on() && o.tag)\`x\`,
            (nil() ?? o.tag)\`x\`,
            (off(), o.tag)\`x\`,
          );
          console.log(off() || o.m(), (off() || o).m());
        `,
      },
      define,
      ...flags,
      run: {
        stdout: [
          "undefined undefined undefined undefined undefined",
          "undefined undefined undefined undefined undefined",
          "undefined undefined undefined undefined",
          "o o",
        ].join("\n"),
      },
    });
  }

  itBundled("inline_calls/NotAConstantFunction", {
    files: {
      "/entry.js": /* js */ `
        let calls = 0;
        async function asyncOne() { return T; }
        function* genOne() { return T; }
        function withDefault(a = calls++) { return T; }
        function withPattern({ a }) { return T; }
        function readsState() { return T && calls; }
        function twoValues(x) { if (x) return T; return F; }
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
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      for (const name of ["asyncOne()", "genOne()", "withDefault()", "withPattern(", "readsState()", "twoValues(0)"]) {
        expect(out).toContain(name);
      }
    },
    run: { stdout: "true function true 1 true 2 false" },
  });

  // The function is not visited yet when the visit pass is at a call above it.
  for (const syntax of ["ESM", "CommonJS"]) {
    itBundled(`inline_calls/CallAboveTheDeclarationIsKeptIn${syntax}`, {
      files: {
        "/entry.js": /* js */ `
          ${syntax === "ESM" ? "export {};" : ""}
          console.log(above());
          function above() { return T; }
          console.log(above());
        `,
      },
      define,
      minifySyntax,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("console.log(above())");
        expect(out).toContain("console.log(!0)");
      },
      run: { stdout: "true\ntrue" },
    });
  }

  // The decorator is parsed before the class statement starts.
  itBundled("inline_calls/FunctionAboveADecoratedClass", {
    files: {
      "/entry.js": /* js */ `
        export function isDev() { return F; }
        @(cls => cls)
        class A {}
        console.log(typeof A, isDev());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "function false" },
  });

  itBundled("inline_calls/LateAssignment", {
    files: {
      "/entry.js": /* js */ `
        function f() { return T; }
        function viaF() { return f(); }
        function untouched() { return T; }
        console.log(f(), viaF(), untouched());
        f = () => "second";
        console.log(f(), viaF(), untouched());
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("f()");
      expect(out).not.toContain("untouched");
    },
    run: { stdout: "true true true\nsecond second true" },
  });

  // A fold changes which code is dead, so the second attempt visits \`G\`, which the first did not.
  itBundled("inline_calls/LateAssignmentInCodeThatAFoldKeeps", {
    files: {
      "/entry.js": /* js */ `
        function F1() { return F; }
        if (!F1()) {
          (function () {
            function G() { return F; var x; }
            if (G()) console.log("g");
            G = () => true;
            if (G()) console.log("g is rebound");
          })();
        }
        F1 = () => true;
        console.log(F1() ? "f is rebound" : "DROP");
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "g is rebound\nf is rebound" },
  });

  itBundled("inline_calls/AssignmentInDestructuring", {
    files: {
      "/entry.js": /* js */ `
        function f() { return T; }
        function g() { return T; }
        function h() { return T; }
        console.log(f(), g(), h());
        [f] = [() => 2];
        ({ g } = { g: () => 3 });
        for (h of [() => 4]);
        console.log(f(), g(), h());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "true true true\n2 3 4" },
  });

  // \`--define HOOK=f\` makes an assignment to \`HOOK\` an assignment to \`f\`.
  itBundled("inline_calls/AssignmentThroughADefine", {
    files: {
      "/entry.js": /* js */ `
        function f() { return T; }
        function g() { return T; }
        console.log(f(), g());
        HOOK = () => "rebound";
        COUNTER++;
        console.log(f(), typeof g);
      `,
    },
    define: { ...define, HOOK: "f", COUNTER: "g" },
    minifySyntax,
    run: { stdout: "true true\nrebound number" },
  });

  itBundled("inline_calls/DirectEval", {
    files: {
      "/entry.js": /* js */ `
        function f() { return T; }
        console.log(f());
        eval("f = () => 2");
        console.log(f());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "true\n2" },
  });

  itBundled("inline_calls/MergedWithVar", {
    files: {
      "/entry.js": /* js */ `
        function test() {
          var a = () => "var a";
          function a() { return T; }
          function b() { return T; }
          { var b = () => "var b"; }
          function last() { return F; }
          function last() { return T; }
          return [a(), b(), last()].join(" ");
        }
        console.log(test());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "var a var b true" },
  });

  // In sloppy mode a function declaration in a block also assigns the function-scope binding.
  itBundled("inline_calls/SloppyBlockFunction", {
    files: {
      "/entry.js": /* js */ `
        function test() {
          function f() { return T; }
          const before = f();
          { function f() { return F; } }
          if (before) { function g() { return T; } }
          return [before, f(), g()].join(" ");
        }
        console.log(test());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "true false true" },
  });

  // A \`switch\` body can be entered at any \`case\`, below the declaration.
  itBundled("inline_calls/ConstInASwitchBody", {
    files: {
      "/entry.js": /* js */ `
        function test(x) {
          switch (x) {
            case 1:
              const f = () => T;
              return f();
            case 2:
              return f();
          }
        }
        console.log(test(1));
        try { test(2); } catch (e) { console.log(e.constructor.name); }
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "true\nReferenceError" },
  });

  itBundled("inline_calls/DirectiveKeepsTheCall", {
    files: {
      "/entry.js": /* js */ `
        function strict() { "use strict"; return T; }
        function action() { "use server"; return T; }
        console.log(strict(), action());
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("strict()");
      expect(out).toContain("action()");
    },
    run: { stdout: "true true" },
  });

  itBundled("inline_calls/InsideWith", {
    files: {
      "/entry.js": /* js */ `
        function f() { return T; }
        with ({ f() { return "property"; } }) {
          console.log(f());
        }
        console.log(f());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "property\ntrue" },
  });

  itBundled("inline_calls/ShadowedName", {
    files: {
      "/entry.js": /* js */ `
        function f() { return T; }
        function test(f) { return f(); }
        function test2() { let f = () => "inner"; return f(); }
        console.log(f(), test(() => "param"), test2());
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "true param inner" },
  });

  itBundled("inline_calls/NestedFunctions", {
    files: {
      "/entry.js": /* js */ `
        function outer(x) {
          function isOn() { return F; }
          if (isOn()) return "DROP";
          return x;
        }
        console.log(outer("kept"));
      `,
    },
    define,
    minifySyntax,
    dce: true,
    run: { stdout: "kept" },
  });

  itBundled("inline_calls/ConstArrowInPrefix", {
    files: {
      "/entry.js": /* js */ `
        const isOn = () => F;
        const isSet = function () { return T; };
        console.log(isOn() ? "DROP" : "off", isSet());
        function afterThePrefix() {}
        const isLate = () => T;
        console.log(isLate());
      `,
    },
    define,
    minifySyntax,
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("isOn");
      expect(out).toContain("isLate()");
    },
    run: { stdout: "off true\ntrue" },
  });

  itBundled("inline_calls/ReadsAConstFromThePrefix", {
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
    minifySyntax,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("DEV");
    },
    run: { stdout: "undefined false" },
  });

  itBundled("inline_calls/ExportedFunctionKeepsDeclaration", {
    files: {
      "/entry.js": /* js */ `
        export function isOn() { return T; }
        export default function () { return isOn() ? "on" : "DROP"; }
      `,
      "/run.js": /* js */ `
        import render, { isOn } from "./out.js";
        console.log(render(), isOn());
      `,
    },
    define,
    minifySyntax,
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
        function isPublic(this: void): boolean { return !isInternal(); }
        if (isInternal()) console.log("DROP internal");
        console.log(isPublic(), isInternal() as boolean);
      `,
    },
    define: { "process.env.BUILD": '"public"' },
    minifySyntax,
    dce: true,
    run: { stdout: "true false" },
  });

  itBundled("inline_calls/CommonJS", {
    files: {
      "/entry.js": /* js */ `
        function isOn() { return F; }
        module.exports = { value: isOn() ? "DROP" : "off" };
        console.log(module.exports.value);
      `,
    },
    define,
    minifySyntax,
    dce: true,
    run: { stdout: "off" },
  });

  itBundled("inline_calls/TranspileOnlyIsUnchanged", {
    files: {
      "/entry.js": /* js */ `
        function isOn() { return F; }
        if (isOn()) console.log("kept");
      `,
    },
    define,
    bundling: false,
    minifySyntax,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("isOn()");
    },
  });

  // A second attempt would run the macro again.
  itBundled("inline_calls/MacroImportKeepsTheCalls", {
    files: {
      "/entry.js": /* js */ `
        import { version } from "./macro.js" with { type: "macro" };
        function isOn() { return F; }
        console.log(isOn() ? "on" : "off", version());
      `,
      "/macro.js": /* js */ `
        export function version() { return "1.0"; }
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("isOn() ?");
    },
    run: { stdout: "off 1.0" },
  });

  // The rule is for each file: only a file that the React Compiler reads keeps its calls.
  itBundled("inline_calls/ReactCompilerKeepsTheCalls", {
    backend: "api",
    files: {
      "/entry.jsx": /* jsx */ `
        import { inTs } from "./plain.ts";
        function isOn() { return F; }
        console.log(isOn() ? "on" : "off", inTs());
      `,
      "/plain.ts": /* ts */ `
        function isOn() { return F; }
        export function inTs() { return isOn() ? "REMOVED" : "off"; }
      `,
    },
    define,
    minifySyntax,
    reactCompiler: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("isOn() ?");
      expect(out).not.toContain("REMOVED");
    },
    run: { stdout: "off off" },
  });

  itBundled("inline_calls/EnvironmentVariableTurnsItOff", {
    backend: "cli",
    env: { BUN_FEATURE_FLAG_DISABLE_CONST_CALL_FOLDING: "1" },
    files: {
      "/entry.js": /* js */ `
        import { isOn } from "./flags.js";
        function isOff() { return F; }
        console.log(isOff() ? "yes" : "no", isOn() ? "yes" : "no");
      `,
      "/flags.js": /* js */ `
        export function isOn() { return T; }
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("isOff()");
      expect(out).toContain("isOn()");
    },
    run: { stdout: "no yes" },
  });

  // Across files. When a condition calls an import, the worker that parses the file
  // also parses the imported file, before it visits the file with the condition.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`inline_calls/${backend}/CrossModule`, {
      backend,
      files: {
        "/entry.ts": /* ts */ `
          import { isDev, hasOn, hasOff, version, nothing } from "./flags";
          if (isDev()) console.log("DROP dev");
          if (hasOn()) console.log("on");
          if (hasOff()) console.log("DROP off"); else console.log("not off");
          if (!nothing()) console.log(isDev() ? "DROP" : "prod", version());
        `,
        // A TypeScript import that only folded calls use still runs the file.
        "/flags.ts": /* ts */ `
          import { feature } from "bun:bundle";
          console.log("flags run");
          export function isDev() { return process.env.NODE_ENV === "development"; }
          export function hasOn() { return feature("ON") ? true : false; }
          export function hasOff() { if (feature("OFF")) return true; return false; }
          export function version() { return "1.2.3"; }
          export function nothing() {}
        `,
      },
      define: { "process.env.NODE_ENV": '"production"' },
      features: ["ON"],
      minifySyntax,
      dce: true,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        for (const call of ["isDev()", "hasOn()", "hasOff()", "nothing()"]) expect(out).not.toContain(call);
        expect(out).toContain('console.log("prod", version())');
      },
      run: { stdout: "flags run\non\nnot off\nprod 1.2.3" },
    });

    // What a function returns depends on its file only, so files that import each other fold too.
    itBundled(`inline_calls/${backend}/CrossModuleImportCycle`, {
      backend,
      files: {
        "/entry.js": /* js */ `
          import "./a";
          import "./self";
        `,
        "/a.js": /* js */ `
          import { bFlag } from "./b";
          export function aFlag() { return T; }
          console.log("a:", bFlag() ? "DROP" : "b off");
        `,
        "/b.js": /* js */ `
          import { aFlag } from "./a";
          export function bFlag() { return F; }
          console.log("b:", aFlag() ? "a on" : "DROP");
        `,
        "/self.js": /* js */ `
          import { selfFlag as imported } from "./self";
          export function selfFlag() { return F; }
          console.log("self:", imported() ? "DROP" : "off");
        `,
      },
      define,
      minifySyntax,
      dce: true,
      run: { stdout: "b: a on\na: b off\nself: off" },
    });
  }

  for (const splitting of [false, true]) {
    itBundled(`inline_calls/CrossModuleDeadBranchIsNeverResolved${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          import { isDev } from "./env";
          if (isDev()) {
            require("./dev-only/does-not-exist");
            import("./dev-only/does-not-exist-either");
          }
          const tools = isDev() ? require("./dev-only/missing") : null;
          isDev() && import("./heavy");
          console.log(tools);
        `,
        "/env.js": /* js */ `
          console.log("env runs");
          export function isDev() { return process.env.NODE_ENV !== "production"; }
        `,
        "/heavy.js": /* js */ `
          console.log("DROP heavy");
        `,
      },
      define: { "process.env.NODE_ENV": '"production"' },
      minifySyntax,
      splitting,
      outdir: "/out",
      dce: true,
      onAfterBundle(api) {
        // One output file: the dead \`import()\` made no chunk.
        expect(api.readFile("/out/entry.js")).not.toContain("heavy");
        expect([...new Bun.Glob("**/*.js").scanSync(api.join("out"))]).toEqual(["entry.js"]);
      },
      run: { file: "/out/entry.js", stdout: "env runs\nnull" },
    });
  }

  itBundled("inline_calls/CrossModuleCompile", {
    compile: true,
    files: {
      "/entry.ts": /* ts */ `
        import { isDev } from "./env";
        if (isDev()) require("./dev-only/does-not-exist");
        console.log(isDev() ? "DROP" : "prod");
      `,
      "/env.ts": /* ts */ `
        export function isDev(): boolean { return process.env.NODE_ENV === "development"; }
      `,
    },
    define: { "process.env.NODE_ENV": '"production"' },
    minifySyntax,
    run: { stdout: "prod" },
  });

  itBundled("inline_calls/CrossModuleReExports", {
    files: {
      "/entry.js": /* js */ `
        import { isDevelopment, viaImport } from "./barrel";
        import isDefault, { isDev as renamed } from "./env";
        import alsoDefault from "./env";
        if (isDevelopment()) console.log("DROP a");
        if (viaImport()) console.log("DROP b");
        if (isDefault()) console.log("DROP c");
        if (renamed()) console.log("DROP d");
        if (alsoDefault()) console.log("DROP e");
        console.log("done");
      `,
      "/barrel.js": /* js */ `
        export { isDev as isDevelopment } from "./env";
        import { isDev } from "./env";
        export { isDev as viaImport };
      `,
      "/env.js": /* js */ `
        function isDev() { return F; }
        export { isDev, isDev as default };
      `,
    },
    define,
    minifySyntax,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("isDev");
    },
    run: { stdout: "done" },
  });

  // The chain ends at the file after \`hops\` files that only export the import again.
  for (const [hops, folds] of [
    [8, true],
    [9, false],
  ] as const) {
    itBundled(`inline_calls/CrossModuleReExportChainOf${hops}`, {
      files: {
        "/entry.js": /* js */ `
          import { isDev } from "./hop1.js";
          if (isDev()) console.log("dev"); else console.log("prod");
        `,
        ...Object.fromEntries(
          Array.from({ length: hops }, (_, i) => [
            `/hop${i + 1}.js`,
            `export { isDev } from "./${i + 1 === hops ? "env" : `hop${i + 2}`}.js";`,
          ]),
        ),
        "/env.js": /* js */ `
          export function isDev() { return F; }
        `,
      },
      define,
      minifySyntax,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        if (folds) expect(out).not.toContain("isDev()");
        else expect(out).toContain("isDev() ?");
      },
      run: { stdout: "prod" },
    });
  }

  // \`module.exports = require("./env.js")\` alone is a redirect to the other file.
  itBundled("inline_calls/CrossModuleRedirect", {
    files: {
      "/entry.js": /* js */ `
        import { isDev } from "./flags.js";
        import { isDev as direct } from "./index.js";
        if (isDev()) require("./dev-only/does-not-exist");
        console.log("app", direct() ? "DROP" : "prod");
      `,
      "/flags.js": /* js */ `
        export { isDev } from "./index.js";
      `,
      "/index.js": /* js */ `
        module.exports = require("./env.js");
      `,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    dce: true,
    run: { stdout: "app prod" },
  });

  itBundled("inline_calls/CrossModuleThroughAPackage", {
    files: {
      "/entry.js": /* js */ `
        import { isDev } from "flags";
        import { isDev as direct } from "flags/env.js";
        if (isDev()) console.log("DROP barrel"); else console.log("prod");
        if (direct()) console.log("DROP direct");
      `,
      "/node_modules/flags/package.json": `{ "name": "flags", "main": "index.js", "sideEffects": false }`,
      "/node_modules/flags/index.js": /* js */ `
        export { isDev } from "./env.js";
        export { unused } from "./unused.js";
      `,
      "/node_modules/flags/env.js": /* js */ `
        export function isDev() { return F; }
      `,
      "/node_modules/flags/unused.js": /* js */ `
        export function unused() { return "never in the bundle"; }
      `,
    },
    define,
    minifySyntax,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("never in the bundle");
    },
    run: { stdout: "prod" },
  });

  // A package with a "module" and a "main" build can get its imports rewritten from one to the other.
  itBundled("inline_calls/CrossModulePackageWithTwoBuilds", {
    files: {
      "/entry.js": /* js */ `
        import { isDev } from "dual";
        import { isDev as same } from "same";
        require("dual");
        console.log(isDev() ? "cjs build" : "esm build", same() ? "REMOVED" : "same off");
      `,
      "/node_modules/dual/package.json": `{ "name": "dual", "main": "./cjs.js", "module": "./esm.js" }`,
      "/node_modules/dual/esm.js": `export function isDev() { return F; }`,
      "/node_modules/dual/cjs.js": `exports.isDev = function () { return true; };`,
      "/node_modules/same/package.json": `{ "name": "same", "main": "./index.js", "module": "./index.js" }`,
      "/node_modules/same/index.js": `export function isDev() { return F; }`,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("esm build");
      expect(out).not.toContain("REMOVED");
    },
    run: { stdout: "cjs build same off" },
  });

  // Almost no file in a package calls a constant import, so a file in a package does not ask.
  itBundled("inline_calls/CrossModuleImporterInAPackage", {
    files: {
      "/entry.js": /* js */ `
        import "lib";
      `,
      "/node_modules/lib/index.js": /* js */ `
        import { isDev } from "./env.js";
        if (isDev()) console.log("dev"); else console.log("prod");
      `,
      "/node_modules/lib/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("isDev() ?");
    },
    run: { stdout: "prod" },
  });

  // The function of the imported file can return a call of an import of that file.
  itBundled("inline_calls/CrossModuleWrapper", {
    files: {
      "/entry.js": /* js */ `
        import { isInternalDev, isInternal, tooDeep } from "./wrapper.js";
        if (isInternalDev()) console.log("DROP"); else console.log("kept");
        if (isInternal()) require("./internal/does-not-exist");
        if (tooDeep()) console.log("DROP at run time"); else console.log("too deep");
      `,
      "/wrapper.js": /* js */ `
        import { isDev } from "./env.js";
        import { viaWrapper } from "./wrapper2.js";
        export function isInternalDev() { return isDev() && INTERNAL; }
        export function isInternal() { return isDev(); }
        export function tooDeep() { return viaWrapper(); }
      `,
      "/wrapper2.js": /* js */ `
        import { isDev } from "./env.js";
        export function viaWrapper() { return isDev(); }
      `,
      "/env.js": /* js */ `
        export function isDev() { return !PRODUCTION; }
      `,
    },
    define: { PRODUCTION: "true", INTERNAL: "true" },
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("isInternalDev()");
      expect(out).toContain("tooDeep() ?");
    },
    run: { stdout: "kept\ntoo deep" },
  });

  itBundled("inline_calls/CrossModuleNotFolded", {
    files: {
      "/entry.js": /* js */ `
        import { arrow, reassigned, usesState, letFn, off } from "./esm";
        import { cjsFlag } from "./cjs.cjs";
        import { viaStar } from "./star";
        import * as ns from "./esm";
        if (arrow()) console.log("arrow");
        if (reassigned()) console.log("reassigned");
        if (usesState()) console.log("state");
        if (letFn()) console.log("let");
        if (cjsFlag()) console.log("cjs");
        if (viaStar()) console.log("star");
        if (ns.off()) console.log("never"); else console.log("ns");
        function shadows(off) { if (off()) console.log("parameter"); }
        shadows(() => true);
        if (off()) console.log("DROP");
      `,
      "/esm.js": /* js */ `
        // A \`const\` is in its temporal dead zone until this file runs.
        export const arrow = () => T;
        export function reassigned() { return F; }
        reassigned = () => true;
        export function usesState() { return T && globalThis.flag === undefined; }
        export let letFn = function () { return T; };
        export function off() { return F; }
        export function viaStar() { return T; }
      `,
      "/star.js": /* js */ `
        export * from "./esm";
      `,
      "/cjs.cjs": /* js */ `
        exports.cjsFlag = function () { return T; };
      `,
    },
    define,
    minifySyntax,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      for (const call of ["arrow()", "reassigned()", "usesState()", "letFn()", "$cjsFlag()", "viaStar()", "off()"]) {
        expect(out).toContain(call);
      }
      expect(out).not.toContain("DROP");
    },
    run: { stdout: "arrow\nreassigned\nstate\nlet\ncjs\nstar\nns\nparameter" },
  });

  itBundled("inline_calls/CrossModuleUnresolvedImport", {
    files: {
      "/entry.js": /* js */ `
        import { flag } from "./does-not-exist";
        if (flag()) console.log("x");
      `,
    },
    minifySyntax,
    bundleErrors: {
      "/entry.js": ['Could not resolve: "./does-not-exist"'],
    },
  });

  // The imported file reports its own errors, one time.
  itBundled("inline_calls/CrossModuleErrorInTheImportedFile", {
    files: {
      "/entry.js": /* js */ `
        import { flag } from "./broken";
        if (flag()) console.log("x");
      `,
      "/broken.js": /* js */ `
        export function flag() { return T; }
        const twice = 1;
        const twice = 2;
      `,
    },
    define,
    minifySyntax,
    bundleErrors: {
      "/broken.js": ['"twice" has already been declared'],
    },
  });

  itBundled("inline_calls/CrossModuleExternalImport", {
    files: {
      "/entry.js": /* js */ `
        import { isatty } from "node:tty";
        import { flag } from "./empty";
        if (isatty(99)) console.log("tty");
        if (flag()) console.log("flag");
        console.log("done");
      `,
      "/empty.js": "\n",
    },
    target: "bun",
    minifySyntax,
    bundleErrors: {
      "/entry.js": ['No matching export in "empty.js" for import "flag"'],
    },
  });

  // Only a JavaScript file exports a function. The loader is known when the specifier is resolved.
  itBundled("inline_calls/CrossModuleOtherLoaders", {
    files: {
      "/entry.js": /* js */ `
        import { name } from "./data.json";
        import { name as mapped } from "pkg/data";
        import { isDev } from "./env";
        if (typeof name === "function" && name()) console.log("DROP");
        if (typeof mapped === "function" && mapped()) console.log("DROP");
        console.log(name, mapped, isDev() ? "DROP" : "prod");
      `,
      "/data.json": `{ "name": "json" }`,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "exports": { "./data": "./data.json" } }`,
      "/node_modules/pkg/data.json": `{ "name": "mapped" }`,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "json mapped prod" },
  });

  itBundled("inline_calls/CrossModuleJSXInJsFile", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { isDev } from "./env.js";
        import { View } from "./view.js";
        console.log(View().props.mode, isDev() ? "DROP" : "prod");
      `,
      "/view.js": /* js */ `
        import { isDev } from "./env.js";
        export function View() {
          if (isDev()) return null;
          return { props: { mode: "view" } };
        }
      `,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    dce: true,
    run: { stdout: "view prod" },
  });

  itBundled("inline_calls/CrossModuleJSXImporter", {
    files: {
      "/entry.tsx": /* tsx */ `
        import { isDev } from "./env";
        const el = <div className={isDev() ? "DROP" : "prod"} />;
        if (isDev()) console.log("DROP");
        console.log(el.props.className);
      `,
      "/env.ts": /* ts */ `
        export function isDev(): boolean { return F; }
      `,
      "/node_modules/react/jsx-runtime.js": /* js */ `
        export const jsx = (type, props) => ({ type, props });
        export const jsxs = jsx;
        export const Fragment = "Fragment";
      `,
      "/node_modules/react/jsx-dev-runtime.js": /* js */ `
        export const jsxDEV = () => { throw new Error("the production JSX options are lost"); };
        export const Fragment = "Fragment";
      `,
    },
    env: { NODE_ENV: "production" },
    define: { ...define, "process.env.NODE_ENV": '"production"' },
    minifySyntax,
    dce: true,
    run: { stdout: "prod" },
  });

  itBundled("inline_calls/CrossModuleSameFileRetry", {
    files: {
      "/entry.js": /* js */ `
        import { isDev } from "./env";
        function local() { return T; }
        console.log(local(), isDev() ? "DROP" : "prod");
        local = () => 2;
        console.log(local());
      `,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    dce: true,
    run: { stdout: "true prod\n2" },
  });

  // The value is known before the only visit, so the error of a dead branch is never made.
  itBundled("inline_calls/CrossModuleErrorInADeadBranch", {
    files: {
      "/entry.js": /* js */ `
        import { feature } from "bun:bundle";
        import { isDev } from "./env";
        if (isDev()) console.log(feature("X") + 1);
        console.log("app");
      `,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    run: { stdout: "app" },
  });

  test("inline_calls/CrossModuleInMemoryFiles", async () => {
    const result = await Bun.build({
      entrypoints: ["/entry.js"],
      files: {
        "/entry.js": `
          import { isDev } from "./env.js";
          console.log(isDev() ? "dev" : "prod");
        `,
        "/env.js": `export function isDev() { return false; }`,
      },
      minify: { syntax: true },
    });
    expect(await result.outputs[0].text()).toContain('console.log("prod")');
  });

  // A plugin gives its answer on another thread, after the file with the condition is visited.
  itBundled("inline_calls/CrossModulePlugins", {
    backend: "api",
    files: {
      "/entry.js": /* js */ `
        import { fromLoad } from "./loaded.js";
        import { fromResolve } from "virtual:flags";
        import { viaReExport } from "./re-export.js";
        import { untouched } from "./untouched.js";
        if (fromLoad()) console.log("DROP at run time"); else console.log("load off");
        if (fromResolve()) console.log("resolve on");
        if (viaReExport()) console.log("re-export on");
        if (untouched()) console.log("DROP"); else console.log("untouched off");
      `,
      "/re-export.js": /* js */ `
        export { fromResolve as viaReExport } from "virtual:flags";
      `,
      "/loaded.js": /* js */ `
        export function fromLoad() { return T; }
      `,
      "/real-flags.js": /* js */ `
        export function fromResolve() { return T; }
      `,
      "/untouched.js": /* js */ `
        export function untouched() { return F; }
      `,
    },
    define,
    minifySyntax,
    plugins: [
      {
        name: "flags",
        setup(build) {
          build.onLoad({ filter: /loaded\.js$/ }, async () => {
            await Promise.resolve();
            return { contents: "export function fromLoad() { return F; }", loader: "js" };
          });
          build.onResolve({ filter: /^virtual:flags$/ }, args => ({
            path: join(dirname(args.importer), "real-flags.js"),
          }));
        },
      },
    ],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("fromLoad() ?");
      expect(out).toIncludeRepeated("fromResolve()", 3);
      expect(out).not.toContain("untouched");
    },
    run: { stdout: "load off\nresolve on\nre-export on\nuntouched off" },
  });

  itBundled("inline_calls/CrossModuleDeferredLoad", {
    backend: "api",
    files: {
      "/entry.js": /* js */ `
        import { deferred } from "./deferred.js";
        import { isDev } from "./env.js";
        if (deferred()) console.log("on"); else console.log("off");
        if (isDev()) console.log("DROP"); else console.log("prod");
      `,
      "/deferred.js": /* js */ `
        export function deferred() { return F; }
      `,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    minifySyntax,
    plugins: [
      {
        name: "defer",
        setup(build) {
          build.onLoad({ filter: /deferred\.js$/ }, async ({ defer }) => {
            await defer();
            return { contents: "export function deferred() { return F; }", loader: "js" };
          });
        },
      },
    ],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("deferred() ?");
      expect(out).not.toContain("isDev");
    },
    run: { stdout: "off\nprod" },
  });
});
