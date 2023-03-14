import { test, describe } from "bun:test";
import { expectBundled, itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_tsconfig_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/tsconfig

describe("bundler", () => {
  itBundled("tsconfig/TsConfigPaths", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import baseurl_dot from './baseurl_dot'
        import baseurl_nested from './baseurl_nested'
        console.log(baseurl_dot, baseurl_nested)
      `,
      "/Users/user/project/baseurl_dot/index.ts": /* ts */ `
        import test0 from 'test0'
        import test1 from 'test1/foo'
        import test2 from 'test2/foo'
        import test3 from 'test3/foo'
        import test4 from 'test4/foo'
        import test5 from 'test5/foo'
        import absoluteIn from './absolute-in'
        import absoluteInStar from './absolute-in-star'
        import absoluteOut from './absolute-out'
        import absoluteOutStar from './absolute-out-star'
        export default {
          test0,
          test1,
          test2,
          test3,
          test4,
          test5,
          absoluteIn,
          absoluteInStar,
          absoluteOut,
          absoluteOutStar,
        }
      `,
      "/Users/user/project/baseurl_dot/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "test0": ["./test0-success.ts"],
              "test1/*": ["./test1-success.ts"],
              "test2/*": ["./test2-success/*"],
              "t*t3/foo": ["./test3-succ*s.ts"],
              "test4/*": ["./test4-first/*", "./test4-second/*"],
              "test5/*": ["./test5-first/*", "./test5-second/*"],
              "/virtual-in/test": ["./actual/test"],
              "/virtual-in-star/*": ["./actual/*"],
              "/virtual-out/test": ["/Users/user/project/baseurl_dot/actual/test"],
              "/virtual-out-star/*": ["/Users/user/project/baseurl_dot/actual/*"],
            }
          }
        }
      `,
      "/Users/user/project/baseurl_dot/test0-success.ts": `export default 'test0-success'`,
      "/Users/user/project/baseurl_dot/test1-success.ts": `export default 'test1-success'`,
      "/Users/user/project/baseurl_dot/test2-success/foo.ts": `export default 'test2-success'`,
      "/Users/user/project/baseurl_dot/test3-success.ts": `export default 'test3-success'`,
      "/Users/user/project/baseurl_dot/test4-first/foo.ts": `export default 'test4-success'`,
      "/Users/user/project/baseurl_dot/test5-second/foo.ts": `export default 'test5-success'`,
      "/Users/user/project/baseurl_dot/absolute-in.ts": `export {default} from '/virtual-in/test'`,
      "/Users/user/project/baseurl_dot/absolute-in-star.ts": `export {default} from '/virtual-in-star/test'`,
      "/Users/user/project/baseurl_dot/absolute-out.ts": `export {default} from '/virtual-out/test'`,
      "/Users/user/project/baseurl_dot/absolute-out-star.ts": `export {default} from '/virtual-out-star/test'`,
      "/Users/user/project/baseurl_dot/actual/test.ts": `export default 'absolute-success'`,
      "/Users/user/project/baseurl_nested/index.ts": /* ts */ `
        import test0 from 'test0'
        import test1 from 'test1/foo'
        import test2 from 'test2/foo'
        import test3 from 'test3/foo'
        import test4 from 'test4/foo'
        import test5 from 'test5/foo'
        import absoluteIn from './absolute-in'
        import absoluteInStar from './absolute-in-star'
        import absoluteOut from './absolute-out'
        import absoluteOutStar from './absolute-out-star'
        export default {
          test0,
          test1,
          test2,
          test3,
          test4,
          test5,
          absoluteIn,
          absoluteInStar,
          absoluteOut,
          absoluteOutStar,
        }
      `,
      "/Users/user/project/baseurl_nested/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": "nested",
            "paths": {
              "test0": ["./test0-success.ts"],
              "test1/*": ["./test1-success.ts"],
              "test2/*": ["./test2-success/*"],
              "t*t3/foo": ["./test3-succ*s.ts"],
              "test4/*": ["./test4-first/*", "./test4-second/*"],
              "test5/*": ["./test5-first/*", "./test5-second/*"],
              "/virtual-in/test": ["./actual/test"],
              "/virtual-in-star/*": ["./actual/*"],
              "/virtual-out/test": ["/Users/user/project/baseurl_nested/nested/actual/test"],
              "/virtual-out-star/*": ["/Users/user/project/baseurl_nested/nested/actual/*"],
            }
          }
        }
      `,
      "/Users/user/project/baseurl_nested/nested/test0-success.ts": `export default 'test0-success'`,
      "/Users/user/project/baseurl_nested/nested/test1-success.ts": `export default 'test1-success'`,
      "/Users/user/project/baseurl_nested/nested/test2-success/foo.ts": `export default 'test2-success'`,
      "/Users/user/project/baseurl_nested/nested/test3-success.ts": `export default 'test3-success'`,
      "/Users/user/project/baseurl_nested/nested/test4-first/foo.ts": `export default 'test4-success'`,
      "/Users/user/project/baseurl_nested/nested/test5-second/foo.ts": `export default 'test5-success'`,
      "/Users/user/project/baseurl_nested/absolute-in.ts": `export {default} from '/virtual-in/test'`,
      "/Users/user/project/baseurl_nested/absolute-in-star.ts": `export {default} from '/virtual-in/test'`,
      "/Users/user/project/baseurl_nested/absolute-out.ts": `export {default} from '/virtual-out/test'`,
      "/Users/user/project/baseurl_nested/absolute-out-star.ts": `export {default} from '/virtual-out-star/test'`,
      "/Users/user/project/baseurl_nested/nested/actual/test.ts": `export default 'absolute-success'`,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigPathsNoBaseURL", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import simple from './simple'
        import extended from './extended'
        console.log(simple, extended)
      `,
      "/Users/user/project/simple/index.ts": /* ts */ `
        import test0 from 'test0'
        import test1 from 'test1/foo'
        import test2 from 'test2/foo'
        import test3 from 'test3/foo'
        import test4 from 'test4/foo'
        import test5 from 'test5/foo'
        import absolute from './absolute'
        export default {
          test0,
          test1,
          test2,
          test3,
          test4,
          test5,
          absolute,
        }
      `,
      "/Users/user/project/simple/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "test0": ["./test0-success.ts"],
              "test1/*": ["./test1-success.ts"],
              "test2/*": ["./test2-success/*"],
              "t*t3/foo": ["./test3-succ*s.ts"],
              "test4/*": ["./test4-first/*", "./test4-second/*"],
              "test5/*": ["./test5-first/*", "./test5-second/*"],
              "/virtual/*": ["./actual/*"],
            }
          }
        }
      `,
      "/Users/user/project/simple/test0-success.ts": `export default 'test0-success'`,
      "/Users/user/project/simple/test1-success.ts": `export default 'test1-success'`,
      "/Users/user/project/simple/test2-success/foo.ts": `export default 'test2-success'`,
      "/Users/user/project/simple/test3-success.ts": `export default 'test3-success'`,
      "/Users/user/project/simple/test4-first/foo.ts": `export default 'test4-success'`,
      "/Users/user/project/simple/test5-second/foo.ts": `export default 'test5-success'`,
      "/Users/user/project/simple/absolute.ts": `export {default} from '/virtual/test'`,
      "/Users/user/project/simple/actual/test.ts": `export default 'absolute-success'`,
      "/Users/user/project/extended/index.ts": /* ts */ `
        import test0 from 'test0'
        import test1 from 'test1/foo'
        import test2 from 'test2/foo'
        import test3 from 'test3/foo'
        import test4 from 'test4/foo'
        import test5 from 'test5/foo'
        import absolute from './absolute'
        export default {
          test0,
          test1,
          test2,
          test3,
          test4,
          test5,
          absolute,
        }
      `,
      "/Users/user/project/extended/tsconfig.json": /* json */ `
        {
          "extends": "./nested/tsconfig.json"
        }
      `,
      "/Users/user/project/extended/nested/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "test0": ["./test0-success.ts"],
              "test1/*": ["./test1-success.ts"],
              "test2/*": ["./test2-success/*"],
              "t*t3/foo": ["./test3-succ*s.ts"],
              "test4/*": ["./test4-first/*", "./test4-second/*"],
              "test5/*": ["./test5-first/*", "./test5-second/*"],
              "/virtual/*": ["./actual/*"],
            }
          }
        }
      `,
      "/Users/user/project/extended/nested/test0-success.ts": `export default 'test0-success'`,
      "/Users/user/project/extended/nested/test1-success.ts": `export default 'test1-success'`,
      "/Users/user/project/extended/nested/test2-success/foo.ts": `export default 'test2-success'`,
      "/Users/user/project/extended/nested/test3-success.ts": `export default 'test3-success'`,
      "/Users/user/project/extended/nested/test4-first/foo.ts": `export default 'test4-success'`,
      "/Users/user/project/extended/nested/test5-second/foo.ts": `export default 'test5-success'`,
      "/Users/user/project/extended/absolute.ts": `export {default} from '/virtual/test'`,
      "/Users/user/project/extended/nested/actual/test.ts": `export default 'absolute-success'`,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigBadPathsNoBaseURL", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.ts": `import "should-not-be-imported"`,
      "/Users/user/project/should-not-be-imported.ts": ``,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "test": [
                ".",
                "..",
                "./good",
                ".\\good",
                "../good",
                "..\\good",
                "/good",
                "\\good",
                "c:/good",
                "c:\\good",
                "C:/good",
                "C:\\good",
  
                "bad",
                "@bad/core",
                ".*/bad",
                "..*/bad",
                "c*:\\bad",
                "c:*\\bad",
                "http://bad"
              ]
            }
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigPathsOverriddenBaseURL", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import test from '#/test'
        console.log(test)
      `,
      "/Users/user/project/src/test.ts": `export default 123`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "extends": "./tsconfig.paths.json",
          "compilerOptions": {
            "baseUrl": "./src"
          }
        }
      `,
      "/Users/user/project/tsconfig.paths.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "#/*": ["./*"]
            }
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigPathsOverriddenBaseURLDifferentDir", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import test from '#/test'
        console.log(test)
      `,
      "/Users/user/project/src/test.ts": `export default 123`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.paths.json",
          "compilerOptions": {
            "baseUrl": "./"
          }
        }
      `,
      "/Users/user/project/tsconfig.paths.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "#/*": ["./*"]
            }
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigPathsMissingBaseURL", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import test from '#/test'
        console.log(test)
      `,
      "/Users/user/project/src/test.ts": `export default 123`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.paths.json",
          "compilerOptions": {
          }
        }
      `,
      "/Users/user/project/tsconfig.paths.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "#/*": ["./*"]
            }
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigPathsTypeOnly", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import { fib } from "fib";
  
        console.log(fib(10));
      `,
      "/Users/user/project/node_modules/fib/index.js": /* js */ `
        export function fib(input) {
          if (input < 2) {
            return input;
          }
          return fib(input - 1) + fib(input - 2);
        }
      `,
      "/Users/user/project/fib-local.d.ts": `export function fib(input: number): number;`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "fib": ["fib-local.d.ts"]
            }
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigJSX", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFactory": "R.c",
            "jsxFragmentFactory": "R.F"
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigNestedJSX", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import factory from './factory'
        import fragment from './fragment'
        import both from './both'
        console.log(factory, fragment, both)
      `,
      "/Users/user/project/factory/index.tsx": `export default <><div/><div/></>`,
      "/Users/user/project/factory/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFactory": "h"
          }
        }
      `,
      "/Users/user/project/fragment/index.tsx": `export default <><div/><div/></>`,
      "/Users/user/project/fragment/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFragmentFactory": "a.b"
          }
        }
      `,
      "/Users/user/project/both/index.tsx": `export default <><div/><div/></>`,
      "/Users/user/project/both/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFactory": "R.c",
            "jsxFragmentFactory": "R.F"
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigReactJSX", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react-jsx",
            "jsxImportSource": "notreact"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigReactJSXDev", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react-jsxdev"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigReactJSXWithDevInMainConfig", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react-jsx"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    jsx: {},
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonBaseUrl", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.js": /* js */ `
        import fn from 'lib/util'
        console.log(fn())
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": "."
          }
        }
      `,
      "/Users/user/project/src/lib/util.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/JsconfigJsonBaseUrl", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.js": /* js */ `
        import fn from 'lib/util'
        console.log(fn())
      `,
      "/Users/user/project/src/jsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": "."
          }
        }
      `,
      "/Users/user/project/src/lib/util.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonAbsoluteBaseUrl", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.js": /* js */ `
        import fn from 'lib/util'
        console.log(fn())
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": "/Users/user/project/src"
          }
        }
      `,
      "/Users/user/project/src/lib/util.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonCommentAllowed", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.js": /* js */ `
        import fn from 'lib/util'
        console.log(fn())
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          // Single-line comment
          "compilerOptions": {
            "baseUrl": "."
          }
        }
      `,
      "/Users/user/project/src/lib/util.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonTrailingCommaAllowed", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.js": /* js */ `
        import fn from 'lib/util'
        console.log(fn())
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
          },
        }
      `,
      "/Users/user/project/src/lib/util.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonExtends", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": `console.log(<div/>, <></>)`,
      "/tsconfig.json": /* json */ `
        {
          "extends": "./base",
          "compilerOptions": {
            "jsxFragmentFactory": "derivedFragment"
          }
        }
      `,
      "/base.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFactory": "baseFactory",
            "jsxFragmentFactory": "baseFragment"
          }
        }
      `,
    },
    snapshot: true,
  });
  test("tsconfig/TsconfigJsonExtendsAbsolute", () => {
    expectBundled("tsconfig/TsconfigJsonExtendsAbsolute", {
      // TODO: hand check and tweak
      host: "Unix",
      files: {
        "/Users/user/project/entry.jsx": `console.log(<div/>, <></>)`,
        "/Users/user/project/tsconfig.json": /* json */ `
          {
            "extends": "/Users/user/project/base.json",
            "compilerOptions": {
              "jsxFragmentFactory": "derivedFragment"
            }
          }
        `,
        "/Users/user/project/base.json": /* json */ `
          {
            "compilerOptions": {
              "jsxFactory": "baseFactory",
              "jsxFragmentFactory": "baseFragment"
            }
          }
        `,
      },
      snapshot: true,
    });
    expectBundled("tsconfig/TsconfigJsonExtendsAbsolute_TODO_LABEL_1", {
      // TODO: hand check and tweak
      host: "Windows",
      files: {
        "/Users/user/project/entry.jsx": `console.log(<div/>, <></>)`,
        "/Users/user/project/tsconfig.json": /* json */ `
          {
            "extends": "C:\\Users\\user\\project\\base.json",
            "compilerOptions": {
              "jsxFragmentFactory": "derivedFragment"
            }
          }
        `,
        "/Users/user/project/base.json": /* json */ `
          {
            "compilerOptions": {
              "jsxFactory": "baseFactory",
              "jsxFragmentFactory": "baseFragment"
            }
          }
        `,
      },
      snapshot: true,
    });
  });
  itBundled("tsconfig/TsconfigJsonExtendsThreeLevels", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.jsx": /* jsx */ `
        import "test/import.js"
        console.log(<div/>, <></>)
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "./path1/base",
          "compilerOptions": {
            "jsxFragmentFactory": "derivedFragment"
          }
        }
      `,
      "/Users/user/project/src/path1/base.json": /* json */ `
        {
          "extends": "../path2/base2"
        }
      `,
      "/Users/user/project/src/path2/base2.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "test/*": ["./works/*"]
            },
            "jsxFactory": "baseFactory",
            "jsxFragmentFactory": "baseFragment"
          }
        }
      `,
      "/Users/user/project/src/path2/works/import.js": `console.log('works')`,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonExtendsLoop", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(123)`,
      "/tsconfig.json": /* json */ `
        {
          "extends": "./base.json"
        }
      `,
      "/base.json": /* json */ `
        {
          "extends": "./tsconfig"
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonExtendsPackage", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.jsx": `console.log(<div/>)`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "@package/foo/tsconfig.json"
        }
      `,
      "/Users/user/project/node_modules/@package/foo/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFactory": "worked"
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonOverrideMissing", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.ts": `import 'foo'`,
      "/Users/user/project/src/foo-bad.ts": `console.log('bad')`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "foo": ["./foo-bad.ts"]
            }
          }
        }
      `,
      "/Users/user/project/other/foo-good.ts": `console.log('good')`,
      "/Users/user/project/other/config-for-ts.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "foo": ["./foo-good.ts"]
            }
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonOverrideNodeModules", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.ts": `import 'foo'`,
      "/Users/user/project/src/node_modules/foo/index.js": `console.log('default')`,
      "/Users/user/project/src/foo-bad.ts": `console.log('bad')`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "foo": ["./foo-bad.ts"]
            }
          }
        }
      `,
      "/Users/user/project/other/foo-good.ts": `console.log('good')`,
      "/Users/user/project/other/config-for-ts.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "foo": ["./foo-good.ts"]
            }
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonOverrideInvalid", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": ``,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonNodeModulesImplicitFile", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.tsx": `console.log(<div/>)`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "foo"
        }
      `,
      "/Users/user/project/src/node_modules/foo/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react",
            "jsxFactory": "worked"
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigJsonInsideNodeModules", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/app/entry.tsx": `import 'foo'`,
      "/Users/user/project/src/node_modules/foo/index.tsx": `console.log(<div/>)`,
      "/Users/user/project/src/node_modules/foo/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxFactory": "TEST_FAILED"
          }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigWarningsInsideNodeModules", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.tsx": /* tsx */ `
        import "./foo"
        import "bar"
      `,
      "/Users/user/project/src/foo/tsconfig.json": `{ "extends": "extends for foo" }`,
      "/Users/user/project/src/foo/index.js": ``,
      "/Users/user/project/src/node_modules/bar/tsconfig.json": `{ "extends": "extends for bar" }`,
      "/Users/user/project/src/node_modules/bar/index.js": ``,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigRemoveUnusedImports", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import {x, y} from "./foo"
        console.log(1 as x)
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "importsNotUsedAsValues": "remove"
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigPreserveUnusedImports", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import {x, y} from "./foo"
        console.log(1 as x)
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "importsNotUsedAsValues": "preserve"
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigImportsNotUsedAsValuesPreserve", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import {x, y} from "./foo"
        import z from "./foo"
        import * as ns from "./foo"
        console.log(1 as x, 2 as z, 3 as ns.y)
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "importsNotUsedAsValues": "preserve"
        }
      }
      `,
    },
    format: "esm",
    outfile: "/Users/user/project/out.js",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigPreserveValueImports", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import {} from "a"
        import {b1} from "b"
        import {c1, type c2} from "c"
        import {d1, d2, type d3} from "d"
        import {type e1, type e2} from "e"
        import f1, {} from "f"
        import g1, {g2} from "g"
        import h1, {type h2} from "h"
        import * as i1 from "i"
        import "j"
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "preserveValueImports": true
        }
      }
      `,
    },
    format: "esm",
    outfile: "/Users/user/project/out.js",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigPreserveValueImportsAndImportsNotUsedAsValuesPreserve", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import {} from "a"
        import {b1} from "b"
        import {c1, type c2} from "c"
        import {d1, d2, type d3} from "d"
        import {type e1, type e2} from "e"
        import f1, {} from "f"
        import g1, {g2} from "g"
        import h1, {type h2} from "h"
        import * as i1 from "i"
        import "j"
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "importsNotUsedAsValues": "preserve",
          "preserveValueImports": true
        }
      }
      `,
    },
    format: "esm",
    outfile: "/Users/user/project/out.js",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigTarget", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import "./es2018"
        import "./es2019"
        import "./es2020"
        import "./es4"
      `,
      "/Users/user/project/src/es2018/index.ts": /* ts */ `
        let x = { ...y }   // es2018 syntax
        try { y } catch {} // es2019 syntax
        x?.y()             // es2020 syntax
      `,
      "/Users/user/project/src/es2019/index.ts": /* ts */ `
        let x = { ...y }   // es2018 syntax
        try { y } catch {} // es2019 syntax
        x?.y()             // es2020 syntax
      `,
      "/Users/user/project/src/es2020/index.ts": /* ts */ `
        let x = { ...y }   // es2018 syntax
        try { y } catch {} // es2019 syntax
        x?.y()             // es2020 syntax
      `,
      "/Users/user/project/src/es4/index.ts": ``,
      "/Users/user/project/src/es2018/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES2018"
        }
      }
      `,
      "/Users/user/project/src/es2019/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "es2019"
        }
      }
      `,
      "/Users/user/project/src/es2020/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ESNext"
        }
      }
      `,
      "/Users/user/project/src/es4/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES4"
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigTargetError", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `x = 123n`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES2019"
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigTargetIgnored", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `x = 123n`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES2019"
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigUseDefineForClassFieldsES2020", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        Foo = class {
          useDefine = false
        }
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES2020"
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigUseDefineForClassFieldsESNext", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        Foo = class {
          useDefine = true
        }
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ESNext"
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigUnrecognizedTargetWarning", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import "./a"
        import "b"
      `,
      "/Users/user/project/src/a/index.ts": ``,
      "/Users/user/project/src/a/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "es3"
        }
      }
      `,
      "/Users/user/project/src/node_modules/b/index.ts": ``,
      "/Users/user/project/src/node_modules/b/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "es3"
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigTargetWarning", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `await 0`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "es6"
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    unsupportedJSFeatures: "es6",
    snapshot: true,
  });
  itBundled("tsconfig/TsconfigOverriddenTargetWarning", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `await 0`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "es6"
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    unsupportedJSFeatures: "es2020",
    /* TODO: 
        TargetFromAPI -- config.TargetWasConfigured, */
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigNoBaseURLExtendsPaths", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import { foo } from "foo"
        console.log(foo)
      `,
      "/Users/user/project/lib/foo.ts": `export let foo = 123`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "extends": "./base/defaults"
      }
      `,
      "/Users/user/project/base/defaults.json": /* json */ `
        {
        "compilerOptions": {
          "paths": {
            "*": ["lib/*"]
          }
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigBaseURLExtendsPaths", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import { foo } from "foo"
        console.log(foo)
      `,
      "/Users/user/project/lib/foo.ts": `export let foo = 123`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "extends": "./base/defaults",
        "compilerOptions": {
          "baseUrl": "."
        }
      }
      `,
      "/Users/user/project/base/defaults.json": /* json */ `
        {
        "compilerOptions": {
          "paths": {
            "*": ["lib/*"]
          }
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigPathsExtendsBaseURL", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import { foo } from "foo"
        console.log(foo)
      `,
      "/Users/user/project/base/test/lib/foo.ts": `export let foo = 123`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "extends": "./base/defaults",
        "compilerOptions": {
          "paths": {
            "*": ["lib/*"]
          }
        }
      }
      `,
      "/Users/user/project/base/defaults.json": /* json */ `
        {
        "compilerOptions": {
          "baseUrl": "test"
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigModuleSuffixesInsert", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import "./foo"
        import "./bar.js"
        import "./baz.a.js"
      `,
      "/Users/user/project/src/foo.a.ts": `console.log('foo.a')`,
      "/Users/user/project/src/foo.b.ts": `console.log('foo.b')`,
      "/Users/user/project/src/foo.ts": `console.log('foo')`,
      "/Users/user/project/src/bar.a.ts": `console.log('bar.a')`,
      "/Users/user/project/src/bar.b.ts": `console.log('bar.b')`,
      "/Users/user/project/src/bar.ts": `console.log('bar')`,
      "/Users/user/project/src/baz.a.ts": `console.log('baz.a')`,
      "/Users/user/project/src/baz.b.ts": `console.log('baz.b')`,
      "/Users/user/project/src/baz.ts": `console.log('baz')`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "moduleSuffixes": [".a", ".b", ""]
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigModuleSuffixesNoInsert", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import "./foo.b"
        import "./bar.js"
        import "./baz.b.js"
      `,
      "/Users/user/project/src/foo.a.ts": `console.log('foo.a')`,
      "/Users/user/project/src/foo.b.ts": `console.log('foo.b')`,
      "/Users/user/project/src/foo.ts": `console.log('foo')`,
      "/Users/user/project/src/bar.ts": `console.log('bar')`,
      "/Users/user/project/src/baz.a.ts": `console.log('baz.a')`,
      "/Users/user/project/src/baz.b.ts": `console.log('baz.b')`,
      "/Users/user/project/src/baz.ts": `console.log('baz')`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "moduleSuffixes": [".a", ".b", ""]
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigModuleSuffixesNoEmpty", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import "./foo.js"
        import "./bar"
      `,
      "/Users/user/project/src/foo.b.ts": `console.log('foo.b')`,
      "/Users/user/project/src/bar.ts": `console.log('bar')`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "moduleSuffixes": [".a", ".b"]
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigWithStatementAlwaysStrictFalse", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `with (x) y`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": false
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigWithStatementAlwaysStrictTrue", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `with (x) y`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": true
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigWithStatementStrictFalse", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `with (x) y`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "strict": false
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigWithStatementStrictTrue", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `with (x) y`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "strict": true
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigWithStatementStrictFalseAlwaysStrictTrue", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `with (x) y`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "strict": false,
          "alwaysStrict": true
        }
      }
      `,
    },
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigWithStatementStrictTrueAlwaysStrictFalse", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.ts": `with (x) y`,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "strict": true,
          "alwaysStrict": false
        }
      }
      `,
    },
    outfile: "/Users/user/project/out.js",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigAlwaysStrictTrueEmitDirectivePassThrough", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/implicit.ts": `console.log('this file should start with "use strict"')`,
      "/Users/user/project/src/explicit.ts": /* ts */ `
        'use strict'
        console.log('this file should start with "use strict"')
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": true
        }
      }
      `,
    },
    entryPoints: ["/Users/user/project/src/implicit.ts", "/Users/user/project/src/explicit.ts"],
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigAlwaysStrictTrueEmitDirectiveFormat", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/implicit.ts": `console.log('this file should start with "use strict"')`,
      "/Users/user/project/src/explicit.ts": /* ts */ `
        'use strict'
        console.log('this file should start with "use strict"')
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": true
        }
      }
      `,
    },
    entryPoints: ["/Users/user/project/src/implicit.ts", "/Users/user/project/src/explicit.ts"],
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigAlwaysStrictTrueEmitDirectiveBundleIIFE", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/implicit.ts": `console.log('this file should start with "use strict"')`,
      "/Users/user/project/src/explicit.ts": /* ts */ `
        'use strict'
        console.log('this file should start with "use strict"')
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": true
        }
      }
      `,
    },
    entryPoints: ["/Users/user/project/src/implicit.ts", "/Users/user/project/src/explicit.ts"],
    outdir: "/Users/user/project/out",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigAlwaysStrictTrueEmitDirectiveBundleCJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/implicit.ts": `console.log('this file should start with "use strict"')`,
      "/Users/user/project/src/explicit.ts": /* ts */ `
        'use strict'
        console.log('this file should start with "use strict"')
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": true
        }
      }
      `,
    },
    entryPoints: ["/Users/user/project/src/implicit.ts", "/Users/user/project/src/explicit.ts"],
    outdir: "/Users/user/project/out",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigAlwaysStrictTrueEmitDirectiveBundleESM", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/implicit.ts": `console.log('this file should not start with "use strict"')`,
      "/Users/user/project/src/explicit.ts": /* ts */ `
        'use strict'
        console.log('this file should not start with "use strict"')
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "alwaysStrict": true
        }
      }
      `,
    },
    entryPoints: ["/Users/user/project/src/implicit.ts", "/Users/user/project/src/explicit.ts"],
    outdir: "/Users/user/project/out",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigExtendsDotWithoutSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/main.ts": `console.log(123n)`,
      "/Users/user/project/src/foo.json": /* json */ `
        {
        "extends": "."
      }
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES6"
        }
      }
      `,
    },
    outdir: "/Users/user/project/out",
    format: "esm",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigExtendsDotDotWithoutSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/main.ts": `console.log(123n)`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "extends": ".."
      }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES6"
        }
      }
      `,
    },
    outdir: "/Users/user/project/out",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigExtendsDotWithSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/main.ts": `console.log(123n)`,
      "/Users/user/project/src/foo.json": /* json */ `
        {
        "extends": "./"
      }
      `,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES6"
        }
      }
      `,
    },
    outdir: "/Users/user/project/out",
    format: "esm",
    snapshot: true,
  });
  itBundled("tsconfig/TsConfigExtendsDotDotWithSlash", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/main.ts": `console.log(123n)`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
        "extends": "../"
      }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
        "compilerOptions": {
          "target": "ES6"
        }
      }
      `,
    },
    outdir: "/Users/user/project/out",
    snapshot: true,
  });
});
