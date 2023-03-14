import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_dce_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/dce

describe("bundler", () => {
  itBundled("dce/PackageJsonSideEffectsFalseKeepNamedImportES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepNamedImportCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepStarImportES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log(ns)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepStarImportCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log(ns)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsTrueKeepES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": true
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsTrueKeepCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": true
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        require('demo-pkg')
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        require('demo-pkg')
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveBareImportES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveBareImportCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveNamedImportES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveNamedImportCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveStarImportES6", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveStarImportCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayRemove", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": []
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeep", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./index.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainUseModule", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainUseMain", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainImplicitModule", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainImplicitMain", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        import "./require-demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/src/require-demo-pkg.js": /* js */ `
        // This causes "index-main.js" to be selected
        require('demo-pkg')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-main.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleUseModule", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleUseMain", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleImplicitModule", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleImplicitMain", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        import "./require-demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/src/require-demo-pkg.js": /* js */ `
        // This causes "index-main.js" to be selected
        require('demo-pkg')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = 123
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = 123
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsArrayGlob", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/keep/this/file"
        import "demo-pkg/remove/this/file"
      `,
      "/Users/user/project/node_modules/demo-pkg/keep/this/file.js": `console.log('this should be kept')`,
      "/Users/user/project/node_modules/demo-pkg/remove/this/file.js": `console.log('TEST FAILED')`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": [
            "./ke?p/*/file.js",
            "./remove/this/file.j",
            "./re?ve/this/file.js"
          ]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsNestedDirectoryRemove", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg/a/b/c"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/a/b/c/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsKeepExportDefaultExpr", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import foo from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": `export default exprWithSideEffects()`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseNoWarningInNodeModulesIssue999", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('used import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        import "demo-pkg2"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg2/index.js": /* js */ `
        export const foo = 123
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg2/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesUnused", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import {foo} from "demo-pkg"`,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export {foo} from "./foo.js"
        throw 'REMOVE THIS'
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `export const foo = 123`,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{ "sideEffects": false }`,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesUsed", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export {foo} from "./foo.js"
        throw 'keep this'
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `export const foo = 123`,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{ "sideEffects": false }`,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesChainAll", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/a/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo} from "c"
        throw 'keep this'
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/c/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
      "/Users/user/project/node_modules/d/package.json": `{ "sideEffects": false }`,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesChainOne", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo} from "c"
        throw 'keep this'
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesDiamond", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": /* js */ `
        export * from "b1"
        export * from "b2"
      `,
      "/Users/user/project/node_modules/b1/index.js": /* js */ `
        export {foo} from "c"
        throw 'keep this 1'
      `,
      "/Users/user/project/node_modules/b1/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/b2/index.js": /* js */ `
        export {foo} from "c"
        throw 'keep this 2'
      `,
      "/Users/user/project/node_modules/b2/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseOneFork", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import("a").then(x => assert(x.foo === "foo"))`,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo, bar} from "c"
        export {baz} from "d"
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": /* js */ `
        export let foo = "foo"
        export let bar = "bar"
      `,
      "/Users/user/project/node_modules/d/index.js": `export let baz = "baz"`,
    },
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseAllFork", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import("a").then(x => assert(x.foo === "foo"))`,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo, bar} from "c"
        export {baz} from "d"
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": /* js */ `
        export let foo = "foo"
        export let bar = "bar"
      `,
      "/Users/user/project/node_modules/c/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/d/index.js": `export let baz = "baz"`,
      "/Users/user/project/node_modules/d/package.json": `{ "sideEffects": false }`,
    },
    snapshot: true,
  });
  itBundled("dce/JSONLoaderRemoveUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.json"
        console.log('unused import')
      `,
      "/example.json": `{"data": true}`,
    },
    snapshot: true,
  });
  itBundled("dce/TextLoaderRemoveUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.txt"
        console.log('unused import')
      `,
      "/example.txt": `some data`,
    },
    snapshot: true,
  });
  itBundled("dce/Base64LoaderRemoveUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `some data`,
    },
    snapshot: true,
  });
  itBundled("dce/DataURLLoaderRemoveUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `some data`,
    },
    snapshot: true,
  });
  itBundled("dce/FileLoaderRemoveUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `some data`,
    },
    snapshot: true,
  });
  itBundled("dce/RemoveUnusedImportMeta", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function foo() {
          console.log(import.meta.url, import.meta.path)
        }
        console.log('foo is unused')
      `,
    },
    snapshot: true,
  });
  itBundled("dce/RemoveUnusedPureCommentCalls", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function bar() {}
        let bare = foo(bar);
  
        let at_yes = /* @__PURE__ */ foo(bar);
        let at_no = /* @__PURE__ */ foo(bar());
        let new_at_yes = /* @__PURE__ */ new foo(bar);
        let new_at_no = /* @__PURE__ */ new foo(bar());
  
        let nospace_at_yes = /*@__PURE__*/ foo(bar);
        let nospace_at_no = /*@__PURE__*/ foo(bar());
        let nospace_new_at_yes = /*@__PURE__*/ new foo(bar);
        let nospace_new_at_no = /*@__PURE__*/ new foo(bar());
  
        let num_yes = /* #__PURE__ */ foo(bar);
        let num_no = /* #__PURE__ */ foo(bar());
        let new_num_yes = /* #__PURE__ */ new foo(bar);
        let new_num_no = /* #__PURE__ */ new foo(bar());
  
        let nospace_num_yes = /*#__PURE__*/ foo(bar);
        let nospace_num_no = /*#__PURE__*/ foo(bar());
        let nospace_new_num_yes = /*#__PURE__*/ new foo(bar);
        let nospace_new_num_no = /*#__PURE__*/ new foo(bar());
  
        let dot_yes = /* @__PURE__ */ foo(sideEffect()).dot(bar);
        let dot_no = /* @__PURE__ */ foo(sideEffect()).dot(bar());
        let new_dot_yes = /* @__PURE__ */ new foo(sideEffect()).dot(bar);
        let new_dot_no = /* @__PURE__ */ new foo(sideEffect()).dot(bar());
  
        let nested_yes = [1, /* @__PURE__ */ foo(bar), 2];
        let nested_no = [1, /* @__PURE__ */ foo(bar()), 2];
        let new_nested_yes = [1, /* @__PURE__ */ new foo(bar), 2];
        let new_nested_no = [1, /* @__PURE__ */ new foo(bar()), 2];
  
        let single_at_yes = // @__PURE__
          foo(bar);
        let single_at_no = // @__PURE__
          foo(bar());
        let new_single_at_yes = // @__PURE__
          new foo(bar);
        let new_single_at_no = // @__PURE__
          new foo(bar());
  
        let single_num_yes = // #__PURE__
          foo(bar);
        let single_num_no = // #__PURE__
          foo(bar());
        let new_single_num_yes = // #__PURE__
          new foo(bar);
        let new_single_num_no = // #__PURE__
          new foo(bar());
  
        let bad_no = /* __PURE__ */ foo(bar);
        let new_bad_no = /* __PURE__ */ new foo(bar);
  
        let parens_no = (/* @__PURE__ */ foo)(bar);
        let new_parens_no = new (/* @__PURE__ */ foo)(bar);
  
        let exp_no = /* @__PURE__ */ foo() ** foo();
        let new_exp_no = /* @__PURE__ */ new foo() ** foo();
      `,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingReactElements", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": /* jsx */ `
        function Foo() {}
  
        let a = <div/>
        let b = <Foo>{a}</Foo>
        let c = <>{b}</>
  
        let d = <div/>
        let e = <Foo>{d}</Foo>
        let f = <>{e}</>
        console.log(f)
      `,
    },
    snapshot: true,
  });
  itBundled("dce/DisableTreeShaking", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": /* jsx */ `
        import './remove-me'
        function RemoveMe1() {}
        let removeMe2 = 0
        class RemoveMe3 {}
  
        import './keep-me'
        function KeepMe1() {}
        let keepMe2 = <KeepMe1/>
        function keepMe3() { console.log('side effects') }
        let keepMe4 = /* @__PURE__ */ keepMe3()
        let keepMe5 = pure()
        let keepMe6 = some.fn()
      `,
      "/remove-me.js": `export default 'unused'`,
      "/keep-me/index.js": `console.log('side effects')`,
      "/keep-me/package.json": `{ "sideEffects": false }`,
    },
    /* TODO: 
        IgnoreDCEAnnotations -- true, */
    define: null,
    /* TODO DEFINES config.ProcessDefines(map[string]config.DefineData{
  		"pure":    {CallCanBeUnwrappedIfUnused: true},
  		"some.fn": {CallCanBeUnwrappedIfUnused: true},
  	}) */ snapshot: true,
  });
  itBundled("dce/DeadCodeFollowingJump", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function testReturn() {
          if (true) return y + z()
          if (FAIL) return FAIL
          if (x) { var y }
          function z() { KEEP_ME() }
          return FAIL
        }
  
        function testThrow() {
          if (true) throw y + z()
          if (FAIL) return FAIL
          if (x) { var y }
          function z() { KEEP_ME() }
          return FAIL
        }
  
        function testBreak() {
          while (true) {
            if (true) {
              y + z()
              break
            }
            if (FAIL) return FAIL
            if (x) { var y }
            function z() { KEEP_ME() }
            return FAIL
          }
        }
  
        function testContinue() {
          while (true) {
            if (true) {
              y + z()
              continue
            }
            if (FAIL) return FAIL
            if (x) { var y }
            function z() { KEEP_ME() }
            return FAIL
          }
        }
  
        function testStmts() {
          return [a, b, c, d, e, f, g, h, i]
  
          while (x) { var a }
          while (FAIL) { let FAIL }
  
          do { var b } while (x)
          do { let FAIL } while (FAIL)
  
          for (var c; ;) ;
          for (let FAIL; ;) ;
  
          for (var d in x) ;
          for (let FAIL in FAIL) ;
  
          for (var e of x) ;
          for (let FAIL of FAIL) ;
  
          if (x) { var f }
          if (FAIL) { let FAIL }
  
          if (x) ; else { var g }
          if (FAIL) ; else { let FAIL }
  
          { var h }
          { let FAIL }
  
          x: { var i }
          x: { let FAIL }
        }
  
        testReturn()
        testThrow()
        testBreak()
        testContinue()
        testStmts()
      `,
    },
    snapshot: true,
  });
  itBundled("dce/RemoveTrailingReturn", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function foo() {
          if (a) b()
          return
        }
        function bar() {
          if (a) b()
          return KEEP_ME
        }
        export default [
          foo,
          bar,
          function () {
            if (a) b()
            return
          },
          function () {
            if (a) b()
            return KEEP_ME
          },
          () => {
            if (a) b()
            return
          },
          () => {
            if (a) b()
            return KEEP_ME
          },
        ]
      `,
    },
    minifySyntax: true,
    snapshot: true,
  });
  itBundled("dce/ImportReExportOfNamespaceImport", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.js": /* js */ `
        import * as ns from 'pkg'
        console.log(ns.foo)
      `,
      "/Users/user/project/node_modules/pkg/index.js": /* js */ `
        export { default as foo } from './foo'
        export { default as bar } from './bar'
      `,
      "/Users/user/project/node_modules/pkg/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/pkg/foo.js": `module.exports = 123`,
      "/Users/user/project/node_modules/pkg/bar.js": `module.exports = 'abc'`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingImportIdentifier", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import * as a from './a'
        new a.Keep()
      `,
      "/a.js": /* js */ `
        import * as b from './b'
        export class Keep extends b.Base {}
        export class REMOVE extends b.Base {}
      `,
      "/b.js": `export class Base {}`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingObjectProperty", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        let remove1 = { x: 'x' }
        let remove2 = { x() {} }
        let remove3 = { get x() {} }
        let remove4 = { set x(_) {} }
        let remove5 = { async x() {} }
        let remove6 = { ['x']: 'x' }
        let remove7 = { ['x']() {} }
        let remove8 = { get ['x']() {} }
        let remove9 = { set ['x'](_) {} }
        let remove10 = { async ['x']() {} }
        let remove11 = { [0]: 'x' }
        let remove12 = { [null]: 'x' }
        let remove13 = { [undefined]: 'x' }
        let remove14 = { [false]: 'x' }
        let remove15 = { [0n]: 'x' }
        let remove16 = { toString() {} }
  
        let keep1 = { x }
        let keep2 = { x: x }
        let keep3 = { ...x }
        let keep4 = { [x]: 'x' }
        let keep5 = { [x]() {} }
        let keep6 = { get [x]() {} }
        let keep7 = { set [x](_) {} }
        let keep8 = { async [x]() {} }
        let keep9 = { [{ toString() {} }]: 'x' }
      `,
    },
    treeShaking: true,
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/TreeShakingClassProperty", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        let remove1 = class { x }
        let remove2 = class { x = x }
        let remove3 = class { x() {} }
        let remove4 = class { get x() {} }
        let remove5 = class { set x(_) {} }
        let remove6 = class { async x() {} }
        let remove7 = class { ['x'] = x }
        let remove8 = class { ['x']() {} }
        let remove9 = class { get ['x']() {} }
        let remove10 = class { set ['x'](_) {} }
        let remove11 = class { async ['x']() {} }
        let remove12 = class { [0] = 'x' }
        let remove13 = class { [null] = 'x' }
        let remove14 = class { [undefined] = 'x' }
        let remove15 = class { [false] = 'x' }
        let remove16 = class { [0n] = 'x' }
        let remove17 = class { toString() {} }
  
        let keep1 = class { [x] = 'x' }
        let keep2 = class { [x]() {} }
        let keep3 = class { get [x]() {} }
        let keep4 = class { set [x](_) {} }
        let keep5 = class { async [x]() {} }
        let keep6 = class { [{ toString() {} }] = 'x' }
      `,
    },
    treeShaking: true,
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/TreeShakingClassStaticProperty", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        let remove1 = class { static x }
        let remove3 = class { static x() {} }
        let remove4 = class { static get x() {} }
        let remove5 = class { static set x(_) {} }
        let remove6 = class { static async x() {} }
        let remove8 = class { static ['x']() {} }
        let remove9 = class { static get ['x']() {} }
        let remove10 = class { static set ['x'](_) {} }
        let remove11 = class { static async ['x']() {} }
        let remove12 = class { static [0] = 'x' }
        let remove13 = class { static [null] = 'x' }
        let remove14 = class { static [undefined] = 'x' }
        let remove15 = class { static [false] = 'x' }
        let remove16 = class { static [0n] = 'x' }
        let remove17 = class { static toString() {} }
  
        let keep1 = class { static x = x }
        let keep2 = class { static ['x'] = x }
        let keep3 = class { static [x] = 'x' }
        let keep4 = class { static [x]() {} }
        let keep5 = class { static get [x]() {} }
        let keep6 = class { static set [x](_) {} }
        let keep7 = class { static async [x]() {} }
        let keep8 = class { static [{ toString() {} }] = 'x' }
      `,
    },
    treeShaking: true,
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/TreeShakingUnaryOperators", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // These operators may have side effects
        let keep;
        +keep;
        -keep;
        ~keep;
        delete keep;
        ++keep;
        --keep;
        keep++;
        keep--;
  
        // These operators never have side effects
        let REMOVE;
        !REMOVE;
        void REMOVE;
      `,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingBinaryOperators", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // These operators may have side effects
        let keep, keep2;
        keep + keep2;
        keep - keep2;
        keep * keep2;
        keep / keep2;
        keep % keep2;
        keep ** keep2;
        keep < keep2;
        keep <= keep2;
        keep > keep2;
        keep >= keep2;
        keep in keep2;
        keep instanceof keep2;
        keep << keep2;
        keep >> keep2;
        keep >>> keep2;
        keep == keep2;
        keep != keep2;
        keep | keep2;
        keep & keep2;
        keep ^ keep2;
        keep = keep2;
        keep += keep2;
        keep -= keep2;
        keep *= keep2;
        keep /= keep2;
        keep %= keep2;
        keep **= keep2;
        keep <<= keep2;
        keep >>= keep2;
        keep >>>= keep2;
        keep |= keep2;
        keep &= keep2;
        keep ^= keep2;
        keep ??= keep2;
        keep ||= keep2;
        keep &&= keep2;
  
        // These operators never have side effects
        let REMOVE, REMOVE2;
        REMOVE === REMOVE2;
        REMOVE !== REMOVE2;
        REMOVE, REMOVE2;
        REMOVE ?? REMOVE2;
        REMOVE || REMOVE2;
        REMOVE && REMOVE2;
      `,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingNoBundleESM", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function unused() {}
        keep()
      `,
    },
    format: "esm",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("dce/TreeShakingNoBundleCJS", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function unused() {}
        keep()
      `,
    },
    format: "cjs",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("dce/TreeShakingNoBundleIIFE", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    format: "iife",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("dce/TreeShakingInESMWrapper", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import {keep1} from './lib'
        console.log(keep1(), require('./cjs'))
      `,
      "/cjs.js": /* js */ `
        import {keep2} from './lib'
        export default keep2()
      `,
      "/lib.js": /* js */ `
        export let keep1 = () => 'keep1'
        export let keep2 = () => 'keep2'
        export let REMOVE = () => 'REMOVE'
      `,
    },
    format: "esm",
    snapshot: true,
  });
  itBundled("dce/DCETypeOf", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // These should be removed because they have no side effects
        typeof x_REMOVE
        typeof v_REMOVE
        typeof f_REMOVE
        typeof g_REMOVE
        typeof a_REMOVE
        var v_REMOVE
        function f_REMOVE() {}
        function* g_REMOVE() {}
        async function a_REMOVE() {}
  
        // These technically have side effects due to TDZ, but this is not currently handled
        typeof c_remove
        typeof l_remove
        typeof s_remove
        const c_remove = 0
        let l_remove
        class s_remove {}
      `,
    },
    format: "esm",
    snapshot: true,
  });
  itBundled("dce/DCETypeOfEqualsString", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        var hasBar = typeof bar !== 'undefined'
        if (false) console.log(hasBar)
      `,
    },
    format: "iife",
    snapshot: true,
  });
  itBundled("dce/DCETypeOfEqualsStringMangle", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var hasBar = typeof bar !== 'undefined'
        if (false) console.log(hasBar)
      `,
    },
    format: "iife",
    minifySyntax: true,
    snapshot: true,
  });
  itBundled("dce/DCETypeOfEqualsStringGuardCondition", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE_1 = typeof x !== 'undefined' ? x : null
        var REMOVE_1 = typeof x != 'undefined' ? x : null
        var REMOVE_1 = typeof x === 'undefined' ? null : x
        var REMOVE_1 = typeof x == 'undefined' ? null : x
        var REMOVE_1 = typeof x !== 'undefined' && x
        var REMOVE_1 = typeof x != 'undefined' && x
        var REMOVE_1 = typeof x === 'undefined' || x
        var REMOVE_1 = typeof x == 'undefined' || x
        var REMOVE_1 = 'undefined' !== typeof x ? x : null
        var REMOVE_1 = 'undefined' != typeof x ? x : null
        var REMOVE_1 = 'undefined' === typeof x ? null : x
        var REMOVE_1 = 'undefined' == typeof x ? null : x
        var REMOVE_1 = 'undefined' !== typeof x && x
        var REMOVE_1 = 'undefined' != typeof x && x
        var REMOVE_1 = 'undefined' === typeof x || x
        var REMOVE_1 = 'undefined' == typeof x || x
  
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE_2 = typeof x === 'object' ? x : null
        var REMOVE_2 = typeof x == 'object' ? x : null
        var REMOVE_2 = typeof x !== 'object' ? null : x
        var REMOVE_2 = typeof x != 'object' ? null : x
        var REMOVE_2 = typeof x === 'object' && x
        var REMOVE_2 = typeof x == 'object' && x
        var REMOVE_2 = typeof x !== 'object' || x
        var REMOVE_2 = typeof x != 'object' || x
        var REMOVE_2 = 'object' === typeof x ? x : null
        var REMOVE_2 = 'object' == typeof x ? x : null
        var REMOVE_2 = 'object' !== typeof x ? null : x
        var REMOVE_2 = 'object' != typeof x ? null : x
        var REMOVE_2 = 'object' === typeof x && x
        var REMOVE_2 = 'object' == typeof x && x
        var REMOVE_2 = 'object' !== typeof x || x
        var REMOVE_2 = 'object' != typeof x || x
  
        // Everything here should be kept as live code because it has side effects
        var keep_1 = typeof x !== 'object' ? x : null
        var keep_1 = typeof x != 'object' ? x : null
        var keep_1 = typeof x === 'object' ? null : x
        var keep_1 = typeof x == 'object' ? null : x
        var keep_1 = typeof x !== 'object' && x
        var keep_1 = typeof x != 'object' && x
        var keep_1 = typeof x === 'object' || x
        var keep_1 = typeof x == 'object' || x
        var keep_1 = 'object' !== typeof x ? x : null
        var keep_1 = 'object' != typeof x ? x : null
        var keep_1 = 'object' === typeof x ? null : x
        var keep_1 = 'object' == typeof x ? null : x
        var keep_1 = 'object' !== typeof x && x
        var keep_1 = 'object' != typeof x && x
        var keep_1 = 'object' === typeof x || x
        var keep_1 = 'object' == typeof x || x
  
        // Everything here should be kept as live code because it has side effects
        var keep_2 = typeof x !== 'undefined' ? y : null
        var keep_2 = typeof x != 'undefined' ? y : null
        var keep_2 = typeof x === 'undefined' ? null : y
        var keep_2 = typeof x == 'undefined' ? null : y
        var keep_2 = typeof x !== 'undefined' && y
        var keep_2 = typeof x != 'undefined' && y
        var keep_2 = typeof x === 'undefined' || y
        var keep_2 = typeof x == 'undefined' || y
        var keep_2 = 'undefined' !== typeof x ? y : null
        var keep_2 = 'undefined' != typeof x ? y : null
        var keep_2 = 'undefined' === typeof x ? null : y
        var keep_2 = 'undefined' == typeof x ? null : y
        var keep_2 = 'undefined' !== typeof x && y
        var keep_2 = 'undefined' != typeof x && y
        var keep_2 = 'undefined' === typeof x || y
        var keep_2 = 'undefined' == typeof x || y
  
        // Everything here should be kept as live code because it has side effects
        var keep_3 = typeof x !== 'undefined' ? null : x
        var keep_3 = typeof x != 'undefined' ? null : x
        var keep_3 = typeof x === 'undefined' ? x : null
        var keep_3 = typeof x == 'undefined' ? x : null
        var keep_3 = typeof x !== 'undefined' || x
        var keep_3 = typeof x != 'undefined' || x
        var keep_3 = typeof x === 'undefined' && x
        var keep_3 = typeof x == 'undefined' && x
        var keep_3 = 'undefined' !== typeof x ? null : x
        var keep_3 = 'undefined' != typeof x ? null : x
        var keep_3 = 'undefined' === typeof x ? x : null
        var keep_3 = 'undefined' == typeof x ? x : null
        var keep_3 = 'undefined' !== typeof x || x
        var keep_3 = 'undefined' != typeof x || x
        var keep_3 = 'undefined' === typeof x && x
        var keep_3 = 'undefined' == typeof x && x
      `,
    },
    format: "iife",
    snapshot: true,
  });
  itBundled("dce/DCETypeOfCompareStringGuardCondition", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE_1 = typeof x <= 'u' ? x : null
        var REMOVE_1 = typeof x < 'u' ? x : null
        var REMOVE_1 = typeof x >= 'u' ? null : x
        var REMOVE_1 = typeof x > 'u' ? null : x
        var REMOVE_1 = typeof x <= 'u' && x
        var REMOVE_1 = typeof x < 'u' && x
        var REMOVE_1 = typeof x >= 'u' || x
        var REMOVE_1 = typeof x > 'u' || x
        var REMOVE_1 = 'u' >= typeof x ? x : null
        var REMOVE_1 = 'u' > typeof x ? x : null
        var REMOVE_1 = 'u' <= typeof x ? null : x
        var REMOVE_1 = 'u' < typeof x ? null : x
        var REMOVE_1 = 'u' >= typeof x && x
        var REMOVE_1 = 'u' > typeof x && x
        var REMOVE_1 = 'u' <= typeof x || x
        var REMOVE_1 = 'u' < typeof x || x
  
        // Everything here should be kept as live code because it has side effects
        var keep_1 = typeof x <= 'u' ? y : null
        var keep_1 = typeof x < 'u' ? y : null
        var keep_1 = typeof x >= 'u' ? null : y
        var keep_1 = typeof x > 'u' ? null : y
        var keep_1 = typeof x <= 'u' && y
        var keep_1 = typeof x < 'u' && y
        var keep_1 = typeof x >= 'u' || y
        var keep_1 = typeof x > 'u' || y
        var keep_1 = 'u' >= typeof x ? y : null
        var keep_1 = 'u' > typeof x ? y : null
        var keep_1 = 'u' <= typeof x ? null : y
        var keep_1 = 'u' < typeof x ? null : y
        var keep_1 = 'u' >= typeof x && y
        var keep_1 = 'u' > typeof x && y
        var keep_1 = 'u' <= typeof x || y
        var keep_1 = 'u' < typeof x || y
  
        // Everything here should be kept as live code because it has side effects
        var keep_2 = typeof x <= 'u' ? null : x
        var keep_2 = typeof x < 'u' ? null : x
        var keep_2 = typeof x >= 'u' ? x : null
        var keep_2 = typeof x > 'u' ? x : null
        var keep_2 = typeof x <= 'u' || x
        var keep_2 = typeof x < 'u' || x
        var keep_2 = typeof x >= 'u' && x
        var keep_2 = typeof x > 'u' && x
        var keep_2 = 'u' >= typeof x ? null : x
        var keep_2 = 'u' > typeof x ? null : x
        var keep_2 = 'u' <= typeof x ? x : null
        var keep_2 = 'u' < typeof x ? x : null
        var keep_2 = 'u' >= typeof x || x
        var keep_2 = 'u' > typeof x || x
        var keep_2 = 'u' <= typeof x && x
        var keep_2 = 'u' < typeof x && x
      `,
    },
    format: "iife",
    snapshot: true,
  });
  itBundled("dce/RemoveUnusedImports", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import a from 'a'
        import * as b from 'b'
        import {c} from 'c'
      `,
    },
    minifySyntax: true,
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/RemoveUnusedImportsEval", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import a from 'a'
        import * as b from 'b'
        import {c} from 'c'
        eval('foo(a, b, c)')
      `,
    },
    minifySyntax: true,
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/RemoveUnusedImportsEvalTS", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import a from 'a'
        import * as b from 'b'
        import {c} from 'c'
        eval('foo(a, b, c)')
      `,
    },
    entryPoints: ["/entry.js"],
    minifySyntax: true,
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/DCEClassStaticBlocks", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        class A_REMOVE {
          static {}
        }
        class B_REMOVE {
          static { 123 }
        }
        class C_REMOVE {
          static { /* @__PURE__*/ foo() }
        }
        class D_REMOVE {
          static { try {} catch {} }
        }
        class E_REMOVE {
          static { try { /* @__PURE__*/ foo() } catch {} }
        }
        class F_REMOVE {
          static { try { 123 } catch { 123 } finally { 123 } }
        }
  
        class A_keep {
          static { foo }
        }
        class B_keep {
          static { this.foo }
        }
        class C_keep {
          static { try { foo } catch {} }
        }
        class D_keep {
          static { try {} finally { foo } }
        }
      `,
    },
    entryPoints: ["/entry.js"],
    snapshot: true,
  });
  itBundled("dce/DCEVarExports", {
    // TODO: hand check and tweak
    files: {
      "/a.js": /* js */ `
        var foo = { bar: 123 }
        module.exports = foo
      `,
      "/b.js": /* js */ `
        var exports = { bar: 123 }
        module.exports = exports
      `,
      "/c.js": /* js */ `
        var module = { bar: 123 }
        exports.foo = module
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    snapshot: true,
  });
  itBundled("dce/DCETemplateLiteral", {
    // TODO: hand check and tweak
    files: {},
    entryPoints: ["/entry.js"],
    snapshot: true,
  });
  itBundled("dce/TreeShakingLoweredClassStaticField", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        class REMOVE_ME {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        function REMOVE_ME_TOO() {
          new REMOVE_ME()
        }
        class KeepMe1 {
          static x = 'x'
          static y = sideEffects()
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        new KeepMe2()
      `,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingLoweredClassStaticFieldMinified", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        class REMOVE_ME {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        function REMOVE_ME_TOO() {
          new REMOVE_ME()
        }
        class KeepMe1 {
          static x = 'x'
          static y = sideEffects()
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        new KeepMe2()
      `,
    },
    unsupportedJSFeatures: "ClassField",
    snapshot: true,
  });
  itBundled("dce/TreeShakingLoweredClassStaticFieldAssignment", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        class KeepMe1 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = sideEffects()
          static z = 'z'
        }
        class KeepMe3 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        new KeepMe3()
      `,
    },
    entryPoints: ["/entry.js"],
    unsupportedJSFeatures: "ClassField",
    snapshot: true,
  });
  itBundled("dce/InlineIdentityFunctionCalls", {
    // TODO: hand check and tweak
    files: {
      "/identity.js": /* js */ `
        function DROP(x) { return x }
        console.log(DROP(1))
        DROP(foo())
        DROP(1)
      `,
      "/identity-last.js": /* js */ `
        function DROP(x) { return [x] }
        function DROP(x) { return x }
        console.log(DROP(1))
        DROP(foo())
        DROP(1)
      `,
      "/identity-cross-module.js": /* js */ `
        import { DROP } from './identity-cross-module-def'
        console.log(DROP(1))
        DROP(foo())
        DROP(1)
      `,
      "/identity-cross-module-def.js": `export function DROP(x) { return x }`,
      "/identity-no-args.js": /* js */ `
        function keep(x) { return x }
        console.log(keep())
        keep()
      `,
      "/identity-two-args.js": /* js */ `
        function keep(x) { return x }
        console.log(keep(1, 2))
        keep(1, 2)
      `,
      "/identity-first.js": /* js */ `
        function keep(x) { return x }
        function keep(x) { return [x] }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/identity-generator.js": /* js */ `
        function* keep(x) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/identity-async.js": /* js */ `
        async function keep(x) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign.js": /* js */ `
        function keep(x) { return x }
        keep = reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-inc.js": /* js */ `
        function keep(x) { return x }
        keep++
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-div.js": /* js */ `
        function keep(x) { return x }
        keep /= reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-array.js": /* js */ `
        function keep(x) { return x }
        [keep] = reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-object.js": /* js */ `
        function keep(x) { return x }
        ({keep} = reassigned)
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-two-args.js": /* js */ `
        function keep(x, y) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-default.js": /* js */ `
        function keep(x = foo()) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-array.js": /* js */ `
        function keep([x]) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-object.js": /* js */ `
        function keep({x}) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-rest.js": /* js */ `
        function keep(...x) { return x }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/not-identity-return.js": /* js */ `
        function keep(x) { return [x] }
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
    },
    entryPoints: [
      "/identity.js",
      "/identity-last.js",
      "/identity-first.js",
      "/identity-generator.js",
      "/identity-async.js",
      "/identity-cross-module.js",
      "/identity-no-args.js",
      "/identity-two-args.js",
      "/reassign.js",
      "/reassign-inc.js",
      "/reassign-div.js",
      "/reassign-array.js",
      "/reassign-object.js",
      "/not-identity-two-args.js",
      "/not-identity-default.js",
      "/not-identity-array.js",
      "/not-identity-object.js",
      "/not-identity-rest.js",
      "/not-identity-return.js",
    ],
    snapshot: true,
  });
  itBundled("dce/InlineEmptyFunctionCalls", {
    // TODO: hand check and tweak
    files: {
      "/empty.js": /* js */ `
        function DROP() {}
        console.log(DROP(foo(), bar()))
        console.log(DROP(foo(), 1))
        console.log(DROP(1, foo()))
        console.log(DROP(1))
        console.log(DROP())
        DROP(foo(), bar())
        DROP(foo(), 1)
        DROP(1, foo())
        DROP(1)
        DROP()
      `,
      "/empty-comma.js": /* js */ `
        function DROP() {}
        console.log((DROP(), DROP(), foo()))
        console.log((DROP(), foo(), DROP()))
        console.log((foo(), DROP(), DROP()))
        for (DROP(); DROP(); DROP()) DROP();
        DROP(), DROP(), foo();
        DROP(), foo(), DROP();
        foo(), DROP(), DROP();
      `,
      "/empty-if-else.js": /* js */ `
        function DROP() {}
        if (foo) { let bar = baz(); bar(); bar() } else DROP();
      `,
      "/empty-last.js": /* js */ `
        function DROP() { return x }
        function DROP() { return }
        console.log(DROP())
        DROP()
      `,
      "/empty-cross-module.js": /* js */ `
        import { DROP } from './empty-cross-module-def'
        console.log(DROP())
        DROP()
      `,
      "/empty-cross-module-def.js": `export function DROP() {}`,
      "/empty-first.js": /* js */ `
        function keep() { return }
        function keep() { return x }
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/empty-generator.js": /* js */ `
        function* keep() {}
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/empty-async.js": /* js */ `
        async function keep() {}
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/reassign.js": /* js */ `
        function keep() {}
        keep = reassigned
        console.log(keep())
        keep(foo())
        keep(1)
      `,
      "/reassign-inc.js": /* js */ `
        function keep() {}
        keep++
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-div.js": /* js */ `
        function keep() {}
        keep /= reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-array.js": /* js */ `
        function keep() {}
        [keep] = reassigned
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
      "/reassign-object.js": /* js */ `
        function keep() {}
        ({keep} = reassigned)
        console.log(keep(1))
        keep(foo())
        keep(1)
      `,
    },
    entryPoints: [
      "/empty.js",
      "/empty-comma.js",
      "/empty-if-else.js",
      "/empty-last.js",
      "/empty-cross-module.js",
      "/empty-first.js",
      "/empty-generator.js",
      "/empty-async.js",
      "/reassign.js",
      "/reassign-inc.js",
      "/reassign-div.js",
      "/reassign-array.js",
      "/reassign-object.js",
    ],
    snapshot: true,
  });
  itBundled("dce/InlineFunctionCallBehaviorChanges", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function empty() {}
        function id(x) { return x }
  
        export let shouldBeWrapped = [
          id(foo.bar)(),
          id(foo[bar])(),
          id(foo?.bar)(),
          id(foo?.[bar])(),
  
          (empty(), foo.bar)(),
          (empty(), foo[bar])(),
          (empty(), foo?.bar)(),
          (empty(), foo?.[bar])(),
  
          id(eval)(),
          id(eval)?.(),
          (empty(), eval)(),
          (empty(), eval)?.(),
  
          id(foo.bar)\` + "\`\`" +
      `,
    },
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/InlineFunctionCallForInitDecl", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function empty() {}
        function id(x) { return x }
  
        for (var y = empty(); false; ) ;
        for (var z = id(123); false; ) ;
      `,
    },
    snapshot: true,
  });
  itBundled("dce/ConstValueInliningNoBundle", {
    // TODO: hand check and tweak
    files: {
      "/top-level.js": /* js */ `
        // These should be kept because they are top-level and tree shaking is not enabled
        const n_keep = null
        const u_keep = undefined
        const i_keep = 1234567
        const f_keep = 123.456
        const s_keep = ''
  
        // Values should still be inlined
        console.log(
          // These are doubled to avoid the "inline const/let into next statement if used once" optimization
          n_keep, n_keep,
          u_keep, u_keep,
          i_keep, i_keep,
          f_keep, f_keep,
          s_keep, s_keep,
        )
      `,
      "/nested-block.js": /* js */ `
        {
          const REMOVE_n = null
          const REMOVE_u = undefined
          const REMOVE_i = 1234567
          const REMOVE_f = 123.456
          const s_keep = '' // String inlining is intentionally not supported right now
          console.log(
            // These are doubled to avoid the "inline const/let into next statement if used once" optimization
            REMOVE_n, REMOVE_n,
            REMOVE_u, REMOVE_u,
            REMOVE_i, REMOVE_i,
            REMOVE_f, REMOVE_f,
            s_keep, s_keep,
          )
        }
      `,
      "/nested-function.js": /* js */ `
        function nested() {
          const REMOVE_n = null
          const REMOVE_u = undefined
          const REMOVE_i = 1234567
          const REMOVE_f = 123.456
          const s_keep = '' // String inlining is intentionally not supported right now
          console.log(
            // These are doubled to avoid the "inline const/let into next statement if used once" optimization
            REMOVE_n, REMOVE_n,
            REMOVE_u, REMOVE_u,
            REMOVE_i, REMOVE_i,
            REMOVE_f, REMOVE_f,
            s_keep, s_keep,
          )
        }
      `,
      "/namespace-export.ts": /* ts */ `
        namespace ns {
          const x_REMOVE = 1
          export const y_keep = 2
          console.log(
            x_REMOVE, x_REMOVE,
            y_keep, y_keep,
          )
        }
      `,
      "/comment-before.js": /* js */ `
        {
          //! comment
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/directive-before.js": /* js */ `
        function nested() {
          'directive'
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/semicolon-before.js": /* js */ `
        {
          ;
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/debugger-before.js": /* js */ `
        {
          debugger
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/type-before.ts": /* ts */ `
        {
          declare let x
          const REMOVE = 1
          x = [REMOVE, REMOVE]
        }
      `,
      "/exprs-before.js": /* js */ `
        function nested() {
          const x = [, '', {}, 0n, /./, function() {}, () => {}]
          const y_REMOVE = 1
          function foo() {
            return y_REMOVE
          }
        }
      `,
      "/disabled-tdz.js": /* js */ `
        foo()
        const x_keep = 1
        function foo() {
          return x_keep
        }
      `,
      "/backwards-reference-top-level.js": /* js */ `
        const x = y
        const y = 1
        console.log(
          x, x,
          y, y,
        )
      `,
      "/backwards-reference-nested-function.js": /* js */ `
        function foo() {
          const x = y
          const y = 1
          console.log(
            x, x,
            y, y,
          )
        }
      `,
    },
    entryPoints: [
      "/top-level.js",
      "/nested-block.js",
      "/nested-function.js",
      "/namespace-export.ts",
      "/comment-before.js",
      "/directive-before.js",
      "/semicolon-before.js",
      "/debugger-before.js",
      "/type-before.ts",
      "/exprs-before.js",
      "/disabled-tdz.js",
      "/backwards-reference-top-level.js",
      "/backwards-reference-nested-function.js",
    ],
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/ConstValueInliningBundle", {
    // TODO: hand check and tweak
    files: {
      "/exported-entry.js": /* js */ `
        const x_REMOVE = 1
        export const y_keep = 2
        console.log(
          x_REMOVE,
          y_keep,
        )
      `,
      "/re-exported-entry.js": /* js */ `
        import { x_REMOVE, y_keep } from './re-exported-constants'
        console.log(x_REMOVE, y_keep)
        export { y_keep }
      `,
      "/re-exported-constants.js": /* js */ `
        export const x_REMOVE = 1
        export const y_keep = 2
      `,
      "/re-exported-2-entry.js": `export { y_keep } from './re-exported-2-constants'`,
      "/re-exported-2-constants.js": /* js */ `
        export const x_REMOVE = 1
        export const y_keep = 2
      `,
      "/re-exported-star-entry.js": `export * from './re-exported-star-constants'`,
      "/re-exported-star-constants.js": /* js */ `
        export const x_keep = 1
        export const y_keep = 2
      `,
      "/cross-module-entry.js": /* js */ `
        import { x_REMOVE, y_keep } from './cross-module-constants'
        console.log(x_REMOVE, y_keep)
      `,
      "/cross-module-constants.js": /* js */ `
        export const x_REMOVE = 1
        foo()
        export const y_keep = 1
        export function foo() {
          return [x_REMOVE, y_keep]
        }
      `,
      "/print-shorthand-entry.js": /* js */ `
        import { foo, _bar } from './print-shorthand-constants'
        // The inlined constants must still be present in the output! We don't
        // want the printer to use the shorthand syntax here to refer to the
        // name of the constant itself because the constant declaration is omitted.
        console.log({ foo, _bar })
      `,
      "/print-shorthand-constants.js": /* js */ `
        export const foo = 123
        export const _bar = -321
      `,
      "/circular-import-entry.js": `import './circular-import-constants'`,
      "/circular-import-constants.js": /* js */ `
        export const foo = 123 // Inlining should be prevented by the cycle
        export function bar() {
          return foo
        }
        import './circular-import-cycle'
      `,
      "/circular-import-cycle.js": /* js */ `
        import { bar } from './circular-import-constants'
        console.log(bar()) // This accesses "foo" before it's initialized
      `,
      "/circular-re-export-entry.js": /* js */ `
        import { baz } from './circular-re-export-constants'
        console.log(baz)
      `,
      "/circular-re-export-constants.js": /* js */ `
        export const foo = 123 // Inlining should be prevented by the cycle
        export function bar() {
          return foo
        }
        export { baz } from './circular-re-export-cycle'
      `,
      "/circular-re-export-cycle.js": /* js */ `
        export const baz = 0
        import { bar } from './circular-re-export-constants'
        console.log(bar()) // This accesses "foo" before it's initialized
      `,
      "/circular-re-export-star-entry.js": `import './circular-re-export-star-constants'`,
      "/circular-re-export-star-constants.js": /* js */ `
        export const foo = 123 // Inlining should be prevented by the cycle
        export function bar() {
          return foo
        }
        export * from './circular-re-export-star-cycle'
      `,
      "/circular-re-export-star-cycle.js": /* js */ `
        import { bar } from './circular-re-export-star-constants'
        console.log(bar()) // This accesses "foo" before it's initialized
      `,
      "/non-circular-export-entry.js": /* js */ `
        import { foo, bar } from './non-circular-export-constants'
        console.log(foo, bar())
      `,
      "/non-circular-export-constants.js": /* js */ `
        const foo = 123 // Inlining should be prevented by the cycle
        function bar() {
          return foo
        }
        export { foo, bar }
      `,
    },
    entryPoints: [
      "/exported-entry.js",
      "/re-exported-entry.js",
      "/re-exported-2-entry.js",
      "/re-exported-star-entry.js",
      "/cross-module-entry.js",
      "/print-shorthand-entry.js",
      "/circular-import-entry.js",
      "/circular-re-export-entry.js",
      "/circular-re-export-star-entry.js",
      "/non-circular-export-entry.js",
    ],
    format: "esm",
    minifySyntax: true,
    snapshot: true,
  });
  itBundled("dce/ConstValueInliningAssign", {
    // TODO: hand check and tweak
    files: {
      "/const-assign.js": /* js */ `
        const x = 1
        x = 2
      `,
      "/const-update.js": /* js */ `
        const x = 1
        x += 2
      `,
    },
    entryPoints: ["/const-assign.js", "/const-update.js"],
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/ConstValueInliningDirectEval", {
    // TODO: hand check and tweak
    files: {
      "/top-level-no-eval.js": /* js */ `
        const x = 1
        console.log(x, evil('x'))
      `,
      "/top-level-eval.js": /* js */ `
        const x = 1
        console.log(x, eval('x'))
      `,
      "/nested-no-eval.js": /* js */ `
        (() => {
          const x = 1
          console.log(x, evil('x'))
        })()
      `,
      "/nested-eval.js": /* js */ `
        (() => {
          const x = 1
          console.log(x, eval('x'))
        })()
      `,
      "/ts-namespace-no-eval.ts": /* ts */ `
        namespace y {
          export const x = 1
          console.log(x, evil('x'))
        }
      `,
      "/ts-namespace-eval.ts": /* ts */ `
        namespace z {
          export const x = 1
          console.log(x, eval('x'))
        }
      `,
    },
    entryPoints: [
      "/top-level-no-eval.js",
      "/top-level-eval.js",
      "/nested-no-eval.js",
      "/nested-eval.js",
      "/ts-namespace-no-eval.ts",
      "/ts-namespace-eval.ts",
    ],
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("dce/CrossModuleConstantFolding", {
    // TODO: hand check and tweak
    files: {
      "/enum-constants.ts": /* ts */ `
        export enum x {
          a = 3,
          b = 6,
        }
      `,
      "/enum-entry.ts": /* ts */ `
        import { x } from './enum-constants'
        console.log([
          +x.b,
          -x.b,
          ~x.b,
          !x.b,
          typeof x.b,
        ], [
          x.a + x.b,
          x.a - x.b,
          x.a * x.b,
          x.a / x.b,
          x.a % x.b,
          x.a ** x.b,
        ], [
          x.a < x.b,
          x.a > x.b,
          x.a <= x.b,
          x.a >= x.b,
          x.a == x.b,
          x.a != x.b,
          x.a === x.b,
          x.a !== x.b,
        ], [
          x.b << 1,
          x.b >> 1,
          x.b >>> 1,
        ], [
          x.a & x.b,
          x.a | x.b,
          x.a ^ x.b,
        ], [
          x.a && x.b,
          x.a || x.b,
          x.a ?? x.b,
        ])
      `,
      "/const-constants.js": /* js */ `
        export const a = 3
        export const b = 6
      `,
      "/const-entry.js": /* js */ `
        import { a, b } from './const-constants'
        console.log([
          +b,
          -b,
          ~b,
          !b,
          typeof b,
        ], [
          a + b,
          a - b,
          a * b,
          a / b,
          a % b,
          a ** b,
        ], [
          a < b,
          a > b,
          a <= b,
          a >= b,
          a == b,
          a != b,
          a === b,
          a !== b,
        ], [
          b << 1,
          b >> 1,
          b >>> 1,
        ], [
          a & b,
          a | b,
          a ^ b,
        ], [
          a && b,
          a || b,
          a ?? b,
        ])
      `,
      "/nested-constants.ts": /* ts */ `
        export const a = 2
        export const b = 4
        export const c = 8
        export enum x {
          a = 16,
          b = 32,
          c = 64,
        }
      `,
      "/nested-entry.ts": /* ts */ `
        import { a, b, c, x } from './nested-constants'
        console.log({
          'should be 4': ~(~a & ~b) & (b | c),
          'should be 32': ~(~x.a & ~x.b) & (x.b | x.c),
        })
      `,
    },
    entryPoints: ["/enum-entry.ts", "/const-entry.js", "/nested-entry.ts"],
    snapshot: true,
  });
  itBundled("dce/MultipleDeclarationTreeShaking", {
    // TODO: hand check and tweak
    files: {
      "/var2.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
      `,
      "/var3.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
        console.log(x)
        var x = 3
      `,
      "/function2.js": /* js */ `
        function x() { return 1 }
        console.log(x())
        function x() { return 2 }
      `,
      "/function3.js": /* js */ `
        function x() { return 1 }
        console.log(x())
        function x() { return 2 }
        console.log(x())
        function x() { return 3 }
      `,
    },
    entryPoints: ["/var2.js", "/var3.js", "/function2.js", "/function3.js"],
    snapshot: true,
  });
  itBundled("dce/MultipleDeclarationTreeShakingMinifySyntax", {
    // TODO: hand check and tweak
    files: {
      "/var2.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
      `,
      "/var3.js": /* js */ `
        var x = 1
        console.log(x)
        var x = 2
        console.log(x)
        var x = 3
      `,
      "/function2.js": /* js */ `
        function x() { return 1 }
        console.log(x())
        function x() { return 2 }
      `,
      "/function3.js": /* js */ `
        function x() { return 1 }
        console.log(x())
        function x() { return 2 }
        console.log(x())
        function x() { return 3 }
      `,
    },
    entryPoints: ["/var2.js", "/var3.js", "/function2.js", "/function3.js"],
    snapshot: true,
  });
  itBundled("dce/PureCallsWithSpread", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        /* @__PURE__ */ foo(...args);
        /* @__PURE__ */ new foo(...args);
      `,
    },
    snapshot: true,
  });
  itBundled("dce/TopLevelFunctionInliningWithSpread", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function empty1() {}
        function empty2() {}
        function empty3() {}
  
        function identity1(x) { return x }
        function identity2(x) { return x }
        function identity3(x) { return x }
  
        empty1()
        empty2(args)
        empty3(...args)
  
        identity1()
        identity2(args)
        identity3(...args)
      `,
      "/inner.js": /* js */ `
        export function empty1() {}
        export function empty2() {}
        export function empty3() {}
  
        export function identity1(x) { return x }
        export function identity2(x) { return x }
        export function identity3(x) { return x }
      `,
      "/entry-outer.js": /* js */ `
        import {
          empty1,
          empty2,
          empty3,
  
          identity1,
          identity2,
          identity3,
        } from './inner.js'
  
        empty1()
        empty2(args)
        empty3(...args)
  
        identity1()
        identity2(args)
        identity3(...args)
      `,
    },
    entryPoints: ["/entry.js", "/entry-outer.js"],
    snapshot: true,
  });
  itBundled("dce/NestedFunctionInliningWithSpread", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        function empty1() {}
        function empty2() {}
        function empty3() {}
  
        function identity1(x) { return x }
        function identity2(x) { return x }
        function identity3(x) { return x }
  
        check(
          empty1(),
          empty2(args),
          empty3(...args),
  
          identity1(),
          identity2(args),
          identity3(...args),
        )
      `,
      "/inner.js": /* js */ `
        export function empty1() {}
        export function empty2() {}
        export function empty3() {}
  
        export function identity1(x) { return x }
        export function identity2(x) { return x }
        export function identity3(x) { return x }
      `,
      "/entry-outer.js": /* js */ `
        import {
          empty1,
          empty2,
          empty3,
  
          identity1,
          identity2,
          identity3,
        } from './inner.js'
  
        check(
          empty1(),
          empty2(args),
          empty3(...args),
  
          identity1(),
          identity2(args),
          identity3(...args),
        )
      `,
    },
    entryPoints: ["/entry.js", "/entry-outer.js"],
    snapshot: true,
  });
  itBundled("dce/PackageJsonSideEffectsFalseCrossPlatformSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/foo"
        import "demo-pkg/bar"
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `console.log('foo')`,
      "/Users/user/project/node_modules/demo-pkg/bar/index.js": `console.log('bar')`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": [
            "**/foo.js",
            "bar/index.js"
          ]
        }
      `,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSS", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg/button'
        import { Menu } from 'pkg/menu'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/button.js": /* js */ `
        import './button.css'
        export let Button
      `,
      "/project/node_modules/pkg/button.css": `button { color: red }`,
      "/project/node_modules/pkg/menu.js": /* js */ `
        import './menu.css'
        export let Menu
      `,
      "/project/node_modules/pkg/menu.css": `menu { color: red }`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSSReExportSideEffectsFalse", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/entry.js": `export { Button } from './components'`,
      "/project/node_modules/pkg/package.json": /* json */ `
        {
        "main": "./entry.js",
        "sideEffects": false
      }
      `,
      "/project/node_modules/pkg/components.jsx": /* jsx */ `
        require('./button.css')
        export const Button = () => <button/>
      `,
      "/project/node_modules/pkg/button.css": `button { color: red }`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSSReExportSideEffectsFalseOnlyJS", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/entry.js": `export { Button } from './components'`,
      "/project/node_modules/pkg/package.json": /* json */ `
        {
        "main": "./entry.js",
        "sideEffects": ["*.css"]
      }
      `,
      "/project/node_modules/pkg/components.jsx": /* jsx */ `
        require('./button.css')
        export const Button = () => <button/>
      `,
      "/project/node_modules/pkg/button.css": `button { color: red }`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSSExportStarSideEffectsFalse", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/entry.js": `export * from './components'`,
      "/project/node_modules/pkg/package.json": /* json */ `
        {
        "main": "./entry.js",
        "sideEffects": false
      }
      `,
      "/project/node_modules/pkg/components.jsx": /* jsx */ `
        require('./button.css')
        export const Button = () => <button/>
      `,
      "/project/node_modules/pkg/button.css": `button { color: red }`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSSExportStarSideEffectsFalseOnlyJS", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/entry.js": `export * from './components'`,
      "/project/node_modules/pkg/package.json": /* json */ `
        {
        "main": "./entry.js",
        "sideEffects": ["*.css"]
      }
      `,
      "/project/node_modules/pkg/components.jsx": /* jsx */ `
        require('./button.css')
        export const Button = () => <button/>
      `,
      "/project/node_modules/pkg/button.css": `button { color: red }`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSSUnusedNestedImportSideEffectsFalse", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg/button'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/package.json": /* json */ `
        {
        "sideEffects": false
      }
      `,
      "/project/node_modules/pkg/button.jsx": /* jsx */ `
        import styles from './styles'
        export const Button = () => <button/>
      `,
      "/project/node_modules/pkg/styles.js": /* js */ `
        import './styles.css'
        export default {}
      `,
      "/project/node_modules/pkg/styles.css": `button { color: red }`,
    },
    snapshot: true,
  });
  itBundled("dce/TreeShakingJSWithAssociatedCSSUnusedNestedImportSideEffectsFalseOnlyJS", {
    // TODO: hand check and tweak
    files: {
      "/project/test.jsx": /* jsx */ `
        import { Button } from 'pkg/button'
        render(<Button/>)
      `,
      "/project/node_modules/pkg/package.json": /* json */ `
        {
        "sideEffects": ["*.css"]
      }
      `,
      "/project/node_modules/pkg/button.jsx": /* jsx */ `
        import styles from './styles'
        export const Button = () => <button/>
      `,
      "/project/node_modules/pkg/styles.js": /* js */ `
        import './styles.css'
        export default {}
      `,
      "/project/node_modules/pkg/styles.css": `button { color: red }`,
    },
    snapshot: true,
  });
});
