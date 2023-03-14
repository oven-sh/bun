import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_packagejson_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/packagejson

describe("bundler", () => {
  itBundled("packagejson/PackageJsonMain", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBadMain", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonSyntaxErrorComment", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonSyntaxErrorTrailingComma", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonModule", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserString", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapRelativeToRelative", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapRelativeToModule", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapRelativeDisabled", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapModuleToRelative", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapModuleToModule", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapModuleDisabled", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapNativeModuleDisabled", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserMapAvoidMissing", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserOverModuleBrowser", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserOverMainNode", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserWithModuleBrowser", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserWithMainNode", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserNodeModulesNoExt", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserNodeModulesIndexNoExt", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserNoExt", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserIndexNoExt", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserIssue2002A", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserIssue2002B", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonBrowserIssue2002C", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportOnly", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardRequireOnly", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireSameFile", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireSeparateFiles", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireForceModuleBeforeMain", {
    // TODO: hand check and tweak
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
    /* TODO: 
        MainFields -- []string{"module", "main"}, */
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireImplicitMain", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireImplicitMainForceModuleBeforeMain", {
    // TODO: hand check and tweak
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
    /* TODO: 
        MainFields -- []string{"module", "main"}, */
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonDualPackageHazardImportAndRequireBrowser", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonMainFieldsA", {
    // TODO: hand check and tweak
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
    /* TODO: 
        MainFields -- []string{"a", "b"}, */
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonMainFieldsB", {
    // TODO: hand check and tweak
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
    /* TODO: 
        MainFields -- []string{"b", "a"}, */
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonNeutralNoDefaultMainFields", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonNeutralExplicitMainFields", {
    // TODO: hand check and tweak
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
    /* TODO: 
        MainFields -- []string{"hello"}, */
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorInvalidModuleSpecifier", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorInvalidPackageConfiguration", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2/foo'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": false } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { "./foo": false } }`,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorInvalidPackageTarget", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorPackagePathNotExported", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": {} } }`,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorModuleNotFound", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./foo.js" } }`,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorUnsupportedDirectoryImport", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./foo/" } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { ".": "./foo" } }`,
      "/Users/user/project/node_modules/pkg2/foo/bar.js": `console.log(bar)`,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsRequireOverImport", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsImportOverRequire", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsDefaultOverImportAndRequire", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsEntryPointImportOverRequire", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsEntryPointRequireOnly", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsEntryPointModuleOverMain", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsEntryPointMainOnly", {
    // TODO: hand check and tweak
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        {
          "main": "./main.js"
        }
      `,
      "/node_modules/pkg/main.js": `console.log('SUCCESS')`,
    },
    entryPoints: ["pkg"],
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsBrowser", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsNode", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsNeutral", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsOrderIndependent", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsWildcard", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsErrorMissingTrailingSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo/bar'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { "./foo/": "./test" } }`,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsCustomConditions", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsNotExactMissingExtension", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsNotExactMissingExtensionPattern", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsExactMissingExtension", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsNoConditionsMatch", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsMustUseRequire", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsMustUseImport", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsReverseLookup", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsPatternTrailers", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonExportsAlternatives", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImports", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportsRemapToOtherPackage", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportsErrorMissingRemappedPackage", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportsInvalidPackageConfiguration", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import '#foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": "#foo"
        }
      `,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportsErrorEqualsHash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import '#'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {}
        }
      `,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportsErrorStartsWithHashSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import '#/foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {}
        }
      `,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonMainFieldsErrorMessageDefault", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonMainFieldsErrorMessageNotIncluded", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonMainFieldsErrorMessageEmpty", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonTypeShouldBeTypes", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportSelfUsingRequire", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportSelfUsingImport", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportSelfUsingRequireScoped", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportSelfUsingImportScoped", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportSelfUsingRequireFailure", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonImportSelfUsingImportFailure", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("packagejson/CommonJSVariableInESMTypeModule", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `module.exports = null`,
      "/package.json": `{ "type": "module" }`,
    },
    snapshot: true,
  });
  itBundled("packagejson/PackageJsonNodePathsIssue2752", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
});
