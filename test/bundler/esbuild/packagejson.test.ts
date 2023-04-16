import { RUN_UNCHECKED_TESTS, expectBundled, itBundled, testForFile } from "../expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_packagejson_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/packagejson

describe("bundler", () => {
  if (!RUN_UNCHECKED_TESTS) return;
  itBundled("packagejson/PackageJsonMain", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./custom-main.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/custom-main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBadMain", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./does-not-exist.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonSyntaxErrorComment", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          // Single-line comment
          "a": 1
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/node_modules/demo-pkg/package.json: ERROR: JSON does not support comments
  `, */
  });
  itBundled("packagejson/PackageJsonSyntaxErrorTrailingComma", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "a": 1,
          "b": 2,
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/node_modules/demo-pkg/package.json: ERROR: JSON does not support trailing commas
  `, */
  });
  itBundled("packagejson/PackageJsonModule", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserString", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": "./browser"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/browser.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapRelativeToRelative", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main",
          "browser": {
            "./main.js": "./main-browser",
            "./lib/util.js": "./lib/util-browser"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        const util = require('./lib/util')
        module.exports = function() {
          return ['main', util]
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main-browser.js": /* js */ `
        const util = require('./lib/util')
        module.exports = function() {
          return ['main-browser', util]
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/util.js": `module.exports = 'util'`,
      "/Users/user/project/node_modules/demo-pkg/lib/util-browser.js": `module.exports = 'util-browser'`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapRelativeToModule", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main",
          "browser": {
            "./util.js": "util-browser"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        const util = require('./util')
        module.exports = function() {
          return ['main', util]
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/util.js": `module.exports = 'util'`,
      "/Users/user/project/node_modules/util-browser/index.js": `module.exports = 'util-browser'`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapRelativeDisabled", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main",
          "browser": {
            "./util-node.js": false
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        const util = require('./util-node')
        module.exports = function(obj) {
          return util.inspect(obj)
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/util-node.js": `module.exports = require('util')`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapModuleToRelative", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "node-pkg": "./node-pkg-browser"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/node-pkg-browser.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        const fn = require('node-pkg')
        module.exports = function() {
          return fn()
        }
      `,
      "/Users/user/project/node_modules/node-pkg/index.js": /* js */ `
        module.exports = function() {
          return 234
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapModuleToModule", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "node-pkg": "node-pkg-browser"
          }
        }
      `,
      "/Users/user/project/node_modules/node-pkg-browser/index.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        const fn = require('node-pkg')
        module.exports = function() {
          return fn()
        }
      `,
      "/Users/user/project/node_modules/node-pkg/index.js": /* js */ `
        module.exports = function() {
          return 234
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapModuleDisabled", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "node-pkg": false
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        const fn = require('node-pkg')
        module.exports = function() {
          return fn()
        }
      `,
      "/Users/user/project/node_modules/node-pkg/index.js": /* js */ `
        module.exports = function() {
          return 234
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapNativeModuleDisabled", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "fs": false
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        const fs = require('fs')
        module.exports = function() {
          return fs.readFile()
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserMapAvoidMissing", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'component-classes'`,
      "/Users/user/project/node_modules/component-classes/package.json": /* json */ `
        {
          "browser": {
            "indexof": "component-indexof"
          }
        }
      `,
      "/Users/user/project/node_modules/component-classes/index.js": /* js */ `
        try {
          var index = require('indexof');
        } catch (err) {
          var index = require('component-indexof');
        }
      `,
      "/Users/user/project/node_modules/component-indexof/index.js": /* js */ `
        module.exports = function() {
          return 234
        }
      `,
    },
  });
  itBundled("packagejson/PackageJsonBrowserOverModuleBrowser", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js",
          "browser": "./main.browser.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    platform: "browser",
  });
  itBundled("packagejson/PackageJsonBrowserOverMainNode", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js",
          "browser": "./main.browser.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    platform: "node",
  });
  itBundled("packagejson/PackageJsonBrowserWithModuleBrowser", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js",
          "browser": {
            "./main.js": "./main.browser.js",
            "./main.esm.js": "./main.browser.esm.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
    },
    platform: "browser",
  });
  itBundled("packagejson/PackageJsonBrowserWithMainNode", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js",
          "browser": {
            "./main.js": "./main.browser.js",
            "./main.esm.js": "./main.browser.esm.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
    },
    platform: "node",
  });
  itBundled("packagejson/PackageJsonBrowserNodeModulesNoExt", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {browser as a} from 'demo-pkg/no-ext'
        import {node as b} from 'demo-pkg/no-ext.js'
        import {browser as c} from 'demo-pkg/ext'
        import {browser as d} from 'demo-pkg/ext.js'
        console.log(a)
        console.log(b)
        console.log(c)
        console.log(d)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./no-ext": "./no-ext-browser.js",
            "./ext.js": "./ext-browser.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/no-ext.js": `export let node = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/no-ext-browser.js": `export let browser = 'browser'`,
      "/Users/user/project/node_modules/demo-pkg/ext.js": `export let node = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/ext-browser.js": `export let browser = 'browser'`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserNodeModulesIndexNoExt", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {browser as a} from 'demo-pkg/no-ext'
        import {node as b} from 'demo-pkg/no-ext/index.js'
        import {browser as c} from 'demo-pkg/ext'
        import {browser as d} from 'demo-pkg/ext/index.js'
        console.log(a)
        console.log(b)
        console.log(c)
        console.log(d)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./no-ext": "./no-ext-browser/index.js",
            "./ext/index.js": "./ext-browser/index.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/no-ext/index.js": `export let node = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/no-ext-browser/index.js": `export let browser = 'browser'`,
      "/Users/user/project/node_modules/demo-pkg/ext/index.js": `export let node = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/ext-browser/index.js": `export let browser = 'browser'`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserNoExt", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {browser as a} from './demo-pkg/no-ext'
        import {node as b} from './demo-pkg/no-ext.js'
        import {browser as c} from './demo-pkg/ext'
        import {browser as d} from './demo-pkg/ext.js'
        console.log(a)
        console.log(b)
        console.log(c)
        console.log(d)
      `,
      "/Users/user/project/src/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./no-ext": "./no-ext-browser.js",
            "./ext.js": "./ext-browser.js"
          }
        }
      `,
      "/Users/user/project/src/demo-pkg/no-ext.js": `export let node = 'node'`,
      "/Users/user/project/src/demo-pkg/no-ext-browser.js": `export let browser = 'browser'`,
      "/Users/user/project/src/demo-pkg/ext.js": `export let node = 'node'`,
      "/Users/user/project/src/demo-pkg/ext-browser.js": `export let browser = 'browser'`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserIndexNoExt", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {browser as a} from './demo-pkg/no-ext'
        import {node as b} from './demo-pkg/no-ext/index.js'
        import {browser as c} from './demo-pkg/ext'
        import {browser as d} from './demo-pkg/ext/index.js'
        console.log(a)
        console.log(b)
        console.log(c)
        console.log(d)
      `,
      "/Users/user/project/src/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./no-ext": "./no-ext-browser/index.js",
            "./ext/index.js": "./ext-browser/index.js"
          }
        }
      `,
      "/Users/user/project/src/demo-pkg/no-ext/index.js": `export let node = 'node'`,
      "/Users/user/project/src/demo-pkg/no-ext-browser/index.js": `export let browser = 'browser'`,
      "/Users/user/project/src/demo-pkg/ext/index.js": `export let node = 'node'`,
      "/Users/user/project/src/demo-pkg/ext-browser/index.js": `export let browser = 'browser'`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserESBuildIssue2002A", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `require('pkg/sub')`,
      "/Users/user/project/src/node_modules/pkg/package.json": /* json */ `
        {
        "browser": {
          "./sub": "./sub/foo.js"
        }
      }
      `,
      "/Users/user/project/src/node_modules/pkg/sub/foo.js": `require('sub')`,
      "/Users/user/project/src/node_modules/sub/package.json": `{ "main": "./bar" }`,
      "/Users/user/project/src/node_modules/sub/bar.js": `works()`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserESBuildIssue2002B", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `require('pkg/sub')`,
      "/Users/user/project/src/node_modules/pkg/package.json": /* json */ `
        {
        "browser": {
          "./sub": "./sub/foo.js",
          "./sub/sub": "./sub/bar.js"
        }
      }
      `,
      "/Users/user/project/src/node_modules/pkg/sub/foo.js": `require('sub')`,
      "/Users/user/project/src/node_modules/pkg/sub/bar.js": `works()`,
    },
  });
  itBundled("packagejson/PackageJsonBrowserESBuildIssue2002C", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `require('pkg/sub')`,
      "/Users/user/project/src/node_modules/pkg/package.json": /* json */ `
        {
        "browser": {
          "./sub": "./sub/foo.js",
          "./sub/sub.js": "./sub/bar.js"
        }
      }
      `,
      "/Users/user/project/src/node_modules/pkg/sub/foo.js": `require('sub')`,
      "/Users/user/project/src/node_modules/sub/index.js": `works()`,
    },
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportOnly", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
  });
  itBundled("packagejson/PackageJsonDualPackageHazardRequireOnly", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireSameFile", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value, require('demo-pkg'))
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireSeparateFiles", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-main'
        import './test-module'
      `,
      "/Users/user/project/src/test-main.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/src/test-module.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireForceModuleBeforeMain", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-main'
        import './test-module'
      `,
      "/Users/user/project/src/test-main.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/src/test-module.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
    mainFields: ["module", "main"],
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireImplicitMain", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-index'
        import './test-module'
      `,
      "/Users/user/project/src/test-index.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/src/test-module.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireImplicitMainForceModuleBeforeMain", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-index'
        import './test-module'
      `,
      "/Users/user/project/src/test-index.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/src/test-module.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "module": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
    mainFields: ["module", "main"],
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireBrowser", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-main'
        import './test-module'
      `,
      "/Users/user/project/src/test-main.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/src/test-module.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./module.js",
          "browser": {
            "./main.js": "./main.browser.js",
            "./module.js": "./module.browser.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": `module.exports = 'browser main'`,
      "/Users/user/project/node_modules/demo-pkg/module.browser.js": `export default 'browser module'`,
    },
  });
  itBundled("packagejson/PackageJsonMainFieldsA", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "a": "./a.js",
          "b": "./b.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/demo-pkg/b.js": `export default 'b'`,
    },
    mainFields: ["a", "b"],
  });
  itBundled("packagejson/PackageJsonMainFieldsB", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "a": "./a.js",
          "b": "./b.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/demo-pkg/b.js": `export default 'b'`,
    },
    mainFields: ["b", "a"],
  });
  itBundled("packagejson/PackageJsonNeutralNoDefaultMainFields", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "module": "./main.esm.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.esm.js": /* js */ `
        export default function() {
          return 123
        }
      `,
    },
    platform: "neutral",
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "demo-pkg"
  Users/user/project/node_modules/demo-pkg/package.json: NOTE: The "main" field here was ignored. Main fields must be configured explicitly when using the "neutral" platform.
  NOTE: You can mark the path "demo-pkg" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonNeutralExplicitMainFields", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "hello": "./main.js",
          "module": "./main.esm.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    platform: "neutral",
    mainFields: ["hello"],
  });
  itBundled("packagejson/PackageJsonExportsErrorInvalidModuleSpecifier", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2'
        import 'pkg3'
        import 'pkg4'
        import 'pkg5'
        import 'pkg6'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./%%" } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { ".": "./%2f" } }`,
      "/Users/user/project/node_modules/pkg3/package.json": `{ "exports": { ".": "./%2F" } }`,
      "/Users/user/project/node_modules/pkg4/package.json": `{ "exports": { ".": "./%5c" } }`,
      "/Users/user/project/node_modules/pkg5/package.json": `{ "exports": { ".": "./%5C" } }`,
      "/Users/user/project/node_modules/pkg6/package.json": `{ "exports": { ".": "./%31.js" } }`,
      "/Users/user/project/node_modules/pkg6/1.js": `console.log(1)`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The module specifier "./%%" is invalid:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg2"
  Users/user/project/node_modules/pkg2/package.json: NOTE: The module specifier "./%2f" is invalid:
  NOTE: You can mark the path "pkg2" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg3"
  Users/user/project/node_modules/pkg3/package.json: NOTE: The module specifier "./%2F" is invalid:
  NOTE: You can mark the path "pkg3" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg4"
  Users/user/project/node_modules/pkg4/package.json: NOTE: The module specifier "./%5c" is invalid:
  NOTE: You can mark the path "pkg4" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg5"
  Users/user/project/node_modules/pkg5/package.json: NOTE: The module specifier "./%5C" is invalid:
  NOTE: You can mark the path "pkg5" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsErrorInvalidPackageConfiguration", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2/foo'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": false } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { "./foo": false } }`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/node_modules/pkg1/package.json: WARNING: This value must be a string, an object, an array, or null
  Users/user/project/node_modules/pkg2/package.json: WARNING: This value must be a string, an object, an array, or null
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The package configuration has an invalid value here:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg2/foo"
  Users/user/project/node_modules/pkg2/package.json: NOTE: The package configuration has an invalid value here:
  NOTE: You can mark the path "pkg2/foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsErrorInvalidPackageTarget", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2'
        import 'pkg3'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "invalid" } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { ".": "./../pkg3" } }`,
      "/Users/user/project/node_modules/pkg3/package.json": `{ "exports": { ".": "./node_modules/pkg" } }`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The package target "invalid" is invalid because it doesn't start with "./":
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg2"
  Users/user/project/node_modules/pkg2/package.json: NOTE: The package target "./../pkg3" is invalid because it contains invalid segment "..":
  NOTE: You can mark the path "pkg2" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg3"
  Users/user/project/node_modules/pkg3/package.json: NOTE: The package target "./node_modules/pkg" is invalid because it contains invalid segment "node_modules":
  NOTE: You can mark the path "pkg3" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsErrorPackagePathNotExported", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": {} } }`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "./foo" is not exported by package "pkg1":
  NOTE: You can mark the path "pkg1/foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsErrorModuleNotFound", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./foo.js" } }`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The module "./foo.js" was not found on the file system:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsErrorUnsupportedDirectoryImport", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./foo/" } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { ".": "./foo" } }`,
      "/Users/user/project/node_modules/pkg2/foo/bar.js": `console.log(bar)`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The module "./foo" was not found on the file system:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg2"
  Users/user/project/node_modules/pkg2/package.json: NOTE: Importing the directory "./foo" is forbidden by this package:
  Users/user/project/node_modules/pkg2/package.json: NOTE: The presence of "exports" here makes importing a directory forbidden:
  NOTE: You can mark the path "pkg2" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsRequireOverImport", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `require('pkg')`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "import": "./import.js",
            "require": "./require.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/import.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/require.js": `console.log('SUCCESS')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsImportOverRequire", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "require": "./require.js",
            "import": "./import.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/require.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/import.js": `console.log('SUCCESS')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsDefaultOverImportAndRequire", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "default": "./default.js",
            "import": "./import.js",
            "require": "./require.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/require.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/import.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('SUCCESS')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsEntryPointImportOverRequire", {
    // GENERATED
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "import": "./import.js",
            "require": "./require.js"
          },
          "module": "./module.js",
          "main": "./main.js"
        }
      `,
      "/node_modules/pkg/import.js": `console.log('SUCCESS')`,
      "/node_modules/pkg/require.js": `console.log('FAILURE')`,
      "/node_modules/pkg/module.js": `console.log('FAILURE')`,
      "/node_modules/pkg/main.js": `console.log('FAILURE')`,
    },
    entryPoints: ["pkg"],
  });
  itBundled("packagejson/PackageJsonExportsEntryPointRequireOnly", {
    // GENERATED
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "require": "./require.js"
          },
          "module": "./module.js",
          "main": "./main.js"
        }
      `,
      "/node_modules/pkg/require.js": `console.log('FAILURE')`,
      "/node_modules/pkg/module.js": `console.log('FAILURE')`,
      "/node_modules/pkg/main.js": `console.log('FAILURE')`,
    },
    entryPoints: ["pkg"],
    /* TODO FIX expectedScanLog: `ERROR: Could not resolve "pkg"
  node_modules/pkg/package.json: NOTE: The path "." is not currently exported by package "pkg":
  node_modules/pkg/package.json: NOTE: None of the conditions provided ("require") match any of the currently active conditions ("browser", "default", "import"):
  `, */
  });
  itBundled("packagejson/PackageJsonExportsEntryPointModuleOverMain", {
    // GENERATED
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        {
          "module": "./module.js",
          "main": "./main.js"
        }
      `,
      "/node_modules/pkg/module.js": `console.log('SUCCESS')`,
      "/node_modules/pkg/main.js": `console.log('FAILURE')`,
    },
    entryPoints: ["pkg"],
  });
  itBundled("packagejson/PackageJsonExportsEntryPointMainOnly", {
    // GENERATED
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        {
          "main": "./main.js"
        }
      `,
      "/node_modules/pkg/main.js": `console.log('SUCCESS')`,
    },
    entryPoints: ["pkg"],
  });
  itBundled("packagejson/PackageJsonExportsBrowser", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "node": "./node.js",
            "browser": "./browser.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('SUCCESS')`,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonExportsNode", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "browser": "./browser.js",
            "node": "./node.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('SUCCESS')`,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonExportsNeutral", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg'`,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "node": "./node.js",
            "browser": "./browser.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/node.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/browser.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg/default.js": `console.log('SUCCESS')`,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonExportsOrderIndependent", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1/foo/bar.js'
        import 'pkg2/foo/bar.js'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "./": "./1/",
            "./foo/": "./2/"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/1/foo/bar.js": `console.log('FAILURE')`,
      "/Users/user/project/node_modules/pkg1/2/bar.js": `console.log('SUCCESS')`,
      "/Users/user/project/node_modules/pkg2/package.json": /* json */ `
        {
          "exports": {
            "./foo/": "./1/",
            "./": "./2/"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg2/1/bar.js": `console.log('SUCCESS')`,
      "/Users/user/project/node_modules/pkg2/2/foo/bar.js": `console.log('FAILURE')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsWildcard", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1/foo'
        import 'pkg1/foo2'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "./foo*": "./file*.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/file.js": `console.log('SUCCESS')`,
      "/Users/user/project/node_modules/pkg1/file2.js": `console.log('SUCCESS')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsErrorMissingTrailingSlash", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo/bar'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { "./foo/": "./test" } }`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo/bar"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The module specifier "./test" is invalid because it doesn't end in "/":
  NOTE: You can mark the path "pkg1/foo/bar" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsCustomConditions", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1'`,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "custom1": "./custom1.js",
            "custom2": "./custom2.js",
            "default": "./default.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/custom2.js": `console.log('SUCCESS')`,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonExportsNotExactMissingExtension", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo/bar'`,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "./foo/": "./dir/"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/dir/bar.js": `console.log('SUCCESS')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsNotExactMissingExtensionPattern", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo/bar'`,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "./foo/*": "./dir/*"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/dir/bar.js": `console.log('SUCCESS')`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo/bar"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The module "./dir/bar" was not found on the file system:
  Users/user/project/src/entry.js: NOTE: Import from "pkg1/foo/bar.js" to get the file "Users/user/project/node_modules/pkg1/dir/bar.js":
  NOTE: You can mark the path "pkg1/foo/bar" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsExactMissingExtension", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo/bar'`,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "./foo/bar": "./dir/bar"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/dir/bar.js": `console.log('SUCCESS')`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo/bar"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The module "./dir/bar" was not found on the file system:
  NOTE: You can mark the path "pkg1/foo/bar" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsNoConditionsMatch", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg1/foo.js'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            ".": {
              "what": "./foo.js"
            },
            "./foo.js": {
              "what": "./foo.js"
            }
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/foo.js": `console.log('FAILURE')`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "." is not currently exported by package "pkg1":
  Users/user/project/node_modules/pkg1/package.json: NOTE: None of the conditions provided ("what") match any of the currently active conditions ("browser", "default", "import"):
  Users/user/project/node_modules/pkg1/package.json: NOTE: Consider enabling the "what" condition if this package expects it to be enabled. You can use 'Conditions: []string{"what"}' to do that:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo.js"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "./foo.js" is not currently exported by package "pkg1":
  Users/user/project/node_modules/pkg1/package.json: NOTE: None of the conditions provided ("what") match any of the currently active conditions ("browser", "default", "import"):
  Users/user/project/node_modules/pkg1/package.json: NOTE: Consider enabling the "what" condition if this package expects it to be enabled. You can use 'Conditions: []string{"what"}' to do that:
  NOTE: You can mark the path "pkg1/foo.js" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsMustUseRequire", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg1/foo.js'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            ".": {
              "require": "./foo.js"
            },
            "./foo.js": {
              "require": "./foo.js"
            }
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/foo.js": `console.log('FAILURE')`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "." is not currently exported by package "pkg1":
  Users/user/project/node_modules/pkg1/package.json: NOTE: None of the conditions provided ("require") match any of the currently active conditions ("browser", "default", "import"):
  Users/user/project/src/entry.js: NOTE: Consider using a "require()" call to import this file, which will work because the "require" condition is supported by this package:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo.js"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "./foo.js" is not currently exported by package "pkg1":
  Users/user/project/node_modules/pkg1/package.json: NOTE: None of the conditions provided ("require") match any of the currently active conditions ("browser", "default", "import"):
  Users/user/project/src/entry.js: NOTE: Consider using a "require()" call to import this file, which will work because the "require" condition is supported by this package:
  NOTE: You can mark the path "pkg1/foo.js" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsMustUseImport", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        require('pkg1')
        require('pkg1/foo.js')
      `,
      "/Users/user/project/node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            ".": {
              "import": "./foo.js"
            },
            "./foo.js": {
              "import": "./foo.js"
            }
          }
        }
      `,
      "/Users/user/project/node_modules/pkg1/foo.js": `console.log('FAILURE')`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "." is not currently exported by package "pkg1":
  Users/user/project/node_modules/pkg1/package.json: NOTE: None of the conditions provided ("import") match any of the currently active conditions ("browser", "default", "require"):
  Users/user/project/src/entry.js: NOTE: Consider using an "import" statement to import this file, which will work because the "import" condition is supported by this package:
  NOTE: You can mark the path "pkg1" as external to exclude it from the bundle, which will remove this error. You can also surround this "require" call with a try/catch block to handle this failure at run-time instead of bundle-time.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg1/foo.js"
  Users/user/project/node_modules/pkg1/package.json: NOTE: The path "./foo.js" is not currently exported by package "pkg1":
  Users/user/project/node_modules/pkg1/package.json: NOTE: None of the conditions provided ("import") match any of the currently active conditions ("browser", "default", "require"):
  Users/user/project/src/entry.js: NOTE: Consider using an "import" statement to import this file, which will work because the "import" condition is supported by this package:
  NOTE: You can mark the path "pkg1/foo.js" as external to exclude it from the bundle, which will remove this error. You can also surround this "require" call with a try/catch block to handle this failure at run-time instead of bundle-time.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsReverseLookup", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        require('pkg/path/to/real/file')
        require('pkg/path/to/other/file')
      `,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "./lib/te*": {
              "default": "./path/to/re*.js"
            },
            "./extra/": {
              "default": "./path/to/"
            }
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/path/to/real/file.js": ``,
      "/Users/user/project/node_modules/pkg/path/to/other/file.js": ``,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg/path/to/real/file"
  Users/user/project/node_modules/pkg/package.json: NOTE: The path "./path/to/real/file" is not exported by package "pkg":
  Users/user/project/node_modules/pkg/package.json: NOTE: The file "./path/to/real/file.js" is exported at path "./lib/teal/file":
  Users/user/project/src/entry.js: NOTE: Import from "pkg/lib/teal/file" to get the file "Users/user/project/node_modules/pkg/path/to/real/file.js":
  NOTE: You can mark the path "pkg/path/to/real/file" as external to exclude it from the bundle, which will remove this error. You can also surround this "require" call with a try/catch block to handle this failure at run-time instead of bundle-time.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg/path/to/other/file"
  Users/user/project/node_modules/pkg/package.json: NOTE: The path "./path/to/other/file" is not exported by package "pkg":
  Users/user/project/node_modules/pkg/package.json: NOTE: The file "./path/to/other/file.js" is exported at path "./extra/other/file.js":
  Users/user/project/src/entry.js: NOTE: Import from "pkg/extra/other/file.js" to get the file "Users/user/project/node_modules/pkg/path/to/other/file.js":
  NOTE: You can mark the path "pkg/path/to/other/file" as external to exclude it from the bundle, which will remove this error. You can also surround this "require" call with a try/catch block to handle this failure at run-time instead of bundle-time.
  `, */
  });
  itBundled("packagejson/PackageJsonExportsPatternTrailers", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg/path/foo.js/bar.js'
        import 'pkg2/features/abc'
        import 'pkg2/features/xyz.js'
      `,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "./path/*/bar.js": "./dir/baz-*"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/dir/baz-foo.js": `console.log('works')`,
      "/Users/user/project/node_modules/pkg2/package.json": /* json */ `
        {
          "exports": {
            "./features/*": "./public/*.js",
            "./features/*.js": "./public/*.js"
          }
        }
      `,
      "/Users/user/project/node_modules/pkg2/public/abc.js": `console.log('abc')`,
      "/Users/user/project/node_modules/pkg2/public/xyz.js": `console.log('xyz')`,
    },
  });
  itBundled("packagejson/PackageJsonExportsAlternatives", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import redApple from 'pkg/apples/red.js'
        import greenApple from 'pkg/apples/green.js'
        import redBook from 'pkg/books/red'
        import greenBook from 'pkg/books/green'
        console.log({redApple, greenApple, redBook, greenBook})
      `,
      "/Users/user/project/node_modules/pkg/package.json": /* json */ `
        {
          "exports": {
            "./apples/": ["./good-apples/", "./bad-apples/"],
            "./books/*": ["./good-books/*-book.js", "./bad-books/*-book.js"]
          }
        }
      `,
      "/Users/user/project/node_modules/pkg/good-apples/green.js": `export default '🍏'`,
      "/Users/user/project/node_modules/pkg/bad-apples/red.js": `export default '🍎'`,
      "/Users/user/project/node_modules/pkg/good-books/green-book.js": `export default '📗'`,
      "/Users/user/project/node_modules/pkg/bad-books/red-book.js": `export default '📕'`,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "pkg/apples/red.js"
  Users/user/project/node_modules/pkg/package.json: NOTE: The module "./good-apples/red.js" was not found on the file system:
  NOTE: You can mark the path "pkg/apples/red.js" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/entry.js: ERROR: Could not resolve "pkg/books/red"
  Users/user/project/node_modules/pkg/package.json: NOTE: The module "./good-books/red-book.js" was not found on the file system:
  NOTE: You can mark the path "pkg/books/red" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonImports", {
    // GENERATED
    files: {
      "/Users/user/project/src/foo/entry.js": /* js */ `
        import '#top-level'
        import '#nested/path.js'
        import '#star/c.js'
        import '#slash/d.js'
      `,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {
            "#top-level": "./a.js",
            "#nested/path.js": "./b.js",
            "#star/*": "./some-star/*",
            "#slash/": "./some-slash/"
          }
        }
      `,
      "/Users/user/project/src/a.js": `console.log('a.js')`,
      "/Users/user/project/src/b.js": `console.log('b.js')`,
      "/Users/user/project/src/some-star/c.js": `console.log('c.js')`,
      "/Users/user/project/src/some-slash/d.js": `console.log('d.js')`,
    },
  });
  itBundled("packagejson/PackageJsonImportsRemapToOtherPackage", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import '#top-level'
        import '#nested/path.js'
        import '#star/c.js'
        import '#slash/d.js'
      `,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {
            "#top-level": "pkg/a.js",
            "#nested/path.js": "pkg/b.js",
            "#star/*": "pkg/some-star/*",
            "#slash/": "pkg/some-slash/"
          }
        }
      `,
      "/Users/user/project/src/node_modules/pkg/a.js": `console.log('a.js')`,
      "/Users/user/project/src/node_modules/pkg/b.js": `console.log('b.js')`,
      "/Users/user/project/src/node_modules/pkg/some-star/c.js": `console.log('c.js')`,
      "/Users/user/project/src/node_modules/pkg/some-slash/d.js": `console.log('d.js')`,
    },
  });
  itBundled("packagejson/PackageJsonImportsErrorMissingRemappedPackage", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import '#foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {
            "#foo": "bar"
          }
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "#foo"
  Users/user/project/src/package.json: NOTE: The remapped path "bar" could not be resolved:
  NOTE: You can mark the path "#foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonImportsInvalidPackageConfiguration", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import '#foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": "#foo"
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "#foo"
  Users/user/project/src/package.json: NOTE: The package configuration has an invalid value here:
  NOTE: You can mark the path "#foo" as external to exclude it from the bundle, which will remove this error.
  Users/user/project/src/package.json: WARNING: The value for "imports" must be an object
  `, */
  });
  itBundled("packagejson/PackageJsonImportsErrorEqualsHash", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import '#'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {}
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "#"
  Users/user/project/src/package.json: NOTE: This "imports" map was ignored because the module specifier "#" is invalid:
  NOTE: You can mark the path "#" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonImportsErrorStartsWithHashSlash", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import '#/foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {}
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "#/foo"
  Users/user/project/src/package.json: NOTE: This "imports" map was ignored because the module specifier "#/foo" is invalid:
  NOTE: You can mark the path "#/foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonMainFieldsErrorMessageDefault", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "foo"
  NOTE: You can mark the path "foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonMainFieldsErrorMessageNotIncluded", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "foo"
  Users/user/project/node_modules/foo/package.json: NOTE: The "main" field here was ignored because the list of main fields to use is currently set to ["some", "fields"].
  NOTE: You can mark the path "foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonMainFieldsErrorMessageEmpty", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "foo"
  Users/user/project/node_modules/foo/package.json: NOTE: The "main" field here was ignored because the list of main fields to use is currently set to [].
  NOTE: You can mark the path "foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/PackageJsonTypeShouldBeTypes", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": ``,
      "/Users/user/project/package.json": /* json */ `
        {
          "main": "./src/index.js",
          "type": "./src/index.d.ts"
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    /* TODO FIX expectedScanLog: `Users/user/project/package.json: WARNING: "./src/index.d.ts" is not a valid value for the "type" field
  Users/user/project/package.json: NOTE: TypeScript type declarations use the "types" field, not the "type" field:
  `, */
  });
  itBundled("packagejson/PackageJsonImportSelfUsingRequire", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        module.exports = 'index'
        console.log(
          require("xyz"),
          require("xyz/bar"),
        )
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo'`,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "xyz",
          "exports": {
            ".": "./src/index.js",
            "./bar": {
              "import": "./src/foo-import.js",
              "require": "./src/foo-require.js"
            }
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonImportSelfUsingImport", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import xyz from "xyz"
        import foo from "xyz/bar"
        export default 'index'
        console.log(xyz, foo)
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo'`,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "xyz",
          "exports": {
            ".": "./src/index.js",
            "./bar": {
              "import": "./src/foo-import.js",
              "require": "./src/foo-require.js"
            }
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonImportSelfUsingRequireScoped", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        module.exports = 'index'
        console.log(
          require("@some-scope/xyz"),
          require("@some-scope/xyz/bar"),
        )
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo'`,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "@some-scope/xyz",
          "exports": {
            ".": "./src/index.js",
            "./bar": {
              "import": "./src/foo-import.js",
              "require": "./src/foo-require.js"
            }
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonImportSelfUsingImportScoped", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import xyz from "@some-scope/xyz"
        import foo from "@some-scope/xyz/bar"
        export default 'index'
        console.log(xyz, foo)
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo'`,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "@some-scope/xyz",
          "exports": {
            ".": "./src/index.js",
            "./bar": {
              "import": "./src/foo-import.js",
              "require": "./src/foo-require.js"
            }
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/PackageJsonImportSelfUsingRequireFailure", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": `require("xyz/src/foo.js")`,
      "/Users/user/project/src/foo.js": `module.exports = 'foo'`,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "xyz",
          "exports": {
            ".": "./src/index.js",
            "./bar": "./src/foo.js"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    /* TODO FIX expectedScanLog: `Users/user/project/src/index.js: ERROR: Could not resolve "xyz/src/foo.js"
  Users/user/project/package.json: NOTE: The path "./src/foo.js" is not exported by package "xyz":
  Users/user/project/package.json: NOTE: The file "./src/foo.js" is exported at path "./bar":
  Users/user/project/src/index.js: NOTE: Import from "xyz/bar" to get the file "Users/user/project/src/foo.js":
  NOTE: You can mark the path "xyz/src/foo.js" as external to exclude it from the bundle, which will remove this error. You can also surround this "require" call with a try/catch block to handle this failure at run-time instead of bundle-time.
  `, */
  });
  itBundled("packagejson/PackageJsonImportSelfUsingImportFailure", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": `import "xyz/src/foo.js"`,
      "/Users/user/project/src/foo.js": `export default 'foo'`,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "xyz",
          "exports": {
            ".": "./src/index.js",
            "./bar": "./src/foo.js"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    /* TODO FIX expectedScanLog: `Users/user/project/src/index.js: ERROR: Could not resolve "xyz/src/foo.js"
  Users/user/project/package.json: NOTE: The path "./src/foo.js" is not exported by package "xyz":
  Users/user/project/package.json: NOTE: The file "./src/foo.js" is exported at path "./bar":
  Users/user/project/src/index.js: NOTE: Import from "xyz/bar" to get the file "Users/user/project/src/foo.js":
  NOTE: You can mark the path "xyz/src/foo.js" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("packagejson/CommonJSVariableInESMTypeModule", {
    // GENERATED
    files: {
      "/entry.js": `module.exports = null`,
      "/package.json": `{ "type": "module" }`,
    },
    /* TODO FIX expectedScanLog: `entry.js: WARNING: The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected
  package.json: NOTE: This file is considered to be an ECMAScript module because the enclosing "package.json" file sets the type of this file to "module":
  NOTE: Node's package format requires that CommonJS files in a "type": "module" package use the ".cjs" file extension.
  `, */
  });
  itBundled("packagejson/PackageJsonNodePathsESBuildIssue2752", {
    // GENERATED
    files: {
      "/src/entry.js": /* js */ `
        import "pkg1"
        import "pkg2"
        import "@scope/pkg3/baz"
        import "@scope/pkg4"
      `,
      "/usr/lib/pkg/pkg1/package.json": `{ "main": "./foo.js" }`,
      "/usr/lib/pkg/pkg1/foo.js": `console.log('pkg1')`,
      "/lib/pkg/pkg2/package.json": `{ "exports": { ".": "./bar.js" } }`,
      "/lib/pkg/pkg2/bar.js": `console.log('pkg2')`,
      "/var/lib/pkg/@scope/pkg3/package.json": `{ "browser": { "./baz.js": "./baz-browser.js" } }`,
      "/var/lib/pkg/@scope/pkg3/baz-browser.js": `console.log('pkg3')`,
      "/tmp/pkg/@scope/pkg4/package.json": `{ "exports": { ".": { "import": "./bat.js" } } }`,
      "/tmp/pkg/@scope/pkg4/bat.js": `console.log('pkg4')`,
    },
  });
});
