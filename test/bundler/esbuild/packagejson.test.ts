import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

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
  itBundled("packagejson/DualPackageHazardImportAndRequireSameFile", {
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
  itBundled("packagejson/DualPackageHazardImportAndRequireSeparateFiles", {
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
  itBundled("packagejson/DualPackageHazardImportAndRequireImplicitMain", {
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
  itBundled("packagejson/DualPackageHazardJsnextMainRequireOnly", {
    // https://github.com/oven-sh/bun/issues/5004
    // "jsnext:main" is the historical name for "module" and is in Bun's
    // browser default main-field list, so it needs the same require/import
    // fallback that "module" gets.
    files: {
      "/Users/user/project/src/entry.js": `console.log(require('demo-pkg'))`,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "jsnext:main": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
    run: {
      stdout: "main",
    },
  });
  itBundled("packagejson/DualPackageHazardJsnextMainImportOnly", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "jsnext:main": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
    run: {
      stdout: "module",
    },
  });
  itBundled("packagejson/DualPackageHazardJsnextMainImportAndRequireSameFile", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value, require('demo-pkg'))
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "jsnext:main": "./module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/module.js": `export default 'module'`,
    },
    run: {
      stdout: "main main",
    },
  });
  itBundled("packagejson/DualPackageHazardJsnextMainRequireFunction", {
    // https://github.com/oven-sh/bun/issues/5004 — the exact moment.js shape:
    // CJS entry exports a function, ESM entry `export default`s a function.
    // require() must get the callable, not `{ default: [Function] }`.
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        const demo = require('demo-pkg');
        console.log(typeof demo, demo());
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "jsnext:main": "./dist/module.js"
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": /* js */ `
        module.exports = function demo() { return 'main' }
      `,
      "/Users/user/project/node_modules/demo-pkg/dist/module.js": /* js */ `
        export default function demo() { return 'module' }
      `,
    },
    run: {
      stdout: "function main",
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
  // Bun-specific: wildcard `exports` with an extensionless target now
  // auto-resolves the extension (`.js`, `.mjs`, ...). Node.js and esbuild
  // error here (this test is ported from esbuild, which is why it previously
  // asserted a resolution error); Vite, webpack, and TypeScript's
  // `moduleResolution: "bundler"` handle this shape. See oven-sh/bun#29679.
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
    run: {
      stdout: "SUCCESS",
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
  // An `exports`/`imports` target that is not on disk gets the same TypeScript
  // extension rewrite as a relative import (esbuild's `rewrittenFileExtensions`
  // in `finalizeImportsExportsResult`), for exact and wildcard keys alike.
  // Bun also tries `.mts` for a `.js` target.
  for (const [from, to] of [
    ["js", "ts"],
    ["js", "tsx"],
    ["jsx", "ts"],
    ["jsx", "tsx"],
    ["mjs", "mts"],
    ["cjs", "cts"],
    ["js", "mts"],
  ]) {
    itBundled(`packagejson/ExportsImportsRewrite_${from}_to_${to}`, {
      files: {
        "/Users/user/project/src/entry.ts": /* ts */ `
          import { exportsExact } from 'rewrite-pkg/exact'
          import { exportsWild } from 'rewrite-pkg/wild/a'
          import { importsExact } from '#exact'
          import { importsWild } from '#wild/a'
          console.log(exportsExact, exportsWild, importsExact, importsWild)
        `,
        "/Users/user/project/package.json": /* json */ `
          {
            "name": "rewrite-pkg",
            "type": "module",
            "exports": {
              "./exact": "./src/exports-exact.${from}",
              "./wild/*": "./src/exports-wild/*.${from}"
            },
            "imports": {
              "#exact": "./src/imports-exact.${from}",
              "#wild/*": "./src/imports-wild/*.${from}"
            }
          }
        `,
        [`/Users/user/project/src/exports-exact.${to}`]: `export const exportsExact = 'exports-exact.${to}'`,
        [`/Users/user/project/src/exports-wild/a.${to}`]: `export const exportsWild = 'exports-wild.${to}'`,
        [`/Users/user/project/src/imports-exact.${to}`]: `export const importsExact = 'imports-exact.${to}'`,
        [`/Users/user/project/src/imports-wild/a.${to}`]: `export const importsWild = 'imports-wild.${to}'`,
      },
      run: {
        stdout: `exports-exact.${to} exports-wild.${to} imports-exact.${to} imports-wild.${to}`,
      },
    });
  }
  itBundled("packagejson/ExportsImportsRewriteExactTargetOnDiskWins", {
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import { feature } from 'exact-js-wins/feature'
        import { feature as feature2 } from '#feature'
        console.log(feature, feature2)
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "exact-js-wins",
          "type": "module",
          "exports": { "./feature": "./src/feature.js" },
          "imports": { "#feature": "./src/feature.js" }
        }
      `,
      "/Users/user/project/src/feature.js": `export const feature = 'js file'`,
      "/Users/user/project/src/feature.ts": `export const feature = 'ts file'`,
    },
    run: {
      stdout: "js file js file",
    },
  });
  itBundled("packagejson/ExportsImportsRewriteStaysInFamily", {
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import 'family/c'
        import '#m'
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "family",
          "type": "module",
          "exports": { "./c": "./src/c.cjs" },
          "imports": { "#m": "./src/m.mjs" }
        }
      `,
      "/Users/user/project/src/c.ts": ``,
      "/Users/user/project/src/c.mts": ``,
      "/Users/user/project/src/m.ts": ``,
      "/Users/user/project/src/m.cts": ``,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.ts": [
        `Could not resolve: "family/c". Maybe you need to "bun install"?`,
        `Could not resolve: "#m". Maybe you need to "bun install"?`,
      ],
    },
  });
  // Inside node_modules the `.mjs` → `.mts` and `.cjs` → `.cts` rewrites are
  // off (`DISABLE_AUTO_JS_TO_TS_IN_NODE_MODULES`); `.js` → `.ts` stays on.
  itBundled("packagejson/ExportsRewriteInsideNodeModules", {
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import { j } from 'dep/j'
        import 'dep/c'
        import 'dep/m'
        console.log(j)
      `,
      "/Users/user/project/node_modules/dep/package.json": /* json */ `
        {
          "name": "dep",
          "exports": { "./c": "./c.cjs", "./m": "./m.mjs", "./j": "./j.js" }
        }
      `,
      "/Users/user/project/node_modules/dep/c.cts": ``,
      "/Users/user/project/node_modules/dep/m.mts": ``,
      "/Users/user/project/node_modules/dep/j.ts": `export const j = 'ts'`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.ts": [
        `Could not resolve: "dep/c". Maybe you need to "bun install"?`,
        `Could not resolve: "dep/m". Maybe you need to "bun install"?`,
      ],
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

describe("bundler", () => {
  // The wildcard match taken from the import specifier (the part substituted for "*"
  // in an exports pattern) must be validated for ".", ".." and "node_modules" segments,
  // including percent-encoded spellings, exactly like Node's PACKAGE_TARGET_RESOLVE does.
  // "%2e%2e" percent-decodes to ".." after substitution, so without that validation the
  // resolved target walks out of the package directory and loads /Users/user/project/escaped.js.
  itBundled("packagejson/ExportsWildcardRejectsParentDirectorySegments", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1/inside.js'
        import 'pkg1/%2e%2e/%2e%2e/escaped.js'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { "./*": "./*" } }`,
      "/Users/user/project/node_modules/pkg1/inside.js": `console.log('SUCCESS')`,
      // Lives outside the package directory. It must never be reachable through pkg1's
      // exports map; if the wildcard subpath is substituted unvalidated, resolution lands here.
      "/Users/user/project/escaped.js": `console.log('FAILURE')`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [
        `Could not resolve: "pkg1/%2e%2e/%2e%2e/escaped.js". Maybe you need to "bun install"?`,
      ],
    },
  });
});

describe("bundler", () => {
  // An exports pattern target may spell ".." as "..*": the literal segment passes the
  // pre-substitution target validation because it is not exactly "..", and a specifier that
  // equals the pattern base ("pkg1/x" against the key "./x*") substitutes an empty string
  // for "*", turning "./..*/..*/outside.js" into "./../../outside.js". The resolved path must
  // be re-validated after substitution so the import fails instead of loading a file that
  // lives above the package directory. The plain "pkg1" import must keep working.
  itBundled("packagejson/ExportsPatternTargetRejectsParentSegmentsAfterSubstitution", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import 'pkg1'
        import 'pkg1/x'
      `,
      "/Users/user/project/node_modules/pkg1/package.json": `{ "exports": { ".": "./index.js", "./x*": "./..*/..*/outside.js" } }`,
      "/Users/user/project/node_modules/pkg1/index.js": `console.log('SUCCESS')`,
      // Lives two directories above the package. It must never be reachable through pkg1's
      // exports map; if the substituted target is not re-validated, resolution lands here.
      "/Users/user/project/outside.js": `console.log('FAILURE')`,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "pkg1/x". Maybe you need to "bun install"?`],
    },
  });
});

describe("bundler", () => {
  // The browser-map checker probes candidates in four stages: exact key, key +
  // implicit extension, key + "/index", and key + "/index" + implicit extension.
  // Only the remap *target* of a successful probe may be consumed by the
  // resolver — the matched candidate string itself (which can point into
  // scratch storage) must not leak into later resolution. These cases pin each
  // probe stage individually through a relative import.
  itBundled("packagejson/BrowserMapProbeStages", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {value as a} from './demo-pkg/exact.js'
        import {value as b} from './demo-pkg/with-ext'
        import {value as c} from './demo-pkg/as-index'
        import {value as d} from './demo-pkg/as-index-ext'
        console.log(a, b, c, d)
      `,
      "/Users/user/project/src/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./exact.js": "./remapped/exact.js",
            "./with-ext.js": "./remapped/with-ext.js",
            "./as-index/index": "./remapped/as-index.js",
            "./as-index-ext/index.js": "./remapped/as-index-ext.js"
          }
        }
      `,
      "/Users/user/project/src/demo-pkg/exact.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/with-ext.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/as-index/index.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/as-index-ext/index.js": `export let value = 'node'`,
      "/Users/user/project/src/demo-pkg/remapped/exact.js": `export let value = 'exact'`,
      "/Users/user/project/src/demo-pkg/remapped/with-ext.js": `export let value = 'with-ext'`,
      "/Users/user/project/src/demo-pkg/remapped/as-index.js": `export let value = 'as-index'`,
      "/Users/user/project/src/demo-pkg/remapped/as-index-ext.js": `export let value = 'as-index-ext'`,
    },
    run: {
      stdout: "exact with-ext as-index as-index-ext",
    },
  });
  // Browser-map keys are normalized at parse time ("./name" -> "name"), so a
  // "./name" entry also remaps the *package path* "name" imported from within
  // the same package (Browserify compatibility quirk); the normalized key
  // matches the package specifier on the checker's first probe.
  itBundled("packagejson/BrowserMapDotSlashOverridesPackagePath", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {value} from './demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/src/demo-pkg/package.json": /* json */ `
        {
          "main": "./main.js",
          "browser": {
            "./fake-pkg": "./fake-pkg-browser.js"
          }
        }
      `,
      "/Users/user/project/src/demo-pkg/main.js": /* js */ `
        export {value} from 'fake-pkg'
      `,
      "/Users/user/project/src/demo-pkg/fake-pkg-browser.js": `export let value = 'browser-override'`,
    },
    run: {
      stdout: "browser-override",
    },
  });
  // The "main" field value is checked against the browser map before extension
  // resolution. Packages like jszip ship
  //   "main": "./lib/index",
  //   "browser": {"./lib/index": "./dist/jszip.min.js"}
  // and expect the prebuilt bundle to be picked for browser targets.
  itBundled("packagejson/BrowserMapMainFieldNoExt", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./lib/index",
          "browser": {
            "./lib/index": "./dist/demo-pkg.min.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/demo-pkg/dist/demo-pkg.min.js": `module.exports = 'prebuilt'`,
    },
    target: "browser",
    run: {
      stdout: "prebuilt",
    },
  });
  // Extension matching for main-field browser remaps should match esbuild:
  // the main-field value is probed as-is and with extensions appended, so an
  // extensionless main still hits a ".js"-keyed browser entry, but a ".js"
  // main does not hit an extensionless browser key.
  itBundled("packagejson/BrowserMapMainFieldExtPermutations", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import a from 'pkg-a'
        import b from 'pkg-b'
        import c from 'pkg-c'
        import d from 'pkg-d'
        console.log(a, b, c, d)
      `,
      "/Users/user/project/node_modules/pkg-a/package.json": `{"main":"./lib/index.js","browser":{"./lib/index.js":"./browser.js"}}`,
      "/Users/user/project/node_modules/pkg-a/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/pkg-a/browser.js": `module.exports = 'browser'`,
      "/Users/user/project/node_modules/pkg-b/package.json": `{"main":"./lib/index","browser":{"./lib/index.js":"./browser.js"}}`,
      "/Users/user/project/node_modules/pkg-b/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/pkg-b/browser.js": `module.exports = 'browser'`,
      "/Users/user/project/node_modules/pkg-c/package.json": `{"main":"./lib/index.js","browser":{"./lib/index":"./browser.js"}}`,
      "/Users/user/project/node_modules/pkg-c/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/pkg-c/browser.js": `module.exports = 'browser'`,
      "/Users/user/project/node_modules/pkg-d/package.json": `{"main":"./lib/index","browser":{"./lib/index":"./browser.js"}}`,
      "/Users/user/project/node_modules/pkg-d/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/pkg-d/browser.js": `module.exports = 'browser'`,
    },
    target: "browser",
    run: {
      stdout: "browser browser lib browser",
    },
  });
  itBundled("packagejson/BrowserMapMainFieldDisabledNoExt", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        console.log(require('demo-pkg') === 'lib' ? 'loaded-lib' : 'disabled')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./lib/index",
          "browser": {
            "./lib/index": false
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/index.js": `module.exports = 'lib'`,
    },
    target: "browser",
    run: {
      stdout: "disabled",
    },
  });
  // A subpath that resolves to a directory's implicit "index" is checked
  // against the enclosing package's browser map, and the remap target is
  // resolved relative to that package (not the subdirectory).
  itBundled("packagejson/BrowserMapSubpathDirIndex", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg/sub'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./sub/index.js": "./browser-sub.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/sub/index.js": `module.exports = 'sub-index'`,
      "/Users/user/project/node_modules/demo-pkg/browser-sub.js": `module.exports = 'browser-sub'`,
    },
    target: "browser",
    run: {
      stdout: "browser-sub",
    },
  });
  itBundled("packagejson/BrowserMapSubpathDirIndexDisabled", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        console.log(require('demo-pkg/sub') === 'sub-index' ? 'loaded' : 'disabled')
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "browser": {
            "./sub/index": false
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/sub/index.js": `module.exports = 'sub-index'`,
    },
    target: "browser",
    run: {
      stdout: "disabled",
    },
  });
  // When "main" points at a directory, the implicit "<dir>/index" is checked
  // against the browser map before extension resolution.
  itBundled("packagejson/BrowserMapMainFieldDirIndexNoExt", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'demo-pkg'
        console.log(value)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "main": "./lib",
          "browser": {
            "./lib/index": "./browser.js"
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/demo-pkg/browser.js": `module.exports = 'browser'`,
    },
    target: "browser",
    run: {
      stdout: "browser",
    },
  });
  // A "browser" map lookup that picks a package's entry file runs before
  // resolution. The lookup after resolution does not run on the file it picked,
  // so another key of the map that names that file does not apply: a chain
  // stops after one step, and a map that swaps two files does not give the
  // "main" file back. The same file imported as a subpath is still remapped by
  // its own key.
  itBundled("packagejson/BrowserMapMainFieldAppliedOnce", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import chain from 'chain'
        import chain3 from 'chain3'
        import swap from 'swap'
        import single from 'single'
        import subpath from 'subpath/x.js'
        import chainSubpath from 'chain/a.js'
        console.log(chain, chain3, swap, single, subpath, chainSubpath)
      `,
      "/Users/user/project/node_modules/chain/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/chain/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/chain/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/chain/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/chain3/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js","./a.js":"./b.js","./b.js":"./c.js"}}`,
      "/Users/user/project/node_modules/chain3/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/chain3/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/chain3/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/chain3/c.js": `module.exports = 'c'`,
      "/Users/user/project/node_modules/swap/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js","./a.js":"./main.js"}}`,
      "/Users/user/project/node_modules/swap/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/swap/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/single/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js"}}`,
      "/Users/user/project/node_modules/single/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/single/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/subpath/package.json": `{"main":"./main.js","browser":{"./x.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/subpath/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/subpath/x.js": `module.exports = 'x'`,
      "/Users/user/project/node_modules/subpath/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/subpath/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "a a a a a b",
    },
  });
  // The same rule for each way that a package's entry file is found. In the
  // last two packages the text of "main" is a key, and the file that it maps
  // to is a key too.
  itBundled("packagejson/BrowserMapMainFieldAppliedOnceForms", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import noExt from 'no-ext'
        import mainDir from 'main-dir'
        import scoped from '@scope/pkg'
        import moduleField from 'module-field'
        import nestedMain from 'nested-main/dir'
        import mainDirKey from 'main-dir-key'
        import noExtKey from 'no-ext-key'
        console.log(noExt, require('no-ext'), mainDir, require('main-dir'), scoped)
        console.log(moduleField, require('main-field'), nestedMain, mainDirKey, noExtKey)
      `,
      "/Users/user/project/node_modules/no-ext/package.json": `{"main":"./main","browser":{"./main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/no-ext/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/no-ext/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/no-ext/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/main-dir/package.json": `{"main":"./lib","browser":{"./lib/index.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/main-dir/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/main-dir/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/main-dir/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/@scope/pkg/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/@scope/pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/@scope/pkg/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/@scope/pkg/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/module-field/package.json": `{"main":"./main.js","module":"./module.js","browser":{"./module.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/module-field/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/module-field/module.js": `export default 'module'`,
      "/Users/user/project/node_modules/module-field/a.js": `export default 'a'`,
      "/Users/user/project/node_modules/module-field/b.js": `export default 'b'`,
      "/Users/user/project/node_modules/main-field/package.json": `{"main":"./main.js","module":"./module.js","browser":{"./main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/main-field/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/main-field/module.js": `export default 'module'`,
      "/Users/user/project/node_modules/main-field/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/main-field/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/nested-main/package.json": `{"browser":{"./dir/main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/nested-main/dir/package.json": `{"main":"./main.js"}`,
      "/Users/user/project/node_modules/nested-main/dir/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/nested-main/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/nested-main/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/main-dir-key/package.json": `{"main":"./lib","browser":{"./lib":"./lib/index.js","./lib/index.js":"./b.js"}}`,
      "/Users/user/project/node_modules/main-dir-key/lib/index.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/main-dir-key/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/no-ext-key/package.json": `{"main":"./index","browser":{"./index":"./index.js","./index.js":"./browser.js"}}`,
      "/Users/user/project/node_modules/no-ext-key/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/no-ext-key/browser.js": `module.exports = 'browser'`,
    },
    target: "browser",
    run: {
      stdout: "a a a a a\na a a lib index",
    },
  });
  // The file that the map picks for an entry file is final also when it is in
  // the scope of another package.json whose map names it. Bun 1.3.14 and
  // esbuild give the same answer.
  itBundled("packagejson/BrowserMapMainFieldAppliedOnceOtherScope", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import toSibling from 'to-sibling'
        import toNested from 'to-nested'
        console.log(toSibling, toNested)
      `,
      "/Users/user/project/node_modules/to-sibling/package.json": `{"main":"./main.js","browser":{"./main.js":"../sibling/a.js"}}`,
      "/Users/user/project/node_modules/to-sibling/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/sibling/package.json": `{"browser":{"./a.js":"./browser.js"}}`,
      "/Users/user/project/node_modules/sibling/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/sibling/browser.js": `module.exports = 'browser'`,
      "/Users/user/project/node_modules/to-nested/package.json": `{"main":"./main.js","browser":{"./main.js":"./sub/a.js"}}`,
      "/Users/user/project/node_modules/to-nested/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/to-nested/sub/package.json": `{"browser":{"./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/to-nested/sub/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/to-nested/sub/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "a a",
    },
  });
  itBundled("packagejson/BrowserMapMainFieldAppliedOnceTsconfigPaths", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from 'alias'
        console.log(value)
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": { "alias": ["./node_modules/demo-pkg"] }
          }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/demo-pkg/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "a",
    },
  });
  // The implicit "index" file of a package is an entry file too.
  itBundled("packagejson/BrowserMapIndexAppliedOnce", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import chain from 'chain'
        import swap from 'swap'
        import nested from 'nested/dir'
        import indexKey from 'index-key'
        console.log(chain, swap, nested, require('module-only'), indexKey)
      `,
      "/Users/user/project/node_modules/chain/package.json": `{"browser":{"./index.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/chain/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/chain/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/chain/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/swap/package.json": `{"browser":{"./index.js":"./a.js","./a.js":"./index.js"}}`,
      "/Users/user/project/node_modules/swap/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/swap/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/nested/package.json": `{"browser":{"./dir/index.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/nested/dir/package.json": `{}`,
      "/Users/user/project/node_modules/nested/dir/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/nested/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/nested/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/module-only/package.json": `{"module":"./module.js","browser":{"./index.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/module-only/module.js": `export default 'module'`,
      "/Users/user/project/node_modules/module-only/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/module-only/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/module-only/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/index-key/package.json": `{"browser":{"./index":"./index.js","./index.js":"./browser.js"}}`,
      "/Users/user/project/node_modules/index-key/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/index-key/browser.js": `module.exports = 'browser'`,
    },
    target: "browser",
    run: {
      stdout: "a a a a index",
    },
  });
  // A key that maps the picked file to false does not disable it. The scoped
  // package is a control: its answer is the same before and after.
  itBundled("packagejson/BrowserMapAppliedOnceThenDisabledKey", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import mainField from 'main-field'
        import builtin from 'builtin'
        import scopedBuiltin from '@scope/builtin'
        console.log(mainField, builtin, scopedBuiltin)
      `,
      "/Users/user/project/node_modules/main-field/package.json": `{"main":"./main.js","browser":{"./main.js":"./a.js","./a.js":false}}`,
      "/Users/user/project/node_modules/main-field/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/main-field/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/builtin/package.json": `{"main":"./main.js","browser":{"fs":"./shim.js","./shim.js":false}}`,
      "/Users/user/project/node_modules/builtin/main.js": `module.exports = require('fs')`,
      "/Users/user/project/node_modules/builtin/shim.js": `module.exports = 'shim'`,
      "/Users/user/project/node_modules/@scope/builtin/package.json": `{"main":"./main.js","browser":{"fs":"./shim.js","./shim.js":false}}`,
      "/Users/user/project/node_modules/@scope/builtin/main.js": `module.exports = require('fs')`,
      "/Users/user/project/node_modules/@scope/builtin/shim.js": `module.exports = 'shim'`,
    },
    target: "browser",
    run: {
      stdout: "a shim shim",
    },
  });
  // When the map sends the entry file to a directory, the lookup after
  // resolution does not run on the index file of that directory. In the first
  // package the key "./dir/index.js.js" is the resolved file name plus an
  // implicit extension, so only that lookup can match it. The third package
  // shows what stays: on the "main" route the index of the picked directory is
  // still looked up before resolution, as in esbuild.
  itBundled("packagejson/BrowserMapAppliedOnceTargetIsDirectory", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import mainField from 'main-field'
        import index from 'index'
        import mainFieldIndexKey from 'main-field-index-key'
        console.log(mainField, index, mainFieldIndexKey)
      `,
      "/Users/user/project/node_modules/main-field/package.json": `{"main":"./main.js","browser":{"./main.js":"./dir","./dir/index.js.js":"./b.js"}}`,
      "/Users/user/project/node_modules/main-field/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/main-field/dir/index.js": `module.exports = 'dir'`,
      "/Users/user/project/node_modules/main-field/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/index/package.json": `{"browser":{"./index.js":"./dir","./dir/index.js":"./b.js"}}`,
      "/Users/user/project/node_modules/index/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/index/dir/index.js": `module.exports = 'dir'`,
      "/Users/user/project/node_modules/index/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/main-field-index-key/package.json": `{"main":"./main.js","browser":{"./main.js":"./dir","./dir/index.js":"./b.js"}}`,
      "/Users/user/project/node_modules/main-field-index-key/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/main-field-index-key/dir/index.js": `module.exports = 'dir'`,
      "/Users/user/project/node_modules/main-field-index-key/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "dir dir b",
    },
  });
  // The map that sends a specifier to a relative path does not apply to that
  // path again. The other imports are controls. The scoped package gives the
  // same answer before and after. A specifier that the map sends to a bare
  // package specifier is resolved as a package, and a map applies to the
  // resolved file ("to-package", "bare"). When the relative path is a file that
  // the map of another package.json names, that map still applies once (the
  // last three imports).
  itBundled("packagejson/BrowserMapSpecifierAppliedOnce", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import toFile from 'to-file'
        import scopedToFile from '@scope/to-file'
        import builtin from 'builtin'
        import toPackage from 'to-package'
        import bare from 'bare'
        import app from 'dep'
        import nested from 'nested'
        import sibling from 'sibling'
        console.log(toFile, scopedToFile, builtin, toPackage, bare, app, nested, sibling)
      `,
      "/Users/user/project/package.json": /* json */ `
        {
          "name": "app",
          "browser": {
            "bare": "plain/a.js",
            "./node_modules/plain/a.js": "./app-shim.js",
            "dep": "./node_modules/readable/readable.js"
          }
        }
      `,
      "/Users/user/project/app-shim.js": `module.exports = 'app-shim'`,
      "/Users/user/project/node_modules/plain/package.json": `{"main":"./main.js"}`,
      "/Users/user/project/node_modules/plain/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/to-file/package.json": `{"main":"./main.js","browser":{"dep":"./local.js","./local.js":"./other.js"}}`,
      "/Users/user/project/node_modules/to-file/main.js": `module.exports = require('dep')`,
      "/Users/user/project/node_modules/to-file/local.js": `module.exports = 'local'`,
      "/Users/user/project/node_modules/to-file/other.js": `module.exports = 'other'`,
      "/Users/user/project/node_modules/@scope/to-file/package.json": `{"main":"./main.js","browser":{"dep":"./local.js","./local.js":"./other.js"}}`,
      "/Users/user/project/node_modules/@scope/to-file/main.js": `module.exports = require('dep')`,
      "/Users/user/project/node_modules/@scope/to-file/local.js": `module.exports = 'local'`,
      "/Users/user/project/node_modules/@scope/to-file/other.js": `module.exports = 'other'`,
      "/Users/user/project/node_modules/builtin/package.json": `{"main":"./main.js","browser":{"fs":"./shim.js","./shim.js":"./other.js"}}`,
      "/Users/user/project/node_modules/builtin/main.js": `module.exports = require('fs')`,
      "/Users/user/project/node_modules/builtin/shim.js": `module.exports = 'shim'`,
      "/Users/user/project/node_modules/builtin/other.js": `module.exports = 'other'`,
      "/Users/user/project/node_modules/to-package/package.json": `{"main":"./main.js","browser":{"dep":"target/a.js"}}`,
      "/Users/user/project/node_modules/to-package/main.js": `module.exports = require('dep')`,
      "/Users/user/project/node_modules/target/package.json": `{"browser":{"./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/target/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/target/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/readable/package.json": `{"main":"./readable.js","browser":{"./readable.js":"./readable-browser.js"}}`,
      "/Users/user/project/node_modules/readable/readable.js": `module.exports = 'readable'`,
      "/Users/user/project/node_modules/readable/readable-browser.js": `module.exports = 'readable-browser'`,
      "/Users/user/project/node_modules/nested/package.json": `{"main":"./main.js","browser":{"dep":"./vendor/dep/lib.js"}}`,
      "/Users/user/project/node_modules/nested/main.js": `module.exports = require('dep')`,
      "/Users/user/project/node_modules/nested/vendor/dep/package.json": `{"browser":{"./lib.js":"./lib.browser.js"}}`,
      "/Users/user/project/node_modules/nested/vendor/dep/lib.js": `module.exports = 'lib'`,
      "/Users/user/project/node_modules/nested/vendor/dep/lib.browser.js": `module.exports = 'lib.browser'`,
      "/Users/user/project/node_modules/sibling/package.json": `{"main":"./main.js","browser":{"dep":"../target/a.js"}}`,
      "/Users/user/project/node_modules/sibling/main.js": `module.exports = require('dep')`,
    },
    target: "browser",
    run: {
      stdout: "local local shim b app-shim readable-browser lib.browser b",
    },
  });
  // A package with "module" and "main" that is imported and required in one
  // bundle uses the "main" file for both. That also holds when the map picks
  // one of the two files and another key names the picked file.
  itBundled("packagejson/BrowserMapDualPackageAppliedOnce", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import moduleChain from 'module-chain'
        import mainChain from 'main-chain'
        console.log(moduleChain, require('module-chain'), mainChain, require('main-chain'))
      `,
      "/Users/user/project/node_modules/module-chain/package.json": `{"main":"./main.js","module":"./module.js","browser":{"./module.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/module-chain/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/module-chain/module.js": `export default 'module'`,
      "/Users/user/project/node_modules/module-chain/a.js": `export default 'a'`,
      "/Users/user/project/node_modules/module-chain/b.js": `export default 'b'`,
      "/Users/user/project/node_modules/main-chain/package.json": `{"main":"./main.js","module":"./module.js","browser":{"./main.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/main-chain/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/main-chain/module.js": `export default 'module'`,
      "/Users/user/project/node_modules/main-chain/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/main-chain/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "main main a a",
    },
  });
  // Controls: these results have no lookup before resolution that picks them,
  // so the lookup after resolution still applies the map once. It uses the map
  // of the resolved file's directory, which for an entry file can be a nested
  // package.json or another package.
  itBundled("packagejson/BrowserMapLookupAfterResolution", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import nestedScope from 'nested-scope'
        import moduleNested from 'module-nested'
        import leaves from 'leaves'
        import importsTarget from 'imports-target'
        import alias from 'alias'
        console.log(nestedScope, moduleNested, leaves, importsTarget, alias)
      `,
      "/Users/user/project/tsconfig.json": `{"compilerOptions":{"baseUrl":".","paths":{"alias":["./node_modules/paths-file/x.js"]}}}`,
      "/Users/user/project/node_modules/nested-scope/package.json": `{"main":"./lib/index.js","browser":{"./unrelated.js":"./unrelated2.js"}}`,
      "/Users/user/project/node_modules/nested-scope/lib/package.json": `{"browser":{"./index.js":"./b.js"}}`,
      "/Users/user/project/node_modules/nested-scope/lib/index.js": `module.exports = 'index'`,
      "/Users/user/project/node_modules/nested-scope/lib/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/module-nested/package.json": `{"main":"./main.js","module":"./esm/index.js"}`,
      "/Users/user/project/node_modules/module-nested/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/module-nested/esm/package.json": `{"browser":{"./index.js":"./b.js"}}`,
      "/Users/user/project/node_modules/module-nested/esm/index.js": `export default 'index'`,
      "/Users/user/project/node_modules/module-nested/esm/b.js": `export default 'b'`,
      "/Users/user/project/node_modules/leaves/package.json": `{"main":"../other/x.js"}`,
      "/Users/user/project/node_modules/other/package.json": `{"browser":{"./x.js":"./b.js"}}`,
      "/Users/user/project/node_modules/other/x.js": `module.exports = 'x'`,
      "/Users/user/project/node_modules/other/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/imports-target/package.json": `{"main":"./main.js","imports":{"#x":"./x.js"},"browser":{"./x.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/imports-target/main.js": `module.exports = require('#x')`,
      "/Users/user/project/node_modules/imports-target/x.js": `module.exports = 'x'`,
      "/Users/user/project/node_modules/imports-target/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/imports-target/b.js": `module.exports = 'b'`,
      "/Users/user/project/node_modules/paths-file/package.json": `{"main":"./main.js","browser":{"./x.js":"./a.js","./a.js":"./b.js"}}`,
      "/Users/user/project/node_modules/paths-file/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/paths-file/x.js": `module.exports = 'x'`,
      "/Users/user/project/node_modules/paths-file/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/paths-file/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "b b b a a",
    },
  });
  // Control: a file that "exports" resolves to has no lookup before resolution.
  // The lookup after resolution applies the map to it once. Bun does this since
  // at least 1.3.14. esbuild does not apply the map to an "exports" target.
  itBundled("packagejson/BrowserMapExportsTargetAppliedOnce", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import root from 'demo-pkg'
        import subpath from 'demo-pkg/x'
        console.log(root, subpath)
      `,
      "/Users/user/project/node_modules/demo-pkg/package.json": /* json */ `
        {
          "exports": { ".": "./main.js", "./x": "./x.js" },
          "browser": { "./main.js": "./a.js", "./x.js": "./a.js", "./a.js": "./b.js" }
        }
      `,
      "/Users/user/project/node_modules/demo-pkg/main.js": `module.exports = 'main'`,
      "/Users/user/project/node_modules/demo-pkg/x.js": `module.exports = 'x'`,
      "/Users/user/project/node_modules/demo-pkg/a.js": `module.exports = 'a'`,
      "/Users/user/project/node_modules/demo-pkg/b.js": `module.exports = 'b'`,
    },
    target: "browser",
    run: {
      stdout: "a a",
    },
  });
});
