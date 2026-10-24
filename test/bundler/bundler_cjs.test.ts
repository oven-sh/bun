import { describe, expect } from "bun:test";
import { bunEnv } from "harness";
import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { itBundled, type BundlerTestBundleAPI } from "./expectBundled";

// Tests for CommonJS <> ESM interop, specifically the __toESM helper behavior.
//
// `__toESM(mod, isNodeMode)` builds the ESM view of a CommonJS module. The
// bundler picks `isNodeMode` from the module type of the *importing* file, the
// same way esbuild does. The syntax the importer uses does not matter.
//
// - `.mjs`, `.mts`, or a `.js`/`.ts` file under package.json `"type": "module"`:
//   isNodeMode=1. The default import is the whole `module.exports`, as in
//   Node. `__esModule` is ignored.
// - Every other importer (`.js`, `.ts`, no package.json `"type"`, or
//   `"type": "commonjs"`): isNodeMode=0. When `module.exports.__esModule` is
//   truthy and `module.exports` has its own `default` property, the default
//   import is `module.exports.default`. Otherwise it is the whole
//   `module.exports`. This matches `bun run`. esbuild matches it too, except
//   that it gives `undefined` when the `default` property is missing.
//
// A bare `require()` never goes through `__toESM`.

describe("bundler", () => {
  // ============================================================================
  // Tests with a `.js` importer and no package.json "type"
  // These use isNodeMode=0, which honors __esModule
  // ============================================================================

  // Test 1: import with __esModule marker - honored
  itBundled("cjs/__toESM_import_syntax_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { value: 'default export' };
        exports.named = 'named export';
      `,
    },
    run: {
      // The importer is a `.js` file with no package.json "type", so
      // isNodeMode=0 and the default import is `exports.default`
      stdout: '{"value":"default export"}',
    },
  });

  // Test 2: import WITHOUT __esModule marker
  itBundled("cjs/__toESM_import_syntax_without_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // Same behavior - entire module wrapped as default
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // Test 3: import with module.exports = function
  itBundled("cjs/__toESM_import_syntax_function", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(lib.name + ':' + lib());
      `,
      "/lib.cjs": /* js */ `
        module.exports = function myFunc() { return 'result'; };
      `,
    },
    run: {
      stdout: "myFunc:result",
    },
  });

  // Test 4: import with module.exports = primitive
  itBundled("cjs/__toESM_import_syntax_primitive", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(lib);
      `,
      "/lib.cjs": /* js */ `
        module.exports = 42;
      `,
    },
    run: {
      stdout: "42",
    },
  });

  // Test 5: import with named + default
  itBundled("cjs/__toESM_import_syntax_named_and_default", {
    files: {
      "/entry.js": /* js */ `
        import lib, { foo } from './lib.cjs';
        console.log(JSON.stringify({ default: lib, named: foo }));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo value';
        exports.bar = 'bar value';
      `,
    },
    run: {
      stdout: '{"default":{"foo":"foo value","bar":"bar value"},"named":"foo value"}',
    },
  });

  // Test 6: Namespace import (import *)
  itBundled("cjs/__toESM_import_syntax_namespace", {
    files: {
      "/entry.js": /* js */ `
        import * as lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // Namespace import only gets the CJS exports as-is, no default wrapper.
      // The lifted module keeps the order of its `exports.x = ...` assignments,
      // like `module.exports` would.
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // ============================================================================
  // Tests with different targets
  // Target doesn't affect isNodeMode - it's based on the importer's module type.
  // The fixture assigns `module.exports` so the module keeps its CommonJS
  // wrapper and the default import goes through __toESM.
  // ============================================================================

  // Test 7: target=node
  itBundled("cjs/__toESM_target_node", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = { x: 1, y: 2 };
      `,
    },
    target: "node",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(");
    },
    run: {
      stdout: '{"x":1,"y":2}',
    },
  });

  // Test 8: target=browser
  itBundled("cjs/__toESM_target_browser", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = { x: 1, y: 2 };
      `,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(");
    },
    run: {
      stdout: '{"x":1,"y":2}',
    },
  });

  // Test 9: target=bun
  itBundled("cjs/__toESM_target_bun", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = { x: 1, y: 2 };
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(");
    },
    run: {
      stdout: '{"x":1,"y":2}',
    },
  });

  // ============================================================================
  // Tests with different output formats
  // Output format doesn't affect isNodeMode either
  // ============================================================================

  // Test 10: format=esm
  itBundled("cjs/__toESM_format_esm", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'the default';
        exports.other = 'other';
      `,
    },
    format: "esm",
    run: {
      // __esModule honored: the `.js` importer has no package.json "type"
      stdout: '"the default"',
    },
  });

  // Test 11: format=cjs with import syntax
  itBundled("cjs/__toESM_format_cjs_with_import", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'the default';
        exports.other = 'other';
      `,
    },
    format: "cjs",
    run: {
      // Output format does not change isNodeMode either
      stdout: '"the default"',
    },
  });

  // ============================================================================
  // Tests for .mjs files re-exporting from .cjs
  // ============================================================================

  // Test 12: .mjs re-exporting default from CJS
  itBundled("cjs/__toESM_mjs_reexport", {
    files: {
      "/entry.js": /* js */ `
        import lib from './wrapper.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/wrapper.mjs": /* js */ `
        export { default } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // Test 13: .mjs re-exporting with __esModule (ignored: the importer is .mjs)
  itBundled("cjs/__toESM_mjs_reexport_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './wrapper.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/wrapper.mjs": /* js */ `
        export { default } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { value: 'from cjs' };
        exports.other = 'other';
      `,
    },
    run: {
      // The file that imports lib.cjs is wrapper.mjs, so isNodeMode=1 and the
      // entire module is the default, as in Node
      stdout: '{"__esModule":true,"default":{"value":"from cjs"},"other":"other"}',
    },
  });

  // Test 14: Deep re-export chain
  itBundled("cjs/__toESM_deep_reexport_chain", {
    files: {
      "/entry.js": /* js */ `
        import lib from './layer1.mjs';
        console.log(JSON.stringify(lib));
      `,
      "/layer1.mjs": /* js */ `
        export { default } from './layer2.mjs';
      `,
      "/layer2.mjs": /* js */ `
        export { default } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.deep = 'value';
      `,
    },
    run: {
      stdout: '{"deep":"value"}',
    },
  });

  // Test 15: Re-export with rename
  itBundled("cjs/__toESM_reexport_with_rename", {
    files: {
      "/entry.js": /* js */ `
        import { myDefault } from './wrapper.mjs';
        console.log(JSON.stringify(myDefault));
      `,
      "/wrapper.mjs": /* js */ `
        export { default as myDefault } from './lib.cjs';
      `,
      "/lib.cjs": /* js */ `
        exports.x = 1;
      `,
    },
    run: {
      stdout: '{"x":1}',
    },
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  // Test 16: CJS with a property named "default" but no __esModule
  itBundled("cjs/__toESM_default_prop_no_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.default = 'I am a prop named default';
        exports.other = 'other';
      `,
    },
    run: {
      // Entire module wrapped, including the .default property
      stdout: '{"default":"I am a prop named default","other":"other"}',
    },
  });

  // Test 17: Mixed import styles
  itBundled("cjs/__toESM_mixed_import_styles", {
    files: {
      "/entry.js": /* js */ `
        import defaultExport from './lib.cjs';
        import { foo } from './lib.cjs';
        import * as namespace from './lib.cjs';
        console.log(JSON.stringify({
          default: defaultExport,
          named: foo,
          namespace: namespace
        }));
      `,
      "/lib.cjs": /* js */ `
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // The default import is held as a value, so the module keeps its
      // CommonJS wrapper and the namespace goes through __toESM, as in Node.
      stdout:
        '{"default":{"foo":"foo","bar":"bar"},"named":"foo","namespace":{"default":{"foo":"foo","bar":"bar"},"foo":"foo","bar":"bar"}}',
    },
  });

  // Test 18: __esModule with non-true value
  itBundled("cjs/__toESM_esModule_non_true", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = 'truthy';
        exports.default = { value: 'default' };
        exports.other = 'other';
      `,
    },
    run: {
      // __toESM tests __esModule for truthiness, like esbuild
      stdout: '{"value":"default"}',
    },
  });

  // Test 19: __esModule = false
  itBundled("cjs/__toESM_esModule_false", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = false;
        exports.default = { value: 'ignored' };
        exports.foo = 'foo';
      `,
    },
    run: {
      // A falsy __esModule means the entire module is the default
      stdout: '{"__esModule":false,"default":{"value":"ignored"},"foo":"foo"}',
    },
  });

  // Test 20: module.exports with __esModule
  itBundled("cjs/__toESM_module_exports_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        module.exports = {
          __esModule: true,
          default: { value: 'nested' },
          other: 'prop'
        };
      `,
    },
    run: {
      // __esModule on a replaced module.exports is honored too
      stdout: '{"value":"nested"}',
    },
  });

  // Test 21: Input=ESM, output=CJS, importing CJS with __esModule and named imports
  // This test covers printing __toESM when output format is CJS and the input
  // uses ESM syntax to import both default and named exports from CJS with __esModule
  itBundled("cjs/__toESM_input_esm_output_cjs_wrapper_print", {
    files: {
      "/entry.js": /* js */ `
        import lib, { named } from "./lib.cjs";
        console.log(JSON.stringify({ default: lib, named }));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { value: "default" };
        exports.named = "named export";
      `,
    },
    format: "cjs",
    run: {
      // default gets `exports.default`, named gets the named property
      stdout: '{"default":{"value":"default"},"named":"named export"}',
    },
  });

  // Test 22: Star import with __esModule
  itBundled("cjs/__toESM_star_import_with_esModule", {
    files: {
      "/entry.js": /* js */ `
        import * as lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'default';
        exports.named = 'named';
      `,
    },
    run: {
      // Star import gets the exports as-is, no wrapper
      stdout: '{"__esModule":true,"default":"default","named":"named"}',
    },
  });

  // Test 23: Practical example - importing lodash-like library
  itBundled("cjs/__toESM_practical_lodash_style", {
    files: {
      "/entry.js": /* js */ `
        import _ from './lodash.cjs';
        import { map } from './lodash.cjs';
        console.log(JSON.stringify({
          hasMap: typeof _.map === 'function',
          same: _.map === map
        }));
      `,
      "/lodash.cjs": /* js */ `
        exports.map = function(arr, fn) { return arr.map(fn); };
        exports.filter = function(arr, fn) { return arr.filter(fn); };
      `,
    },
    run: {
      // Default gets entire module, named import gets specific function
      // Both reference the same function
      stdout: '{"hasMap":true,"same":true}',
    },
  });

  // ============================================================================
  // Nullish module.exports: __toESM must not pass null/undefined to
  // Object.getOwnPropertyNames or the bundle throws at import time.
  // ============================================================================

  // Test 24: module.exports = null, format=esm
  itBundled("cjs/__toESM_module_exports_null", {
    files: {
      "/entry.js": /* js */ `
        import z from "./z.cjs";
        console.log("z is", z);
      `,
      "/z.cjs": /* js */ `
        module.exports = null;
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: {
      stdout: "z is null",
    },
  });

  // Test 25: module.exports = null, format=cjs
  itBundled("cjs/__toESM_module_exports_null_format_cjs", {
    files: {
      "/entry.js": /* js */ `
        import z from "./z.cjs";
        console.log("z is", z);
      `,
      "/z.cjs": /* js */ `
        module.exports = null;
      `,
    },
    target: "node",
    format: "cjs",
    run: {
      stdout: "z is null",
    },
  });

  // Test 26: module.exports = undefined
  itBundled("cjs/__toESM_module_exports_undefined", {
    files: {
      "/entry.js": /* js */ `
        import u from "./u.cjs";
        console.log("u is", u);
      `,
      "/u.cjs": /* js */ `
        module.exports = undefined;
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: {
      stdout: "u is undefined",
    },
  });

  // ============================================================================
  // The __commonJS wrapper must be a regular function (not an arrow) so a
  // top-level `arguments` reference in a CJS body has a binding in ESM output.
  // ============================================================================

  // Test 27: top-level `arguments` inside a CJS module
  itBundled("cjs/__commonJS_top_level_arguments", {
    files: {
      "/entry.js": /* js */ `
        import tag from "./args.cjs";
        console.log(tag);
      `,
      "/args.cjs": /* js */ `
        module.exports = Object.prototype.toString.call(arguments);
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: {
      stdout: "[object Arguments]",
    },
  });

  // ============================================================================
  // A bundled file that starts with "use strict" keeps the directive as the
  // first statement of its __commonJS or __esm wrapper in cjs and iife output.
  // The directive of a chunk's own entry point is at the top of that chunk.
  //
  // node runs the node-target bundles. bun decides the mode of such a bundle as a
  // whole when it loads it: as an ES module each file is strict, and as CommonJS
  // each file is sloppy, because its parser drops a directive in a function body.
  // ============================================================================

  const strictPackage = {
    "/node_modules/ext/package.json": `{ "name": "ext", "version": "1.0.0", "main": "index.js" }`,
    "/node_modules/ext/index.js": /* js */ `
      "use strict";
      exports.self = function () { return this === undefined ? "strict" : "SLOPPY"; };
      exports.frozen = function () {
        try { Object.freeze({ x: 1 }).x = 2; return "SLOPPY: no throw"; } catch (e) { return "strict: " + e.name; }
      };
      exports.caller = function () {
        try { return "SLOPPY: " + typeof exports.caller.caller; } catch (e) { return "strict: " + e.name; }
      };
    `,
  };
  const logStrictPackage = /* js */ `
    const f = ext.self;
    console.log(f(), "|", ext.frozen(), "|", ext.caller());
  `;
  const directiveFirstIn = (wrapper: string) => new RegExp(`${wrapper}\\(function\\([^)]*\\) \\{\\s*"use strict";`);

  for (const format of ["cjs", "iife"] as const) {
    itBundled(`cjs/UseStrictInCommonJSWrapper_format_${format}`, {
      files: {
        "/entry.mjs": `import ext from "ext";` + logStrictPackage,
        ...strictPackage,
      },
      target: "node",
      format,
      onAfterBundle(api) {
        const code = api.readFile("/out.js");
        expect(code).not.toStartWith('"use strict"');
        expect(code).toMatch(directiveFirstIn("require_ext = __commonJS"));
      },
      run: { runtime: "node", stdout: "strict | strict: TypeError | strict: TypeError" },
    });
  }

  itBundled("cjs/UseStrictInCommonJSWrapper_commonjs_entry", {
    files: {
      "/entry.cjs": `const ext = require("ext");` + logStrictPackage,
      ...strictPackage,
    },
    backend: "cli",
    target: "node",
    format: "cjs",
    run: { runtime: "node", stdout: "strict | strict: TypeError | strict: TypeError" },
  });

  // Each file exports whether its own body ran in strict mode.
  const isStrict = `(function () { return this === undefined; })()`;
  const strictAndSloppyFiles = {
    "/entry.mjs": /* js */ `
      import strict from "./strict.cjs";
      import sloppy from "./sloppy.cjs";
      import { unwrapped } from "./unwrapped.mjs";
      console.log(strict, sloppy, unwrapped);
    `,
    "/strict.cjs": `"use strict";\nmodule.exports = ${isStrict};`,
    "/sloppy.cjs": `module.exports = ${isStrict};`,
    // No wrapper: the file gets no directive and runs in the mode of the chunk.
    "/unwrapped.mjs": `"use strict";\nexport const unwrapped = ${isStrict};`,
  };

  // bun runs these two. The `// @bun` pragma makes bun run the text as printed, and the bytecode is compiled from it.
  for (const bytecode of [false, true]) {
    itBundled(`cjs/UseStrictInCommonJSWrapper_target_bun${bytecode ? "_bytecode" : ""}`, {
      files: strictAndSloppyFiles,
      target: "bun",
      format: "cjs",
      bytecode,
      outdir: "/out",
      outputPaths: ["/out/entry.js"],
      onAfterBundle(api) {
        const code = api.readFile("/out/entry.js");
        expect(code).toStartWith("// @bun ");
        expect(code).toMatch(directiveFirstIn("require_strict = __commonJS"));
        expect(code.split('"use strict"')).toHaveLength(2);
      },
      run: { stdout: "true false false" },
    });
  }

  itBundled("cjs/UseStrictInCommonJSWrapper_minify", {
    files: strictAndSloppyFiles,
    target: "node",
    format: "cjs",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toMatch(/\(function\([^)]*\)\{"use strict";/);
      expect(code.split('"use strict"')).toHaveLength(2);
    },
    run: { runtime: "node", stdout: "true false false" },
  });

  // ESM output is strict everywhere, so the directive is not printed.
  itBundled("cjs/UseStrictInCommonJSWrapper_format_esm", {
    files: strictAndSloppyFiles,
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      api.expectFile("/out.mjs").not.toContain("use strict");
    },
    run: { stdout: "true true true" },
  });

  // The linker inserts the init_*() calls of wrapped imports at the start of the wrapper body.
  // A directive after them is a plain string statement.
  const wrappedDependency = {
    "/dep.mjs": /* js */ `
      console.log("dep");
      export const dep = 1;
    `,
  };
  itBundled("cjs/UseStrictBeforeInitCallsInCommonJSWrapper", {
    files: {
      "/entry.js": /* js */ `
        const mixed = require("./mixed.js");
        console.log(mixed.strict, mixed.dep);
      `,
      "/mixed.js": /* js */ `
        "use strict";
        import { dep } from "./dep.mjs";
        module.exports = { strict: ${isStrict}, dep };
      `,
      ...wrappedDependency,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api
        .expectFile("/out.js")
        .toMatch(/require_mixed = __commonJS\(function\([^)]*\) \{\s*"use strict";\s*init_dep\(\);/);
    },
    run: { runtime: "node", stdout: "dep\ntrue 1" },
  });
  itBundled("cjs/UseStrictBeforeInitCallsInEsmWrapper", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("./lib.mjs");
        console.log(lib.strict, lib.dep);
      `,
      "/lib.mjs": /* js */ `
        "use strict";
        import { dep } from "./dep.mjs";
        export const strict = ${isStrict};
        export { dep };
      `,
      ...wrappedDependency,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatch(/init_lib = __esm\(\(\) => \{\s*"use strict";\s*init_dep\(\);/);
    },
    run: { runtime: "node", stdout: "dep\ntrue 1" },
  });

  // Every statement of this ES module is hoisted out of the __esm closure, so the
  // parser made no wrapper symbol for it. No closure is printed for the directive.
  itBundled("cjs/UseStrictEsmFileWithoutWrapperSymbol", {
    files: {
      "/entry.cjs": /* js */ `
        const lib = require("./lib.mjs");
        console.log(lib.one());
      `,
      "/lib.mjs": /* js */ `
        "use strict";
        export function one() { return 1; }
      `,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("use strict");
      expect(code).not.toContain("__esm(");
    },
    run: { runtime: "node", stdout: "1" },
  });

  // The import statement gives this ES module a wrapper symbol, and each of its
  // statements is hoisted. The closure holds the directive alone, as in esbuild.
  itBundled("cjs/UseStrictAloneInEsmWrapper", {
    files: {
      "/entry.cjs": /* js */ `
        const lib = require("./lib.mjs");
        console.log(lib.one());
      `,
      "/lib.mjs": /* js */ `
        "use strict";
        import "./other.mjs";
        export function one() { return 1; }
      `,
      "/other.mjs": `export const other = 2;`,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatch(/var init_lib = __esm\(\(\) => \{\s*"use strict";\s*\}\);/);
    },
    run: { runtime: "node", stdout: "1" },
  });

  // b.cjs is an entry point and a wrapped dependency of a.cjs. In a.js its directive
  // is inside its wrapper. In its own chunk the directive is at the top.
  itBundled("cjs/UseStrictEntryPointRequiredByOtherEntryPoint", {
    files: {
      "/a.cjs": /* js */ `
        const b = require("./b.cjs");
        console.log("a", ${isStrict}, "b", b);
      `,
      "/b.cjs": `"use strict";\nmodule.exports = ${isStrict};`,
    },
    entryPoints: ["/a.cjs", "/b.cjs"],
    outdir: "/out",
    outputPaths: ["/out/a.js", "/out/b.js"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      const a = api.readFile("/out/a.js");
      expect(a).not.toStartWith('"use strict"');
      expect(a).toMatch(directiveFirstIn("require_b = __commonJS"));
      const b = api.readFile("/out/b.js");
      expect(b).toStartWith('"use strict";\n');
      expect(b.split('"use strict"')).toHaveLength(2);
    },
    run: { file: "/out/a.js", runtime: "node", stdout: "a false b true" },
  });

  // dep.cjs requires the entry point back, so the entry point is wrapped too. Its
  // directive is printed once, at the top of the chunk, and not inside its wrapper.
  itBundled("cjs/UseStrictOfWrappedEntryPointStaysAtChunkTop", {
    files: {
      "/entry.cjs": /* js */ `
        "use strict";
        exports.entry = ${isStrict};
        exports.dep = require("./dep.cjs").dep;
        console.log(exports.entry, exports.dep);
      `,
      "/dep.cjs": /* js */ `
        "use strict";
        require("./entry.cjs");
        exports.dep = ${isStrict};
      `,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toStartWith('"use strict";\n');
      expect(code).toMatch(directiveFirstIn("require_dep = __commonJS"));
      expect(code).not.toMatch(directiveFirstIn("require_entry = __commonJS"));
      expect(code.split('"use strict"')).toHaveLength(3);
    },
    run: { runtime: "node", stdout: "true true" },
  });

  // The mode of each kind of file that starts with "use strict", in one bundle.
  // The entry point, a file with no wrapper, and a function that is hoisted out
  // of an __esm closure run in the mode of the chunk, as in esbuild.
  const strictEsm = `"use strict";\nexport const top = ${isStrict};\nexport function fn() { return this === undefined; }`;
  const modeTableFiles = {
    "/entry.mjs": /* js */ `
      import cjsImported from "./cjs-imported.cjs";
      import cjsNoDirective from "./cjs-no-directive.cjs";
      import * as esmImported from "./esm-imported.mjs";
      import "./script-imported.js";
      const cjsRequired = require("./cjs-required.cjs");
      const esmRequired = require("./esm-required.mjs");
      require("./script-required.js");
      const call = f => f();
      const rows = {
        "entry": ${isStrict},
        "import cjs": cjsImported.top,
        "import cjs, no directive": cjsNoDirective.top,
        "import esm": esmImported.top,
        "import esm, function": call(esmImported.fn),
        "import script": globalThis.scriptImported,
        "require cjs": cjsRequired.top,
        "require esm": esmRequired.top,
        "require esm, function": call(esmRequired.fn),
        "require script": globalThis.scriptRequired,
        "require script, function": globalThis.scriptRequiredFn,
      };
      for (const row in rows) console.log(row + ": " + (rows[row] ? "strict" : "sloppy"));
    `,
    "/cjs-imported.cjs": `"use strict";\nexports.top = ${isStrict};`,
    "/cjs-no-directive.cjs": `exports.top = ${isStrict};`,
    "/cjs-required.cjs": `"use strict";\nexports.top = ${isStrict};`,
    "/esm-imported.mjs": strictEsm,
    "/esm-required.mjs": strictEsm,
    "/script-imported.js": `"use strict";\nglobalThis.scriptImported = ${isStrict};`,
    "/script-required.js": `"use strict";\nfunction fn() { return this === undefined; }\nglobalThis.scriptRequired = ${isStrict};\nglobalThis.scriptRequiredFn = fn();`,
  };
  const modeTable = [
    "entry: sloppy",
    "import cjs: strict",
    "import cjs, no directive: sloppy",
    "import esm: sloppy",
    "import esm, function: sloppy",
    "import script: sloppy",
    "require cjs: strict",
    "require esm: strict",
    "require esm, function: sloppy",
    "require script: strict",
    "require script, function: strict",
  ].join("\n");
  for (const format of ["cjs", "iife"] as const) {
    itBundled(`cjs/UseStrictModeTable_format_${format}`, {
      files: modeTableFiles,
      target: "node",
      format,
      run: { runtime: "node", stdout: modeTable },
    });
  }

  // ============================================================================
  // A file that starts with "use strict" and has no module syntax is a script.
  // The parser leaves its kind undecided and the linker decides from how the
  // file is loaded. require(), import() without code splitting, and a default
  // or star import make it CommonJS, as in node and esbuild. Any other such
  // file stays an ES module.
  // ============================================================================
  const strictScript = /* js */ `
    "use strict";
    function named() { return this === undefined; }
    globalThis.scriptRuns = (globalThis.scriptRuns ?? 0) + 1;
    globalThis.scriptRow = [${isStrict}, named()].join(",");
  `;
  const requiresScript = {
    "/entry.mjs": /* js */ `
      const script = require("./script.js");
      console.log(globalThis.scriptRow, script.__esModule, JSON.stringify(script));
    `,
    "/script.js": strictScript,
  };

  for (const format of ["cjs", "iife", "esm"] as const) {
    const outfile = format === "esm" ? "/out.mjs" : "/out.js";
    itBundled(`cjs/UseStrictScriptRequired_format_${format}`, {
      files: requiresScript,
      target: "node",
      format,
      outfile,
      onAfterBundle(api) {
        const code = api.readFile(outfile);
        expect(code).toContain("var require_script = __commonJS(");
        expect(code).not.toContain("__esm(");
      },
      run: { runtime: "node", stdout: "true,true undefined {}" },
    });
  }

  itBundled("cjs/UseStrictScriptRequired_commonjs_entry", {
    files: {
      "/entry.cjs": /* js */ `
        require("./script.js");
        console.log("script body,named", globalThis.scriptRow);
      `,
      "/script.js": strictScript,
    },
    backend: "cli",
    target: "node",
    format: "cjs",
    run: { runtime: "node", stdout: "script body,named true,true" },
  });

  // The script is an entry point and a dependency of the other entry point.
  // It is CommonJS in both chunks, and its own chunk still runs it.
  for (const format of ["cjs", "esm"] as const) {
    const extension = format === "esm" ? "mjs" : "js";
    itBundled(`cjs/UseStrictScriptEntryPointRequiredByOtherEntryPoint_format_${format}`, {
      files: {
        "/other.cjs": /* js */ `
          const script = require("./script.js");
          console.log("other", globalThis.scriptRow, script.__esModule);
        `,
        "/script.js": strictScript + `console.log("script", globalThis.scriptRow);`,
      },
      entryPoints: ["/other.cjs", "/script.js"],
      outdir: "/out",
      entryNaming: `[name].${extension}`,
      outputPaths: [`/out/other.${extension}`, `/out/script.${extension}`],
      target: "node",
      format,
      onAfterBundle(api) {
        const code = api.readFile(`/out/other.${extension}`);
        expect(code).toContain("var require_script = __commonJS(");
        expect(code).not.toContain("__esm(");
      },
      run: [
        { file: `/out/other.${extension}`, runtime: "node", stdout: "script true,true\nother true,true undefined" },
        { file: `/out/script.${extension}`, runtime: "node", stdout: "script true,true" },
      ],
    });
  }

  // bun runs these two. The `// @bun` pragma makes bun run the text as printed.
  for (const bytecode of [false, true]) {
    itBundled(`cjs/UseStrictScriptRequired_target_bun${bytecode ? "_bytecode" : ""}`, {
      files: requiresScript,
      target: "bun",
      format: "cjs",
      bytecode,
      outdir: "/out",
      outputPaths: ["/out/entry.js"],
      run: { stdout: "true,true undefined {}" },
    });
  }

  // With --splitting for bun, require() of an ES module loads a chunk of its own.
  // The script is CommonJS for a require(), so it stays in the chunk of its importer.
  itBundled("cjs/UseStrictScriptRequired_splitting_target_bun", {
    files: requiresScript,
    target: "bun",
    format: "esm",
    splitting: true,
    outdir: "/out",
    outputPaths: ["/out/entry.js"],
    onAfterBundle(api) {
      expect(readdirSync(api.outdir)).toEqual(["entry.js"]);
      expect(api.readFile("/out/entry.js")).not.toContain("import.meta.require");
    },
    run: { file: "/out/entry.js", stdout: "true,true undefined {}" },
  });

  // Each statement of this script can be hoisted, so the parser made no wrapper
  // symbol for it. The linker makes the symbol when it makes the file CommonJS.
  for (const minify of [false, true]) {
    itBundled(`cjs/UseStrictScriptRequired_declarations_only${minify ? "_minify" : ""}`, {
      files: {
        "/entry.cjs": /* js */ `
          const declarations = require("./declarations.js");
          console.log(declarations.__esModule, JSON.stringify(declarations));
        `,
        "/declarations.js": `"use strict";\nfunction unused() {}\nvar alsoUnused;`,
      },
      target: "node",
      format: "cjs",
      minifyWhitespace: minify,
      minifySyntax: minify,
      minifyIdentifiers: minify,
      onAfterBundle(api) {
        const code = api.readFile("/out.js");
        if (!minify) expect(code).toContain("var require_declarations = __commonJS(");
        expect(code).not.toContain("__INVALID__REF__");
      },
      run: { runtime: "node", stdout: "undefined {}" },
    });
  }

  itBundled("cjs/UseStrictScriptRequired_typescript", {
    files: {
      "/entry.mjs": /* js */ `
        const script = require("./script.ts");
        console.log(globalThis.scriptRow, script.__esModule, JSON.stringify(script));
      `,
      "/script.ts": /* ts */ `
        "use strict";
        function named(this: unknown): boolean { return this === undefined; }
        (globalThis as any).scriptRow = [${isStrict}, named()].join(",");
      `,
    },
    target: "node",
    format: "cjs",
    run: { runtime: "node", stdout: "true,true undefined {}" },
  });

  // Without code splitting, import() is a require() that returns a promise.
  for (const format of ["cjs", "iife", "esm"] as const) {
    itBundled(`cjs/UseStrictScriptDynamicImport_format_${format}`, {
      files: {
        "/entry.mjs": /* js */ `
          import("./script.js").then(ns => {
            console.log(globalThis.scriptRow, Object.keys(ns).join(","), JSON.stringify(ns.default));
          });
        `,
        "/script.js": strictScript,
      },
      target: "node",
      format,
      outfile: format === "esm" ? "/out.mjs" : "/out.js",
      run: { runtime: "node", stdout: "true,true default {}" },
    });
  }

  // With code splitting the script is the entry point of its own chunk.
  itBundled("cjs/UseStrictScriptDynamicImport_splitting", {
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("./script.js");
        console.log(globalThis.scriptRuns, Object.keys(ns).length);
      `,
      "/script.js": strictScript,
    },
    target: "node",
    format: "esm",
    splitting: true,
    outdir: "/out",
    outputPaths: ["/out/entry.js"],
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir);
      expect(chunks).toHaveLength(2);
      for (const chunk of chunks) expect(api.readFile("/out/" + chunk)).not.toContain("__commonJS");
    },
    run: { file: "/out/entry.js", stdout: "1 0" },
  });

  for (const format of ["cjs", "iife", "esm"] as const) {
    itBundled(`cjs/UseStrictScriptDefaultAndStarImport_format_${format}`, {
      files: {
        "/entry.mjs": /* js */ `
          import byDefault from "./default.js";
          import * as byStar from "./star.js";
          import both, * as bothStar from "./both.js";
          console.log(JSON.stringify([byDefault, Object.keys(byStar), byStar.default, both, Object.keys(bothStar)]));
          console.log(globalThis.scriptsRan.join(","));
        `,
        "/default.js": `"use strict";\n(globalThis.scriptsRan ??= []).push("default");`,
        "/star.js": `"use strict";\n(globalThis.scriptsRan ??= []).push("star");`,
        "/both.js": `"use strict";\n(globalThis.scriptsRan ??= []).push("both");`,
      },
      target: "node",
      format,
      outfile: format === "esm" ? "/out.mjs" : "/out.js",
      run: { runtime: "node", stdout: `[{},["default"],{},{},["default"]]\ndefault,star,both` },
    });
  }

  // One importer needs no wrapper and the other one does. The script is CommonJS
  // for both, in either order, and runs once.
  for (const [order, first, second] of [
    ["import_first", "./imports.mjs", "./requires.cjs"],
    ["require_first", "./requires.cjs", "./imports.mjs"],
  ] as const) {
    itBundled(`cjs/UseStrictScriptImportedAndRequired_${order}`, {
      files: {
        "/entry.mjs": /* js */ `
          import "${first}";
          import "${second}";
          console.log(globalThis.scriptRuns, globalThis.scriptRow);
        `,
        "/imports.mjs": `import "./script.js";`,
        "/requires.cjs": `require("./script.js");`,
        "/script.js": strictScript,
      },
      target: "node",
      format: "cjs",
      onAfterBundle(api) {
        expect(api.readFile("/out.js").split("scriptRuns = ")).toHaveLength(2);
      },
      run: { runtime: "node", stdout: "1 true,true" },
    });
  }

  // These loads need no CommonJS module, so the script stays an ES module with
  // no wrapper. It runs in the mode of the chunk.
  for (const format of ["cjs", "iife", "esm"] as const) {
    const outfile = format === "esm" ? "/out.mjs" : "/out.js";
    itBundled(`cjs/UseStrictScriptSideEffectImportHasNoWrapper_format_${format}`, {
      files: {
        "/entry.mjs": /* js */ `
          import "./script.js";
          export * from "./reexported.js";
          console.log(globalThis.scriptRuns, globalThis.reexported);
        `,
        "/script.js": strictScript,
        "/reexported.js": `"use strict";\nglobalThis.reexported = "ran";`,
      },
      target: "node",
      format,
      outfile,
      onAfterBundle(api) {
        const code = api.readFile(outfile);
        expect(code).not.toContain("__commonJS");
        expect(code).not.toContain("__esm(");
      },
      run: { runtime: "node", stdout: "1 ran" },
    });

    itBundled(`cjs/UseStrictScriptEntryPointHasNoWrapper_format_${format}`, {
      files: {
        "/entry.js": strictScript + `console.log(globalThis.scriptRow);`,
      },
      target: "node",
      format,
      outfile,
      onAfterBundle(api) {
        const code = api.readFile(outfile);
        expect(code).not.toContain("__commonJS");
        expect(code.startsWith('"use strict";')).toBe(format !== "esm");
      },
      run: { runtime: "node", stdout: "true,true" },
    });
  }

  // The script has no exports in either kind, so a named import is an error.
  itBundled("cjs/UseStrictScriptNamedImportIsAnError", {
    files: {
      "/entry.mjs": /* js */ `
        import { missing } from "./script.js";
        console.log(missing);
      `,
      "/script.js": strictScript,
    },
    target: "node",
    format: "cjs",
    bundleErrors: {
      "/entry.mjs": [`No matching export in "script.js" for import "missing"`],
    },
  });
  for (const format of ["cjs", "iife", "esm"] as const) {
    itBundled(`cjs/UseStrictScriptNamedImportIsAnError_required_format_${format}`, {
      files: {
        "/entry.mjs": /* js */ `
          import { missing } from "./script.js";
          import "./requires.cjs";
          console.log(missing);
        `,
        "/requires.cjs": `require("./script.js");`,
        "/script.js": strictScript,
      },
      target: "node",
      format,
      bundleErrors: {
        "/entry.mjs": [`No matching export in "script.js" for import "missing"`],
      },
    });
  }
  itBundled("cjs/UseStrictScriptStarImportOfMissingNameWarns", {
    files: {
      "/entry.mjs": /* js */ `
        import * as ns from "./script.js";
        console.log(ns.missing, Object.keys(ns).join(","));
      `,
      "/script.js": strictScript,
    },
    target: "node",
    format: "cjs",
    bundleWarnings: {
      "/entry.mjs": [`Import "missing" will always be undefined because there is no matching export in "script.js"`],
    },
    run: { runtime: "node", stdout: "undefined default" },
  });

  // export * from a CommonJS file copies its exports at run time, as in esbuild.
  // The names of the barrel are then not all known, and a missing one is undefined.
  itBundled("cjs/UseStrictScriptBehindExportStar", {
    files: {
      "/entry.mjs": /* js */ `
        import { own, missing } from "./barrel.mjs";
        import "./requires.cjs";
        console.log(own, missing, globalThis.scriptRuns);
      `,
      "/barrel.mjs": `export * from "./script.js";\nexport const own = "own";`,
      "/requires.cjs": `require("./script.js");`,
      "/script.js": strictScript,
    },
    target: "node",
    format: "cjs",
    run: { runtime: "node", stdout: "own undefined 1" },
  });

  // The first require() of a script that throws gets the error. What a later
  // require() of it gets is the contract of the __commonJS helper, not of this file.
  for (const format of ["cjs", "iife"] as const) {
    itBundled(`cjs/UseStrictScriptThatThrows_format_${format}`, {
      files: {
        "/entry.mjs": /* js */ `
          try {
            require("./throws.js");
          } catch (e) {
            console.log("threw:" + e.message, globalThis.loads);
          }
        `,
        "/throws.js": `"use strict";\nglobalThis.loads = (globalThis.loads ?? 0) + 1;\nthrow new Error("boom");`,
      },
      target: "node",
      format,
      onAfterBundle(api) {
        api.expectFile("/out.js").toContain("var require_throws = __commonJS(");
      },
      run: { runtime: "node", stdout: "threw:boom 1" },
    });
  }

  // The directive is what makes the kind undecided. These scripts have none, so
  // the bundler still makes them ES modules, where bun run, node and esbuild
  // make the one that reads __dirname CommonJS.
  itBundled("cjs/ScriptWithoutUseStrictIsEsModule", {
    files: {
      "/entry.mjs": /* js */ `
        const plain = require("./plain.js");
        const dirname = require("./dirname.js");
        const strictDirname = require("./strict-dirname.js");
        console.log(plain.__esModule, dirname.__esModule, strictDirname.__esModule);
      `,
      "/plain.js": `globalThis.plain = true;`,
      "/dirname.js": `globalThis.dirname = typeof __dirname;`,
      "/strict-dirname.js": `"use strict";\nglobalThis.strictDirname = typeof __dirname;`,
    },
    target: "node",
    format: "cjs",
    run: { runtime: "node", stdout: "true true undefined" },
  });

  // import.meta is module syntax, so this file is an ES module for every importer.
  itBundled("cjs/UseStrictScriptWithImportMetaIsEsModule", {
    files: {
      "/entry.mjs": /* js */ `
        const meta = require("./meta.js");
        console.log(globalThis.metaUrl, meta.__esModule);
      `,
      "/meta.js": `"use strict";\nglobalThis.metaUrl = typeof import.meta.url;`,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      const code = api.readFile("/out.mjs");
      expect(code).toContain("var init_meta = __esm(");
      expect(code).not.toContain("__commonJS");
    },
    run: { runtime: "node", stdout: "string true" },
  });

  // In esm and iife output, a file of a package that the bundler converts from
  // CommonJS to an ES module stays converted.
  itBundled("cjs/UseStrictScriptOfConvertedPackageIsEsModule", {
    files: {
      "/entry.mjs": /* js */ `
        let react;
        try {
          react = require("react");
        } catch {}
        console.log(globalThis.reactLoaded, react.__esModule);
      `,
      "/node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "main": "index.js" }`,
      "/node_modules/react/index.js": `"use strict";\nglobalThis.reactLoaded = true;`,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      const code = api.readFile("/out.mjs");
      expect(code).toContain("var init_react = __esm(");
      expect(code).not.toContain("__commonJS");
    },
    run: { runtime: "node", stdout: "true true" },
  });

  // The dev server takes the kind of a file from the parser, so there the
  // script is an ES module: a tuple, where a CommonJS module is a function.
  itBundled("cjs/UseStrictScriptInDevServerFormatIsEsModule", {
    files: requiresScript,
    format: "internal_bake_dev",
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain('"script.js": [ [], [], [], (');
      expect(code).not.toContain('"script.js"(hmr, module, exports)');
    },
  });

  // The metafile has the kind that the linker decided.
  itBundled("cjs/UseStrictScriptMetafileFormat", {
    files: {
      "/entry.mjs": /* js */ `
        import "./imported.js";
        require("./required.js");
      `,
      "/imported.js": `"use strict";\nglobalThis.imported = true;`,
      "/required.js": `"use strict";\nglobalThis.required = true;`,
    },
    target: "node",
    format: "cjs",
    metafile: true,
    onAfterBundle(api) {
      const inputs: Record<string, { format?: string }> = JSON.parse(api.readFile("/metafile.json")).inputs;
      const formats = Object.entries(inputs).map(([path, input]) => [basename(path), input.format]);
      expect(Object.fromEntries(formats)).toEqual({
        "entry.mjs": "esm",
        "imported.js": "esm",
        "required.js": "cjs",
      });
    },
  });

  // The script is an entry point and another entry point imports its default.
  // It is CommonJS in both chunks, and its own chunk still runs it.
  const defaultImportedByOtherEntryPoint = {
    "/other.mjs": /* js */ `
      import script from "./script.js";
      console.log("other", JSON.stringify(script));
    `,
    "/script.js": strictScript + `console.log("script", globalThis.scriptRow);`,
  };
  for (const format of ["cjs", "esm"] as const) {
    const extension = format === "esm" ? "mjs" : "js";
    itBundled(`cjs/UseStrictScriptEntryPointDefaultImportedByOtherEntryPoint_format_${format}`, {
      files: defaultImportedByOtherEntryPoint,
      entryPoints: ["/other.mjs", "/script.js"],
      outdir: "/out",
      entryNaming: `[name].${extension}`,
      outputPaths: [`/out/other.${extension}`, `/out/script.${extension}`],
      target: "node",
      format,
      run: [
        { file: `/out/other.${extension}`, runtime: "node", stdout: "script true,true\nother {}" },
        { file: `/out/script.${extension}`, runtime: "node", stdout: "script true,true" },
      ],
    });
  }

  // Nothing calls the wrapper of an iife entry point (#37843), so a star or
  // default import leaves that script an ES module. Its own chunk still runs it,
  // and a default import of it is still an error.
  itBundled("cjs/UseStrictScriptIifeEntryPointWithStarImport", {
    files: {
      "/script.js": strictScript + `console.log("script", globalThis.scriptRuns);`,
      "/other.mjs": /* js */ `
        import * as ns from "./script.js";
        console.log("other", typeof ns);
      `,
    },
    entryPoints: ["/script.js", "/other.mjs"],
    outdir: "/out",
    outputPaths: ["/out/script.js", "/out/other.js"],
    target: "node",
    format: "iife",
    run: [
      { file: "/out/script.js", runtime: "node", stdout: "script 1" },
      { file: "/out/other.js", runtime: "node", stdout: "script 1\nother object" },
    ],
  });
  itBundled("cjs/UseStrictScriptIifeEntryPointWithDefaultImport", {
    files: defaultImportedByOtherEntryPoint,
    entryPoints: ["/other.mjs", "/script.js"],
    outdir: "/out",
    target: "node",
    format: "iife",
    bundleErrors: {
      "/other.mjs": [`No matching export in "script.js" for import "default"`],
    },
  });

  // An HTML file calls no wrapper either (#42026). A script that the page loads
  // with <script src> still runs at its tag when a module script star-imports it,
  // and a default import of it is still an error.
  const page = (...scripts: string[]) => `
<!DOCTYPE html>
<html>
  <head>
    ${scripts.join("\n    ")}
  </head>
</html>`;
  // Runs the script chunk of the page with node, as a module.
  async function runPageScript(api: BundlerTestBundleAPI) {
    const script = api.readFile("/out/index.html").match(/src="(.*\.js)"/);
    await using node = Bun.spawn({
      cmd: ["node", "--input-type=module"],
      env: bunEnv,
      stdin: Bun.file(api.join("out/" + script![1])),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([node.stdout.text(), node.stderr.text(), node.exited]);
    return { stdout, stderr, exitCode };
  }
  itBundled("cjs/UseStrictScriptOfHtmlFileWithStarImport", {
    files: {
      "/index.html": page(
        `<script src="./first.js"></script>`,
        `<script src="./second.js"></script>`,
        `<script type="module" src="./third.js"></script>`,
      ),
      "/first.js": `"use strict";\nconsole.log("first");`,
      "/second.js": `console.log("second");`,
      "/third.js": `import * as first from "./first.js";\nconsole.log("third", typeof first);`,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    async onAfterBundle(api) {
      expect(await runPageScript(api)).toEqual({ stdout: "first\nsecond\nthird object\n", stderr: "", exitCode: 0 });
    },
  });
  itBundled("cjs/UseStrictScriptOfHtmlFileWithDefaultImport", {
    files: {
      "/index.html": page(`<script src="./first.js"></script>`, `<script type="module" src="./second.js"></script>`),
      "/first.js": `"use strict";\nconsole.log("first");`,
      "/second.js": `import first from "./first.js";\nconsole.log("second", first);`,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    bundleErrors: {
      "/second.js": [`No matching export in "first.js" for import "default"`],
    },
  });
  // The page does not load this script itself, so its importer makes it CommonJS.
  itBundled("cjs/UseStrictScriptImportedByScriptOfHtmlFile", {
    files: {
      "/index.html": page(`<script type="module" src="./module.js"></script>`),
      "/module.js": /* js */ `
        import script, * as ns from "./script.js";
        console.log(globalThis.scriptRow, JSON.stringify(script), Object.keys(ns).join(","));
      `,
      "/script.js": strictScript,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    async onAfterBundle(api) {
      expect(await runPageScript(api)).toEqual({ stdout: "true,true {} default\n", stderr: "", exitCode: 0 });
    },
  });

  // Test 28: export * from an external package whose module.exports is null.
  // CJS output emits __reExport(exports, require("ext"), module.exports) with
  // the raw require() result, so __reExport itself must tolerate null.
  itBundled("cjs/__reExport_external_null_module_exports", {
    files: {
      "/entry.js": /* js */ `
        export * from "ext";
        console.log("loaded ok");
      `,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": /* js */ `module.exports = null;`,
    },
    external: ["ext"],
    target: "node",
    format: "cjs",
    run: {
      stdout: "loaded ok",
    },
  });

  // ============================================================================
  // isNodeMode follows the importer's module type: the file extension first,
  // then the nearest package.json "type". One test per importer kind.
  //
  // `dep.cjs` sets the marker with Object.defineProperty, the way TypeScript
  // and Babel emit it. `typeof d` tells the two interops apart: "function" is
  // `exports.default`, "object" is the whole `module.exports`.
  // ============================================================================

  const esModuleDep = /* js */ `
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.named = 1;
    exports.default = function theDefault() {};
  `;
  const logDefaultAndNamed = /* js */ `
    import d, { named } from "./dep.cjs";
    console.log(typeof d, named);
  `;

  // Test 29: a `.ts` importer gets `exports.default`, the same as `bun run`
  itBundled("cjs/__toESM_ts_importer_honors_esModule", {
    files: {
      "/entry.ts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep())");
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 30: a `.mjs` importer gets the whole `module.exports`, as in Node
  itBundled("cjs/__toESM_mjs_importer_node_mode", {
    files: {
      "/entry.mjs": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep(), 1)");
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 31: `.mts` behaves like `.mjs`
  itBundled("cjs/__toESM_mts_importer_node_mode", {
    files: {
      "/entry.mts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 32: package.json "type": "module" makes a `.ts` importer ESM.
  itBundled("cjs/__toESM_type_module_importer_node_mode", {
    files: {
      "/entry.ts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "name": "app", "type": "module" }`,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 33: package.json "type": "commonjs" keeps the `__esModule` interop
  itBundled("cjs/__toESM_type_commonjs_importer_honors_esModule", {
    files: {
      "/entry.js": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "name": "app", "type": "commonjs" }`,
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 34: the `.mjs` extension wins over package.json "type": "commonjs"
  itBundled("cjs/__toESM_mjs_importer_overrides_type_commonjs", {
    files: {
      "/entry.mjs": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "name": "app", "type": "commonjs" }`,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 35: the rule applies per file. A `.ts` entry and a `.mjs` file that
  // import the same CJS module each see their own interop.
  itBundled("cjs/__toESM_per_importer_module_type", {
    files: {
      "/entry.ts": /* ts */ `
        import d from "./dep.cjs";
        import { fromMjs } from "./other.mjs";
        console.log(typeof d, typeof fromMjs);
      `,
      "/other.mjs": /* js */ `
        import d from "./dep.cjs";
        export const fromMjs = d;
      `,
      "/dep.cjs": esModuleDep,
    },
    run: {
      stdout: "function object",
    },
  });

  const dynamicImportLog = /* js */ `
    const m = await import("./dep.cjs");
    console.log(typeof m.default, m.named);
  `;

  // Test 36: dynamic import of a bundled CJS module, `.ts` importer
  itBundled("cjs/__toESM_dynamic_import_ts_importer", {
    files: {
      "/entry.ts": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep())");
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 37: dynamic import of a bundled CJS module, `.mjs` importer
  itBundled("cjs/__toESM_dynamic_import_mjs_importer", {
    files: {
      "/entry.mjs": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_dep(), 1)");
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 38: with splitting, the CJS module lands in its own chunk and the
  // importer unwraps it with `.then((m) => __toESM(m.default))`
  itBundled("cjs/__toESM_splitting_dynamic_import_ts_importer", {
    files: {
      "/entry.ts": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__toESM(m.default))");
    },
    run: {
      file: "/out/entry.js",
      stdout: "function 1",
    },
  });

  // Test 39: the same with a `.mjs` importer
  itBundled("cjs/__toESM_splitting_dynamic_import_mjs_importer", {
    files: {
      "/entry.mjs": dynamicImportLog,
      "/dep.cjs": esModuleDep,
    },
    splitting: true,
    outdir: "/out",
    outputPaths: ["/out/entry.js"],
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__toESM(m.default,1))");
    },
    run: {
      file: "/out/entry.js",
      stdout: "object 1",
    },
  });

  const externalImportLog = /* js */ `
    import d, { named } from "ext";
    console.log(typeof d, named);
  `;
  const externalRuntimeFiles = {
    "/node_modules/ext/package.json": `{ "name": "ext", "main": "index.js" }`,
    "/node_modules/ext/index.js": esModuleDep,
  };

  // Test 40: an external CJS dependency in CJS output, `.ts` importer
  itBundled("cjs/__toESM_external_require_ts_importer", {
    files: {
      "/entry.ts": externalImportLog,
    },
    runtimeFiles: externalRuntimeFiles,
    external: ["ext"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__toESM(require("ext"))');
    },
    run: {
      stdout: "function 1",
    },
  });

  // Test 41: an external CJS dependency in CJS output, `.mjs` importer
  itBundled("cjs/__toESM_external_require_mjs_importer", {
    files: {
      "/entry.mjs": externalImportLog,
    },
    runtimeFiles: externalRuntimeFiles,
    external: ["ext"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__toESM(require("ext"), 1)');
    },
    run: {
      stdout: "object 1",
    },
  });

  // ============================================================================
  // Files reached through a package.json "exports" map. The matched "import" or
  // "require" condition is not a module type. Only the extension and the
  // nearest package.json "type" are.
  // ============================================================================

  const cjsDepFiles = {
    "/node_modules/cjs-dep/package.json": `{ "name": "cjs-dep", "main": "index.js" }`,
    "/node_modules/cjs-dep/index.js": esModuleDep,
  };
  const reexportDefault = /* js */ `
    import d from "cjs-dep";
    export default d;
  `;
  const logTypeofDefault = /* ts */ `
    import x from "pkg";
    console.log(typeof x);
  `;

  // Test 42: "fake ESM" reached through the "import" condition of a package
  // without "type" honors __esModule, like esbuild and `bun run`
  itBundled("cjs/__toESM_exports_import_condition_without_type", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }
      }`,
      "/node_modules/pkg/esm/index.js": reexportDefault,
      "/node_modules/pkg/cjs/index.js": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function",
    },
  });

  // Test 43: the same package with "type": "module" gets Node's interop
  itBundled("cjs/__toESM_exports_import_condition_type_module", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "type": "module",
        "exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }
      }`,
      "/node_modules/pkg/esm/index.js": reexportDefault,
      "/node_modules/pkg/cjs/index.js": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object",
    },
  });

  // Test 44: a nested package.json with "type": "module" next to the resolved
  // file makes it ESM, whatever the package root says
  itBundled("cjs/__toESM_exports_nested_type_module", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "exports": { "import": "./esm/index.js", "require": "./cjs/index.js" }
      }`,
      "/node_modules/pkg/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/esm/index.js": reexportDefault,
      "/node_modules/pkg/cjs/index.js": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object",
    },
  });

  // Test 45: a `.mjs` file is ESM even inside a "type": "commonjs" package
  itBundled("cjs/__toESM_exports_mjs_in_type_commonjs_package", {
    files: {
      "/entry.ts": logTypeofDefault,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "type": "commonjs",
        "exports": { "import": "./index.mjs", "require": "./index.cjs" }
      }`,
      "/node_modules/pkg/index.mjs": reexportDefault,
      "/node_modules/pkg/index.cjs": /* js */ `module.exports = require("cjs-dep").default;`,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object",
    },
  });

  // ============================================================================
  // A module that sets `__esModule` and has no own `default` property.
  // TypeScript and Babel emit this shape for a file with only named exports
  // (rxjs, redis, mobx). `bun run` and Node give the whole `module.exports` as
  // the default import. The bundle gives the same, for every importer.
  // ============================================================================

  const namedOnlyFiles = {
    "/node_modules/named-only/package.json": `{ "name": "named-only", "main": "index.js" }`,
    "/node_modules/named-only/index.js": /* js */ `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.named = 1;
    `,
  };
  // `bun run` prints "object true true true 1" for this file.
  const logNamedOnly = /* js */ `
    import d, * as ns from "named-only";
    import { named } from "named-only";
    const m = await import("named-only");
    console.log(typeof d, d === require("named-only"), ns.default === d, m.default === d, named);
  `;

  // Test 46: a `.js` importer
  itBundled("cjs/__toESM_esModule_without_default_js_importer", {
    files: {
      "/entry.js": logNamedOnly,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 47: a `.ts` importer with target=node
  itBundled("cjs/__toESM_esModule_without_default_ts_importer_target_node", {
    files: {
      "/entry.ts": logNamedOnly,
      ...namedOnlyFiles,
    },
    target: "node",
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 48: a `.mjs` importer uses Node's interop and gets the same value
  itBundled("cjs/__toESM_esModule_without_default_mjs_importer", {
    files: {
      "/entry.mjs": logNamedOnly,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 49: an external dependency in CJS output, `.ts` importer
  itBundled("cjs/__toESM_esModule_without_default_external_require", {
    files: {
      "/entry.ts": /* ts */ `
        import d, { named } from "named-only";
        console.log(typeof d, d === require("named-only"), named);
      `,
    },
    runtimeFiles: namedOnlyFiles,
    external: ["named-only"],
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__toESM(require("named-only"))');
    },
    run: {
      stdout: "object true 1",
    },
  });

  // Test 50: a `.js` importer under package.json "type": "commonjs"
  itBundled("cjs/__toESM_esModule_without_default_type_commonjs_importer", {
    files: {
      "/entry.js": logNamedOnly,
      "/package.json": `{ "name": "app", "type": "commonjs" }`,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object true true true 1",
    },
  });

  // Test 51: a dynamic import with no static import of the module
  itBundled("cjs/__toESM_esModule_without_default_dynamic_import_only", {
    files: {
      "/entry.ts": /* ts */ `
        const m = await import("named-only");
        console.log(typeof m.default, m.default?.named, m.named);
      `,
      ...namedOnlyFiles,
    },
    run: {
      stdout: "object 1 1",
    },
  });

  // Test 52: an own `default` property is the default export even when its
  // value is falsy. `bun run` prints "undefined 0" too.
  itBundled("cjs/__toESM_esModule_with_falsy_default", {
    files: {
      "/entry.js": /* js */ `
        import a from "./a.cjs";
        import b from "./b.cjs";
        console.log(a, b);
      `,
      "/a.cjs": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.default = undefined;
        exports.named = 1;
      `,
      "/b.cjs": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.default = 0;
        exports.named = 1;
      `,
    },
    run: {
      stdout: "undefined 0",
    },
  });

  // ============================================================================
  // The nearest package.json decides "type", with or without a "name". A dual
  // package marks its ESM build with a nameless `dist/esm/package.json` that
  // holds only `{ "type": "module" }`. Node and esbuild read that file whatever
  // the path that reached it.
  //
  // `seen` tells the interops apart: Node's gives the whole `module.exports`
  // ("object/function"), the other gives `exports.default` ("function/undefined").
  // ============================================================================

  const seenFromCjsDep = /* js */ `
    import d from "cjs-dep";
    export const seen = typeof d + "/" + typeof d.default;
  `;
  const logSeen = /* ts */ `
    import { seen } from "pkg";
    console.log(seen);
  `;

  // Test 53: the nested marker is reached through "main"
  itBundled("cjs/__toESM_nested_nameless_type_module_via_main", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "./dist/esm/index.js" }`,
      "/node_modules/pkg/dist/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    target: "node",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM(require_cjs_dep(), 1)");
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 54: a nested package.json with a "name" counts the same way
  itBundled("cjs/__toESM_nested_named_type_module_via_main", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "./dist/esm/index.js" }`,
      "/node_modules/pkg/dist/esm/package.json": `{ "name": "pkg-esm", "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 55: the nameless marker, reached through "module"
  itBundled("cjs/__toESM_nested_nameless_type_module_via_module_field", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "main": "./dist/cjs/index.js",
        "module": "./dist/esm/index.js"
      }`,
      "/node_modules/pkg/dist/cjs/index.js": /* js */ `exports.seen = "cjs build";`,
      "/node_modules/pkg/dist/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 56: the nameless marker, reached through a relative path
  itBundled("cjs/__toESM_nested_nameless_type_module_via_relative_path", {
    files: {
      "/entry.ts": /* ts */ `
        import { seen } from "./lib/esm/index.js";
        console.log(seen);
      `,
      "/package.json": `{ "name": "app" }`,
      "/lib/esm/package.json": `{ "type": "module" }`,
      "/lib/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 57: the marker applies to every file below it, not only to the
  // directory that holds it
  itBundled("cjs/__toESM_nested_nameless_type_module_in_subdirectory", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "./dist/esm/index.js" }`,
      "/node_modules/pkg/dist/esm/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/dist/esm/index.js": /* js */ `export { seen } from "./inner/seen.js";`,
      "/node_modules/pkg/dist/esm/inner/seen.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 58: a project package.json with "type" and no "name" counts too
  itBundled("cjs/__toESM_nameless_project_type_module", {
    files: {
      "/entry.ts": logDefaultAndNamed,
      "/dep.cjs": esModuleDep,
      "/package.json": `{ "type": "module" }`,
    },
    run: {
      stdout: "object 1",
    },
  });

  // Test 59: the nearest package.json wins. A nameless "type": "commonjs"
  // marker below a "type": "module" package keeps the __esModule interop.
  itBundled("cjs/__toESM_nested_nameless_type_commonjs_under_type_module", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "./dist/cjs/index.js" }`,
      "/node_modules/pkg/dist/cjs/package.json": `{ "type": "commonjs" }`,
      "/node_modules/pkg/dist/cjs/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function/undefined",
    },
  });

  // Test 60: the nearest package.json is the scope even when it has no "type".
  // The lookup does not continue to the "type": "module" package root.
  itBundled("cjs/__toESM_nearest_package_json_without_type_is_the_scope", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "./dist/index.js" }`,
      "/node_modules/pkg/dist/package.json": `{ "sideEffects": false }`,
      "/node_modules/pkg/dist/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function/undefined",
    },
  });

  // Test 61: the lookup does not stop at a node_modules directory. A package
  // without a package.json of its own takes the "type" of the one above it.
  itBundled("cjs/__toESM_nameless_type_module_above_node_modules", {
    files: {
      "/entry.ts": logSeen,
      "/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "object/function",
    },
  });

  // Test 62: only the file in the bundle decides. With the default target,
  // "module" wins and "main" is the fallback for require(). The fallback's
  // package.json does not give the "module" file its "type".
  itBundled("cjs/__toESM_type_from_module_field_not_main_fallback", {
    files: {
      "/entry.ts": logSeen,
      "/node_modules/pkg/package.json": `{
        "name": "pkg",
        "main": "./lib/index.js",
        "module": "./esm/index.js"
      }`,
      "/node_modules/pkg/lib/package.json": `{ "type": "module" }`,
      "/node_modules/pkg/lib/index.js": /* js */ `export const seen = "main build";`,
      "/node_modules/pkg/esm/index.js": seenFromCjsDep,
      ...cjsDepFiles,
    },
    run: {
      stdout: "function/undefined",
    },
  });
});
