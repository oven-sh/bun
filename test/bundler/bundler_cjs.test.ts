import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

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

  // ============================================================================
  // In Node and in Bun `require` is a parameter of each CommonJS module's
  // wrapper, so a file that assigns it changes its own `require` and no other
  // file's. A bundle has one `require` for all of its files. In a bundle for
  // node or bun, the file that assigns gets a variable of its own. The entry
  // point of a cjs bundle does not: it is the output file itself.
  // ============================================================================

  // `/src/loader.cjs` starts like the loader that NAPI-RS generates. Its own
  // `require` then resolves from the source folder, where `src-only` is. `ext`
  // is only beside the bundle, where the `require` of `/src/other.cjs` has to
  // look.
  const requireAssignedByLoader = {
    "/src/entry.js": /* js */ `
      import loader from "./loader.cjs";
      import other from "./other.cjs";
      console.log(loader, "|", other());
    `,
    "/src/loader.cjs": /* js */ `
      const { createRequire } = require("node:module");
      require = createRequire(__filename);
      module.exports = require("src-only");
    `,
    "/src/other.cjs": /* js */ `
      module.exports = () => require("ext");
    `,
    "/src/node_modules/src-only/index.js": /* js */ `module.exports = "src-only ok";`,
  };
  for (const target of ["node", "bun"] as const) {
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`cjs/require_assignment_stays_in_its_file_${target}_${format}`, {
        files: requireAssignedByLoader,
        runtimeFiles: {
          "/out/node_modules/ext/index.js": /* js */ `module.exports = "ext ok";`,
        },
        external: ["ext", "src-only"],
        target,
        format,
        outdir: "/out",
        run: {
          file: "/out/entry.js",
          runtime: target,
          stdout: "src-only ok | ext ok",
        },
      });
    }
  }

  // `id()` keeps the bundler from resolving the argument at build time, so the
  // call goes through the file's `require` at run time.
  const readsPath = /* js */ `
    const id = x => x;
    module.exports = () => typeof require(id("node:path")).join;
  `;
  const requireAssignedToStub = {
    "/entry.mjs": /* js */ `
      import writer from "./writer.cjs";
      import other from "./other.cjs";
      console.log(JSON.stringify({ writer, other: other() }));
    `,
    "/writer.cjs": /* js */ `
      const id = x => x;
      const before = typeof require(id("node:path")).join;
      function declaredBefore() {
        return require(id("a"));
      }
      require = name => "stub " + name;
      module.exports = { before, declaredBefore: declaredBefore(), after: require(id("b")) };
    `,
    "/other.cjs": readsPath,
  };
  const requireAssignedToStubOutput =
    '{"writer":{"before":"function","declaredBefore":"stub a","after":"stub b"},"other":"function"}';

  itBundled("cjs/require_assignment_minify_identifiers", {
    files: requireAssignedToStub,
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    minifyIdentifiers: true,
    run: { runtime: "node", stdout: requireAssignedToStubOutput },
  });

  itBundled("cjs/require_assignment_cli", {
    files: requireAssignedToStub,
    target: "node",
    format: "cjs",
    backend: "cli",
    run: { runtime: "node", stdout: requireAssignedToStubOutput },
  });

  // `/writer.cjs` is only in the chunk of `/a.js`, and the bundle's `require`
  // is in the chunk that both entry points share. An assignment to that import
  // throws `TypeError: Assignment to constant variable.`
  itBundled("cjs/require_assignment_splitting", {
    files: {
      ...requireAssignedToStub,
      "/a.js": requireAssignedToStub["/entry.mjs"],
      "/b.js": /* js */ `
        import other from "./other.cjs";
        console.log(other());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    target: "bun",
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: requireAssignedToStubOutput },
      { file: "/out/b.js", stdout: "function" },
    ],
  });

  // A standalone executable is one bundle with one `require`.
  itBundled("cjs/require_assignment_compile", {
    compile: true,
    backend: "cli",
    files: requireAssignedToStub,
    run: { stdout: requireAssignedToStubOutput },
  });

  // The dev server prints `require` as `hmr.require`, which is also the method
  // that loads the bundled imports of the module. `.resolve` and `.main` keep
  // their dev server form: a bound `hmr.require` has neither.
  itBundled("cjs/require_assignment_dev_server_format", {
    files: {
      "/entry.cjs": /* js */ `
        const id = x => x;
        require = name => "stub " + name;
        module.exports = [require(id("a")), require.resolve(id("b")), require.main];
      `,
    },
    format: "internal_bake_dev",
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      expect(output).toContain("var require2 = hmr.require.bind(hmr);");
      expect(output).toContain('require2 = (name) => "stub " + name;');
      expect(output).toContain('module.exports = [require2(id("a")), hmr.requireResolve(id("b")), false];');
      expect(output).not.toContain("hmr.require = ");
    },
  });

  // For node in esm output `import.meta.main` is
  // `__require.main == __require.module`. That is the `require` of the bundle,
  // not the one that the entry point assigns.
  for (const target of ["node", "bun"] as const) {
    itBundled(`cjs/require_assignment_keeps_generated_require_calls_${target}_esm`, {
      files: {
        "/entry.mjs": /* js */ `
          import ext from "ext";
          import other from "./other.cjs";
          export * from "ext";
          const id = x => x;
          require = Object.assign(name => "stub " + name, { main: "stub main", module: "stub module" });
          console.log(JSON.stringify({ ext, own: require(id("a")), main: import.meta.main, other: other() }));
        `,
        "/other.cjs": readsPath,
      },
      runtimeFiles: {
        "/node_modules/ext/index.js": /* js */ `module.exports = "ext ok";`,
      },
      external: ["ext"],
      target,
      format: "esm",
      outfile: "/out.mjs",
      run: { runtime: target, stdout: '{"ext":"ext ok","own":"stub a","main":true,"other":"function"}' },
    });
  }

  // In cjs output the linker lowers the `import` and the `export * from` of
  // `/writer.mjs` to `require()` calls that run before its first statement.
  // They are calls of the `require` of the bundle, not of the one that the
  // file assigns.
  itBundled("cjs/require_assignment_keeps_lowered_imports", {
    files: {
      "/entry.mjs": /* js */ `
        import * as writer from "./writer.mjs";
        import other from "./other.cjs";
        console.log(JSON.stringify({ import: writer.fromImport, star: writer.name, own: writer.own, other: other() }));
      `,
      "/writer.mjs": /* js */ `
        import ext from "ext";
        export * from "ext";
        const id = x => x;
        require = name => "stub " + name;
        export const fromImport = ext.name;
        export const own = require(id("a"));
      `,
      "/other.cjs": readsPath,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": /* js */ `exports.name = "ext ok";`,
    },
    external: ["ext"],
    target: "node",
    format: "cjs",
    run: { runtime: "node", stdout: '{"import":"ext ok","star":"ext ok","own":"stub a","other":"function"}' },
  });

  // In cjs output the entry point is the output file itself: its `require` is
  // the one that every file of the bundle reads. The main script of a Node.js
  // single executable application gets a `require` for built-in modules only,
  // and assigns a real one there for the whole bundle.
  itBundled("cjs/require_assignment_in_cjs_entry_point_reaches_every_file", {
    files: {
      "/entry.cjs": /* js */ `
        const { createRequire } = require("node:module");
        require = createRequire(__filename);
        console.log(require("./other.cjs")());
      `,
      "/other.cjs": /* js */ `
        module.exports = () => require("ext");
      `,
      "/run.js": /* js */ `
        const { isBuiltin } = require("node:module");
        const source = require("node:fs").readFileSync(__dirname + "/out.js", "utf8");
        const builtinsOnly = name => {
          if (!isBuiltin(name)) throw new Error("not a built-in module: " + name);
          return require(name);
        };
        new Function("require", "module", "exports", source)(builtinsOnly, { exports: {} }, {});
      `,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": /* js */ `module.exports = "ext ok";`,
    },
    external: ["ext"],
    target: "node",
    format: "cjs",
    run: { file: "/run.js", runtime: "node", stdout: "ext ok" },
  });

  // `/a.js` is the entry point of its own output file only. In the output
  // file of `/b.js` it is a file like any other, with its own variable.
  itBundled("cjs/require_assignment_in_entry_point_of_another_output_file", {
    files: {
      "/a.js": /* js */ `
        const readPath = require("./other.cjs");
        const id = x => x;
        require = name => "stub " + name;
        module.exports = { own: require(id("a")), other: readPath() };
      `,
      "/b.js": /* js */ `
        console.log(JSON.stringify(require("./a.js")));
      `,
      "/other.cjs": readsPath,
      "/run-a.js": /* js */ `
        console.log(JSON.stringify(require("./out/a.js")));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    target: "node",
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/b.js", runtime: "node", stdout: '{"own":"stub a","other":"function"}' },
      { file: "/run-a.js", runtime: "node", stdout: '{"own":"stub a","other":"undefined"}' },
    ],
  });

  // A banner is the place for a `require` that every file of a cjs bundle
  // gets: it runs in the scope of the output file.
  for (const target of ["node", "bun"] as const) {
    itBundled(`cjs/require_assignment_in_banner_reaches_every_file_${target}`, {
      banner: `require = (original => Object.assign(name => original(name), { fromBanner: true }))(require);`,
      files: {
        "/entry.cjs": /* js */ `
          console.log(JSON.stringify({ entry: require.fromBanner, other: require("./other.cjs")() }));
        `,
        "/other.cjs": /* js */ `
          const id = x => x;
          module.exports = () => [require.fromBanner, typeof require(id("node:path")).join];
        `,
      },
      target,
      format: "cjs",
      run: { runtime: target, stdout: '{"entry":true,"other":[true,"function"]}' },
    });
  }

  // cjs output can run where there is no `require`, as in `new Function`. The
  // first value of the variable is then `undefined`, not a ReferenceError.
  itBundled("cjs/require_assignment_without_ambient_require", {
    files: {
      "/entry.js": /* js */ `
        import "./writer.cjs";
        console.log("loaded");
      `,
      "/writer.cjs": /* js */ `
        exports.setRequire = value => {
          require = value;
        };
      `,
      "/run.js": /* js */ `
        const source = require("node:fs").readFileSync(__dirname + "/out.js", "utf8");
        new Function("module", "exports", source)({ exports: {} }, {});
      `,
    },
    target: "node",
    format: "cjs",
    run: { file: "/run.js", runtime: "node", stdout: "loaded" },
  });

  // For a browser `require` is a global that scripts share. A file that
  // assigns it gives it to the others, as a `browserify -r` bundle does.
  itBundled("cjs/require_assignment_browser_target_is_shared", {
    files: {
      "/entry.js": /* js */ `
        import "./prelude.js";
        import { read } from "./consumer.js";
        console.log(read());
      `,
      "/prelude.js": /* js */ `
        require = name => "published " + name;
      `,
      "/consumer.js": /* js */ `
        const id = x => x;
        export const read = () => require(id("greet"));
      `,
    },
    target: "browser",
    format: "esm",
    run: { stdout: "published greet" },
  });

  // iife output for node is as it was. Its `require` of the bundle,
  // `createRequire(import.meta.url)`, cannot load in a script, so a file that
  // assigns `require` must not bring it in.
  for (const [write, statement] of [
    ["live", `require = () => "stub";`],
    ["dead", `if (false) require = () => "stub";`],
    ["later", `exports.assign = () => { require = () => "stub"; };`],
  ] as const) {
    itBundled(`cjs/require_assignment_iife_node_${write}_write`, {
      files: {
        "/entry.mjs": /* js */ `
          import "./writer.cjs";
          console.log("loaded");
        `,
        "/writer.cjs": statement,
      },
      target: "node",
      format: "iife",
      run: { runtime: "node", stdout: "loaded" },
    });
  }

  // `/b.mjs` calls `readPath()` before a statement of `/a.mjs` runs, so the
  // variable of `/a.mjs` has its value ahead of the imports of `/a.mjs`. With
  // `/requires-a.cjs` both files get the `__esm` wrapper, and the value stays
  // on the declaration that the wrapper hoists.
  for (const wrapper of ["none", "esm"] as const) {
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`cjs/require_assignment_import_cycle_wrapper_${wrapper}_${format}`, {
        files: {
          "/entry.mjs": /* js */ `
            import { late } from "./a.mjs";
            import { early } from "./b.mjs";
            ${wrapper === "esm" ? `import "./requires-a.cjs";` : ""}
            console.log(JSON.stringify({ early, late: late() }));
          `,
          "/a.mjs": /* js */ `
            import "./b.mjs";
            function id(x) {
              return x;
            }
            export function readPath() {
              return typeof require(id("node:path")).join;
            }
            export function late() {
              return typeof require(id("node:path")).join;
            }
            if (globalThis.never) require = () => "stub";
          `,
          "/b.mjs": /* js */ `
            import { readPath } from "./a.mjs";
            export const early = readPath();
          `,
          "/requires-a.cjs": /* js */ `
            exports.a = require("./a.mjs");
          `,
        },
        target: "bun",
        format,
        run: { stdout: '{"early":"function","late":"function"}' },
      });
    }
  }

  // An assignment that cannot run gives the file no variable and does not make
  // the file CommonJS. `typeof require` is "function" in a bundle.
  for (const format of ["esm", "cjs"] as const) {
    itBundled(`cjs/require_assignment_in_dead_code_${format}`, {
      files: {
        "/entry.mjs": /* js */ `
          import * as dead from "./dead.js";
          import other from "./other.cjs";
          console.log(JSON.stringify({ keys: Object.keys(dead), other: other() }));
        `,
        "/dead.js": /* js */ `
          if (false) require = 1;
        `,
        "/other.cjs": readsPath,
      },
      target: "node",
      format,
      outfile: format === "esm" ? "/out.mjs" : "/out.js",
      onAfterBundle(api) {
        expect(api.readFile(format === "esm" ? "/out.mjs" : "/out.js")).not.toContain("require2");
      },
      run: { runtime: "node", stdout: '{"keys":[],"other":"function"}' },
    });
  }

  // `--define require=ownRequire` makes the assignment one to `ownRequire`.
  itBundled("cjs/require_assignment_with_define", {
    files: {
      "/entry.cjs": /* js */ `
        var ownRequire;
        require = "assigned";
        console.log(ownRequire);
      `,
    },
    define: { require: "ownRequire" },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("require2");
    },
    run: { runtime: "node", stdout: "assigned" },
  });

  const requireWriteForms = {
    assign: `require = mark("assign");`,
    logicalOr: `require ||= mark("logicalOr");`,
    logicalAnd: `require &&= mark("logicalAnd");`,
    nullish: `require ??= mark("nullish");`,
    plus: `require += "";`,
    increment: `require++;`,
    arrayPattern: `[require] = [mark("arrayPattern")];`,
    objectPattern: `({ require } = { require: mark("objectPattern") });`,
    patternDefault: `({ absent: require = mark("patternDefault") } = {});`,
    arrayRest: `[...require] = [mark("arrayRest")];`,
    objectRest: `({ ...require } = { mark: "objectRest" });`,
    forOf: `for (require of [mark("forOf")]);`,
    forIn: `for (require in { forIn: 1 });`,
  };

  // The lazy-cache package in short: `proxy(name, alias)` registers a property that loads
  // `name` with `fn` on its first read.
  const lazyCache = /* js */ `
    module.exports = fn => {
      const cache = {};
      const proxy = (name, alias) => {
        const key = alias || name.slice(2, -4).replace(/-(.)/g, (_, letter) => letter.toUpperCase());
        Object.defineProperty(proxy, key, {
          enumerable: true,
          get: () => (key in cache ? cache[key] : (cache[key] = fn(name))),
        });
      };
      return proxy;
    };
  `;
  // `utils.js` of clone-deep 0.2.4, the idiom of #11754: it puts the proxy in `require`, so that
  // a bundler sees the names that it registers, and puts the old value back.
  const lazyCacheUtils = (registrations: string, lazyCachePath = "./lazy-cache.cjs") => /* js */ `
    var utils = require("${lazyCachePath}")(require);
    var fn = require;
    require = utils;
    ${registrations}
    require = fn;
    module.exports = utils;
  `;

  // Each program prints the same from its source and from its bundle. With
  // `node`, Node.js runs the source and a bundle for node too. `bun: false`
  // leaves Bun out. `todo` says why a bundle prints something else.
  type RequireAssignmentProgram = {
    files: Record<string, string>;
    external?: string[];
    formats?: readonly ("esm" | "cjs")[];
    node?: boolean;
    bun?: false;
    todo?: string;
  };
  const requireAssignmentPrograms: Record<string, RequireAssignmentProgram> = {
    // A call before the assignment gets the bundle's `require`. A function
    // that is declared before it and called after it sees the new value.
    "own reads follow the assignment": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify({ writer: require("./writer.cjs"), other: require("./other.cjs")() }));
        `,
        "writer.cjs": requireAssignedToStub["/writer.cjs"],
        "other.cjs": readsPath,
      },
    },
    // One file for each way to write to a binding. Each exports what its own
    // `require` is afterwards. `||=` and `??=` do not write: `require` is set.
    "every write form": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          const forms = {};
          ${Object.keys(requireWriteForms)
            .map(name => `forms.${name} = require("./${name}.cjs");`)
            .join("\n")}
          console.log(JSON.stringify({ forms, other: require("./other.cjs")() }));
        `,
        "describe.cjs": /* js */ `
          exports.mark = name => Object.assign(() => {}, { mark: name });
          exports.describe = value =>
            typeof value === "function"
              ? (value.mark ?? "not written")
              : typeof value === "object"
                ? (value.mark ?? value[0].mark)
                : typeof value === "string" && value.length < 10
                  ? value
                  : typeof value;
        `,
        ...Object.fromEntries(
          Object.entries(requireWriteForms).map(([name, statement]) => [
            `${name}.cjs`,
            /* js */ `
              const { mark, describe } = require("./describe.cjs");
              ${statement}
              module.exports = describe(require);
            `,
          ]),
        ),
        "other.cjs": readsPath,
      },
    },
    // Neither writer keeps a CommonJS wrapper in esm output, so both are in
    // the scope of the chunk. Each has its own variable.
    "two files without a wrapper": {
      node: true,
      files: {
        "entry.mjs": /* js */ `
          import { one } from "./one.cjs";
          import { two } from "./two.cjs";
          import { other } from "./other.cjs";
          console.log(JSON.stringify({ one: one(), two: two(), other: other() }));
        `,
        "one.cjs": /* js */ `
          const id = x => x;
          require = name => "one " + name;
          exports.one = () => require(id("a"));
        `,
        "two.cjs": /* js */ `
          const id = x => x;
          require = name => "two " + name;
          exports.two = () => require(id("a"));
        `,
        "other.cjs": /* js */ `
          const id = x => x;
          exports.other = () => typeof require(id("node:path")).join;
        `,
      },
    },
    // `wrapped.mjs` is an ES module that a CommonJS file requires, so it gets
    // the `__esm` wrapper. `plain.mjs` has no wrapper. Node.js has no
    // `require` in an ES module.
    "es modules": {
      files: {
        "entry.mjs": /* js */ `
          import { plain } from "./plain.mjs";
          import { wrapped, other } from "./requires-wrapped.cjs";
          console.log(JSON.stringify({ plain: plain(), wrapped: wrapped(), other: other() }));
        `,
        "plain.mjs": /* js */ `
          const id = x => x;
          require = name => "plain " + name;
          export const plain = () => require(id("a"));
        `,
        "wrapped.mjs": /* js */ `
          const id = x => x;
          require = name => "wrapped " + name;
          export function wrapped() {
            return require(id("a"));
          }
        `,
        "requires-wrapped.cjs": /* js */ `
          const id = x => x;
          exports.wrapped = require("./wrapped.mjs").wrapped;
          exports.other = () => typeof require(id("node:path")).join;
        `,
      },
    },
    // The variable prints as `require2`. A local of that name in a nested
    // scope must not capture it. `later.cjs` assigns in a function that runs
    // later: until then its `require` is the bundle's.
    "nested scopes": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          const later = require("./later.cjs");
          console.log(
            JSON.stringify({
              nested: require("./nested.cjs"),
              later: [later.read(), (later.assign(), later.read())],
              other: require("./other.cjs")(),
            }),
          );
        `,
        "nested.cjs": /* js */ `
          const id = x => x;
          require = name => "stub " + name;
          module.exports = (function (require2) {
            let require3 = "local";
            return [require2, require3, require(id("a"))];
          })("parameter");
        `,
        "later.cjs": /* js */ `
          const id = x => x;
          exports.assign = () => {
            require = name => "stub " + name;
          };
          exports.read = () => {
            const path = require(id("node:path"));
            return typeof path === "string" ? path : typeof path.join;
          };
        `,
        "other.cjs": readsPath,
      },
    },
    // `require.resolve` and `require.main` are read from the assigned value.
    "resolve and main of the assigned value": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify({ writer: require("./writer.cjs"), other: require("./other.cjs")() }));
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          require = Object.assign(name => "stub " + name, { resolve: name => "resolved " + name, main: "stub main" });
          module.exports = [require.resolve(id("a")), require.main];
        `,
        "other.cjs": /* js */ `
          const id = x => x;
          module.exports = () => require.resolve(id("node:path"));
        `,
      },
    },
    // A literal that the bundler leaves for run time is a call of the file's
    // own `require` too: before the assignment and after it.
    "an external literal before and after the assignment": {
      node: true,
      external: ["ext"],
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify({ writer: require("./writer.cjs"), other: require("./other.cjs") }));
        `,
        "writer.cjs": /* js */ `
          const before = require("ext");
          require = name => "stub " + name;
          module.exports = [before, require("ext")];
        `,
        "other.cjs": /* js */ `
          module.exports = require("ext");
        `,
        "node_modules/ext/index.js": /* js */ `module.exports = "ext ok";`,
      },
    },
    // `react` is a package whose require() the bundler turns into an import in
    // esm output. The call is still the file's own.
    "an external literal of an unwrapped package": {
      node: true,
      external: ["react"],
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          require = name => ({ name: "stub " + name });
          const { name } = require("react");
          module.exports = name;
        `,
        "node_modules/react/index.js": /* js */ `exports.name = "react";`,
      },
    },
    // The lazy-cache idiom of #11754 (clone-deep/utils.js): put a function in
    // `require`, call it, put the old value back. Another file that runs in
    // between still has its own `require`.
    "restored after calls": {
      node: true,
      external: ["ext-dep"],
      files: {
        "entry.cjs": /* js */ `
          const utils = require("./utils.cjs");
          console.log(
            JSON.stringify({
              twoArguments: utils.registered.includes("alias"),
              external: utils.registered.includes("ext-dep"),
              otherMeanwhile: utils.otherMeanwhile,
              restored: utils.restored,
            }),
          );
        `,
        "utils.cjs": /* js */ `
          const readPath = require("./other.cjs");
          const registered = [];
          const old = require;
          require = (name, alias) => registered.push(alias || name);
          require("two-argument-dep", "alias");
          require("./dep.cjs");
          require("ext-dep");
          const otherMeanwhile = readPath();
          require = old;
          module.exports = { registered, otherMeanwhile, restored: typeof require("node:path").join };
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
        "other.cjs": readsPath,
      },
    },
    // A literal of a bundled file is a call of the assigned function too.
    "restored after a call with the literal of a bundled file": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./utils.cjs")));
        `,
        "utils.cjs": /* js */ `
          const registered = [];
          const old = require;
          require = name => registered.push(name);
          require("./dep.cjs");
          require = old;
          module.exports = registered;
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // lazy-cache loads a registered module on the first read of its property, with the
    // `require` that the file gave it before the assignment. The bundle is in `out/`, where
    // a lookup of `./for-own.cjs` by name at run time finds nothing.
    "the lazy-cache idiom": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          globalThis.evaluated = [];
          const utils = require("./utils.cjs");
          const atRegistration = [...evaluated];
          const forOwn = utils.forOwn;
          console.log(
            JSON.stringify({
              atRegistration,
              keys: Object.keys(utils),
              types: [typeof forOwn, typeof utils.isObject],
              evaluated,
              once: utils.forOwn === forOwn,
              sameInstance: forOwn === require("./for-own.cjs"),
            }),
          );
        `,
        "utils.cjs": lazyCacheUtils(`
          require("./is-plain-object.cjs", "isObject");
          require("./for-own.cjs");
        `),
        "lazy-cache.cjs": lazyCache,
        "for-own.cjs": /* js */ `
          evaluated.push("for-own");
          module.exports = function forOwn() {};
        `,
        "is-plain-object.cjs": /* js */ `
          evaluated.push("is-plain-object");
          module.exports = function isPlainObject() {};
        `,
      },
    },
    // Each file has its own table: `./dep.cjs` is another file for each of the two.
    "the same specifier in two files": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify([require("./a/utils.cjs").dep, require("./b/utils.cjs").dep]));
        `,
        "a/utils.cjs": lazyCacheUtils(`require("./dep.cjs");`, "../lazy-cache.cjs"),
        "b/utils.cjs": lazyCacheUtils(`require("./dep.cjs");`, "../lazy-cache.cjs"),
        "a/dep.cjs": /* js */ `module.exports = "dep of a";`,
        "b/dep.cjs": /* js */ `module.exports = "dep of b";`,
        "lazy-cache.cjs": lazyCache,
      },
    },
    // Which function a call reaches is only known at run time: `load` is declared above the
    // assignment, and the assignment runs after the first `read()`.
    "a literal in a function above an assignment that runs later": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          const writer = require("./writer.cjs");
          console.log(
            JSON.stringify({ before: writer.before, first: writer.read(), second: (writer.assign(), writer.read()) }),
          );
        `,
        "writer.cjs": /* js */ `
          function load() {
            return require("./dep.cjs");
          }
          exports.before = load();
          exports.assign = () => {
            require = name => "stub " + name;
          };
          exports.read = () => [load(), require("./dep.cjs")];
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // The assigned function hands the name to the `require` that the file had first, and
    // that one answers from the bundle.
    "the assigned function forwards to the first require": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          const first = require;
          const seen = [];
          require = name => {
            seen.push(name);
            return first(name);
          };
          module.exports = { dep: require("./dep.cjs"), same: require("./dep.cjs") === first("./dep.cjs"), seen };
        `,
        "dep.cjs": /* js */ `
          module.exports = { name: "dep" };
        `,
      },
    },
    // A registered name is only a string until something asks for it. One that does not
    // resolve does not fail the build.
    "a registered name that does not resolve is never read": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./utils.cjs")));
        `,
        "utils.cjs": /* js */ `
          const names = [];
          const old = require;
          require = name => names.push(name);
          require("./absent.cjs");
          require("absent-package", "alias");
          require = old;
          module.exports = names;
        `,
      },
    },
    // `module.require` is not the variable: it loads the module. Bun calls the assigned
    // function there when it runs the source.
    "module.require after the assignment": {
      node: true,
      bun: false,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          require = name => "stub " + name;
          module.exports = [require("./dep.cjs"), module.require("./dep.cjs")];
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // `?.` calls the variable, both names of a conditional go to it, and nothing is read off
    // the module that a name stands for.
    "other forms of a call with a literal": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          const first = require;
          const { name } = require("./dep.cjs");
          require = name => ({ name: "stub " + name });
          const stubbed = [
            require?.("./dep.cjs").name,
            require(name ? "./dep.cjs" : "./other.cjs").name,
            (({ name }) => name)(require("./other.cjs")),
          ];
          module.exports = { name, stubbed, first: first("./other.cjs").name };
        `,
        "dep.cjs": /* js */ `
          exports.name = "dep";
        `,
        "other.cjs": /* js */ `
          exports.name = "other";
        `,
      },
    },
    // The first value of the variable has what a `require` function has.
    "resolve and cache of the first value": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          const first = require;
          require = name => "stub " + name;
          module.exports = {
            dep: first("./dep.cjs"),
            resolve: first.resolve(id("node:path")),
            cache: typeof first.cache,
            builtin: typeof first(id("node:path")).join,
            stubbed: require("./dep.cjs"),
          };
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // A direct eval pins every name of the file, so its `require` stays as it was: the name
    // `require` in the output is still the one of the output file.
    "a direct eval in a file that names a module": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          const dep = require("./dep.cjs");
          const first = require;
          require = name => "stub " + name;
          module.exports = [dep, eval("typeof first"), typeof first(id("node:path")).join, require(id("a"))];
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // The same for a name in a `with` statement.
    "a with statement in a file that names a module": {
      node: true,
      formats: ["cjs"],
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify(require("./writer.cjs")));
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          const dep = require("./dep.cjs");
          const first = require;
          with ({}) {
            var same = first === require;
          }
          require = name => "stub " + name;
          module.exports = [dep, same, typeof first(id("node:path")).join, require(id("a"))];
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // Bun folds `typeof require` when it runs the source too.
    "typeof after the assignment in a file that names a module": {
      node: true,
      bun: false,
      files: {
        "entry.cjs": /* js */ `
          require("./writer.cjs");
        `,
        "writer.cjs": /* js */ `
          const dep = require("./dep.cjs");
          require = 1;
          console.log(typeof require, dep);
        `,
        "dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
    },
    // A name in a `with` statement is not rewritten, so this assignment is one
    // to the `require` of the output file, and the file gets no variable.
    "an assignment in a with statement": {
      node: true,
      formats: ["cjs"],
      files: {
        "entry.cjs": /* js */ `
          console.log(JSON.stringify({ writer: require("./writer.cjs") }));
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          with ({}) {
            require = name => "stub " + name;
          }
          module.exports = require(id("a"));
        `,
      },
    },
    // The calls that the file itself makes go to the assigned value, also
    // when a direct eval keeps every name of the file as it is written.
    "own calls in a file with a direct eval": {
      node: true,
      files: {
        "entry.cjs": /* js */ `
          require("./writer.cjs");
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          require = name => "stub " + name;
          console.log(eval("id")("evaluated"), require(id("a")));
        `,
      },
    },
    // Bun folds it when it runs the source too. Node.js prints "number".
    "typeof after the assignment": {
      todo: 'the bundler folds `typeof require` to "function"',
      node: true,
      bun: false,
      files: {
        "entry.cjs": /* js */ `
          require("./writer.cjs");
        `,
        "writer.cjs": /* js */ `
          require = 1;
          console.log(typeof require);
        `,
      },
    },
    "a direct eval reads the assigned value": {
      todo: "the code that a direct eval runs is not rewritten: it reads the `require` of the output file",
      node: true,
      files: {
        "entry.cjs": /* js */ `
          require("./writer.cjs");
        `,
        "writer.cjs": /* js */ `
          require = name => "stub " + name;
          console.log(eval("require") === require);
        `,
      },
    },
    "a direct eval assigns": {
      todo: "the code that a direct eval runs is not rewritten: it assigns the `require` of the output file",
      node: true,
      files: {
        "entry.cjs": /* js */ `
          require("./writer.cjs");
        `,
        "writer.cjs": /* js */ `
          const id = x => x;
          require = name => "first " + name;
          eval('require = name => "second " + name');
          console.log(require(id("a")));
        `,
      },
    },
    "a with statement reads the assigned value": {
      todo: "a name in a with statement is not rewritten: it reads the `require` of the output file",
      node: true,
      formats: ["cjs"],
      files: {
        "entry.cjs": /* js */ `
          require("./writer.cjs");
        `,
        "writer.cjs": /* js */ `
          require = name => "stub " + name;
          with ({}) {
            console.log(require("a"));
          }
        `,
      },
    },
    "a property of require": {
      todo: "the files of a bundle share one `require` function until one of them assigns `require`",
      node: true,
      files: {
        "entry.cjs": /* js */ `
          require("./sets.cjs");
          console.log(require.marker);
        `,
        "sets.cjs": /* js */ `
          require.marker = "set in sets.cjs";
        `,
      },
    },
  };
  const run = async (cmd: string[], cwd: string) => {
    await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const node = nodeExe();
  const programDirs: ReturnType<typeof tempDir>[] = [];
  afterAll(() => {
    for (const dir of programDirs) dir[Symbol.dispose]();
  });
  for (const [name, program] of Object.entries(requireAssignmentPrograms)) {
    const entry = Object.keys(program.files)[0];
    for (const [target, found] of [
      ...(program.bun === false ? [] : [["bun", bunExe()]]),
      ...(program.node ? [["node", node]] : []),
    ] as const) {
      // On a machine without Node.js its cases show as skipped.
      const register = found ? test.todoIf(!!program.todo) : test.skip;
      const exe = found ?? target;
      // One directory and one run of the source for both formats.
      let source: Promise<{ dir: ReturnType<typeof tempDir>; printed: Awaited<ReturnType<typeof run>> }> | undefined;
      const runSource = async () => {
        const dir = tempDir("require-assignment", program.files);
        programDirs.push(dir);
        return { dir, printed: await run([exe, entry], String(dir)) };
      };
      for (const format of program.formats ?? (["esm", "cjs"] as const)) {
        register.concurrent(`cjs/require_assignment: ${name} (${target}, ${format})`, async () => {
          const { dir, printed } = await (source ??= runSource());
          expect(printed).toEqual({ stdout: expect.stringMatching(/\S/), stderr: "", exitCode: 0 });
          const bundle = `${target}.${format === "esm" ? "mjs" : "cjs"}`;
          const build = await Bun.build({
            entrypoints: [join(String(dir), entry)],
            outdir: join(String(dir), "out"),
            naming: bundle,
            target,
            format,
            external: program.external,
          });
          expect(build.logs).toEqual([]);
          expect(await run([exe, join("out", bundle)], String(dir))).toEqual(printed);
        });
      }
    }
  }

  // The page that a server imports is for a browser, whatever the target of
  // the build is: a file of the page gets no variable, a file of the server
  // gets one.
  test.concurrent("cjs/require_assignment: the page of a server build shares its require", async () => {
    using dir = tempDir("require-assignment-page", {
      "server.js": /* js */ `
        import page from "./index.html";
        import writer from "./writer.cjs";
        import other from "./other.cjs";
        console.log(JSON.stringify({ page: typeof page, writer, other: other() }));
      `,
      "index.html": /* html */ `<script type="module" src="./page.js"></script>`,
      "page.js": /* js */ `
        const id = x => x;
        require = name => "published " + name;
        console.log(require(id("greet")));
      `,
      "writer.cjs": /* js */ `
        const id = x => x;
        require = name => "stub " + name;
        module.exports = require(id("a"));
      `,
      "other.cjs": readsPath,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "server.js")],
      outdir: join(String(dir), "out"),
      target: "bun",
    });
    expect(build.logs).toEqual([]);
    const page = build.outputs.find(output => output.path.endsWith(".js") && !output.path.endsWith("server.js"));
    const pageText = await page!.text();
    expect(pageText).toContain('"published "');
    expect(pageText).not.toContain("require2");
    expect(await run([bunExe(), join("out", "server.js")], String(dir))).toEqual({
      stdout: '{"page":"object","writer":"stub a","other":"function"}\n',
      stderr: "",
      exitCode: 0,
    });
  });

  // The lazy-cache idiom in the builds that the table above does not make. The output is in
  // another folder than the source, so nothing that it prints comes from a lookup by name.
  const lazyCacheProgram = {
    "/src/entry.js": /* js */ `
      const utils = require("./utils.cjs");
      console.log(typeof utils.forOwn, typeof utils.isObject, utils.esm.name);
    `,
    "/src/utils.cjs": lazyCacheUtils(`
      require("./is-plain-object.cjs", "isObject");
      require("./for-own.cjs");
      require("./esm.mjs");
    `),
    "/src/lazy-cache.cjs": lazyCache,
    "/src/for-own.cjs": /* js */ `module.exports = function forOwn() {};`,
    "/src/is-plain-object.cjs": /* js */ `module.exports = function isPlainObject() {};`,
    "/src/esm.mjs": /* js */ `export const name = "esm";`,
  };
  const lazyCacheProgramOutput = "function function esm";

  itBundled("cjs/require_assignment_table_cli", {
    files: lazyCacheProgram,
    target: "node",
    format: "cjs",
    backend: "cli",
    outdir: "/out",
    run: { file: "/out/entry.js", runtime: "node", stdout: lazyCacheProgramOutput },
  });

  itBundled("cjs/require_assignment_table_compile", {
    compile: true,
    backend: "cli",
    files: lazyCacheProgram,
    run: { stdout: lazyCacheProgramOutput },
  });

  itBundled("cjs/require_assignment_table_minify", {
    files: lazyCacheProgram,
    target: "node",
    format: "esm",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    outdir: "/out",
    run: { file: "/out/entry.js", runtime: "node", stdout: lazyCacheProgramOutput },
  });

  // `/src/esm.mjs` is a chunk of its own: the entry of the table loads that chunk.
  itBundled("cjs/require_assignment_table_splitting", {
    files: {
      ...lazyCacheProgram,
      "/src/other.js": /* js */ `
        console.log(typeof require("./utils.cjs").isObject);
      `,
    },
    entryPoints: ["/src/entry.js", "/src/other.js"],
    target: "bun",
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/entry.js", stdout: lazyCacheProgramOutput },
      { file: "/out/other.js", stdout: "function" },
    ],
  });

  // `--reject-unresolved` takes no `require` call that is left for run time. The calls of
  // the file are calls of its variable, and each name in its table resolves.
  itBundled("cjs/require_assignment_table_reject_unresolved", {
    files: lazyCacheProgram,
    target: "node",
    format: "cjs",
    allowUnresolved: [],
    outdir: "/out",
    run: { file: "/out/entry.js", runtime: "node", stdout: lazyCacheProgramOutput },
  });

  // A name that is not a literal can be one for the module system at run time, so that error
  // stays. Each of the two calls logs it in the first parse.
  itBundled("cjs/require_assignment_table_reject_unresolved_keeps_other_errors", {
    files: {
      "/entry.js": /* js */ `
        const name = "./dep.cjs";
        const old = require;
        require = name => "stub " + name;
        require("./dep.cjs", "dep");
        console.log(require(name));
        require = old;
      `,
      "/dep.cjs": /* js */ `
        module.exports = "dep";
      `,
    },
    target: "node",
    format: "esm",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": [
        "This require() expression will not be bundled because the argument is not a string literal",
        "This require() expression will not be bundled because the argument is not a string literal",
      ],
    },
  });

  // As `cjs/require_assignment_import_cycle_wrapper_*`, with a name that the bundler
  // resolves: the table of `/a.mjs` is there before `/b.mjs` calls in.
  for (const wrapper of ["none", "esm"] as const) {
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`cjs/require_assignment_table_import_cycle_wrapper_${wrapper}_${format}`, {
        files: {
          "/entry.mjs": /* js */ `
            import { late } from "./a.mjs";
            import { early } from "./b.mjs";
            ${wrapper === "esm" ? `import "./requires-a.cjs";` : ""}
            console.log(JSON.stringify({ early, late: late() }));
          `,
          "/a.mjs": /* js */ `
            import "./b.mjs";
            export function readDep() {
              return require("./dep.cjs");
            }
            export function late() {
              return require("./dep.cjs");
            }
            if (globalThis.never) require = () => "stub";
          `,
          "/b.mjs": /* js */ `
            import { readDep } from "./a.mjs";
            export const early = readDep();
          `,
          "/requires-a.cjs": /* js */ `
            exports.a = require("./a.mjs");
          `,
          "/dep.cjs": /* js */ `
            module.exports = "dep";
          `,
        },
        target: "bun",
        format,
        run: { stdout: '{"early":"dep","late":"dep"}' },
      });
    }
  }

  // The file is parsed twice. What the first parse logs is not in the output.
  itBundled("cjs/require_assignment_table_reports_a_warning_once", {
    files: {
      "/entry.jsx": /* js */ `
        // @jsx .
        const old = require;
        require = name => "stub " + name;
        const dep = require("./dep.cjs");
        require = old;
        console.log(dep);
      `,
      "/dep.cjs": /* js */ `
        module.exports = "dep";
      `,
    },
    target: "bun",
    format: "esm",
    backend: "cli",
    jsx: { runtime: "classic" },
    bundleWarnings: {
      "/entry.jsx": ['Invalid JSX factory: "."'],
    },
    run: { stdout: "stub ./dep.cjs" },
  });

  // A macro runs when the file is visited, so a file that calls one is parsed once and
  // stays as it was: the name that the bundler resolved is the bundled module.
  itBundled("cjs/require_assignment_with_a_macro_is_parsed_once", {
    files: {
      "/entry.js": /* js */ `
        import { count } from "./macro.ts" with { type: "macro" };
        const old = require;
        require = name => "stub " + name;
        const dep = require("./dep.cjs");
        require = old;
        console.log(count(), dep);
      `,
      "/macro.ts": /* ts */ `
        let calls = 0;
        export const count = () => ++calls;
      `,
      "/dep.cjs": /* js */ `
        module.exports = "dep";
      `,
    },
    target: "bun",
    format: "esm",
    run: { stdout: "1 dep" },
  });

  // `require.main === module` is `import.meta.main` while `require` is the name of the
  // module system's function. The entry point keeps that, and stays as it was.
  itBundled("cjs/require_assignment_table_entry_point_keeps_require_main", {
    files: {
      "/entry.cjs": /* js */ `
        const old = require;
        require = name => "stub " + name;
        require("./dep.cjs");
        require = old;
        console.log(require.main === module);
      `,
      "/dep.cjs": /* js */ `
        module.exports = "dep";
      `,
    },
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    run: { runtime: "node", stdout: "true" },
  });

  // A function of what names the file gives a `require` for that same file: NAPI-RS
  // loaders assign `createRequire(__filename)`, also inside the wrapper of another bundler,
  // and the esm package is used as `require("esm")(module)`. `__filename` is a path of the
  // build machine, so a name that the bundler resolved stays the bundled module. The source
  // folder is gone when the bundle runs.
  for (const [name, assignment] of [
    ["filename", `require = createRequire(__filename);`],
    ["filename_in_function", `(() => { require = createRequire(__filename); })();`],
    ["module", `require = (({ filename = __filename }) => createRequire(filename))(module);`],
    ["import_meta_url", `require = createRequire(import.meta.url);`],
  ] as const) {
    itBundled(`cjs/require_assignment_of_a_require_for_the_same_file_${name}`, {
      files: {
        "/src/entry.js": /* js */ `
          const { createRequire } = require("node:module");
          ${assignment}
          console.log(require("./dep.cjs"));
        `,
        "/src/dep.cjs": /* js */ `
          module.exports = "dep";
        `,
      },
      target: "node",
      format: "esm",
      outdir: "/out",
      onAfterBundle(api) {
        rmSync(api.join("src"), { recursive: true });
      },
      run: { file: "/out/entry.js", runtime: "node", stdout: "dep" },
    });
  }
});
