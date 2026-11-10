import { describe } from "bun:test";
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
  // A CommonJS module that an ES module imports while it is still loading.
  // `__toESM` builds that importer's namespace from the names set so far. An
  // import that runs after the load sees every name, as in Node and `bun run`.
  // ============================================================================

  // `index.js` requires a plugin in the middle of its own load. The plugin is
  // an ES module that imports `index.js` back through `api.js`.
  const pluginHost = (plugin: string, api = /* js */ `module.exports = require("./index.js");`) => ({
    "/index.js": /* js */ `
      exports.helper = s => "h:" + s;
      exports.plugins = [require("./${plugin}").default];
      exports.version = "1.0";
    `,
    "/api.js": api,
    ["/" + plugin]: /* js */ `
      import { helper } from "./api.js";
      export default { name: helper("a") };
    `,
  });
  const logIndex = /* js */ `console.log(typeof ns.helper, typeof ns.plugins, String(ns.version), String(ns.default.version), Object.keys(ns).join(","));`;
  const importIndexLater = /* js */ `
    export const handle = async () => {
      const ns = await import("./index.js");
      ${logIndex}
    };
  `;
  const requireHostThen = (route: string) => /* js */ `
    require("./index.js");
    require("./${route}").handle();
  `;
  const allOfIndex = "function object 1.0 1.0 default,helper,plugins,version";

  // Test 63: a `.ts` file imports inside the load, then `import()` in a
  // CommonJS file
  for (const format of ["esm", "cjs"] as const) {
    itBundled(`cjs/__toESM_module_still_loading_dynamic_import_cjs_importer_format_${format}`, {
      files: {
        "/entry.js": requireHostThen("route.cjs"),
        ...pluginHost("plugin.ts"),
        "/route.cjs": /* js */ `
          exports.handle = async () => {
            const ns = await import("./index.js");
            ${logIndex}
          };
        `,
      },
      target: "node",
      format,
      run: { stdout: allOfIndex },
    });
  }

  // Test 64: then `import()` in a `.ts` file
  itBundled("cjs/__toESM_module_still_loading_dynamic_import_ts_importer", {
    files: {
      "/entry.js": requireHostThen("route.ts"),
      ...pluginHost("plugin.ts"),
      "/route.ts": importIndexLater,
    },
    target: "node",
    run: { stdout: allOfIndex },
  });

  // Test 65: then `import *` in a `.ts` file
  itBundled("cjs/__toESM_module_still_loading_static_import_ts_importer", {
    files: {
      "/entry.js": /* js */ `
        require("./index.js");
        require("./route.ts");
      `,
      ...pluginHost("plugin.ts"),
      "/route.ts": /* js */ `
        import * as ns from "./index.js";
        ${logIndex}
      `,
    },
    target: "node",
    run: { stdout: allOfIndex },
  });

  // Test 66: the same pair in node mode, an `.mjs` file then an `.mjs` file
  itBundled("cjs/__toESM_module_still_loading_mjs_importers", {
    files: {
      "/entry.js": requireHostThen("route.mjs"),
      ...pluginHost("plugin.mjs"),
      "/route.mjs": importIndexLater,
    },
    target: "node",
    run: { stdout: allOfIndex },
  });

  // Test 67: minified helpers, through `Bun.build`
  itBundled("cjs/__toESM_module_still_loading_minified", {
    files: {
      "/entry.js": requireHostThen("route.ts"),
      ...pluginHost("plugin.ts"),
      "/route.ts": importIndexLater,
    },
    backend: "api",
    target: "bun",
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    run: { stdout: allOfIndex },
  });

  // Test 68: `import()` of a chunk
  itBundled("cjs/__toESM_module_still_loading_splitting", {
    files: {
      "/entry.js": requireHostThen("route.ts"),
      ...pluginHost("plugin.ts"),
      "/route.ts": importIndexLater,
    },
    target: "node",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: allOfIndex },
  });

  // Test 69: `api.js` is more than a re-export, so it keeps its own wrapper.
  // The object that `require_api()` returns is still the one `index.js` fills.
  itBundled("cjs/__toESM_module_still_loading_through_another_wrapper", {
    files: {
      "/entry.js": requireHostThen("route.ts"),
      ...pluginHost(
        "plugin.ts",
        /* js */ `
          const index = require("./index.js");
          globalThis.apiLoaded = true;
          module.exports = index;
        `,
      ),
      "/route.ts": importIndexLater,
    },
    target: "node",
    run: { stdout: allOfIndex },
  });

  // Test 70: a CommonJS entry point in a cycle with itself through a `.ts` file
  itBundled("cjs/__toESM_entry_still_loading", {
    files: {
      "/entry.js": /* js */ `
        require("./reexport.ts");
        import("./entry.js").then(ns => console.log(String(ns.late), String(ns.default.late), Object.keys(ns).join(",")));
        exports.late = "late";
      `,
      "/reexport.ts": /* js */ `export { early } from "./entry.js";`,
    },
    target: "node",
    run: { stdout: "late late default,late" },
  });

  // `const e = exports` keeps the bundler from turning the assignments into ES
  // exports, which have no `__toESM` call.
  const twoStaticImports = {
    "/entry.ts": /* js */ `
      import * as a from "./a.cjs";
      console.log(Object.keys(a).join(","), a.late, a.default.late);
    `,
    "/a.cjs": /* js */ `
      const e = exports;
      e.early = 1;
      require("./b.ts");
      e.late = 2;
    `,
    "/b.ts": /* js */ `
      import * as a from "./a.cjs";
      console.log(Object.keys(a).join(","));
    `,
  };

  // Test 71: two static imports, one inside the load and one after it
  itBundled("cjs/__toESM_module_still_loading_two_static_imports", {
    files: twoStaticImports,
    run: { stdout: "default,early\ndefault,early,late 2 2" },
  });

  // Test 72: with target bun, `require("./b.ts")` is a chunk of its own. Its
  // top level runs while `a.cjs` is loading.
  itBundled("cjs/__toESM_module_still_loading_split_require", {
    files: twoStaticImports,
    target: "bun",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "default,early\ndefault,early,late 2 2" },
  });

  // Test 73: each import inside the load sees the names set so far
  itBundled("cjs/__toESM_module_still_loading_imported_twice", {
    files: {
      "/entry.ts": /* js */ `
        import * as a from "./a.cjs";
        console.log(Object.keys(a).join(","));
      `,
      "/a.cjs": /* js */ `
        const e = exports;
        e.one = 1;
        require("./b.ts");
        e.two = 2;
        require("./c.ts");
        e.three = 3;
      `,
      "/api1.cjs": /* js */ `module.exports = require("./a.cjs");`,
      "/api2.cjs": /* js */ `module.exports = require("./a.cjs");`,
      "/b.ts": /* js */ `
        import * as a from "./api1.cjs";
        console.log(Object.keys(a).join(","));
        globalThis.seenByB = a;
      `,
      "/c.ts": /* js */ `
        import * as a from "./api2.cjs";
        console.log(Object.keys(a).join(","), a === globalThis.seenByB);
      `,
    },
    run: { stdout: "default,one\ndefault,one,two false\ndefault,one,two,three" },
  });

  // Test 74: a load inside a load. `b.ts` runs while both are loading.
  itBundled("cjs/__toESM_module_still_loading_nested", {
    files: {
      "/entry.ts": /* js */ `
        import * as x from "./x.cjs";
        import * as y from "./y.cjs";
        console.log(Object.keys(x).join(","), Object.keys(y).join(","));
      `,
      "/x.cjs": /* js */ `
        const e = exports;
        e.x1 = 1;
        require("./y.cjs");
        e.x2 = 2;
      `,
      "/y.cjs": /* js */ `
        const e = exports;
        e.y1 = 1;
        require("./b.ts");
        e.y2 = 2;
      `,
      "/b.ts": /* js */ `
        import * as x from "./x.cjs";
        import * as y from "./y.cjs";
        console.log(Object.keys(x).join(","), Object.keys(y).join(","));
      `,
    },
    run: { stdout: "default,x1 default,y1\ndefault,x1,x2 default,y1,y2" },
  });

  // Test 75: the body throws after the import. The names set before the throw
  // are all there for a later import.
  itBundled("cjs/__toESM_module_still_loading_then_throws", {
    files: {
      "/entry.ts": /* js */ `
        try {
          require("./a.cjs");
        } catch (e) {
          console.log(e.message);
        }
        const ns = await import("./a.cjs");
        console.log(Object.keys(ns).join(","));
      `,
      "/a.cjs": /* js */ `
        const e = exports;
        e.one = 1;
        require("./b.ts");
        e.two = 2;
        throw new Error("boom");
      `,
      "/b.ts": /* js */ `
        import * as a from "./a.cjs";
        console.log(Object.keys(a).join(","));
      `,
    },
    run: { stdout: "default,one\nboom\ndefault,one,two" },
  });

  // Test 76: "default" is picked again after the load. TypeScript output sets
  // `exports.default` where the source has it, below the `require()` calls.
  itBundled("cjs/__toESM_module_still_loading_late_default", {
    files: {
      "/entry.ts": /* js */ `
        import lib, { early } from "./lib.cjs";
        console.log(typeof lib, early);
      `,
      "/lib.cjs": /* js */ `
        "use strict";
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.early = 1;
        require("./user.ts");
        exports.default = function late() {};
      `,
      "/user.ts": /* js */ `
        import * as lib from "./lib.cjs";
        console.log(typeof lib.default, lib.early);
      `,
    },
    run: { stdout: "object 1\nfunction 1" },
  });

  // Test 77: `module.exports` is replaced, before or after the import
  itBundled("cjs/__toESM_module_still_loading_module_exports_replaced", {
    files: {
      "/entry.ts": /* js */ `
        import * as a from "./a.cjs";
        console.log(Object.keys(a).join(","), a.late);
      `,
      "/a.cjs": /* js */ `
        exports.early = 1;
        require("./b.ts");
        module.exports = { replaced: true };
        require("./c.ts");
        module.exports.late = 2;
      `,
      "/b.ts": /* js */ `
        import * as a from "./a.cjs";
        console.log(Object.keys(a).join(","));
      `,
      "/c.ts": /* js */ `
        import * as a from "./a.cjs";
        console.log(Object.keys(a).join(","));
      `,
    },
    run: { stdout: "default,early\ndefault,replaced\ndefault,replaced,late 2" },
  });

  // Test 78: no import cycle. `y.cjs` is loaded, but its `module.exports` is
  // now the object that `z.cjs` is still filling.
  itBundled("cjs/__toESM_exports_of_another_module_still_loading", {
    files: {
      "/entry.ts": /* js */ `
        import "./z.cjs";
        import * as y from "./y.cjs";
        console.log(Object.keys(y).join(","), y.late);
      `,
      "/z.cjs": /* js */ `
        const e = exports;
        e.early = 1;
        require("./y.cjs").adopt(e);
        require("./f.ts");
        e.late = 2;
      `,
      "/y.cjs": /* js */ `module.exports.adopt = o => { module.exports = o; };`,
      "/f.ts": /* js */ `
        import * as y from "./y.cjs";
        console.log(Object.keys(y).join(","));
      `,
    },
    run: { stdout: "default,early\ndefault,early,late 2" },
  });

  // Test 79: `export *` from the module inside its load is one more importer.
  // It copies the names set so far.
  itBundled("cjs/__toESM_module_still_loading_export_star", {
    files: {
      "/entry.js": /* js */ `
        require("./a.cjs");
        const { a, b } = require("./later.ts");
        console.log(Object.keys(a).join(","), Object.keys(b).join(","));
      `,
      "/a.cjs": /* js */ `
        const e = exports;
        e.early = 1;
        require("./b.ts");
        e.late = 2;
      `,
      "/b.ts": /* js */ `
        export * from "./a.cjs";
        export const own = 1;
      `,
      "/later.ts": /* js */ `
        import * as a from "./a.cjs";
        import * as b from "./b.ts";
        export { a, b };
      `,
    },
    run: { stdout: "default,early,late own,early" },
  });

  // Test 80: a function as `module.exports` has no cached namespace
  itBundled("cjs/__toESM_function_still_loading", {
    files: {
      "/entry.ts": /* js */ `
        import * as ns from "./fn.cjs";
        console.log(typeof ns.default, ns.early, ns.late);
      `,
      "/fn.cjs": /* js */ `
        module.exports = function f() {};
        module.exports.early = 1;
        require("./user.ts");
        module.exports.late = 2;
      `,
      "/user.ts": /* js */ `
        import * as ns from "./fn.cjs";
        console.log(typeof ns.default, ns.early, ns.late);
      `,
    },
    run: { stdout: "function 1 undefined\nfunction 1 2" },
  });

  // ============================================================================
  // What does not change: the namespace of a loaded module is built once.
  // ============================================================================

  // Test 81: a name added after the load is not in the namespace, and every
  // import gets the same object. Node and `bun run` do the same.
  itBundled("cjs/__toESM_loaded_module_has_one_namespace", {
    files: {
      "/entry.mjs": /* js */ `
        import * as first from "./lib.cjs";
        first.default.setLate();
        const ns = await import("./lib.cjs");
        console.log(ns === first, Object.keys(ns).join(","), ns.late, ns.default.late);
      `,
      "/lib.cjs": /* js */ `
        const e = exports;
        e.early = 1;
        e.setLate = () => { e.late = 2; };
      `,
    },
    run: { stdout: "true default,early,setLate undefined 2" },
  });

  // Test 82: importers inside the load share one namespace when no name was
  // set between them. An import after the load gets that object too.
  itBundled("cjs/__toESM_module_still_loading_shares_unchanged_namespace", {
    files: {
      "/entry.ts": /* js */ `
        import * as hub from "./hub.cjs";
        const [p1, p2] = globalThis.seen;
        console.log(p1 === p2, hub === p1, Object.keys(hub).join(","));
      `,
      "/hub.cjs": /* js */ `
        const e = exports;
        e.a = 1;
        e.b = 2;
        globalThis.seen = [];
        require("./p1.ts");
        require("./p2.ts");
      `,
      "/p1.ts": /* js */ `
        import * as hub from "./hub.cjs";
        globalThis.seen.push(hub);
      `,
      "/p2.ts": /* js */ `
        import * as hub from "./hub.cjs";
        globalThis.seen.push(hub);
      `,
    },
    run: { stdout: "true true default,a,b" },
  });

  // Test 83: a module whose body threw is not loading any more. Its namespace
  // is built once, like that of a loaded module.
  itBundled("cjs/__toESM_module_that_threw_has_one_namespace", {
    files: {
      "/entry.mjs": /* js */ `
        try {
          require("./x.cjs");
        } catch (e) {
          console.log(e.message);
        }
        const first = await import("./x.cjs");
        first.default.setLate();
        const ns = await import("./x.cjs");
        console.log(ns === first, Object.keys(ns).join(","));
      `,
      "/x.cjs": /* js */ `
        const e = exports;
        e.one = 1;
        e.setLate = () => { e.late = 2; };
        throw new Error("boom");
      `,
    },
    run: { stdout: "boom\ntrue default,one,setLate" },
  });

  // ============================================================================
  // The other direction: `require()` of an ES module while it is still
  // loading. `__toCommonJS` caches the view it returns. An `export *` that
  // runs later adds its names to that view.
  // ============================================================================

  const requiredWhileLoading = {
    "/b.ts": /* js */ `
      import "./c.cjs";
      export * from "./d.cjs";
      export const own = 1;
    `,
    "/c.cjs": /* js */ `globalThis.early = require("./b.ts");`,
    "/d.cjs": /* js */ `
      const e = exports;
      e.fromD = "d";
    `,
  };

  // Test 84: a `require()` after the load
  itBundled("cjs/__toCommonJS_module_still_loading_export_star", {
    files: {
      "/entry.cjs": /* js */ `
        const b = require("./b.ts");
        console.log(Object.keys(b).join(","), b.fromD, b === globalThis.early);
      `,
      ...requiredWhileLoading,
    },
    target: "node",
    run: { stdout: "own,fromD d true" },
  });

  // Test 85: in CommonJS output the view of the entry point is
  // `module.exports`, and it stays that object
  itBundled("cjs/__toCommonJS_entry_still_loading_export_star_format_cjs", {
    files: {
      "/entry.ts": /* js */ `
        import "./c.cjs";
        export * from "./d.cjs";
        export const own = 1;
        export const self = () => require("./lazy.cjs").get();
      `,
      "/c.cjs": /* js */ `globalThis.early = require("./entry.ts");`,
      "/d.cjs": requiredWhileLoading["/d.cjs"],
      "/lazy.cjs": /* js */ `exports.get = () => require("./entry.ts");`,
      "/run.cjs": /* js */ `
        const m = require("./out.js");
        console.log(Object.keys(m).sort().join(","), m.fromD, m.self() === m, globalThis.early === m);
      `,
    },
    target: "node",
    format: "cjs",
    run: { file: "/run.cjs", stdout: "fromD,own,self d true true" },
  });
});
