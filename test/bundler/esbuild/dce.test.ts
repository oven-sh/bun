import { describe, expect } from "bun:test";
import { isWindows } from "harness";
import { dedent, itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_dce_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/dce

// To understand what `dce: true` is doing, see ../expectBundled.md's "dce: true" section

describe("bundler", () => {
  itBundled("dce/PackageJsonSideEffectsFalseKeepNamedImportES6", {
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
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/UnreferencedObjectLiteral", {
    files: {
      "/entry.js": /* js */ `
        ({
            0: 1,
            2: console.log("EFFECT1"),
        });
        ({
            0: 1,
            [console.log("EFFECT2")]: 2,
        });
      `,
    },
    run: {
      stdout: "EFFECT1\nEFFECT2",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepNamedImportCommonJS", {
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
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepStarImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log(JSON.stringify(ns))
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
    run: {
      stdout: 'hello\n{"foo":123}',
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepStarImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log(JSON.stringify(ns))
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
    run: {
      stdout: 'hello\n{"foo":123}',
    },
  });
  itBundled("dce/PackageJsonSideEffectsTrueKeepES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "FAILED"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": true
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsTrueKeepCommonJS", {
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
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireES6", {
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
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireCommonJS", {
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
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveBareImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveBareImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveNamedImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveNamedImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveStarImportES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseRemoveStarImportCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import * as ns from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        exports.foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayRemove", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": []
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeep", {
    todo: isWindows,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log("hello")
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./index.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainUseModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
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
    dce: true,
    mainFields: ["module"],
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainUseMain", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
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
    dce: true,
    mainFields: ["main"],
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainImplicitModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
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
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepMainImplicitMain", {
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
        export const foo = "POSSIBLE_REMOVAL"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
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
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleUseModule", {
    todo: isWindows,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log('unused import')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-main.js": /* js */ `
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
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
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleUseMain", {
    todo: isWindows,
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
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "index-main.js",
          "module": "index-module.js",
          "sideEffects": ["./index-module.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "hello\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleImplicitModule", {
    todo: isWindows,
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
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayKeepModuleImplicitMain", {
    todo: true,
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
        export const foo = "POSSIBLE_REMOVAL"
        console.log('this should be kept')
      `,
      "/Users/user/project/node_modules/demo-pkg/index-module.js": /* js */ `
        export const foo = "TEST FAILED"
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
    dce: true,
    run: {
      stdout: "this should be kept\nunused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsArrayGlob", {
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
    dce: true,
    run: {
      stdout: "this should be kept",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobBasicPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { used } from "demo-pkg/lib/used.js";
        import { unused } from "demo-pkg/lib/unused.js";
        import { effect } from "demo-pkg/effects/effect.js";
        console.log(used);
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/used.js": `export const used = "used";`,
      "/Users/user/project/node_modules/demo-pkg/lib/unused.js": /* js */ `
        export const unused = "unused";
        console.log("should be tree-shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/effects/effect.js": /* js */ `
        console.log("side effect preserved");
        export const effect = "effect";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./effects/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "side effect preserved\nused",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobQuestionMark", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { file1 } from "demo-pkg/file1.js";
        import { file2 } from "demo-pkg/file2.js";
        import { fileAB } from "demo-pkg/fileAB.js";
        import { other } from "demo-pkg/other.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/file1.js": /* js */ `
        console.log("file1 effect");
        export const file1 = "file1";
      `,
      "/Users/user/project/node_modules/demo-pkg/file2.js": /* js */ `
        console.log("file2 effect");
        export const file2 = "file2";
      `,
      "/Users/user/project/node_modules/demo-pkg/fileAB.js": /* js */ `
        console.log("fileAB effect");
        export const fileAB = "fileAB";
      `,
      "/Users/user/project/node_modules/demo-pkg/other.js": /* js */ `
        console.log("other effect");
        export const other = "other";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./file?.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "file1 effect\nfile2 effect\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobBraceExpansion", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { comp } from "demo-pkg/components/comp.js";
        import { util } from "demo-pkg/utils/util.js";
        import { other } from "demo-pkg/other/file.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/components/comp.js": /* js */ `
        console.log("component effect");
        export const comp = "comp";
      `,
      "/Users/user/project/node_modules/demo-pkg/utils/util.js": /* js */ `
        console.log("utility effect");
        export const util = "util";
      `,
      "/Users/user/project/node_modules/demo-pkg/other/file.js": /* js */ `
        console.log("other effect");
        export const other = "other";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./{components,utils}/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "component effect\nutility effect\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobMixedPatterns", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { used } from "demo-pkg/lib/used.js";
        import { specific } from "demo-pkg/lib/specific.js";
        import { glob1 } from "demo-pkg/lib/glob/glob1.js";
        import { glob2 } from "demo-pkg/lib/glob/glob2.js";
        import { other } from "demo-pkg/lib/other.js";
        console.log(used);
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/used.js": `export const used = "used";`,
      "/Users/user/project/node_modules/demo-pkg/lib/specific.js": /* js */ `
        console.log("specific side effect");
        export const specific = "specific";
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/glob/glob1.js": /* js */ `
        console.log("glob1 side effect");
        export const glob1 = "glob1";
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/glob/glob2.js": /* js */ `
        console.log("glob2 side effect");
        export const glob2 = "glob2";
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/other.js": /* js */ `
        console.log("other side effect");
        export const other = "other";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./lib/specific.js", "./lib/glob/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "specific side effect\nglob1 side effect\nglob2 side effect\nused",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobDeepPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/shallow.js";
        import "demo-pkg/components/effects/deep.js";
        import "demo-pkg/utils/helpers/effects/nested.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/shallow.js": /* js */ `
        console.log("shallow side effect - should be tree shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/components/effects/deep.js": /* js */ `
        console.log("deep side effect - should be preserved");
      `,
      "/Users/user/project/node_modules/demo-pkg/utils/helpers/effects/nested.js": /* js */ `
        console.log("nested side effect - should be preserved");
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./**/effects/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "deep side effect - should be preserved\nnested side effect - should be preserved\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobExtensionPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "demo-pkg/utils/util.js";
        import "demo-pkg/effects/main.effect.js";
        import "demo-pkg/effects/secondary.js";
        console.log("done");
      `,
      "/Users/user/project/node_modules/demo-pkg/utils/util.js": /* js */ `
        console.log("util side effect - should be tree shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/effects/main.effect.js": /* js */ `
        console.log("main effect - should be preserved");
      `,
      "/Users/user/project/node_modules/demo-pkg/effects/secondary.js": /* js */ `
        console.log("secondary effect - should be tree shaken");
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./**/*.effect.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "main effect - should be preserved\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobInvalidPattern", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import { lib } from "demo-pkg/lib/lib.js";
        console.log(lib);
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/lib.js": /* js */ `
        console.log("lib side effect");
        export const lib = "lib";
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "sideEffects": ["./[unclosed.js", "./lib/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "lib side effect\nlib",
    },
  });
  itBundled("dce/PackageJsonSideEffectsGlobNoMatches", {
    todo: true,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import "./components/comp.js";
        import "./utils/util.js";
        import "./root.js";
        console.log("done");
      `,
      "/Users/user/project/src/components/comp.js": /* js */ `
        console.log("component side effect");
      `,
      "/Users/user/project/src/utils/util.js": /* js */ `
        console.log("utility side effect - should be tree shaken");
      `,
      "/Users/user/project/src/root.js": /* js */ `
        console.log("root side effect - should be tree shaken");
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "sideEffects": ["src/components/*.js"]
        }
      `,
    },
    dce: true,
    run: {
      stdout: "component side effect\ndone",
    },
  });
  itBundled("dce/PackageJsonSideEffectsNestedDirectoryRemove", {
    todo: true,
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
        export const foo = "TEST FAILED"
        console.log('TEST FAILED')
      `,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsKeepExportDefaultExpr", {
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
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.exprWithSideEffects = () => 1;
        await import('./out');
      `,
    },
    run: {
      file: "/test.js",
      stdout: "1",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseNoWarningInNodeModulesESBuildIssue999", {
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
        export const foo = "FAILED"
        console.log('FAILED')
      `,
      "/Users/user/project/node_modules/demo-pkg2/package.json": /* json */ `
        {
          "sideEffects": false
        }
      `,
    },
    dce: true,
    run: {
      stdout: "unused import\nused import",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesUnused", {
    files: {
      "/Users/user/project/src/entry.js": `import {foo} from "demo-pkg"`,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export {foo} from "./foo.js"
        throw 'REMOVE THIS'
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `export const foo = 123`,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toBe("");
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesUsed", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "demo-pkg"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        export {foo} from "./foo.js"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/demo-pkg/foo.js": `export const foo = 123`,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesChainAll", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/a/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/c/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
      "/Users/user/project/node_modules/d/package.json": `{ "sideEffects": false }`,
    },
    dce: true,
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesChainOne", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {foo} from "a"
        console.log(foo)
      `,
      "/Users/user/project/node_modules/a/index.js": `export {foo} from "b"`,
      "/Users/user/project/node_modules/b/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello')
      `,
      "/Users/user/project/node_modules/b/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
    },
    dce: true,
    run: {
      stdout: "hello\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseIntermediateFilesDiamond", {
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
        console.log('hello 1')
      `,
      "/Users/user/project/node_modules/b1/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/b2/index.js": /* js */ `
        export {foo} from "c"
        console.log('hello 2')
      `,
      "/Users/user/project/node_modules/b2/package.json": `{ "sideEffects": false }`,
      "/Users/user/project/node_modules/c/index.js": `export {foo} from "d"`,
      "/Users/user/project/node_modules/d/index.js": `export const foo = 123`,
    },
    dce: true,
    run: {
      stdout: "hello 1\nhello 2\n123",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseOneFork", {
    files: {
      "/Users/user/project/src/entry.js": `import("a").then(x => console.log(x.foo))`,
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
    dce: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("dce/PackageJsonSideEffectsFalseAllFork", {
    files: {
      "/Users/user/project/src/entry.js": `import("a").then(x => console.log(x.foo))`,
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
    dce: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("dce/JSONLoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.json"
        console.log('unused import')
      `,
      "/example.json": `{"data": "FAILED"}`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/TextLoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.txt"
        console.log('unused import')
      `,
      "/example.txt": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
  });
  itBundled("dce/Base64LoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
    loader: {
      ".data": "base64",
    },
  });
  itBundled("dce/DataURLLoaderRemoveUnused", {
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
    loader: {
      ".data": "dataurl",
    },
  });
  itBundled("dce/FileLoaderRemoveUnused", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import unused from "./example.data"
        console.log('unused import')
      `,
      "/example.data": `TEST FAILED`,
    },
    dce: true,
    run: {
      stdout: "unused import",
    },
    assetNaming: "[name].[ext]",
    outdir: "/out",
    loader: {
      ".data": "file",
    },
    onAfterBundle(api) {
      const fs = require("fs");
      expect(fs.readdirSync(api.outdir)).toEqual(["entry.js"]);
    },
  });
  itBundled("dce/RemoveUnusedImportMeta", {
    files: {
      "/entry.js": /* js */ `
        function foo() {
          console.log(import.meta.url, import.meta.path, 'FAILED')
        }
        console.log('foo is unused')
      `,
    },
    dce: true,
    run: {
      stdout: "foo is unused",
    },
  });
  for (const { minify, emitDCEAnnotations, name } of [
    { minify: false, emitDCEAnnotations: false, name: "dce/RemoveUnusedPureCommentCalls" },
    { minify: true, emitDCEAnnotations: false, name: "dce/RemoveUnusedPureCommentCallsMinify" },
    { minify: true, emitDCEAnnotations: true, name: "dce/RemoveUnusedPureCommentCallsMinifyExplitOn" },
  ]) {
    itBundled(name, {
      // in this test, the bundler must drop all `_yes` variables entirely, and then
      // preserve the pure comments in the same way esbuild does
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
      minifyWhitespace: minify,
      emitDCEAnnotations: emitDCEAnnotations,
      backend: "cli",
      onAfterBundle(api) {
        const code = api.readFile("/out.js");
        expect(code).not.toContain("_yes"); // should not contain any *_yes variables
        expect(code).toContain(minify ? "var bare=foo(bar)" : "var bare = foo(bar)");
        const keep = [
          ["at_no", true],
          ["new_at_no", true],
          ["nospace_at_no", true],
          ["nospace_new_at_no", true],
          ["num_no", true],
          ["new_num_no", true],
          ["nospace_num_no", true],
          ["nospace_new_num_no", true],
          ["dot_no", true],
          ["new_dot_no", true],
          ["nested_no", true],
          ["new_nested_no", true],
          ["single_at_no", true],
          ["new_single_at_no", true],
          ["single_num_no", true],
          ["new_single_num_no", true],
          ["parens_no", false],
          ["new_parens_no", false],
          ["exp_no", true],
          ["new_exp_no", true],
        ];
        for (const [name, pureComment] of keep) {
          const regex = new RegExp(`${name}\\s*=[^\/\n;]*(\\/\\*[^\/\n;]*?PURE[^\/\n;]*?\\*\\/)?`, "g");
          const match = regex.exec(code)!;
          expect(match).toBeTruthy(); // should contain ${name}

          if ((emitDCEAnnotations || !minify) && pureComment) {
            expect(match[1], "should contain pure comment for " + name).toBeTruthy();
          } else {
            expect(match[1], "should not contain pure comment for " + name).toBeFalsy();
          }
        }
      },
    });
  }
  itBundled("dce/TreeShakingReactElements", {
    files: {
      "/entry.jsx": /* jsx */ `
        function Foo() {}
  
        let DROP_a = <div/>
        let DROP_b = <Foo>{DROP_a}</Foo>
        let DROP_c = <>{DROP_b}</>
  
        let d = <div/>
        let e = <Foo>{d}</Foo>
        let f = <>{e}</>
        console.log(JSON.stringify(f))
      `,

      "/node_modules/react/index.js": `export const Fragment = 'F'`,
      "/node_modules/react/jsx-dev-runtime.js": `export const jsxDEV = (a,b) => [a,b]; export const Fragment = 'F'`,
    },
    jsx: {
      runtime: "automatic",
    },
    target: "bun",
    dce: true,
    run: {
      stdout: `["F",{"children":[null,{"children":["div",{}]}]}]`,
    },
  });
  itBundled("dce/DeadCodeFollowingJump", {
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
    dce: true,
    minifySyntax: true,
  });
  itBundled("dce/RemoveTrailingReturn", {
    todo: true,
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
    dce: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect([...code.matchAll(/return/g)]).toHaveLength(2); // should remove 3 trailing returns and the arrow function return
    },
  });
  itBundled("dce/ImportReExportOfNamespaceImport", {
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
      "/Users/user/project/node_modules/pkg/bar.js": `module.exports = 'FAILED'`,
    },
    dce: true,
    run: {
      stdout: "123",
    },
  });
  itBundled("dce/TreeShakingImportIdentifier", {
    files: {
      "/entry.js": /* js */ `
        import * as a from './a'
        new a.Keep().x().y()
      `,
      "/a.js": /* js */ `
        import * as b from './b'
        export class Keep extends b.Base { y() { console.log(2); return this; } }
        export class REMOVE extends b.Base { y() { console.log(3); return this; } }
      `,
      "/b.js": `export class Base { x() { console.log(1); return this; } }`,
    },
    dce: true,
    dceKeepMarkerCount: false,
    run: {
      stdout: "1\n2",
    },
  });
  itBundled("dce/TreeShakingObjectProperty", {
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
    dce: true,
  });
  itBundled("dce/TreeShakingClassProperty", {
    todo: true,
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
        let keep6 = class { [{ toString() { console.log(1); } }] = 'x' }

        let POSSIBLE_REMOVAL_1 = class { [{ toString() {} }] = 'x' }
      `,
    },
    bundling: false,
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/TreeShakingClassStaticProperty", {
    todo: true,
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
        let keep8 = class { static [{ toString() { console.log(1); } }] = 'x' }

        let POSSIBLE_REMOVAL_1 = class { static [{ toString() {} }] = 'x' }
      `,
    },
    bundling: false,
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/TreeShakingUnaryOperators", {
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
    format: "iife",
    dce: true,
  });
  itBundled("dce/TreeShakingBinaryOperators", {
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
    dce: true,
    format: "iife",
  });
  itBundled("dce/TreeShakingNoBundleESM", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    format: "esm",
    bundling: false,
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/TreeShakingNoBundleCJS", {
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    dce: true,
    format: "cjs",
    treeShaking: true,
    bundling: false,
    todo: true,
  });
  itBundled("dce/TreeShakingNoBundleIIFE", {
    files: {
      "/entry.js": /* js */ `
        function keep() {}
        function REMOVE() {}
        keep()
      `,
    },
    dce: true,
    format: "iife",
    treeShaking: true,
    bundling: false,
    todo: true,
  });
  itBundled("dce/TreeShakingInESMWrapper", {
    files: {
      "/entry.js": /* js */ `
        import {keep1} from './lib'
        console.log(JSON.stringify([keep1(), require('./cjs')]))
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
    dce: true,
    dceKeepMarkerCount: false,
    run: {
      stdout: '["keep1",{"default":"keep2"}]',
    },
  });
  itBundled("dce/DCETypeOf", {
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
  
        // TODO: These technically have side effects due to TDZ, but this is not currently handled
        typeof c_remove
        typeof l_remove
        typeof s_remove
        const c_remove = 0
        let l_remove
        class s_remove {}
      `,
    },
    format: "esm",
    dce: true,
  });
  itBundled("dce/DCETypeOfEqualsString", {
    files: {
      "/entry.js": /* js */ `
        var hasBar = typeof REMOVE !== 'undefined'
        if (false) console.log(hasBar)
      `,
    },
    format: "iife",
    dce: true,
  });
  itBundled("dce/DCETypeOfEqualsStringMangle", {
    files: {
      "/entry.js": /* js */ `
        // Everything here should be removed as dead code due to tree shaking
        var REMOVE1 = typeof REMOVE2 !== 'undefined'
        if (false) console.log(REMOVE1)
      `,
    },
    format: "iife",
    minifySyntax: true,
    dce: true,
  });
  itBundled("dce/DCETypeOfEqualsStringGuardCondition", {
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
    dce: true,
  });
  itBundled("dce/DCETypeOfCompareStringGuardCondition", {
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
    minifySyntax: true,
    dce: true,
  });
  itBundled("dce/RemoveUnusedImports", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import REMOVE1 from 'a'
        import * as REMOVE2 from 'b'
        import {REMOVE3} from 'c'
      `,
    },
    minifySyntax: true,
    dce: true,
    external: ["a", "b", "c"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toBe(
        dedent`
          import "a";
          import "b";
          import "c";
        ` + "\n",
      );
    },
  });
  itBundled("dce/RemoveUnusedImportsEval", {
    files: {
      "/entry.js": /* js */ `
        import keep_a from 'a'
        import * as keep_b from 'b'
        import {keep_c} from 'c'
        eval('foo(keep_a, keep_b, keep_c)')
      `,
    },
    minifySyntax: true,
    bundling: false,
    dce: true,
  });
  itBundled("dce/RemoveUnusedImportsEvalTS", {
    files: {
      "/entry.ts": /* ts */ `
        import drop_a from 'a'
        import * as drop_b from 'b'
        import {drop_c} from 'c'
        eval('foo(a, b, c)')
      `,
    },
    dce: true,
    minifySyntax: true,
    bundling: false,
  });
  itBundled("dce/DCEClassStaticBlocks", {
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
    dce: true,
  });
  itBundled("dce/DCEVarExports", {
    files: {
      "/a.js": /* js */ `
        var foo = { keep: 123 }
        module.exports = foo
      `,
      "/b.js": /* js */ `
        var exports = { keep: 123 }
        module.exports = exports
      `,
      "/c.js": /* js */ `
        var module = { keep: 123 }
        exports.foo = module
      `,
    },
    dce: true,
    entryPoints: ["/a.js", "/b.js", "/c.js"],
  });
  itBundled("dce/DCETemplateLiteral", {
    files: {
      "/entry.js":
        "var remove;\n" +
        "var alsoKeep;\n" +
        "let a = `${keep}`\n" +
        "let remove2 = `${123}`\n" +
        "let c = `${keep ? 1 : 2n}`\n" +
        "let remove3 = `${remove ? 1 : 2n}`\n" +
        "let e = `${alsoKeep}`\n",
    },
    dce: true,
  });
  itBundled("dce/TreeShakingLoweredClassStaticField", {
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
    dce: true,
    dceKeepMarkerCount: 9,
    unsupportedJSFeatures: ["class-field"],
  });
  itBundled("dce/TreeShakingLoweredClassStaticFieldMinified", {
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
    dce: true,
    dceKeepMarkerCount: 9,
    unsupportedJSFeatures: ["class-field"],
    minifySyntax: true,
  });
  itBundled("dce/TreeShakingLoweredClassStaticFieldAssignment", {
    files: {
      "/entry.ts": /* ts */ `
        class KeepMe1 {
          static x = 'x'
          static y = 'y'
          static z = 'z'
        }
        class KeepMe2 {
          static x = 'x'
          static y = sideEffects_keep()
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
    unsupportedJSFeatures: ["class-field"],
    dce: true,
    dceKeepMarkerCount: 14,
  });
  itBundled("dce/InlineIdentityFunctionCalls", {
    todo: true,
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
    dce: true,
    minifySyntax: false,
    dceKeepMarkerCount: {
      "/out/identity-first.js": 4,
    },
  });
  itBundled("dce/InlineEmptyFunctionCalls", {
    todo: true,
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
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/empty-first.js": 4,
    },
  });
  itBundled("dce/InlineFunctionCallBehaviorChanges", {
    todo: true,
    files: {
      // At the time of writing, using a template string here triggered a bug in bun's transpiler
      // making it impossible to run the test.
      "/entry.js":
        "function empty_REMOVE() { }\n" +
        "function id_REMOVE(x) { return x }\n" +
        "\n" +
        "export let shouldBeWrapped = [\n" +
        "  id_REMOVE(foo.bar)(),\n" +
        "  id_REMOVE(foo[bar])(),\n" +
        "  id_REMOVE(foo?.bar)(),\n" +
        "  id_REMOVE(foo?.[bar])(),\n" +
        "\n" +
        "  (empty_REMOVE(), foo.bar)(),\n" +
        "  (empty_REMOVE(), foo[bar])(),\n" +
        "  (empty_REMOVE(), foo?.bar)(),\n" +
        "  (empty_REMOVE(), foo?.[bar])(),\n" +
        "\n" +
        "  id_REMOVE(eval)(),\n" +
        "  id_REMOVE(eval)?.(),\n" +
        "  (empty_REMOVE(), eval)(),\n" +
        "  (empty_REMOVE(), eval)?.(),\n" +
        "\n" +
        "  id_REMOVE(foo.bar)``,\n" +
        "  id_REMOVE(foo[bar])``,\n" +
        "  id_REMOVE(foo?.bar)``,\n" +
        "  id_REMOVE(foo?.[bar])``,\n" +
        "\n" +
        "  (empty_REMOVE(), foo.bar)``,\n" +
        "  (empty_REMOVE(), foo[bar])``,\n" +
        "  (empty_REMOVE(), foo?.bar)``,\n" +
        "  (empty_REMOVE(), foo?.[bar])``,\n" +
        "\n" +
        "  delete id_REMOVE(foo),\n" +
        "  delete id_REMOVE(foo.bar),\n" +
        "  delete id_REMOVE(foo[bar]),\n" +
        "  delete id_REMOVE(foo?.bar),\n" +
        "  delete id_REMOVE(foo?.[bar]),\n" +
        "\n" +
        "  delete (empty_REMOVE(), foo),\n" +
        "  delete (empty_REMOVE(), foo.bar),\n" +
        "  delete (empty_REMOVE(), foo[bar]),\n" +
        "  delete (empty_REMOVE(), foo?.bar),\n" +
        "  delete (empty_REMOVE(), foo?.[bar]),\n" +
        "\n" +
        "  delete empty_REMOVE(),\n" +
        "]\n" +
        "\n" +
        "export let shouldNotBeWrapped = [\n" +
        "  id_REMOVE(foo)(),\n" +
        "  (empty_REMOVE(), foo)(),\n" +
        "\n" +
        "  id_REMOVE(foo)``,\n" +
        "  (empty_REMOVE(), foo)``,\n" +
        "]\n" +
        "\n" +
        "export let shouldNotBeDoubleWrapped = [\n" +
        "  delete (empty_REMOVE(), foo(), foo()),\n" +
        "  delete id_REMOVE((foo(), bar())),\n" +
        "]",
    },
    bundling: false,
    minifySyntax: true,
    treeShaking: true,
    dce: true,
  });
  itBundled("dce/InlineFunctionCallForInitDecl", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function empty_REMOVE() {}
        function id_REMOVE(x) { return x }
  
        for (var y = empty_REMOVE(); false; ) ;
        for (var z = id_REMOVE(123); false; ) ;
      `,
    },
    minifySyntax: true,
    dce: true,
  });
  itBundled("dce/ConstValueInliningNoBundle", {
    todo: true,
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
        console.log(nested())
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
          console.log(foo)
        }
        console.log(nested());
      `,
      "/disabled-tdz.js": /* js */ `
        console.log(foo())
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
        console.log(foo())
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
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/top-level.js": 5,
      "/out/nested-function.js": 3,
      "/out/namespace-export.js": 1,
    },
  });
  itBundled("dce/ConstValueInliningBundle", {
    todo: true,
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
    dce: true,
    dceKeepMarkerCount: {
      "/out/re-exported-entry.js": 2,
      "/out/re-exported-2-entry.js": 2,
      "/out/re-exported-star-entry.js": 4,
      "/out/re-exported-star-entry.js.": 4,
    },
  });
  itBundled("dce/ConstValueInliningAssign", {
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
    bundleErrors: {
      "/const-update.js": [`Cannot assign to "x" because it is a constant`],
      "/const-assign.js": [`Cannot assign to "x" because it is a constant`],
    },
  });
  itBundled("dce/ConstValueInliningDirectEval", {
    todo: true,
    files: {
      "/top-level-no-eval.js": /* js */ `
        const keep = 1
        console.log(keep, evil('x')) // inline the 1 here
      `,
      "/top-level-eval.js": /* js */ `
        const keep = 1
        console.log(keep, eval('x')) // inline the 1 but keep the const def
      `,
      "/nested-no-eval.js": /* js */ `
        (() => {
          const remove = 1
          console.log(remove, evil('x')) // inline the 1 here and remove the const def
        })()
      `,
      "/nested-eval.js": /* js */ `
        (() => {
          const keep = 1
          console.log(keep, eval('x')) // inline the 1 but keep the const def
        })()
      `,
      "/ts-namespace-no-eval.ts": /* ts */ `
        namespace y {
          export const keep = 1
          console.log(keep, evil('x')) // inline the 1 here
        }
      `,
      "/ts-namespace-eval.ts": /* ts */ `
        namespace z {
          export const keep = 1
          console.log(keep, eval('x'))
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
    bundling: false,
    minifySyntax: true,
    dce: true,
    dceKeepMarkerCount: {
      "/out/top-level-no-eval.js": 1,
      "/out/top-level-eval.js": 1,
      "/out/nested-eval.js": 1,
      "/out/ts-namespace-no-eval.js": 1,
      "/out/ts-namespace-eval.js": 1,
    },
  });
  itBundled("dce/CrossModuleConstantFolding", {
    files: {
      "/enum-constants.ts": /* ts */ `
        export enum remove {
          a = 3,
          b = 6,
        }
      `,
      "/enum-entry.ts": /* ts */ `
        import { remove as x } from './enum-constants'
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
        export enum remove {
          a = 16,
          b = 32,
          c = 64,
        }
      `,
      "/nested-entry.ts": /* ts */ `
        import { a, b, c, remove as x } from './nested-constants'
        console.log({
          'should be 4': ~(~a & ~b) & (b | c),
          'should be 32': ~(~x.a & ~x.b) & (x.b | x.c),
        })
      `,
    },
    entryPoints: ["/enum-entry.ts", "/const-entry.js", "/nested-entry.ts"],
    dce: true,
  });
  itBundled("dce/MultipleDeclarationTreeShaking", {
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
    dce: true,
    treeShaking: true,
    minifySyntax: false,
    run: [
      { file: "/out/var2.js", stdout: "1" },
      { file: "/out/var3.js", stdout: "1\n2" },
      { file: "/out/function2.js", stdout: "2" },
      { file: "/out/function3.js", stdout: "3\n3" },
    ],
  });
  itBundled("dce/MultipleDeclarationTreeShakingMinifySyntax", {
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
        function x() { return "REMOVE" }
        console.log(x())
        function x() { return 2 }
      `,
      "/function3.js": /* js */ `
        function x() { return "REMOVE" }
        console.log(x())
        function x() { return "REMOVE" }
        console.log(x())
        function x() { return 3 }
      `,
    },
    entryPoints: ["/var2.js", "/var3.js", "/function2.js", "/function3.js"],
    dce: true,
    treeShaking: true,
    minifySyntax: true,
    run: [
      { file: "/out/var2.js", stdout: "1" },
      { file: "/out/var3.js", stdout: "1\n2" },
      { file: "/out/function2.js", stdout: "2" },
      { file: "/out/function3.js", stdout: "3\n3" },
    ],
  });
  itBundled("dce/PureCallsWithSpread", {
    todo: true,
    files: {
      // this changes to "[...args]"
      "/entry.js": /* js */ `
        /* @__PURE__ */ REMOVE(...args);
        /* @__PURE__ */ new REMOVE(...args);
      `,
    },
    minifySyntax: true,
    dce: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect([...code.matchAll(/\[\.\.\.args\]/g)]).toHaveLength(2); // spread should be preserved
    },
  });
  itBundled("dce/TopLevelFunctionInliningWithSpread", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        function empty1_remove() {}
        function empty2_remove() {}
        function empty3_remove() {}
  
        function identity1(x) { return x }
        function identity2_remove(x) { return x }
        function identity3(x) { return x }
  
        empty1_remove()
        empty2_remove(args)
        empty3_remove(...args)
  
        identity1()
        identity2_remove(args)
        identity3(...args)
      `,
      "/inner.js": /* js */ `
        export function empty1_remove() {}
        export function empty2_remove() {}
        export function empty3_remove() {}
  
        export function identity1(x) { return x }
        export function identity2_remove(x) { return x }
        export function identity3(x) { return x }
      `,
      "/entry-outer.js": /* js */ `
        import {
          empty1_remove,
          empty2_remove,
          empty3_remove,
  
          identity1,
          identity2_remove,
          identity3,
        } from './inner.js'
  
        empty1_remove()
        empty2_remove(args)
        empty3_remove(...args)
  
        identity1()
        identity2_remove(args)
        identity3(...args)
      `,
    },
    dce: true,
    entryPoints: ["/entry.js", "/entry-outer.js"],
    minifySyntax: true,

    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.args = {
          [Symbol.iterator]() {
            console.log('spread')
            return {
              next() {
                return { done: true, value: undefined }
              }
            }
          }
        };

        await import('./out/entry.js');
        console.log('---')
        await import('./out/entry-outer.js');
      `,
    },
    run: {
      file: "/test.js",
      stdout: "spread\nspread\n---\nspread\nspread",
    },
  });
  itBundled("dce/NestedFunctionInliningWithSpread", {
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
  });
  // im confused what this is testing. cross platform slash? there is none?? not even in the go source
  itBundled("dce/PackageJsonSideEffectsFalseCrossPlatformSlash", {
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
    run: {
      stdout: "foo\nbar",
    },
  });
  itBundled("dce/CallWithNoArg", {
    files: {
      "/entry.js": /* js */ `
        /* @__PURE__ */ noSideEffects();
      `,
    },
    run: {
      stdout: "",
    },
  });
  itBundled("dce/ConstructWithNoArg", {
    files: {
      "/entry.js": /* js */ `
        /* @__PURE__ */ new NoSideEffects();
      `,
    },
    run: {
      stdout: "",
    },
  });
  itBundled("dce/IgnoreAnnotations", {
    files: {
      "/entry.js": /* js */ `
        function noSideEffects() { console.log("PASS"); }
        /* @__PURE__ */ noSideEffects(1);
      `,
    },
    ignoreDCEAnnotations: true,
    run: {
      stdout: "PASS",
    },
  });
  itBundled("dce/IgnoreAnnotationsDoesNotApplyToRuntime", {
    files: {
      "/entry.js": /* js */ `
        import("./other.js");
      `,
      "/other.js": /* js */ `
        export function foo() { }
      `,
    },
    ignoreDCEAnnotations: true,
    onAfterBundle(api) {
      // These symbols technically have side effects, and we use dce annotations
      // to let them tree-shake User-specified --ignore-annotations should not
      // apply to our code.
      api.expectFile("/out.js").not.toContain("__dispose");
      api.expectFile("/out.js").not.toContain("__asyncDispose");
      api.expectFile("/out.js").not.toContain("__require");

      // This assertion catches if the bundler changes in that the runtime is no
      // longer included. If this fails, just adjust the code snippet so some
      // part of runtime.js is used
      api.expectFile("/out.js").toContain("__defProp");
    },
  });
  // itBundled("dce/TreeShakingJSWithAssociatedCSS", {
  //   // TODO: css assertions. this should contain both button and menu
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg/button'
  //       import { Menu } from 'pkg/menu'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/button.js": /* js */ `
  //       import './button.css'
  //       export let Button
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //     "/project/node_modules/pkg/menu.js": /* js */ `
  //       import './menu.css'
  //       export let Menu
  //     `,
  //     "/project/node_modules/pkg/menu.css": `menu { color: green }`,
  //   },
  //   external: ["react"],
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSReExportSideEffectsFalse", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export { Button } from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": false
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSReExportSideEffectsFalseOnlyJS", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export { Button } from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": ["*.css"]
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSExportStarSideEffectsFalse", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export * from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": false
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSExportStarSideEffectsFalseOnlyJS", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/entry.js": `export * from './components'`,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "main": "./entry.js",
  //       "sideEffects": ["*.css"]
  //     }
  //     `,
  //     "/project/node_modules/pkg/components.jsx": /* jsx */ `
  //       require('./button.css')
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/button.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSUnusedNestedImportSideEffectsFalse", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg/button'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //       "sideEffects": false
  //     }
  //     `,
  //     "/project/node_modules/pkg/button.jsx": /* jsx */ `
  //       import styles from './styles'
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/styles.js": /* js */ `
  //       import './styles.css'
  //       export default {}
  //     `,
  //     "/project/node_modules/pkg/styles.css": `button { color: red }`,
  //   },
  // });
  // itBundled("dce/TreeShakingJSWithAssociatedCSSUnusedNestedImportSideEffectsFalseOnlyJS", {
  //   // GENERATED
  //   files: {
  //     "/project/test.jsx": /* jsx */ `
  //       import { Button } from 'pkg/button'
  //       render(<Button/>)
  //     `,
  //     "/project/node_modules/pkg/package.json": /* json */ `
  //       {
  //         "sideEffects": ["*.css"]
  //       }
  //     `,
  //     "/project/node_modules/pkg/button.jsx": /* jsx */ `
  //       import styles from './styles'
  //       export const Button = () => <button/>
  //     `,
  //     "/project/node_modules/pkg/styles.js": /* js */ `
  //       import './styles.css'
  //       export default {}
  //     `,
  //     "/project/node_modules/pkg/styles.css": `button { color: red }`,
  //   },
  // });
});
