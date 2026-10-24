import { describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { join } from "path";
import { itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_tsconfig_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/tsconfig

describe("bundler", () => {
  itBundled("tsconfig/Paths", ({ root }) => ({
    todo: true,
    files: {
      "/entry.ts": /* ts */ `
        import baseurl_dot from './baseurl_dot'
        import baseurl_nested from './baseurl_nested'
        console.log(JSON.stringify({baseurl_dot, baseurl_nested}))
      `,
      "/baseurl_dot/index.ts": /* ts */ `
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
      "/baseurl_dot/tsconfig.json": /* json */ `
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
              "/virtual-out/test": ["${root}/baseurl_dot/actual/test"],
              "/virtual-out-star/*": ["${root}/baseurl_dot/actual/*"],
            }
          }
        }
      `,
      "/baseurl_dot/test0-success.ts": `export default 'test0-success'`,
      "/baseurl_dot/test1-success.ts": `export default 'test1-success'`,
      "/baseurl_dot/test2-success/foo.ts": `export default 'test2-success'`,
      "/baseurl_dot/test3-success.ts": `export default 'test3-success'`,
      "/baseurl_dot/test4-first/foo.ts": `export default 'test4-success'`,
      "/baseurl_dot/test5-second/foo.ts": `export default 'test5-success'`,
      "/baseurl_dot/absolute-in.ts": `export {default} from '/virtual-in/test'`,
      "/baseurl_dot/absolute-in-star.ts": `export {default} from '/virtual-in-star/test'`,
      "/baseurl_dot/absolute-out.ts": `export {default} from '/virtual-out/test'`,
      "/baseurl_dot/absolute-out-star.ts": `export {default} from '/virtual-out-star/test'`,
      "/baseurl_dot/actual/test.ts": `export default 'absolute-success'`,
      "/baseurl_nested/index.ts": /* ts */ `
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
      "/baseurl_nested/tsconfig.json": /* json */ `
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
              "/virtual-out/test": ["${root}/baseurl_nested/nested/actual/test"],
              "/virtual-out-star/*": ["${root}/baseurl_nested/nested/actual/*"],
            }
          }
        }
      `,
      "/baseurl_nested/nested/test0-success.ts": `export default 'test0-success'`,
      "/baseurl_nested/nested/test1-success.ts": `export default 'test1-success'`,
      "/baseurl_nested/nested/test2-success/foo.ts": `export default 'test2-success'`,
      "/baseurl_nested/nested/test3-success.ts": `export default 'test3-success'`,
      "/baseurl_nested/nested/test4-first/foo.ts": `export default 'test4-success'`,
      "/baseurl_nested/nested/test5-second/foo.ts": `export default 'test5-success'`,
      "/baseurl_nested/absolute-in.ts": `export {default} from '/virtual-in/test'`,
      "/baseurl_nested/absolute-in-star.ts": `export {default} from '/virtual-in/test'`,
      "/baseurl_nested/absolute-out.ts": `export {default} from '/virtual-out/test'`,
      "/baseurl_nested/absolute-out-star.ts": `export {default} from '/virtual-out-star/test'`,
      "/baseurl_nested/nested/actual/test.ts": `export default 'absolute-success'`,
    },
    run: {
      stdout:
        '{"baseurl_dot":{"test0":"test0-success","test1":"test1-success","test2":"test2-success","test3":"test3-success","test4":"test4-success","test5":"test5-success","absoluteIn":"absolute-success","absoluteInStar":"absolute-success","absoluteOut":"absolute-success","absoluteOutStar":"absolute-success"},"baseurl_nested":{"test0":"test0-success","test1":"test1-success","test2":"test2-success","test3":"test3-success","test4":"test4-success","test5":"test5-success","absoluteIn":"absolute-success","absoluteInStar":"absolute-success","absoluteOut":"absolute-success","absoluteOutStar":"absolute-success"}}',
    },
  }));
  itBundled("tsconfig/PathsNoBaseURL", {
    todo: true,
    files: {
      "/entry.ts": /* ts */ `
        import simple from './simple'
        import extended from './extended'
        console.log(JSON.stringify({simple, extended}))
      `,
      "/simple/index.ts": /* ts */ `
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
      "/simple/tsconfig.json": /* json */ `
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
      "/simple/test0-success.ts": `export default 'test0-success'`,
      "/simple/test1-success.ts": `export default 'test1-success'`,
      "/simple/test2-success/foo.ts": `export default 'test2-success'`,
      "/simple/test3-success.ts": `export default 'test3-success'`,
      "/simple/test4-first/foo.ts": `export default 'test4-success'`,
      "/simple/test5-second/foo.ts": `export default 'test5-success'`,
      "/simple/absolute.ts": `export {default} from '/virtual/test'`,
      "/simple/actual/test.ts": `export default 'absolute-success'`,
      "/extended/index.ts": /* ts */ `
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
      "/extended/tsconfig.json": /* json */ `
        {
          "extends": "./nested/tsconfig.json"
        }
      `,
      "/extended/nested/tsconfig.json": /* json */ `
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
      "/extended/nested/test0-success.ts": `export default 'test0-success'`,
      "/extended/nested/test1-success.ts": `export default 'test1-success'`,
      "/extended/nested/test2-success/foo.ts": `export default 'test2-success'`,
      "/extended/nested/test3-success.ts": `export default 'test3-success'`,
      "/extended/nested/test4-first/foo.ts": `export default 'test4-success'`,
      "/extended/nested/test5-second/foo.ts": `export default 'test5-success'`,
      "/extended/absolute.ts": `export {default} from '/virtual/test'`,
      "/extended/nested/actual/test.ts": `export default 'absolute-success'`,
    },
    run: {
      stdout:
        '{"simple":{"test0":"test0-success","test1":"test1-success","test2":"test2-success","test3":"test3-success","test4":"test4-success","test5":"test5-success","absolute":"absolute-success"},"extended":{"test0":"test0-success","test1":"test1-success","test2":"test2-success","test3":"test3-success","test4":"test4-success","test5":"test5-success","absolute":"absolute-success"}}',
    },
  });
  // TODO: warnings shouldnt stop build?
  itBundled("tsconfig/BadPathsNoBaseURL", {
    // GENERATED
    todo: true,
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
                ".\\\\good",
                "../good",
                "..\\\\good",
                "/good",
                "\\\\good",
                "c:/good",
                "c:\\\\good",
                "C:/good",
                "C:\\\\good",
  
                "bad",
                "@bad/core",
                ".*/bad",
                "..*/bad",
                "c*:\\\\bad",
                "c:*\\\\bad",
                "http://bad"
              ]
            }
          }
        }
      `,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/entry.ts: ERROR: Could not resolve "should-not-be-imported"
  NOTE: Use the relative path "./should-not-be-imported" to reference the file "Users/user/project/should-not-be-imported.ts". Without the leading "./", the path "should-not-be-imported" is being interpreted as a package path instead.
  Users/user/project/tsconfig.json: WARNING: Non-relative path "bad" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/tsconfig.json: WARNING: Non-relative path "@bad/core" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/tsconfig.json: WARNING: Non-relative path ".* /bad" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/tsconfig.json: WARNING: Non-relative path "..* /bad" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/tsconfig.json: WARNING: Non-relative path "c*:\\bad" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/tsconfig.json: WARNING: Non-relative path "c:*\\bad" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/tsconfig.json: WARNING: Non-relative path "http://bad" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  `, */
  });
  itBundled("tsconfig/PathsOverriddenBaseURL", {
    // GENERATED
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
    run: {
      stdout: "123",
    },
  });
  itBundled("tsconfig/PathsOverriddenBaseURLDifferentDir", {
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
    run: {
      stdout: "123",
    },
  });
  itBundled("tsconfig/PathsMissingBaseURL", {
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
    bundleErrors: {
      "/Users/user/project/src/entry.ts": [`Could not resolve: "#/test". Maybe you need to "bun install"?`],
    },
  });
  itBundled("tsconfig/PathsInChildNoBaseURL", {
    // Child defines paths without baseUrl, extends parent with no paths/baseUrl.
    // Paths should resolve relative to the child tsconfig's directory.
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import test from '#/lib/test'
        console.log(test)
      `,
      "/Users/user/project/src/lib/test.ts": `export default 123`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.base.json",
          "compilerOptions": {
            "paths": {
              "#/*": ["./*"]
            }
          }
        }
      `,
      "/Users/user/project/tsconfig.base.json": /* json */ `
        {
          "compilerOptions": {
            "strict": true
          }
        }
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("tsconfig/PathsInGrandchildNoBaseURL", {
    // 3-level extends chain: root -> child -> grandchild, both child and
    // grandchild define paths without baseUrl. TypeScript replaces paths across
    // extends, so only grandchild's paths survive and base_url_for_paths
    // resolves relative to grandchild's directory.
    files: {
      "/Users/user/project/app/src/entry.ts": /* ts */ `
        import test from '#/lib/test'
        console.log(test)
      `,
      "/Users/user/project/app/src/lib/test.ts": `export default 456`,
      "/Users/user/project/app/src/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.json",
          "compilerOptions": {
            "paths": {
              "#/*": ["./*"]
            }
          }
        }
      `,
      "/Users/user/project/app/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.base.json",
          "compilerOptions": {
            "paths": {
              "util/*": ["./utils/*"]
            }
          }
        }
      `,
      "/Users/user/project/tsconfig.base.json": /* json */ `
        {
          "compilerOptions": {
            "strict": true
          }
        }
      `,
    },
    run: {
      stdout: "456",
    },
  });
  itBundled("tsconfig/PathsReplacedAcrossExtends", {
    // TypeScript replaces paths across extends: when grandchild defines paths,
    // child's paths are gone entirely (verified via `tsc --showConfig`). This
    // test places the target file where the OLD merge behavior would find it
    // (grandchild's dir), so it discriminates: merge would succeed, replace fails.
    files: {
      "/Users/user/project/app/src/entry.ts": /* ts */ `
        import test from 'util/helper'
        console.log(test)
      `,
      "/Users/user/project/app/src/utils/helper.ts": `export default 789`,
      "/Users/user/project/app/src/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.json",
          "compilerOptions": {
            "paths": {
              "#/*": ["./*"]
            }
          }
        }
      `,
      "/Users/user/project/app/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.base.json",
          "compilerOptions": {
            "paths": {
              "util/*": ["./utils/*"]
            }
          }
        }
      `,
      "/Users/user/project/tsconfig.base.json": /* json */ `
        {
          "compilerOptions": {
            "strict": true
          }
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/app/src/entry.ts": [`Could not resolve: "util/helper". Maybe you need to "bun install"?`],
    },
  });
  itBundled("tsconfig/EmptyPathsClearsParent", {
    // An explicit `paths: {}` in the child should CLEAR inherited paths, not
    // inherit them. TypeScript treats empty paths as a complete override.
    files: {
      "/Users/user/project/src/entry.ts": /* ts */ `
        import test from '@helpers/x'
        console.log(test)
      `,
      "/Users/user/project/src/helpers/x.ts": `export default 123`,
      "/Users/user/project/src/tsconfig.json": /* json */ `
        {
          "extends": "../tsconfig.base.json",
          "compilerOptions": {
            "paths": {}
          }
        }
      `,
      "/Users/user/project/tsconfig.base.json": /* json */ `
        {
          "compilerOptions": {
            "paths": {
              "@helpers/*": ["./src/helpers/*"]
            }
          }
        }
      `,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.ts": [`Could not resolve: "@helpers/x". Maybe you need to "bun install"?`],
    },
  });
  itBundled("tsconfig/JSX", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react",
            "jsxFactory": "R.c",
            "jsxFragmentFactory": "R.F"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    external: ["react"],
    onAfterBundle(api) {
      api
        .expectFile("/Users/user/project/out.js")
        .toContain(
          `console.log(/* @__PURE__ */ R.c(R.F, null, /* @__PURE__ */ R.c(\"div\", null), /* @__PURE__ */ R.c(\"div\", null)));\n`,
        );
    },
  });
  itBundled("tsconfig/ReactJSXNotReact", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/notreact/jsx-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxImportSource": "notreact"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    env: {
      NODE_ENV: "production",
    },
    external: ["notreact"],
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`from "notreact/jsx-runtime`);
    },
  });
  itBundled("tsconfig/ReactJSXNotReactScoped", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/@notreact/jsx/jsx-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsxImportSource": "@notreact/jsx"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    external: ["@notreact/jsx"],
    env: {
      NODE_ENV: "production",
    },
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`from "@notreact/jsx/jsx-runtime`);
    },
  });
  itBundled("tsconfig/ReactJSXDevNotReact", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/notreact/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react-jsxdev",
            "jsxImportSource": "notreact"
          }
        }
      `,
    },
    outfile: "/Users/user/project/out.js",
    external: ["notreact"],
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`from "notreact/jsx-dev-runtime`);
    },
  });
  itBundled("tsconfig/ReactJSXDev", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react-jsxdev"
          }
        }
      `,
    },
    external: ["react"],
    outfile: "/Users/user/project/out.js",
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`from "react/jsx-dev-runtime`);
    },
  });
  itBundled("tsconfig/ReactJSXDevTSConfigProduction", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react-jsx"
          }
        }
      `,
    },
    external: ["react"],
    env: {
      NODE_ENV: "development",
    },
    outfile: "/Users/user/project/out.js",
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`from "react/jsx-dev-runtime`);
    },
  });
  itBundled("tsconfig/ReactJSX", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
    },
    external: ["react"],
    env: {
      NODE_ENV: "production",
    },
    outfile: "/Users/user/project/out.js",
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`from "react/jsx-runtime`);
    },
  });

  itBundled("tsconfig/ReactJSXClassic", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react"
          }
        }
      `,
    },
    external: ["react"],
    outfile: "/Users/user/project/out.js",
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`React.Fragment`);
      api.expectFile("/Users/user/project/out.js").toContain(`React.createElement`);
    },
  });
  itBundled("tsconfig/ReactJSXClassicWithNODE_ENV=Production", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react"
          }
        }
      `,
    },
    external: ["react"],
    outfile: "/Users/user/project/out.js",
    env: {
      NODE_ENV: "production",
    },
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`React.Fragment`);
      api.expectFile("/Users/user/project/out.js").toContain(`React.createElement`);
    },
  });

  itBundled("tsconfig/ReactJSXClassicWithNODE_ENV=Development", {
    files: {
      "/Users/user/project/entry.tsx": `console.log(<><div/><div/></>)`,
      "/Users/user/project/node_modules/react/jsx-dev-runtime.ts": `
        export const Fragment = (props: { key?: string; children?: Child[] }): JSXNode => {
          return new JSXFragmentNode('', {}, props.children || [])
        }
        export const jsx = (tag: string | JSXComponent, props: { key?: string; children?: Child[] }, ...children: Child[]): JSXNode => {
          return new JSXNode(tag, props, children)
        }
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "jsx": "react"
          }
        }
      `,
    },
    external: ["react"],
    outfile: "/Users/user/project/out.js",
    env: {
      NODE_ENV: "development",
    },
    onAfterBundle(api) {
      api.expectFile("/Users/user/project/out.js").toContain(`React.Fragment`);
      api.expectFile("/Users/user/project/out.js").toContain(`React.createElement`);
    },
  });
  itBundled("tsconfig/PathsTypeOnly", {
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
    run: {
      stdout: "55",
    },
  });
  // A `paths` substitution that names a declaration file (`.d.ts`, `.d.mts`,
  // `.d.cts`, any case) is skipped, for an exact key and after `*`
  // substitution. The import falls through to the next substitution or to
  // node_modules, like esbuild's `matchTSConfigPaths` does for `.d.ts`.
  itBundled("tsconfig/PathsSkipDeclarationFiles", {
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import { x } from "foo";
        import { y } from "bar/lib";
        import { u } from "upper";
        import { v } from "upper-star/up";
        import { f } from "fallback";
        import { m } from "esm-types";
        import { c } from "cjs-types/lib";
        console.log(x, y, u, v, f, m, c);
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "foo": ["./types/foo.d.ts"],
              "bar/*": ["./types/*.d.ts"],
              "upper": ["./types/upper.D.TS"],
              "upper-star/*": ["./types/*.D.TS"],
              "fallback": ["./types/fallback.d.ts", "./src/fallback.ts"],
              "esm-types": ["./types/esm-types.d.mts"],
              "cjs-types/*": ["./types/*.d.cts"]
            }
          }
        }
      `,
      "/Users/user/project/types/foo.d.ts": `export declare const x: number;`,
      "/Users/user/project/types/lib.d.ts": `export declare const y: number;`,
      "/Users/user/project/types/upper.D.TS": `export declare const u: number;`,
      "/Users/user/project/types/up.D.TS": `export declare const v: number;`,
      "/Users/user/project/types/fallback.d.ts": `export declare const f: string;`,
      "/Users/user/project/types/esm-types.d.mts": `export declare const m: number;`,
      "/Users/user/project/types/lib.d.cts": `export declare const c: number;`,
      "/Users/user/project/src/fallback.ts": `export const f = "fallback.ts";`,
      "/Users/user/project/node_modules/foo/package.json": `{ "name": "foo", "type": "module", "main": "index.js" }`,
      "/Users/user/project/node_modules/foo/index.js": `export const x = 123;`,
      "/Users/user/project/node_modules/bar/package.json": `{ "name": "bar", "type": "module" }`,
      "/Users/user/project/node_modules/bar/lib.js": `export const y = 456;`,
      "/Users/user/project/node_modules/upper/package.json": `{ "name": "upper", "type": "module", "main": "index.js" }`,
      "/Users/user/project/node_modules/upper/index.js": `export const u = 7;`,
      "/Users/user/project/node_modules/upper-star/package.json": `{ "name": "upper-star", "type": "module" }`,
      "/Users/user/project/node_modules/upper-star/up.js": `export const v = 8;`,
      "/Users/user/project/node_modules/esm-types/package.json": `{ "name": "esm-types", "main": "index.mjs" }`,
      "/Users/user/project/node_modules/esm-types/index.mjs": `export const m = 9;`,
      "/Users/user/project/node_modules/cjs-types/package.json": `{ "name": "cjs-types" }`,
      "/Users/user/project/node_modules/cjs-types/lib.js": `module.exports.c = 10;`,
    },
    run: {
      stdout: "123 456 7 8 fallback.ts 9 10",
    },
  });
  itBundled("tsconfig/PathsSkipDeclarationFilesNoFallback", {
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import { z } from "types-only";
        console.log(z);
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "types-only": ["./types/types-only.d.ts"]
            }
          }
        }
      `,
      "/Users/user/project/types/types-only.d.ts": `export declare const z: number;`,
    },
    bundleErrors: {
      "/Users/user/project/entry.ts": [`Could not resolve: "types-only". Maybe you need to "bun install"?`],
    },
  });
  // Only the tsconfig text counts. A catch-all alias still resolves a specifier
  // that names a declaration file itself.
  itBundled("tsconfig/PathsCatchAllResolvesDeclarationSpecifier", {
    files: {
      "/Users/user/project/entry.ts": /* ts */ `
        import "@/env.d.ts";
        console.log("ok");
      `,
      "/Users/user/project/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@/*": ["./src/*"]
            }
          }
        }
      `,
      "/Users/user/project/src/env.d.ts": /* ts */ `
        declare global { interface Env { FOO: string } }
        export {};
      `,
    },
    run: {
      stdout: "ok",
    },
  });

  // A file outside node_modules takes the tsconfig.json nearest to its real path, also when an
  // import reaches it through a symbolic link. Each stub JSX runtime returns its own name, so
  // stdout names the runtime that each file was compiled against.
  const jsxRuntimeStub = (dir: string, name: string) => ({
    [`${dir}/node_modules/${name}/jsx-runtime.js`]: `export const jsx = () => "${name}"; export const jsxs = jsx; export const Fragment = "${name}";`,
    [`${dir}/node_modules/${name}/jsx-dev-runtime.js`]: `export const jsxDEV = () => "${name}"; export const Fragment = "${name}";`,
  });
  const jsxRuntimeStubs = {
    ...jsxRuntimeStub("", "react"),
    ...jsxRuntimeStub("", "preact"),
    ...jsxRuntimeStub("", "solid-js"),
  };
  const jsxImportSource = (name: string) =>
    JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: name } });
  // An application imports a package of its workspace by name, through a link in its own
  // node_modules. `bun install` makes this link.
  const linkedPackageSources = {
    "/apps/web/tsconfig.json": jsxImportSource("preact"),
    "/packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
    "/packages/ui/button.tsx": `export const Button = () => <button />;`,
    "/packages/ui/card.tsx": `export const Card = () => <article />;`,
    "/packages/ui/main.tsx": `console.log(<main />);`,
  };
  const linkedPackage = { ...jsxRuntimeStubs, ...linkedPackageSources };
  const byName = /* tsx */ `
    import { Button } from "ui/button";
    console.log(<a />, Button());
  `;
  // "legacy" with experimentalDecorators, "assign" with useDefineForClassFields false.
  const decoratorAndFieldProbe = /* ts */ `
    export let decorators = "none";
    function dec(...args: unknown[]) {
      decorators = args.length === 3 ? "legacy" : "standard";
    }
    class Model {
      field;
      @dec method() {}
    }
    export const fields = Object.hasOwn(new Model(), "field") ? "define" : "assign";
  `;
  // "design:type" with emitDecoratorMetadata.
  const decoratorMetadataProbe = /* ts */ `
    const keys: string[] = [];
    (Reflect as any).metadata = (key: string) => {
      keys.push(key);
      return () => {};
    };
    function dec(_target: unknown, _key: string) {}
    class Model {
      @dec name: string = "";
    }
    export const metadata = keys.join(",") || "none";
  `;
  const decoratorOptions = (emitDecoratorMetadata: boolean) =>
    JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata } });
  for (const backend of ["cli", "api"] as const) {
    itBundled(`tsconfig/SymlinkedPackageTsconfigAboveRealPath-${backend}`, {
      files: {
        "/apps/web/entry.tsx": byName,
        ...linkedPackage,
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "preact solid-js" },
    });
    // Each side has only its own JSX runtime installed, as after `bun install`. The runtime
    // of a file is resolved from its real directory.
    itBundled(`tsconfig/SymlinkedPackageRuntimeInstalledPerSide-${backend}`, {
      files: {
        "/apps/web/entry.tsx": byName,
        ...linkedPackageSources,
        ...jsxRuntimeStub("/apps/web", "preact"),
        ...jsxRuntimeStub("/packages", "solid-js"),
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "preact solid-js" },
    });
    // The tsconfig.json above the link gives the file nothing.
    itBundled(`tsconfig/SymlinkedPackageNoTsconfigAboveRealPath-${backend}`, {
      files: {
        "/apps/web/entry.tsx": byName,
        ...linkedPackage,
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "preact react" },
    });
    // The same for the decorator and class field options of the tsconfig.json above the link.
    itBundled(`tsconfig/SymlinkedPackageNoTsconfigAboveRealPathDecorators-${backend}`, {
      files: {
        "/apps/web/entry.ts": /* ts */ `
          import { decorators, fields } from "ui/model";
          console.log(decorators, fields);
        `,
        "/apps/web/tsconfig.json": /* json */ `
          { "compilerOptions": { "experimentalDecorators": true, "useDefineForClassFields": false } }
        `,
        "/packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
        "/packages/ui/model.ts": decoratorAndFieldProbe,
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "standard define" },
    });
    // The build reads the tsconfig.json above the real path for a linked file, also when the
    // file imports nothing. What is wrong with that tsconfig.json is an error of the build.
    itBundled(`tsconfig/SymlinkedPackageMalformedTsconfigAboveRealPath-${backend}`, {
      files: {
        "/apps/web/entry.ts": /* ts */ `
          import { value } from "ui/value";
          console.log(value);
        `,
        "/packages/tsconfig.json": `{ this is not json`,
        "/packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
        "/packages/ui/value.ts": `export const value = 1;`,
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      bundleErrors: {
        "/packages/tsconfig.json": [`Expected string but found "this"`],
      },
    });
    // An import through the link and an import of the real path give the file the same
    // settings, whichever comes first.
    itBundled(`tsconfig/SymlinkedPackageAndRealPathAgree-${backend}`, {
      files: {
        "/apps/web/entry.tsx": /* tsx */ `
          import { Button as buttonByName } from "ui/button";
          import { Button as buttonByPath } from "../../packages/ui/button";
          import { Card as cardByPath } from "../../packages/ui/card";
          import { Card as cardByName } from "ui/card";
          console.log(buttonByName === buttonByPath, buttonByName(), cardByName === cardByPath, cardByName());
        `,
        ...linkedPackage,
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "true solid-js true solid-js" },
    });
    // The tsconfig.json of the package is read at its real path, which is not in node_modules,
    // so its "extends" counts.
    itBundled(`tsconfig/SymlinkedPackageTsconfigExtends-${backend}`, {
      files: {
        "/apps/web/entry.tsx": byName,
        ...linkedPackage,
        "/packages/tsconfig.base.json": jsxImportSource("solid-js"),
        "/packages/ui/tsconfig.json": `{ "extends": "../tsconfig.base.json" }`,
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "preact solid-js" },
    });
    // An "extends" chain that does not end: every file of the package gets the same settings.
    itBundled(`tsconfig/SymlinkedPackageTsconfigExtendsItself-${backend}`, {
      files: {
        "/apps/web/entry.tsx": /* tsx */ `
          import { Button } from "ui/button";
          import { Card } from "ui/card";
          console.log(Button() === Card());
        `,
        ...linkedPackage,
        "/packages/ui/tsconfig.json": JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions: { jsx: "react-jsx", jsxImportSource: "solid-js" },
        }),
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "true" },
    });
    // A relative "extends" is joined onto the real directory of the tsconfig.json. The file of
    // that name beside the link is not the base.
    itBundled(`tsconfig/SymlinkedDirectoryTsconfigExtendsRelative-${backend}`, {
      files: {
        "/apps/web/entry.tsx": /* tsx */ `
          import { Button } from "./linked/button";
          console.log(<a />, Button());
        `,
        ...linkedPackage,
        "/packages/tsconfig.base.json": jsxImportSource("solid-js"),
        "/packages/ui/tsconfig.json": `{ "extends": "../tsconfig.base.json" }`,
        "/apps/web/tsconfig.base.json": jsxImportSource("react"),
      },
      symlinks: { "/apps/web/linked": "/packages/ui" },
      backend,
      run: { stdout: "preact solid-js" },
    });
    itBundled(`tsconfig/SymlinkedPackageDecoratorsAndClassFields-${backend}`, {
      files: {
        "/apps/web/entry.ts": /* ts */ `
          import { decorators, fields } from "ui/model";
          console.log(decorators, fields);
        `,
        "/apps/web/tsconfig.json": `{ "compilerOptions": { "useDefineForClassFields": true } }`,
        "/packages/tsconfig.json": /* json */ `
          { "compilerOptions": { "experimentalDecorators": true, "useDefineForClassFields": false } }
        `,
        "/packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
        "/packages/ui/model.ts": decoratorAndFieldProbe,
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      backend,
      run: { stdout: "legacy assign" },
    });
    for (const [name, above, atRealPath, stdout] of [
      ["SymlinkedPackageEmitDecoratorMetadata", false, true, "design:type"],
      ["SymlinkedPackageNoEmitDecoratorMetadata", true, false, "none"],
    ] as const) {
      itBundled(`tsconfig/${name}-${backend}`, {
        files: {
          "/apps/web/entry.ts": /* ts */ `
            import { metadata } from "ui/model";
            console.log(metadata);
          `,
          "/apps/web/tsconfig.json": decoratorOptions(above),
          "/packages/tsconfig.json": decoratorOptions(atRealPath),
          "/packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
          "/packages/ui/model.ts": decoratorMetadataProbe,
        },
        symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
        backend,
        run: { stdout },
      });
    }
    // "module" is the file in the bundle. The tsconfig.json next to "main" gives it nothing, on
    // every route to the package, whichever import comes first.
    const routesToPackage = [
      `import { Button as byName } from "ui";`,
      `import { Button as byDirectory } from "../../packages/ui";`,
      `import { Button as byAlias } from "@ui";`,
    ];
    for (const [order, routes] of [
      ["NameFirst", routesToPackage],
      ["NameLast", routesToPackage.toReversed()],
    ] as const) {
      itBundled(`tsconfig/SymlinkedPackageMainAndModule${order}-${backend}`, {
        files: {
          "/apps/web/entry.tsx": `${routes.join("\n")}\nconsole.log(byName === byDirectory, byName === byAlias, byName());`,
          ...jsxRuntimeStubs,
          "/apps/web/tsconfig.json": JSON.stringify({
            compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact", paths: { "@ui": ["../../packages/ui"] } },
          }),
          "/packages/tsconfig.json": jsxImportSource("solid-js"),
          "/packages/ui/package.json": /* json */ `
            { "name": "ui", "version": "1.0.0", "module": "./src/index.tsx", "main": "./dist/index.js" }
          `,
          "/packages/ui/src/index.tsx": `export const Button = () => <button />;`,
          "/packages/ui/dist/tsconfig.json": jsxImportSource("react"),
          "/packages/ui/dist/index.js": `exports.Button = () => "main";`,
        },
        symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
        backend,
        run: { stdout: "true true solid-js" },
      });
    }
    // A real path inside node_modules: the file keeps the tsconfig.json above the link, as
    // before. https://github.com/oven-sh/bun/pull/36673 decides this case.
    itBundled(`tsconfig/SymlinkedStoreDependencyKeepsTsconfigAboveLink-${backend}`, {
      files: {
        "/apps/web/entry.tsx": /* tsx */ `
          import { Widget } from "jsxlib";
          console.log(<a />, Widget());
        `,
        ...jsxRuntimeStubs,
        "/apps/web/tsconfig.json": jsxImportSource("preact"),
        "/node_modules/.bun/jsxlib@1.0.0/node_modules/jsxlib/package.json": `{ "name": "jsxlib", "version": "1.0.0" }`,
        "/node_modules/.bun/jsxlib@1.0.0/node_modules/jsxlib/index.tsx": `export const Widget = () => <section />;`,
      },
      symlinks: { "/apps/web/node_modules/jsxlib": "/node_modules/.bun/jsxlib@1.0.0/node_modules/jsxlib" },
      backend,
      run: { stdout: "preact preact" },
    });
    // A file directly in a node_modules directory is inside node_modules too.
    itBundled(`tsconfig/SymlinkedNodeModulesDirectoryKeepsTsconfigAboveLink-${backend}`, {
      files: {
        "/apps/web/entry.tsx": /* tsx */ `
          import { Widget } from "./linked/widget";
          console.log(<a />, Widget());
        `,
        ...jsxRuntimeStubs,
        "/apps/web/tsconfig.json": jsxImportSource("preact"),
        "/vendor/tsconfig.json": jsxImportSource("solid-js"),
        "/vendor/node_modules/widget.tsx": `export const Widget = () => <section />;`,
      },
      symlinks: { "/apps/web/linked": "/vendor/node_modules" },
      backend,
      run: { stdout: "preact preact" },
    });
    itBundled(`tsconfig/SymlinkedDirectoryEntryPoint-${backend}`, {
      files: {
        ...linkedPackage,
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/linked": "/packages/ui" },
      entryPoints: ["/apps/web/linked/main.tsx"],
      backend,
      run: { stdout: "solid-js" },
    });
    // The scripts of an HTML import are resolved by the resolver of the browser target.
    itBundled(`tsconfig/SymlinkedPackageInScriptOfHtmlImport-${backend}`, {
      files: {
        "/apps/web/server.ts": /* ts */ `
          import page from "./index.html";
          console.log(typeof page);
        `,
        "/apps/web/index.html": `<!DOCTYPE html><html><body><script type="module" src="./client.tsx"></script></body></html>`,
        "/apps/web/client.tsx": byName,
        ...linkedPackage,
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/node_modules/ui": "/packages/ui" },
      target: "bun",
      outdir: "/out",
      backend,
      async onAfterBundle(api) {
        const scripts = readdirSync(api.outdir).filter(name => name.startsWith("index-") && name.endsWith(".js"));
        expect(scripts).toHaveLength(1);
        await using proc = Bun.spawn({
          cmd: [bunExe(), join(api.outdir, scripts[0])],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "preact solid-js\n", stderr: "", exitCode: 0 });
      },
    });
    // A link to a file needs a privilege on Windows.
    (isWindows ? itBundled.skip : itBundled)(`tsconfig/SymlinkedFileTsconfigAboveRealPath-${backend}`, {
      files: {
        "/apps/web/entry.tsx": /* tsx */ `
          import { Button } from "./button";
          console.log(<a />, Button());
        `,
        ...linkedPackage,
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/button.tsx": "/packages/ui/button.tsx" },
      backend,
      run: { stdout: "preact solid-js" },
    });
    (isWindows ? itBundled.skip : itBundled)(`tsconfig/SymlinkedFileEntryPoint-${backend}`, {
      files: {
        ...linkedPackage,
        "/packages/tsconfig.json": jsxImportSource("solid-js"),
      },
      symlinks: { "/apps/web/main.tsx": "/packages/ui/main.tsx" },
      entryPoints: ["/apps/web/main.tsx"],
      backend,
      run: { stdout: "solid-js" },
    });
  }
  itBundled("tsconfig/SymlinkedDirectoryEntryPointNoBundle", {
    files: {
      ...linkedPackage,
      "/packages/tsconfig.json": jsxImportSource("solid-js"),
    },
    symlinks: { "/apps/web/linked": "/packages/ui" },
    entryPoints: ["/apps/web/linked/main.tsx"],
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatch(/from\s*"solid-js\/jsx-(dev-)?runtime"/);
    },
  });
  // Runs `bun build` in `cwd`, then the output. Returns what the output prints.
  const buildAndRun = async (root: string, cwd: string, entry: string) => {
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", entry, "--outfile", join(root, "out.js")],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildStderr, buildExitCode }).toEqual({ buildStderr: "", buildExitCode: 0 });
    await using run = Bun.spawn({ cmd: [bunExe(), join(root, "out.js")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    return { stdout, stderr, exitCode };
  };
  // `itBundled` starts every build in the root. This build starts in the directory of the
  // application, as a script of its package.json does. "model" has no tsconfig.json at or above
  // its real path.
  test("tsconfig/SymlinkedPackageBuildStartedInApplicationDirectory", async () => {
    using dir = tempDir("bundler-linked-package-application-cwd", {
      ...Object.fromEntries(Object.entries(jsxRuntimeStubs).map(([file, text]) => [file.slice(1), text])),
      "apps/web/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "preact",
          experimentalDecorators: true,
          useDefineForClassFields: false,
        },
      }),
      "apps/web/entry.tsx": /* tsx */ `
        import { Button } from "ui/button";
        import { Button as byPath } from "../../packages/ui/button";
        import { decorators, fields } from "model";
        console.log(<a />, Button(), Button === byPath, decorators, fields);
      `,
      "apps/web/node_modules/.keep": "",
      "packages/tsconfig.json": jsxImportSource("solid-js"),
      "packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
      "packages/ui/button.tsx": `export const Button = () => <button />;`,
      "libs/model/package.json": `{ "name": "model", "version": "1.0.0" }`,
      "libs/model/index.ts": decoratorAndFieldProbe,
    });
    const root = String(dir);
    const application = join(root, "apps", "web");
    // A junction needs no privilege on Windows. Its target is absolute.
    symlinkSync(join(root, "packages", "ui"), join(application, "node_modules", "ui"), "junction");
    symlinkSync(join(root, "libs", "model"), join(application, "node_modules", "model"), "junction");
    expect(await buildAndRun(root, application, "entry.tsx")).toEqual({
      stdout: "preact solid-js true standard define\n",
      stderr: "",
      exitCode: 0,
    });
  });
  // The links that `bun install` makes for a workspace. Each side installs its own JSX runtime.
  const jsxRuntimePackage = (name: string) => ({
    [`packages/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0" }),
    [`packages/${name}/jsx-runtime.js`]: `export const jsx = () => "${name}"; export const jsxs = jsx; export const Fragment = "${name}";`,
    [`packages/${name}/jsx-dev-runtime.js`]: `export const jsxDEV = () => "${name}"; export const Fragment = "${name}";`,
  });
  test.each(["isolated", "hoisted"])("tsconfig/SymlinkedPackageOfInstalledWorkspace-%s", async linker => {
    using dir = tempDir("bundler-linked-package-installed-workspace", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["apps/*", "packages/*"] }),
      "apps/web/package.json": JSON.stringify({
        name: "web",
        version: "1.0.0",
        dependencies: { ui: "workspace:*", preact: "workspace:*" },
      }),
      "apps/web/tsconfig.json": jsxImportSource("preact"),
      "apps/web/entry.tsx": byName,
      "packages/tsconfig.json": jsxImportSource("solid-js"),
      "packages/ui/package.json": JSON.stringify({
        name: "ui",
        version: "1.0.0",
        dependencies: { "solid-js": "workspace:*" },
      }),
      "packages/ui/button.tsx": `export const Button = () => <button />;`,
      ...jsxRuntimePackage("preact"),
      ...jsxRuntimePackage("solid-js"),
    });
    const root = String(dir);
    await using install = Bun.spawn({
      cmd: [bunExe(), "install", `--linker=${linker}`],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, installStderr, installExitCode] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);
    expect(installExitCode, installStderr).toBe(0);
    expect(await buildAndRun(root, root, join("apps", "web", "entry.tsx"))).toEqual({
      stdout: "preact solid-js\n",
      stderr: "",
      exitCode: 0,
    });
  });
  // `bun build --app` has a resolver for the server and one for the client. Both take the
  // tsconfig.json above the real path of the package.
  test("tsconfig/SymlinkedPackageInServerAndClientOfApp", async () => {
    using dir = tempDir("bundler-linked-package-app", {
      ...Object.fromEntries(Object.entries(jsxRuntimeStubs).map(([file, text]) => [file.slice(1), text])),
      "apps/web/tsconfig.json": jsxImportSource("preact"),
      "apps/web/client.tsx": `import { Button } from "ui/button";\nconsole.log("client", Button());`,
      "apps/web/server.ts": /* ts */ `
        export function render(req, meta) {
          return new Response(String(meta.pageModule.default()));
        }
        export async function prerender(meta) {
          const scripts = meta.modules.map(m => '<script type="module" src="' + m + '"></script>').join("");
          return { files: { "index.html": "<body>" + meta.pageModule.default() + scripts + "</body>" } };
        }
      `,
      "apps/web/routes/index.tsx": `import { Button } from "ui/button";\nexport default () => "server " + Button();`,
      "apps/web/app.ts": /* ts */ `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", clientEntryPoint: "./client.tsx" };
        export default { app: { framework: { fileSystemRouterTypes: [fsr] } } };
      `,
      "apps/web/node_modules/.keep": "",
      "packages/tsconfig.json": jsxImportSource("solid-js"),
      "packages/ui/package.json": `{ "name": "ui", "version": "1.0.0" }`,
      "packages/ui/button.tsx": `export const Button = () => <button />;`,
    });
    const application = join(String(dir), "apps", "web");
    // A junction needs no privilege on Windows. Its target is absolute.
    symlinkSync(join(String(dir), "packages", "ui"), join(application, "node_modules", "ui"), "junction");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./app.ts"],
      cwd: application,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    const html = await Bun.file(join(application, "dist", "index.html"))
      .text()
      .catch(() => stderr);
    const script = html.match(/<script type="module" src="\/([^"]*_bun[^"]*\.js)"><\/script>/);
    const client = script ? await Bun.file(join(application, "dist", script[1])).text() : "";
    expect({
      server: html.match(/server ([\w-]+)/)?.[1],
      client: ["preact", "solid-js"].filter(name => client.includes(`"${name}"`)),
    }).toEqual({ server: "solid-js", client: ["solid-js"] });
    expect(exitCode).toBe(0);
  });
  // The settings of a linked file are in its real directory. A build that cannot read that
  // directory reports it, also when the file imports nothing.
  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial.skipIf(isWindows)("tsconfig/SymlinkedFileInDirectoryThatCannotBeListed", async () => {
    using dir = tempDir("bundler-symlinked-file-unlistable-directory", {
      "app/entry.ts": `import { value } from "./value"; console.log(value);`,
      "locked/value.ts": `export const value = 1;`,
      "out/.keep": "",
    });
    const root = String(dir);
    symlinkSync(join(root, "locked", "value.ts"), join(root, "app", "value.ts"));
    using unprivileged = unprivilegedSpawnOptions(root);
    // Its owner can open files in it but cannot list it.
    chmodSync(join(root, "locked"), 0o311);
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", join("app", "entry.ts"), "--outfile", join("out", "entry.js")],
        cwd: root,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.match(/^error: Cannot read directory ".*locked": EACCES$/gm)).toHaveLength(1);
      expect(exitCode).toBe(1);
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });
  return;
  itBundled("tsconfig/NestedJSX", {
    // GENERATED
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
  });
  itBundled("tsconfig/ReactJSXWithDevInMainConfig", {
    // GENERATED
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
    jsx: {
      development: true,
    },
  });
  itBundled("tsconfig/JsonBaseUrl", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsconfigJsonBaseUrl", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonAbsoluteBaseUrl", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonCommentAllowed", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonTrailingCommaAllowed", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonExtends", {
    // GENERATED
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
  });
  test.skip("tsconfig/JsonExtendsAbsolute", () => {
    // @ts-expect-error not imported
    expectBundled("tsconfig/JsonExtendsAbsoluteUnix", {
      // GENERATED
      host: "unix",
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
    });
    // @ts-expect-error not imported
    expectBundled("tsconfig/JsonExtendsAbsoluteWindows", {
      // GENERATED
      host: "windows",
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
    });
  });
  itBundled("tsconfig/JsonExtendsThreeLevels", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonExtendsLoop", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `base.json: WARNING: Base config file "./tsconfig" forms cycle
  `, */
  });
  itBundled("tsconfig/JsonExtendsPackage", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonOverrideMissing", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonOverrideNodeModules", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonOverrideInvalid", {
    // GENERATED
    files: {
      "/entry.ts": ``,
    },
    /* TODO FIX expectedScanLog: `ERROR: Cannot find tsconfig file "this/file/doesn't/exist/tsconfig.json"
  `, */
  });
  itBundled("tsconfig/JsonNodeModulesImplicitFile", {
    // GENERATED
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
  });
  itBundled("tsconfig/JsonInsideNodeModules", {
    // GENERATED
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
  });
  itBundled("tsconfig/WarningsInsideNodeModules", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/foo/tsconfig.json: WARNING: Cannot find base config file "extends for foo"
  `, */
  });
  itBundled("tsconfig/RemoveUnusedImports", {
    // GENERATED
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
  });
  itBundled("tsconfig/PreserveUnusedImports", {
    // GENERATED
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
  });
  itBundled("tsconfig/ImportsNotUsedAsValuesPreserve", {
    // GENERATED
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
  });
  itBundled("tsconfig/PreserveValueImports", {
    // GENERATED
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
  });
  itBundled("tsconfig/PreserveValueImportsAndImportsNotUsedAsValuesPreserve", {
    // GENERATED
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
  });
  itBundled("tsconfig/Target", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/es4/tsconfig.json: WARNING: Unrecognized target environment "ES4"
  `, */
  });
  itBundled("tsconfig/TargetError", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: Big integer literals are not available in the configured target environment ("ES2019")
  Users/user/project/src/tsconfig.json: NOTE: The target environment was set to "ES2019" here:
  `, */
  });
  itBundled("tsconfig/TargetIgnored", {
    // GENERATED
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
  });
  itBundled("tsconfig/UseDefineForClassFieldsES2020", {
    // GENERATED
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
  });
  itBundled("tsconfig/UseDefineForClassFieldsESNext", {
    // GENERATED
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
  });
  itBundled("tsconfig/UnrecognizedTargetWarning", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/a/tsconfig.json: WARNING: Unrecognized target environment "es3"
  `, */
  });
  itBundled("tsconfig/TargetWarning", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: Top-level await is not available in the configured target environment ("es6")
  Users/user/project/src/tsconfig.json: NOTE: The target environment was set to "es6" here:
  `, */
  });
  itBundled("tsconfig/OverriddenTargetWarning", {
    // GENERATED
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
    targetFromAPI: "TargetWasConfigured",
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: Top-level await is not available in the configured target environment (es2020)
  `, */
  });
  itBundled("tsconfig/NoBaseURLExtendsPaths", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/base/defaults.json: WARNING: Non-relative path "lib/*" is not allowed when "baseUrl" is not set (did you forget a leading "./"?)
  Users/user/project/src/entry.ts: ERROR: Could not resolve "foo"
  NOTE: You can mark the path "foo" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("tsconfig/BaseURLExtendsPaths", {
    // GENERATED
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
  });
  itBundled("tsconfig/PathsExtendsBaseURL", {
    // GENERATED
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
  });
  itBundled("tsconfig/ModuleSuffixesInsert", {
    // GENERATED
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
  });
  itBundled("tsconfig/ModuleSuffixesNoInsert", {
    // GENERATED
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
  });
  itBundled("tsconfig/ModuleSuffixesNoEmpty", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: Could not resolve "./bar"
  `, */
  });
  itBundled("tsconfig/WithStatementAlwaysStrictFalse", {
    // GENERATED
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
  });
  itBundled("tsconfig/WithStatementAlwaysStrictTrue", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: With statements cannot be used in strict mode
  Users/user/project/tsconfig.json: NOTE: TypeScript's "alwaysStrict" setting was enabled here:
  `, */
  });
  itBundled("tsconfig/WithStatementStrictFalse", {
    // GENERATED
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
  });
  itBundled("tsconfig/WithStatementStrictTrue", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: With statements cannot be used in strict mode
  Users/user/project/tsconfig.json: NOTE: TypeScript's "strict" setting was enabled here:
  `, */
  });
  itBundled("tsconfig/WithStatementStrictFalseAlwaysStrictTrue", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.ts: ERROR: With statements cannot be used in strict mode
  Users/user/project/tsconfig.json: NOTE: TypeScript's "alwaysStrict" setting was enabled here:
  `, */
  });
  itBundled("tsconfig/WithStatementStrictTrueAlwaysStrictFalse", {
    // GENERATED
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
  });
  itBundled("tsconfig/AlwaysStrictTrueEmitDirectivePassThrough", {
    // GENERATED
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
  });
  itBundled("tsconfig/AlwaysStrictTrueEmitDirectiveFormat", {
    // GENERATED
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
  });
  itBundled("tsconfig/AlwaysStrictTrueEmitDirectiveBundleIIFE", {
    // GENERATED
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
  });
  itBundled("tsconfig/AlwaysStrictTrueEmitDirectiveBundleCJS", {
    // GENERATED
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
  });
  itBundled("tsconfig/AlwaysStrictTrueEmitDirectiveBundleESM", {
    // GENERATED
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
  });
  itBundled("tsconfig/ExtendsDotWithoutSlash", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/main.ts: ERROR: Big integer literals are not available in the configured target environment ("ES6")
  Users/user/project/src/tsconfig.json: NOTE: The target environment was set to "ES6" here:
  `, */
  });
  itBundled("tsconfig/ExtendsDotDotWithoutSlash", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/main.ts: ERROR: Big integer literals are not available in the configured target environment ("ES6")
  Users/user/project/tsconfig.json: NOTE: The target environment was set to "ES6" here:
  `, */
  });
  itBundled("tsconfig/ExtendsDotWithSlash", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/foo.json: WARNING: Cannot find base config file "./"
  `, */
  });
  itBundled("tsconfig/ExtendsDotDotWithSlash", {
    // GENERATED
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
    /* TODO FIX expectedScanLog: `Users/user/project/src/tsconfig.json: WARNING: Cannot find base config file "../"
  `, */
  });
});
