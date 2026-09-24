import { describe, expect } from "bun:test";
import { dirname, join } from "node:path";
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

  // Across files. A file whose branch condition calls an import is visited after
  // the imported file is parsed, with the value of the call already known.
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
        expect(api.readFile("/out.js")).not.toContain("function");
      },
      run: { stdout: "flags run\non\nnot off\nprod 1.2.3 undefined" },
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
        function isDev() { return false; }
        export { isDev, isDev as default };
      `,
    },
    dce: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("isDev");
    },
    run: { stdout: "done" },
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
        export function isDev() { return false; }
      `,
      "/node_modules/flags/unused.js": /* js */ `
        export function unused() { return "never parsed"; }
      `,
    },
    dce: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("if (isDev())");
      expect(out).not.toContain("never parsed");
    },
    run: { stdout: "function\nprod" },
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
        export const arrow = () => true;
        export function reassigned() { return false; }
        reassigned = () => true;
        export function usesState() { return globalThis.flag === undefined; }
        export let letFn = function () { return true; };
        export function off() { return false; }
      `,
      "/cjs.cjs": /* js */ `
        exports.cjsFlag = function () { return true; };
      `,
    },
    dce: true,
    run: { stdout: "arrow\nreassigned\nstate\nlet\ncjs\nns\nparameter" },
  });

  // Which file of a cycle is parsed first differs from run to run. The output must not.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`inline_calls/${backend}/CrossModuleImportCycle`, {
      backend,
      files: {
        "/entry.js": /* js */ `
          import "./a";
          import "./self";
        `,
        "/a.js": /* js */ `
          import { bFlag } from "./b";
          export function aFlag() { return true; }
          console.log("a:", bFlag() ? "b on" : "b off");
        `,
        "/b.js": /* js */ `
          import { aFlag } from "./a";
          export function bFlag() { return false; }
          console.log("b:", aFlag() ? "a on" : "a off");
        `,
        "/self.js": /* js */ `
          import { selfFlag as imported } from "./self";
          export function selfFlag() { return 0; }
          console.log("self:", imported() ? "on" : "off");
        `,
      },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("aFlag()");
        expect(out).toContain("bFlag()");
        expect(out).toContain('selfFlag() ? "on"');
      },
      run: { stdout: "b: a on\na: b off\nself: off" },
    });
  }

  itBundled("inline_calls/CrossModuleDownstreamOfCycle", {
    files: {
      "/entry.js": /* js */ `
        import { aFlag } from "./a";
        console.log("entry:", aFlag() ? "a on" : "DROP");
      `,
      "/a.js": /* js */ `
        import { bFlag } from "./b";
        import { leaf } from "./leaf";
        export function aFlag() { return true; }
        console.log("a:", bFlag() ? "b on" : "b off", leaf() ? "DROP" : "leaf off");
      `,
      "/b.js": /* js */ `
        import { aFlag } from "./a";
        export function bFlag() { return false; }
        console.log("b:", aFlag() ? "a on" : "a off");
      `,
      "/leaf.js": /* js */ `
        export function leaf() { return false; }
      `,
    },
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
      // An empty file finishes without an AST. The importer must not wait for one.
      "/empty.js": "\n",
    },
    target: "bun",
    bundleErrors: {
      "/entry.js": ['No matching export in "empty.js" for import "flag"'],
    },
  });

  itBundled("inline_calls/CrossModuleOtherLoaders", {
    files: {
      "/entry.js": /* js */ `
        import data from "./data.json";
        import text from "./note.txt";
        import { isDev } from "./env";
        if (typeof data === "function" && data()) console.log("DROP");
        if (typeof text === "function" && text()) console.log("DROP");
        console.log(data.name, text.trim(), isDev() ? "DROP" : "prod");
      `,
      "/data.json": `{ "name": "json" }`,
      "/note.txt": `text`,
      "/env.js": /* js */ `
        export function isDev() { return false; }
      `,
    },
    run: { stdout: "json text prod" },
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
        export function isDev() { return false; }
      `,
    },
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
        export function isDev(): boolean { return false; }
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
    define: { "process.env.NODE_ENV": '"production"' },
    dce: true,
    run: { stdout: "prod" },
  });

  itBundled("inline_calls/CrossModuleSameFileRetry", {
    files: {
      "/entry.js": /* js */ `
        import { isDev } from "./env";
        function local() { return 1; }
        console.log(local(), isDev() ? "DROP" : "prod");
        local = () => 2;
        console.log(local());
      `,
      "/env.js": /* js */ `
        export function isDev() { return false; }
      `,
    },
    dce: true,
    run: { stdout: "1 prod\n2" },
  });

  itBundled("inline_calls/CrossModulePluginCallee", {
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
        export function fromLoad() { return true; }
      `,
      "/real-flags.js": /* js */ `
        export function fromResolve() { return true; }
      `,
    },
    plugins: [
      {
        name: "flags",
        setup(build) {
          build.onLoad({ filter: /loaded\.js$/ }, async () => {
            await Bun.sleep(1);
            return { contents: "export function fromLoad() { return false; }", loader: "js" };
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
    files: {
      "/entry.js": /* js */ `
        import { deferred } from "./deferred.js";
        if (deferred()) console.log("on"); else console.log("off");
      `,
      "/deferred.js": /* js */ `
        export function deferred() { return false; }
      `,
    },
    plugins: [
      {
        name: "defer",
        setup(build) {
          build.onLoad({ filter: /deferred\.js$/ }, async ({ defer }) => {
            // Resolves once every other file is parsed: the importer cannot wait for this one.
            await defer();
            return { contents: "export function deferred() { return false; }", loader: "js" };
          });
        },
      },
    ],
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
