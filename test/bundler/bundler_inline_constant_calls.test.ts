import { describe, expect } from "bun:test";
import { dirname, join } from "node:path";
import { itBundled } from "./expectBundled";

// A call of a function that always returns one primitive folds to that value
// while the file is visited, so the branch it guards folds like a `--define`.
// Without `minifySyntax`, only a function that reads a `--define` or a
// `feature()` value folds.
const define = { T: "true", F: "false" };

describe("bundler", () => {
  for (const minifySyntax of [false, true]) {
    const suffix = minifySyntax ? "Minify" : "";

    itBundled(`inline_calls/BuildTimeValues${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          function isDev() { return process.env.NODE_ENV === "development"; }
          function hasFlag() { if (FLAG) { return true; } return false; }
          function nothing() { if (isDev()) return 1; }
          function nil() { return isDev() ? 0 : null; }
          function viaIf() { if (isDev()) return "dev"; else { return "prod"; } }
          if (isDev()) console.log("DROP dev");
          if (hasFlag()) console.log("flag"); else console.log("DROP no flag");
          if (viaIf() === "dev") console.log("DROP string");
          console.log(nothing(), nil(), isDev() ? "DROP" : "kept", !isDev());
        `,
      },
      define: { "process.env.NODE_ENV": '"production"', FLAG: "true" },
      minifySyntax,
      dce: true,
      onAfterBundle(api) {
        expect(api.readFile("/out.js")).not.toContain("function");
      },
      run: { stdout: "flag\nundefined null kept true" },
    });

    itBundled(`inline_calls/PlainConstant${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          const arrow = () => false;
          function yes() { return true; }
          function nothing() {}
          if (yes()) console.log("yes");
          console.log(nothing(), arrow() ? "on" : "off");
        `,
      },
      minifySyntax,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        for (const call of ["yes()", "nothing()", "arrow()"]) {
          if (minifySyntax) expect(out).not.toContain(call);
          else expect(out).toContain(call);
        }
      },
      run: { stdout: "yes\nundefined off" },
    });

    itBundled(`inline_calls/DeadBranchIsNeverResolved${suffix}`, {
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
    itBundled(`inline_calls/ImportSpecifierStaysOpaque${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          function name() { return NAME; }
          const fromCall = name();
          console.log(typeof name(), typeof fromCall);
          if (process.argv.length > 99) {
            require(name());
            require.resolve(name());
            import(name());
            require(fromCall);
          }
        `,
      },
      define: { NAME: '"./not-on-disk.js"' },
      minifySyntax,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("require(name())");
        expect(out).toContain("require.resolve(name())");
        expect(out).toContain("import(name())");
        expect(out).toContain("require(fromCall)");
      },
      run: { stdout: "string string" },
    });
  }

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

  itBundled("inline_calls/StringAndNumberFoldOnlyInACondition", {
    files: {
      "/entry.js": /* js */ `
        function mode() { return MODE; }
        function count() { return COUNT; }
        if (mode() === "dev") console.log("DROP");
        console.log(count() > 1 ? "many" : "DROP", mode(), count());
      `,
    },
    define: { MODE: '"prod"', COUNT: "2" },
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain('console.log("many", mode(), count())');
    },
    run: { stdout: "many prod 2" },
  });

  itBundled("inline_calls/LongStringStaysInTheFunction", {
    files: {
      "/entry.js": /* js */ `
        function long() { return LONG; }
        function short() { return SHORT; }
        if (long().length === 65) console.log("long");
        if (short().length === 64) console.log("short");
      `,
    },
    define: {
      LONG: JSON.stringify(Buffer.alloc(65, "x").toString()),
      SHORT: JSON.stringify(Buffer.alloc(64, "x").toString()),
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("long().length");
      expect(out).not.toContain("short()");
    },
    run: { stdout: "long\nshort" },
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
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("function yes()");
      expect(out).toContain("new yes");
      expect(out).toContain("yes.call(null)");
      expect(out).toContain("yes?.()");
      expect(out).toContain("console.log(true,");
    },
    run: { stdout: "true true true true true 1 function" },
  });

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
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("console.log(above())");
        expect(out).toContain("console.log(true)");
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
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("f()");
      expect(out).not.toContain("untouched");
    },
    run: { stdout: "true true true\nsecond second true" },
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
    run: { stdout: "true true true\n2 3 4" },
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
    run: { stdout: "true false true" },
  });

  // A `switch` body can be entered at any `case`, below the declaration.
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
    dce: true,
    run: { stdout: "kept" },
  });

  itBundled("inline_calls/ConstArrowInPrefix", {
    files: {
      "/entry.js": /* js */ `
        const isOn = () => F;
        const isSet = function () { return T; };
        console.log(isOn() ? "DROP" : "off", isSet());
        console.log(isLate());
        const isLate = () => T;
      `,
    },
    define,
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("isOn");
      expect(out).toContain("isLate()");
    },
    run: { error: "ReferenceError: Cannot access 'isLate' before initialization." },
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
    minifySyntax: true,
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
    minifySyntax: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("isOn()");
    },
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
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("isOff()");
      expect(out).toContain("isOn()");
    },
    run: { stdout: "no yes" },
  });

  // Across files. The result of a file whose condition calls an import is held
  // until the imported file is parsed. With a value, the file is parsed and
  // visited again with it.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`inline_calls/${backend}/CrossModule`, {
      backend,
      files: {
        "/entry.ts": /* ts */ `
          import { isDev, hasOn, hasOff, version, nothing } from "./flags";
          if (isDev()) console.log("DROP dev");
          if (hasOn()) console.log("on");
          if (hasOff()) console.log("DROP off"); else console.log("not off");
          console.log(isDev() ? "DROP" : "prod", version(), nothing());
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
      dce: true,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        for (const call of ["isDev()", "hasOn()", "hasOff()"]) expect(out).not.toContain(call);
        expect(out).toContain('console.log("prod", version(), nothing())');
      },
      run: { stdout: "flags run\non\nnot off\nprod 1.2.3 undefined" },
    });

    // Which file of a cycle is parsed first differs from run to run. The output must not.
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
          console.log("a:", bFlag() ? "b on" : "b off");
        `,
        "/b.js": /* js */ `
          import { aFlag } from "./a";
          export function bFlag() { return F; }
          console.log("b:", aFlag() ? "a on" : "a off");
        `,
        "/self.js": /* js */ `
          import { selfFlag as imported } from "./self";
          export function selfFlag() { return F; }
          console.log("self:", imported() ? "on" : "off");
        `,
      },
      define,
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("aFlag()");
        expect(out).toContain("bFlag()");
        expect(out).toContain('selfFlag() ? "on"');
      },
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
    run: { stdout: "prod" },
  });

  itBundled("inline_calls/CrossModulePlainConstant", {
    files: {
      "/entry.js": /* js */ `
        import { isOn } from "./flags.js";
        if (isOn()) console.log("on");
      `,
      "/flags.js": /* js */ `
        export function isOn() { return true; }
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("if (isOn())");
    },
    run: { stdout: "on" },
  });

  itBundled("inline_calls/CrossModulePlainConstantMinify", {
    files: {
      "/entry.js": /* js */ `
        import { isOn } from "./flags.js";
        if (isOn()) console.log("on"); else console.log("DROP");
      `,
      "/flags.js": /* js */ `
        export function isOn() { return true; }
      `,
    },
    minifySyntax: true,
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("isOn");
    },
    run: { stdout: "on" },
  });

  itBundled("inline_calls/CrossModuleReExports", {
    files: {
      "/entry.js": /* js */ `
        import { isDevelopment, viaImport } from "./barrel";
        import isDefault, { isDev as renamed } from "./env";
        if (isDevelopment()) console.log("DROP a");
        if (viaImport()) console.log("DROP b");
        if (isDefault()) console.log("DROP c");
        if (renamed()) console.log("DROP d");
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
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("isDev");
    },
    run: { stdout: "done" },
  });

  // The chain ends at the file after `hops` files that only export the import again.
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
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        if (folds) expect(out).not.toContain("isDev()");
        else expect(out).toContain("if (isDev())");
      },
      run: { stdout: "prod" },
    });
  }

  // `module.exports = require("./env.js")` alone is a redirect to the other file.
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
    dce: true,
    run: { stdout: "app prod" },
  });

  // Which records of a barrel are resolved depends on the order its importers finish.
  // A re-export of one is not followed, so the output is the same for every run.
  itBundled("inline_calls/CrossModuleOptimizedBarrel", {
    files: {
      "/entry.js": /* js */ `
        import { isDev } from "flags";
        import { isDev as direct } from "flags/env.js";
        import "./other-importer";
        if (isDev()) console.log("dev"); else console.log("prod");
        if (direct()) console.log("DROP");
      `,
      "/other-importer.js": /* js */ `
        import { isDev } from "flags";
        console.log(typeof isDev);
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
        export function unused() { return "never parsed"; }
      `,
    },
    define,
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("if (isDev())");
      expect(out).not.toContain("never parsed");
    },
    run: { stdout: "function\nprod" },
  });

  // Almost no file in a package gets a value, so a file in a package is not held for one.
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
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("if (isDev())");
    },
    run: { stdout: "prod" },
  });

  itBundled("inline_calls/CrossModuleChain", {
    files: {
      "/entry.js": /* js */ `
        import { isInternalDev } from "./b";
        if (isInternalDev()) console.log("DROP"); else console.log("kept");
      `,
      "/b.js": /* js */ `
        import { isDev } from "./a";
        export function isInternalDev() { return isDev() && INTERNAL; }
      `,
      "/a.js": /* js */ `
        export function isDev() { return !PRODUCTION; }
      `,
    },
    define: { PRODUCTION: "true", INTERNAL: "true" },
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("function");
    },
    run: { stdout: "kept" },
  });

  // \`return isDev()\` in a top-level function makes the function a wrapper of the import.
  itBundled("inline_calls/CrossModuleWrapper", {
    files: {
      "/entry.js": /* js */ `
        import { isInternal } from "./wrapper.js";
        if (isInternal()) require("./internal/does-not-exist");
        console.log("app");
      `,
      "/wrapper.js": /* js */ `
        import { isDev } from "./env.js";
        export function isInternal() { return isDev(); }
      `,
      "/env.js": /* js */ `
        export function isDev() { return F; }
      `,
    },
    define,
    run: { stdout: "app" },
  });

  itBundled("inline_calls/CrossModuleNotFolded", {
    files: {
      "/entry.js": /* js */ `
        import { arrow, reassigned, usesState, letFn, off } from "./esm";
        import { cjsFlag } from "./cjs.cjs";
        import * as ns from "./esm";
        if (arrow()) console.log("arrow");
        if (reassigned()) console.log("reassigned");
        if (usesState()) console.log("state");
        if (letFn()) console.log("let");
        if (cjsFlag()) console.log("cjs");
        if (ns.usesState()) console.log("ns");
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
      `,
      "/cjs.cjs": /* js */ `
        exports.cjsFlag = function () { return T; };
      `,
    },
    define,
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      for (const call of ["arrow()", "reassigned()", "usesState()", "letFn()", "$cjsFlag()"]) {
        expect(out).toContain("if (" + call);
      }
    },
    run: { stdout: "arrow\nreassigned\nstate\nlet\ncjs\nns\nparameter" },
  });

  itBundled("inline_calls/CrossModuleDownstreamOfCycle", {
    files: {
      "/entry.js": /* js */ `
        import { aFlag } from "./a";
        console.log("entry:", aFlag() ? "a on" : "DROP");
      `,
      "/a.js": /* js */ `
        import { bFlag } from "./b";
        import { leaf } from "./leaf";
        export function aFlag() { return T; }
        console.log("a:", bFlag() ? "b on" : "b off", leaf() ? "DROP" : "leaf off");
      `,
      "/b.js": /* js */ `
        import { aFlag } from "./a";
        export function bFlag() { return F; }
        console.log("b:", aFlag() ? "a on" : "a off");
      `,
      "/leaf.js": /* js */ `
        export function leaf() { return F; }
      `,
    },
    define,
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("bFlag()");
      expect(out).not.toContain("leaf()");
    },
    run: { stdout: "b: a on\na: b off leaf off\nentry: a on" },
  });

  itBundled("inline_calls/CrossModuleUnresolvedImport", {
    files: {
      "/entry.js": /* js */ `
        import { flag } from "./does-not-exist";
        if (flag()) console.log("x");
      `,
    },
    bundleErrors: {
      "/entry.js": ['Could not resolve: "./does-not-exist"'],
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
        export const jsxDEV = () => { throw new Error("the second run lost the production JSX options"); };
        export const Fragment = "Fragment";
      `,
    },
    env: { NODE_ENV: "production" },
    define: { ...define, "process.env.NODE_ENV": '"production"' },
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
    dce: true,
    run: { stdout: "true prod\n2" },
  });

  // An error of the first visit can be in a branch that a value makes dead.
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
    run: { stdout: "app" },
  });

  itBundled("inline_calls/CrossModulePluginCallee", {
    backend: "api",
    files: {
      "/entry.js": /* js */ `
        import { fromLoad } from "./loaded.js";
        import { fromResolve } from "virtual:flags";
        import { viaReExport } from "./re-export.js";
        if (fromLoad()) console.log("DROP load"); else console.log("load off");
        if (fromResolve()) console.log("resolve on");
        if (viaReExport()) console.log("re-export on");
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
    },
    define,
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
      expect(out).not.toContain("fromLoad()");
      expect(out).toContain("if (fromResolve())");
      expect(out).toIncludeRepeated("fromResolve()", 3);
    },
    run: { stdout: "load off\nresolve on\nre-export on" },
  });

  itBundled("inline_calls/CrossModuleDeferredCallee", {
    backend: "api",
    files: {
      "/entry.js": /* js */ `
        import { deferred } from "./deferred.js";
        if (deferred()) console.log("on"); else console.log("off");
      `,
      "/deferred.js": /* js */ `
        export function deferred() { return F; }
      `,
    },
    define,
    plugins: [
      {
        name: "defer",
        setup(build) {
          build.onLoad({ filter: /deferred\.js$/ }, async ({ defer }) => {
            // Resolves once every other file is parsed: the importer cannot wait for this one.
            await defer();
            return { contents: "export function deferred() { return F; }", loader: "js" };
          });
        },
      },
    ],
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("if (deferred())");
    },
    run: { stdout: "off" },
  });
});
