import { itBundled } from "../expectBundled";
import { describe } from "bun:test";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_packagejson_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/packagejson

describe("bundler", () => {
  itBundled("packagejson/Main", {
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
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/trailing-comma", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          // very comment!!
          /** even multi-line comment!! */
          /** such feature much compatible very ecosystem */
          "main": "./custom-main.js",
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/custom-main.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/BadMain", {
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
    run: {
      stdout: "123",
    },
  });
  // itBundled("packagejson/SyntaxErrorComment", {
  //   todo: true,
  //   files: {
  //     "/Users/user/project/src/entry.js": /* js */ `
  //       import fn from 'demo-pkg'
  //       console.log(fn())
  //     `,
  //     "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
  //       {
  //         // Single-line comment
  //         "a": 1
  //       }
  //     `,
  //     "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
  //       module.exports = function() {
  //         return 123
  //       }
  //     `,
  //   },
  //   bundleErrors: {
  //     "/Users/user/project/node_modules/demo-pkg/package.json": ["JSON does not support comments"],
  //   },
  // });
  // itBundled("packagejson/SyntaxErrorTrailingComma", {
  //   files: {
  //     "/Users/user/project/src/entry.js": /* js */ `
  //       import fn from 'demo-pkg'
  //       console.log(fn())
  //     `,
  //     "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
  //       {
  //         "a": 1,
  //         "b": 2,
  //       }
  //     `,
  //     "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
  //       module.exports = function() {
  //         return 123
  //       }
  //     `,
  //   },
  //   bundleErrors: {
  //     "/Users/user/project/node_modules/demo-pkg/package.json": ["JSON does not support trailing commas"],
  //   },
  // });
  itBundled("packagejson/Module", {
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
          return 234
        }
      `,
    },
    run: {
      stdout: "234",
    },
  });
  itBundled("packagejson/BrowserString", {
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
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/BrowserMapRelativeToRelative", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(JSON.stringify(fn()))
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
    run: {
      stdout: `["main-browser","util-browser"]`,
    },
  });
  itBundled("packagejson/BrowserMapRelativeToModule", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(JSON.stringify(fn()))
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
    run: {
      stdout: `["main","util-browser"]`,
    },
  });
  itBundled("packagejson/BrowserMapRelativeDisabled", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(JSON.stringify(fn(123)))
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
          return [util.inspect, obj]
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/util-node.js": `module.exports = require('util')`,
    },
    run: {
      stdout: `[null,123]`,
    },
  });
  itBundled("packagejson/BrowserMapModuleToRelative", {
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
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/BrowserMapModuleToModule", {
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
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/BrowserMapModuleDisabled", {
    todo: true,
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
        console.log(fn)
        module.exports = function() {
          return typeof fn === 'function' ? fn() : 123
        }
      `,
      "/Users/user/project/node_modules/node-pkg/index.js": /* js */ `
        module.exports = function() {
          return 234
        }
      `,
    },
    run: {
      stdout: "{}\n123",
    },
  });
  itBundled("packagejson/BrowserMapNativeModuleDisabled", {
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
          return fs.readFile === undefined
        }
      `,
    },
    run: {
      stdout: "true",
    },
  });
  itBundled("packagejson/BrowserMapAvoidMissing", {
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
          console.log('catch')
          var index = require('component-indexof');
        }
        console.log(index())
      `,
      "/Users/user/project/node_modules/component-indexof/index.js": /* js */ `
        module.exports = function() {
          return 234
        }
      `,
      "/Users/user/project/node_modules/indexof/index.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    run: {
      stdout: "234",
    },
  });
  itBundled("packagejson/BrowserOverModuleBrowser", {
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
          return 234
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 345
        }
      `,
    },
    target: "browser",
    run: {
      stdout: "345",
    },
  });
  itBundled("packagejson/BrowserOverMainNode", {
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
          return 234
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 345
        }
      `,
    },
    target: "node",
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/BrowserWithModuleBrowser", {
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
          return 234
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 345
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.esm.js": /* js */ `
        export default function() {
          return 456
        }
      `,
    },
    target: "browser",
    run: {
      stdout: "456",
    },
  });
  itBundled("packagejson/BrowserWithMainNode", {
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
          return 234
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.js": /* js */ `
        module.exports = function() {
          return 345
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.browser.esm.js": /* js */ `
        export default function() {
          return 456
        }
      `,
    },
    target: "node",
    run: {
      stdout: "123",
    },
  });
  itBundled("packagejson/BrowserNodeModulesNoExt", {
    todo: true,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {value as a} from 'demo-pkg/no-ext'
        import {value as b} from 'demo-pkg/no-ext.js'
        import {value as c} from 'demo-pkg/ext'
        import {value as d} from 'demo-pkg/ext.js'
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
      "/Users/user/project/node_modules/demo-pkg/no-ext.js": `export let value = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/no-ext-browser.js": `export let value = 'browser'`,
      "/Users/user/project/node_modules/demo-pkg/ext.js": `export let value = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/ext-browser.js": `export let value = 'browser'`,
    },
    run: {
      stdout: `
        browser
        node
        browser
        browser
      `,
    },
  });
  itBundled("packagejson/BrowserNodeModulesIndexNoExt", {
    todo: true,
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {value as a} from 'demo-pkg/no-ext'
        import {value as b} from 'demo-pkg/no-ext/index.js'
        import {value as c} from 'demo-pkg/ext'
        import {value as d} from 'demo-pkg/ext/index.js'
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
      "/Users/user/project/node_modules/demo-pkg/no-ext/index.js": `export let value = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/no-ext-browser/index.js": `export let value = 'browser'`,
      "/Users/user/project/node_modules/demo-pkg/ext/index.js": `export let value = 'node'`,
      "/Users/user/project/node_modules/demo-pkg/ext-browser/index.js": `export let value = 'browser'`,
    },
    run: {
      stdout: `
        browser
        node
        browser
        browser
      `,
    },
  });
  itBundled("packagejson/BrowserNoExt", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {value as a} from './demo-pkg/no-ext'
        import {value as b} from './demo-pkg/no-ext.js'
        import {value as c} from './demo-pkg/ext'
        import {value as d} from './demo-pkg/ext.js'
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
      "/Users/user/project/src/demo-pkg/no-ext.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/no-ext-browser.js": `export let value = 'browser'`,
      "/Users/user/project/src/demo-pkg/ext.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/ext-browser.js": `export let value = 'browser'`,
    },
    run: {
      stdout: `
        browser
        node
        browser
        browser
      `,
    },
  });
  itBundled("packagejson/BrowserIndexNoExt", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {value as a} from './demo-pkg/no-ext'
        import {value as b} from './demo-pkg/no-ext/index.js'
        import {value as c} from './demo-pkg/ext'
        import {value as d} from './demo-pkg/ext/index.js'
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
      "/Users/user/project/src/demo-pkg/no-ext/index.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/no-ext-browser/index.js": `export let value = 'browser'`,
      "/Users/user/project/src/demo-pkg/ext/index.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/ext-browser/index.js": `export let value = 'browser'`,
    },
    run: {
      stdout: `
        browser
        node
        browser
        browser
      `,
    },
  });
  itBundled("packagejson/BrowserESBuildIssue2002A", {
    todo: true,
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
      "/Users/user/project/src/node_modules/sub/bar.js": `console.log('it works')`,
    },
    run: {
      stdout: "it works",
    },
  });
  itBundled("packagejson/BrowserESBuildIssue2002B", {
    todo: true,
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
      "/Users/user/project/src/node_modules/pkg/sub/bar.js": `console.log('it works')`,
    },
    run: {
      stdout: "it works",
    },
  });
  itBundled("packagejson/BrowserESBuildIssue2002C", {
    todo: true,
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
      "/Users/user/project/src/node_modules/sub/index.js": `console.log('it works')`,
    },
    run: {
      stdout: "it works",
    },
  });
  itBundled("packagejson/DualPackageHazardImportOnly", {
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
    run: {
      stdout: "module",
    },
  });
  itBundled("packagejson/DualPackageHazardRequireOnly", {
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
    run: {
      stdout: "main",
    },
  });
  itBundled.skip("packagejson/DualPackageHazardImportAndRequireSameFile", {
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
    run: {
      stdout: "main main",
    },
  });
  itBundled.skip("packagejson/DualPackageHazardImportAndRequireSeparateFiles", {
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
    run: {
      stdout: "main\nmain",
    },
  });
  itBundled("packagejson/DualPackageHazardImportAndRequireForceModuleBeforeMain", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-main'
        import './test-module'
      `,
      "/Users/user/project/src/test-main.js": `console.log(require('demo-pkg').default)`,
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
    run: {
      stdout: "module\nmodule",
    },
  });
  itBundled.skip("packagejson/DualPackageHazardImportAndRequireImplicitMain", {
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
    run: {
      stdout: "index\nindex",
    },
  });
  itBundled("packagejson/DualPackageHazardImportAndRequireImplicitMainForceModuleBeforeMain", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import './test-index'
        import './test-module'
      `,
      "/Users/user/project/src/test-index.js": `console.log(require('demo-pkg').default)`,
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
    run: {
      stdout: "module\nmodule",
    },
  });
  itBundled("packagejson/DualPackageHazardImportAndRequireBrowser", {
    todo: true,
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
    run: {
      stdout: "browser main\nbrowser main",
    },
  });
  itBundled("packagejson/DualPackageHazardMainFieldWithoutExtension", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        const { foo } = require("bar");
        const { foo: foo2 } = await import("bar");
        console.log(foo === foo2);
      `,
      "/Users/user/project/node_modules/bar/package.json": /* json */ `
        {
          "name": "bar",
          "version": "2.0.0",
          "main": "index"
        }
      `,
      "/Users/user/project/node_modules/bar/index.js": /* js */ `
        module.exports.foo = function() { return "cjs"; };
      `,
      "/Users/user/project/node_modules/bar/index.mjs": /* js */ `
        export const foo = function(){ return "esm"; };
      `,
    },
    run: {
      stdout: "true",
    },
  });
  itBundled("packagejson/DualPackageHazardModuleFieldAndMainFieldWithoutExtension", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        const { foo } = require("bar");
        const { foo: foo2 } = await import("bar");
        console.log(foo === foo2);
      `,
      "/Users/user/project/node_modules/bar/package.json": /* json */ `
        {
          "name": "bar",
          "version": "2.0.0",
          "main": "index",
          "module": "index.mjs"
        }
      `,
      "/Users/user/project/node_modules/bar/index.js": /* js */ `
        module.exports.foo = function() { return "cjs"; };
      `,
      "/Users/user/project/node_modules/bar/index.mjs": /* js */ `
        export const foo = function(){ return "esm"; };
      `,
    },
    run: {
      stdout: "true",
    },
  });
  itBundled("packagejson/DualPackageHazardModuleFieldNoMainField", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        const { foo } = require("bar");
        const { foo: foo2 } = await import("bar");
        console.log(foo === foo2);
      `,
      "/Users/user/project/node_modules/bar/package.json": /* json */ `
        {
          "name": "bar",
          "version": "2.0.0",
          "module": "index.mjs"
        }
      `,
      "/Users/user/project/node_modules/bar/index.js": /* js */ `
        module.exports.foo = function() { return "cjs"; };
      `,
      "/Users/user/project/node_modules/bar/index.mjs": /* js */ `
        export const foo = function(){ return "esm"; };
      `,
    },
    run: {
      stdout: "true",
    },
  });
  itBundled("packagejson/MainFieldsA", {
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
    run: {
      stdout: "a",
    },
  });
  itBundled("packagejson/MainFieldsB", {
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
    run: {
      stdout: "b",
    },
  });
  itBundled("packagejson/ExportsErrorInvalidModuleSpecifier", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg2". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg3". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg4". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg5". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsErrorInvalidPackageConfiguration", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2/foo'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": false } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { "./foo": false } }`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg2/foo". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsErrorInvalidPackageTarget", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg2". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg3". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsErrorPackagePathNotExported", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": {} } }`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "pkg1/foo". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ExportsErrorModuleNotFound", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./foo.js" } }`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "pkg1". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ExportsErrorUnsupportedDirectoryImport", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg2'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./foo/" } }`,
      "/Users/user/project/node_modules/pkg2/package.json": `{ "exports": { ".": "./foo" } }`,
      "/Users/user/project/node_modules/pkg2/foo/bar.js": `console.log(bar)`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg2". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsRequireOverImport", {
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
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsImportOverRequire", {
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
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsDefaultOverImportAndRequire", {
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
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsEntryPointImportOverRequire", {
    todo: true,
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
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsEntryPointRequireOnly", {
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
    entryPointsRaw: ["pkg"],
    bundleErrors: {
      "<bun>": [`ModuleNotFound resolving "pkg" (entry point)`],
    },
  });
  itBundled("packagejson/ExportsEntryPointModuleOverMain", {
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
    entryPointsRaw: ["pkg"],
    outfile: "out.js",
    run: {
      file: "out.js",
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsEntryPointMainOnly", {
    files: {
      "/node_modules/pkg/package.json": /* json */ `
        {
          "main": "./main.js"
        }
      `,
      "/node_modules/pkg/main.js": `console.log('SUCCESS')`,
    },
    entryPointsRaw: ["pkg"],
    outfile: "out.js",
    run: {
      file: "out.js",
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsBrowser", {
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
    target: "browser",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsNode", {
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
    target: "node",
    outfile: "/Users/user/project/out.js",
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsOrderIndependent", {
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
    run: {
      stdout: "SUCCESS\nSUCCESS",
    },
  });
  itBundled("packagejson/ExportsWildcard", {
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
    run: {
      stdout: "SUCCESS\nSUCCESS",
    },
  });
  itBundled("packagejson/ExportsErrorMissingTrailingSlash", {
    files: {
      "/Users/user/project/src/entry.js": `import 'pkg1/foo/bar'`,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { "./foo/": "./test" } }`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "pkg1/foo/bar". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ExportsCustomConditions", {
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
    conditions: ["custom2"],
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsCustomConditionsAPI", {
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
    conditions: ["custom2"],
    backend: "api",
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsNotExactMissingExtension", {
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
    run: {
      stdout: "SUCCESS",
    },
  });
  itBundled("packagejson/ExportsNotExactMissingExtensionPattern", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "pkg1/foo/bar". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ExportsExactMissingExtension", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "pkg1/foo/bar". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ExportsNoConditionsMatch", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg1/foo.js". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsMustUseRequire", {
    todo: true,
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
  });
  itBundled("packagejson/ExportsMustUseImport", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg1/foo.js". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsReverseLookup", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg/path/to/real/file". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg/path/to/other/file". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/ExportsPatternTrailers", {
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
    run: {
      stdout: `works\nabc\nxyz`,
    },
  });
  itBundled("packagejson/ExportsAlternatives", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg/apples/red.js". Maybe you need to "bun install"?`,
        `Could not resolve: "pkg/books/red". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("packagejson/Imports", {
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
    run: {
      stdout: `a.js\nb.js\nc.js\nd.js`,
    },
  });
  itBundled("packagejson/ImportsRemapToOtherPackage", {
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
    run: {
      stdout: `a.js\nb.js\nc.js\nd.js`,
    },
  });
  itBundled("packagejson/ImportsErrorMissingRemappedPackage", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "#foo". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ImportsInvalidPackageConfiguration", {
    files: {
      "/Users/user/project/src/entry.js": `import '#foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": "#foo"
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "#foo". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ImportsErrorEqualsHash", {
    files: {
      "/Users/user/project/src/entry.js": `import '#'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {}
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "#". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ImportsErrorStartsWithHashSlash", {
    files: {
      "/Users/user/project/src/entry.js": `import '#/foo'`,
      "/Users/user/project/src/package.json": /* json */ `
        {
          "imports": {}
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "#/foo". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/MainFieldsErrorMessageDefault", {
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "foo". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/MainFieldsErrorMessageNotIncluded", {
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "foo". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/MainFieldsErrorMessageEmpty", {
    files: {
      "/Users/user/project/src/entry.js": `import 'foo'`,
      "/Users/user/project/node_modules/foo/package.json": /* json */ `
        {
          "main": "./foo"
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "foo". Maybe you need to "bun install"?`],
    },
    outfile: "/Users/user/project/out.js",
  });
  itBundled("packagejson/TypeShouldBeTypes", {
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
    bundleWarnings: {
      "/Users/user/project/package.json": [
        `"./src/index.d.ts" is not a valid value for "type" field (must be either "commonjs" or "module")`,
      ],
    },
  });
  itBundled("packagejson/ImportSelfUsingRequire", {
    todo: true,
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        module.exports = 'index'
        console.log(
          require("xyz"),
          require("xyz/bar"),
        )
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo-import'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo-require'`,
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
    run: {
      stdout: `index foo-require`,
    },
  });
  itBundled("packagejson/ImportSelfUsingImport", {
    todo: true,
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import xyz from "xyz"
        import foo from "xyz/bar"
        export default 'index'
        console.log(xyz, foo)
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo-import'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo-require'`,
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
    run: {
      stdout: `index foo-import`,
    },
  });
  itBundled("packagejson/ImportSelfUsingRequireScoped", {
    todo: true,
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        module.exports = 'index'
        console.log(
          require("@some-scope/xyz"),
          require("@some-scope/xyz/bar"),
        )
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo-import'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo-require'`,
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
    run: {
      stdout: `index foo-require`,
    },
  });
  itBundled("packagejson/ImportSelfUsingImportScoped", {
    todo: true,
    files: {
      "/Users/user/project/src/index.js": /* js */ `
        import xyz from "@some-scope/xyz"
        import foo from "@some-scope/xyz/bar"
        export default 'index'
        console.log(xyz, foo)
      `,
      "/Users/user/project/src/foo-import.js": `export default 'foo-import'`,
      "/Users/user/project/src/foo-require.js": `module.exports = 'foo-require'`,
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
    run: {
      stdout: `index foo-import`,
    },
  });
  itBundled("packagejson/ImportSelfUsingRequireFailure", {
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
    bundleErrors: {
      "/Users/user/project/src/index.js": [`Could not resolve: "xyz/src/foo.js". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/ImportSelfUsingImportFailure", {
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
    bundleErrors: {
      "/Users/user/project/src/index.js": [`Could not resolve: "xyz/src/foo.js". Maybe you need to "bun install"?`],
    },
  });
  itBundled("packagejson/CommonJSVariableInESMTypeModule", {
    files: {
      "/entry.js": `module.exports = null`,
      "/package.json": `{ "type": "module" }`,
    },
  });
  itBundled("packagejson/NodePathsESBuildIssue2752", {
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
    nodePaths: ["/usr/lib/pkg", "/lib/pkg", "/var/lib/pkg", "/tmp/pkg"],
  });
});
