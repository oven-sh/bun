import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests for CommonJS <> ESM interop, specifically the __toESM helper behavior.
//
// The key insight from the code change:
// - `input_module_type` is set based on the AST's exports_kind (whether the importing
//   file uses ESM syntax like import/export or CJS syntax like require/module.exports)
// - When a file uses ESM syntax (import/export), isNodeMode = 1
// - When a file uses CJS syntax (require), __toESM is not used at all
//
// This means:
// - Any file using `import` will always get isNodeMode=1, which IGNORES __esModule
//   and always wraps the CJS module as the default export
// - This matches Node.js ESM behavior where importing CJS from .mjs always wraps
//   the entire exports object as the default
//
// The __esModule marker is only respected in non-bundled scenarios or when using
// actual CommonJS require() syntax.

describe("bundler", () => {
  // ============================================================================
  // Tests with ESM syntax (import statements)
  // These all use isNodeMode=1, which IGNORES __esModule
  // ============================================================================

  // Test 1: import with __esModule marker - IGNORED
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
      // With import syntax, isNodeMode=1, so __esModule is IGNORED
      // The entire CJS exports object is wrapped as default
      stdout: '{"__esModule":true,"default":{"value":"default export"},"named":"named export"}',
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
      // Namespace import only gets the CJS exports as-is, no default wrapper
      stdout: '{"bar":"bar","foo":"foo"}',
    },
  });

  // ============================================================================
  // Tests with different targets
  // Target doesn't affect isNodeMode - it's based on syntax
  // ============================================================================

  // Test 7: target=node
  itBundled("cjs/__toESM_target_node", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.x = 1;
        exports.y = 2;
      `,
    },
    target: "node",
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
        exports.x = 1;
        exports.y = 2;
      `,
    },
    target: "browser",
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
        exports.x = 1;
        exports.y = 2;
      `,
    },
    target: "bun",
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
      // __esModule ignored because we're using import syntax
      stdout: '{"__esModule":true,"default":"the default","other":"other"}',
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
      // Still ignores __esModule because entry uses import syntax
      stdout: '{"__esModule":true,"default":"the default","other":"other"}',
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

  // Test 13: .mjs re-exporting with __esModule (still ignored)
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
      // __esModule ignored - entire module wrapped as default
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
      // Even if __esModule were respected, only `true` would work
      // But it's ignored anyway due to import syntax
      stdout: '{"__esModule":"truthy","default":{"value":"default"},"other":"other"}',
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
      // Entire module wrapped as default (since we use import syntax)
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
      // __esModule is in the object but ignored due to import syntax
      stdout: '{"__esModule":true,"default":{"value":"nested"},"other":"prop"}',
    },
  });

  // Test 21: Input=ESM, output=CJS, importing CJS with __esModule and named imports
  // This test covers the specific fix for printing __toESM when output format is CJS
  // and input uses ESM syntax to import both default and named exports from CJS with __esModule
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
      // With the fix: ignores __esModule, wraps entire module as default
      // So default gets the whole exports object, named gets the named property
      stdout:
        '{"default":{"__esModule":true,"default":{"value":"default"},"named":"named export"},"named":"named export"}',
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
  // __require in iife output. Anything the printer rewrites to the runtime's
  // `__require` (a require() with a non-literal argument, require.resolve(),
  // an uncalled `require` reference, an external require) needs the runtime
  // part that defines it to be kept in the bundle, for every target.
  // ============================================================================

  const dynamicRequireFiles = {
    "/entry.js": /* js */ `
      import value from "./dyn.cjs";
      console.log(value);
    `,
    "/dyn.cjs": /* js */ `
      var ext = ".cjs";
      module.exports = require("./dep-runtime" + ext).value;
    `,
  };
  const dynamicRequireRuntimeFiles = {
    "/dep-runtime.cjs": /* js */ `module.exports = { value: "required at runtime" };`,
  };

  // Test 29: the node flavor of __require (createRequire(import.meta.url)) cannot
  // exist inside an iife, so node gets the same shim as the browser and the
  // shim forwards to the host's require when the iife is loaded as CommonJS.
  itBundled("cjs/__require_iife_dynamic_require_target_node", {
    files: dynamicRequireFiles,
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "node",
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatch(/var __require = /);
      api.expectFile("/out.js").not.toContain("createRequire");
      api.expectFile("/out.js").not.toContain("import.meta");
    },
    run: [{ runtime: "node", stdout: "required at runtime" }, { stdout: "required at runtime" }],
  });

  // Test 30: target bun keeps its import.meta.require flavor. Bun loads the
  // `// @bun` output as an ES module, where that is the only require available.
  itBundled("cjs/__require_iife_dynamic_require_target_bun", {
    files: dynamicRequireFiles,
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "bun",
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("var __require = import.meta.require;");
    },
    run: {
      stdout: "required at runtime",
    },
  });

  // Test 31: target browser
  itBundled("cjs/__require_iife_dynamic_require_target_browser", {
    files: dynamicRequireFiles,
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "browser",
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatch(/var __require = /);
    },
    run: [{ runtime: "node", stdout: "required at runtime" }, { stdout: "required at runtime" }],
  });

  // Test 32: same as above with the renamer running over the runtime part
  itBundled("cjs/__require_iife_dynamic_require_minified", {
    files: dynamicRequireFiles,
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "browser",
    format: "iife",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: [{ runtime: "node", stdout: "required at runtime" }, { stdout: "required at runtime" }],
  });

  // Test 33: without a host require() the shim throws esbuild's error instead of
  // the bundle failing on the missing __require binding. `new Function` runs the
  // iife in the global scope, where the module-scoped `require` is not visible.
  itBundled("cjs/__require_iife_dynamic_require_without_host_require", {
    files: {
      ...dynamicRequireFiles,
      "/test.js": /* js */ `
        import { readFileSync } from "node:fs";
        const code = readFileSync(new URL("./out.js", import.meta.url), "utf8");
        try {
          new Function(code)();
        } catch (e) {
          console.log(e.message);
        }
      `,
    },
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "browser",
    format: "iife",
    run: {
      file: "/test.js",
      stdout: 'Dynamic require of "./dep-runtime.cjs" is not supported',
    },
  });

  // Test 34: require.resolve(), an uncalled `require` and require.main all print
  // through the same __require binding
  itBundled("cjs/__require_iife_require_reference_forms", {
    files: {
      "/entry.js": /* js */ `
        import value from "./forms.cjs";
        console.log(value.join("\\n"));
      `,
      "/forms.cjs": /* js */ `
        var ext = ".cjs";
        var indirect = require;
        module.exports = [
          indirect("./dep-runtime" + ext).value,
          require.resolve("./dep-runtime" + ext).endsWith("dep-runtime.cjs"),
          typeof require.main,
        ];
      `,
    },
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "node",
    format: "iife",
    run: [
      { runtime: "node", stdout: "required at runtime\ntrue\nobject" },
      { stdout: "required at runtime\ntrue\nobject" },
    ],
  });

  // Test 35: a require() of an external package already pulled __require in for
  // iife output, but target node defined it with an import of node:module that
  // the iife turned into `__require("node:module")`, a reference to itself.
  itBundled("cjs/__require_iife_external_require_target_node", {
    files: {
      "/entry.js": /* js */ `
        import value from "./dep.cjs";
        console.log(value);
      `,
      "/dep.cjs": /* js */ `
        module.exports = require("ext").value;
      `,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": /* js */ `module.exports = { value: "external package" };`,
    },
    external: ["ext"],
    target: "node",
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('__require("ext")');
      api.expectFile("/out.js").not.toContain('__require("node:module")');
      api.expectFile("/out.js").not.toContain("import.meta");
    },
    run: [{ runtime: "node", stdout: "external package" }, { stdout: "external package" }],
  });

  // Test 36: esm output for node is unchanged by the iife shim
  itBundled("cjs/__require_esm_dynamic_require_target_node", {
    files: dynamicRequireFiles,
    runtimeFiles: dynamicRequireRuntimeFiles,
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    onAfterBundle(api) {
      api.expectFile("/out.mjs").toContain('import { createRequire } from "node:module";');
      api.expectFile("/out.mjs").toContain("createRequire(import.meta.url)");
    },
    run: {
      runtime: "node",
      stdout: "required at runtime",
    },
  });
});
