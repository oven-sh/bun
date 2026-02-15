import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests for CommonJS <> ESM interop, specifically the __toESM helper behavior.
//
// The key insight from the code change:
// - `input_module_type` is set based on the RESOLVER's module type determination
//   (file extension .mjs/.mts and package.json "type" field), NOT on syntax detection.
// - The isNodeMode flag is ONLY set when BOTH conditions are true:
//   1. The target is Node.js (not browser/bun)
//   2. The importing file is in Node ESM mode (.mjs/.mts or "type": "module")
//
// This means:
// - For browser/bun targets: __esModule is ALWAYS respected
// - For Node.js target with Node ESM files: __esModule is ignored (matches Node.js behavior)
// - For Node.js target with regular .js files: __esModule is respected
//
// This matches both Babel/TypeScript interop expectations for browser bundles
// and Node.js native ESM behavior when targeting Node.js.

describe("bundler", () => {
  // ============================================================================
  // Tests with regular .js entry file (default browser target)
  // __esModule is ALWAYS respected for browser targets
  // ============================================================================

  // Test 1: import with __esModule marker - RESPECTED
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
      // Browser target: __esModule IS RESPECTED
      // The default import gets exports.default
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
      // No __esModule, so entire module wrapped as default
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

  // Test 5: import with named + default (with __esModule)
  itBundled("cjs/__toESM_import_syntax_named_and_default", {
    files: {
      "/entry.js": /* js */ `
        import lib, { foo } from './lib.cjs';
        console.log(JSON.stringify({ default: lib, named: foo }));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = 'the default';
        exports.foo = 'foo value';
        exports.bar = 'bar value';
      `,
    },
    run: {
      // __esModule is respected: default gets exports.default, named gets exports.foo
      stdout: '{"default":"the default","named":"foo value"}',
    },
  });

  // Test 5b: import with named + default (without __esModule)
  itBundled("cjs/__toESM_import_syntax_named_and_default_no_esModule", {
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
      // No __esModule: default gets entire module, named gets exports.foo
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
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // ============================================================================
  // Tests with different targets
  // Only Node.js target + Node ESM files ignore __esModule
  // ============================================================================

  // Test 7: target=node with .js entry - __esModule RESPECTED
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
      // .js file is NOT Node ESM, so __esModule would be respected if present
      // No __esModule here, so entire module wrapped as default
      stdout: '{"x":1,"y":2}',
    },
  });

  // Test 8: target=browser - __esModule ALWAYS RESPECTED
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

  // Test 9: target=bun - __esModule ALWAYS RESPECTED
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
  // Output format doesn't affect isNodeMode
  // ============================================================================

  // Test 10: format=esm with __esModule (should be respected for browser target)
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
      // __esModule respected for browser target
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
      // __esModule respected for browser target
      stdout: '"the default"',
    },
  });

  // ============================================================================
  // Tests for .mjs files re-exporting from .cjs (browser target)
  // For browser target, __esModule is ALWAYS respected, even for .mjs files
  // ============================================================================

  // Test 12: .mjs re-exporting default from CJS (browser target)
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
      // Browser target: entire module wrapped as default (no __esModule)
      stdout: '{"foo":"foo","bar":"bar"}',
    },
  });

  // Test 13: .mjs re-exporting with __esModule (browser target - RESPECTED)
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
      // Browser target: __esModule IS RESPECTED, default gets exports.default
      stdout: '{"value":"from cjs"}',
    },
  });

  // Test 14: Deep re-export chain through .mjs files (browser target)
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

  // Test 15: Re-export with rename from .mjs (browser target)
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
      // No __esModule, so entire module wrapped as default
      stdout: '{"default":"I am a prop named default","other":"other"}',
    },
  });

  // Test 17: Mixed import styles (with __esModule)
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
        exports.__esModule = true;
        exports.default = 'the default';
        exports.foo = 'foo';
        exports.bar = 'bar';
      `,
    },
    run: {
      // __esModule respected: default gets exports.default, named gets exports.foo
      // namespace gets all exports
      stdout:
        '{"default":"the default","named":"foo","namespace":{"default":"the default","foo":"foo","bar":"bar","__esModule":true}}',
    },
  });

  // Test 17b: Mixed import styles (without __esModule)
  itBundled("cjs/__toESM_mixed_import_styles_no_esModule", {
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
      // No __esModule: default gets entire module, named gets exports.foo
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
      // __esModule must be strictly `true` to be respected
      // 'truthy' is not `true`, so entire module wrapped as default
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
      // __esModule = false, so entire module wrapped as default
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
      // __esModule respected, default gets the default property
      stdout: '{"value":"nested"}',
    },
  });

  // Test 21: Input=ESM, output=CJS, importing CJS with __esModule and named imports
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
      // __esModule respected: default gets exports.default, named gets exports.named
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
      // Star import gets exports as-is (though may have synthetic default added)
      stdout: '{"named":"named","default":"default","__esModule":true}',
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
      // No __esModule: Default gets entire module, named import gets specific function
      // Both reference the same function
      stdout: '{"hasMap":true,"same":true}',
    },
  });

  // ============================================================================
  // Tests for the original issue #26901 - browser target scenarios
  // ============================================================================

  // Test 24: .js importing from CJS with __esModule (browser target)
  itBundled("cjs/__toESM_issue_26901_js_file", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { msg: 'hello' };
      `,
    },
    run: {
      // Browser target: __esModule is RESPECTED
      stdout: '{"msg":"hello"}',
    },
  });

  // Test 25: .mjs importing from CJS with __esModule (browser target)
  itBundled("cjs/__toESM_issue_26901_mjs_file", {
    files: {
      "/entry.mjs": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { msg: 'hello' };
      `,
    },
    run: {
      // Browser target: __esModule is RESPECTED even for .mjs entry
      stdout: '{"msg":"hello"}',
    },
  });

  // Test 26: "type": "module" with browser target - __esModule is RESPECTED
  itBundled("cjs/__toESM_issue_26901_type_module_browser", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/package.json": /* json */ `
        { "type": "module" }
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { msg: 'hello' };
      `,
    },
    // Default target is browser
    run: {
      // Browser target: __esModule is RESPECTED even with "type": "module"
      stdout: '{"msg":"hello"}',
    },
  });

  // ============================================================================
  // Tests for Node.js target with Node ESM files
  // Only this combination ignores __esModule
  // ============================================================================

  // Test 27: target=node with .mjs entry - __esModule is IGNORED
  itBundled("cjs/__toESM_node_target_mjs_entry", {
    files: {
      "/entry.mjs": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { msg: 'hello' };
      `,
    },
    target: "node",
    run: {
      // Node.js target + .mjs entry: __esModule is IGNORED (Node.js behavior)
      stdout: '{"__esModule":true,"default":{"msg":"hello"}}',
    },
  });

  // Test 28: target=node with "type": "module" - __esModule is IGNORED
  itBundled("cjs/__toESM_node_target_type_module", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/package.json": /* json */ `
        { "type": "module" }
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { msg: 'hello' };
      `,
    },
    target: "node",
    run: {
      // Node.js target + "type": "module": __esModule is IGNORED (Node.js behavior)
      stdout: '{"__esModule":true,"default":{"msg":"hello"}}',
    },
  });

  // Test 29: target=node with regular .js entry - __esModule is RESPECTED
  itBundled("cjs/__toESM_node_target_js_entry", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.cjs';
        console.log(JSON.stringify(lib));
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = { msg: 'hello' };
      `,
    },
    target: "node",
    run: {
      // Node.js target + .js entry (NOT Node ESM): __esModule is RESPECTED
      stdout: '{"msg":"hello"}',
    },
  });
});
