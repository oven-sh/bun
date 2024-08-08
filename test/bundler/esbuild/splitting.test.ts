import assert from "assert";
import { readdirSync } from "fs";
import { itBundled, testForFile } from "../expectBundled";
import { describe, expect } from "bun:test";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_splitting_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/splitting

describe("bundler", () => {
  itBundled("splitting/SharedES6IntoES6", {
    files: {
      "/a.js": /* js */ `
        import {foo} from "./shared.js"
        console.log(foo)
      `,
      "/b.js": /* js */ `
        import {foo} from "./shared.js"
        console.log(foo)
      `,
      "/shared.js": `export let foo = 123`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    run: [
      { file: "/out/a.js", stdout: "123" },
      { file: "/out/b.js", stdout: "123" },
    ],
    assertNotPresent: {
      "/out/a.js": "123",
      "/out/b.js": "123",
    },
  });
  itBundled("splitting/SharedCommonJSIntoES6", {
    files: {
      "/a.js": /* js */ `
        const {foo} = require("./shared.js")
        console.log(foo)
      `,
      "/b.js": /* js */ `
        const {foo} = require("./shared.js")
        console.log(foo)
      `,
      "/shared.js": `exports.foo = 123`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    run: [
      { file: "/out/a.js", stdout: "123" },
      { file: "/out/b.js", stdout: "123" },
    ],
    assertNotPresent: {
      "/out/a.js": "123",
      "/out/b.js": "123",
    },
  });
  itBundled("splitting/DynamicES6IntoES6", {
    todo: true,
    files: {
      "/entry.js": `import("./foo.js").then(({bar}) => console.log(bar))`,
      "/foo.js": `export let bar = 123`,
    },
    splitting: true,
    outdir: "/out",
    assertNotPresent: {
      "/out/entry.js": "123",
    },
    onAfterBundle(api) {
      const files = readdirSync(api.outdir);
      assert.strictEqual(
        files.length,
        2,
        "should have 2 files: entry.js and foo-[hash].js, found [" + files.join(", ") + "]",
      );
      assert(files.includes("entry.js"), "has entry.js");
      assert(!files.includes("foo.js"), "does not have foo.js");
    },
    run: {
      file: "/out/entry.js",
      stdout: "123",
    },
  });
  itBundled("splitting/DynamicCommonJSIntoES6", {
    files: {
      "/entry.js": `import("./foo.js").then(({default: {bar}}) => console.log(bar))`,
      "/foo.js": `exports.bar = 123`,
    },
    splitting: true,
    outdir: "/out",
    assertNotPresent: {
      "/out/entry.js": "123",
    },
    run: {
      file: "/out/entry.js",
      stdout: "123",
    },
  });
  itBundled("splitting/DynamicAndNotDynamicES6IntoES6", {
    files: {
      "/entry.js": /* js */ `
        import {bar as a} from "./foo.js"
        import("./foo.js").then(({bar: b}) => console.log(a, b))
      `,
      "/foo.js": `export let bar = 123`,
    },
    splitting: true,
    outdir: "/out",
  });
  itBundled("splitting/DynamicAndNotDynamicCommonJSIntoES6", {
    skipOnEsbuild: true,
    files: {
      "/entry.js": /* js */ `
        import {bar as a} from "./foo.js"
        import("./foo.js").then(({default: {bar: b}}) => console.log(a, b))
      `,
      "/foo.js": `exports.bar = 123`,
    },
    outdir: "/out",
    splitting: true,
    run: {
      file: "/out/entry.js",
      stdout: "123 123",
    },
  });
  itBundled("splitting/AssignToLocal", {
    files: {
      "/a.js": /* js */ `
        import {foo, setFoo} from "./shared.js"
        setFoo(123)
        console.log(foo)
      `,
      "/b.js": /* js */ `
        import {foo} from "./shared.js"
        console.log(foo)
      `,
      "/shared.js": /* js */ `
        export let foo = 456
        export function setFoo(value) {
          foo = value
        }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    runtimeFiles: {
      "/test1.js": /* js */ `
        await import('./out/a.js')
        await import('./out/b.js')
      `,
      "/test2.js": /* js */ `
        await import('./out/b.js')
        await import('./out/a.js')
      `,
    },
    run: [
      { file: "/out/a.js", stdout: "123" },
      { file: "/out/b.js", stdout: "456" },
      { file: "/test1.js", stdout: "123\n123" },
      { file: "/test2.js", stdout: "456\n123" },
    ],
  });
  itBundled("splitting/SideEffectsWithoutDependencies", {
    files: {
      "/a.js": /* js */ `
        import {a} from "./shared.js"
        console.log(a)
      `,
      "/b.js": /* js */ `
        import {b} from "./shared.js"
        console.log(b)
      `,
      "/shared.js": /* js */ `
        export let a = 1
        export let b = 2
        console.log('side effect')
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    runtimeFiles: {
      "/test1.js": /* js */ `
        await import('./out/a.js')
        await import('./out/b.js')
      `,
      "/test2.js": /* js */ `
        await import('./out/b.js')
        await import('./out/a.js')
      `,
    },
    run: [
      { file: "/out/a.js", stdout: "side effect\n1" },
      { file: "/out/b.js", stdout: "side effect\n2" },
      { file: "/test1.js", stdout: "side effect\n1\n2" },
      { file: "/test2.js", stdout: "side effect\n2\n1" },
    ],
  });
  itBundled("splitting/NestedDirectories", {
    files: {
      "/Users/user/project/src/pages/pageA/page.js": /* js */ `
        import x from "../shared.js"
        console.log(x)
      `,
      "/Users/user/project/src/pages/pageB/page.js": /* js */ `
        import x from "../shared.js"
        console.log(-x)
      `,
      "/Users/user/project/src/pages/shared.js": `export default 123`,
    },
    entryPoints: ["/Users/user/project/src/pages/pageA/page.js", "/Users/user/project/src/pages/pageB/page.js"],
    outputPaths: ["/out/pageA/page.js", "/out/pageB/page.js"],
    splitting: true,

    run: [
      { file: "/out/pageA/page.js", stdout: "123" },
      { file: "/out/pageB/page.js", stdout: "-123" },
    ],
  });
  itBundled("splitting/CircularReferenceESBuildIssue251", {
    todo: true,
    files: {
      "/a.js": /* js */ `
        export * from './b.js';
        export var p = 5;
      `,
      "/b.js": /* js */ `
        export * from './a.js';
        export var q = 6;

        export function foo() {
          q = 7;
        }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,

    runtimeFiles: {
      "/test.js": /* js */ `
        import { p, q, foo } from './out/a.js';
        console.log(p, q)
        import { p as p2, q as q2, foo as foo2 } from './out/b.js';
        console.log(p2, q2)
        console.log(foo === foo2)
        foo();
        console.log(q, q2)
      `,
    },
    run: [{ file: "/test.js", stdout: "5 6\n5 6\ntrue\n7 7" }],
  });
  itBundled("splitting/MissingLazyExport", {
    files: {
      "/a.js": /* js */ `
        import {foo} from './common.js'
        console.log(JSON.stringify(foo()))
      `,
      "/b.js": /* js */ `
        import {bar} from './common.js'
        console.log(JSON.stringify(bar()))
      `,
      "/common.js": /* js */ `
        import * as ns from './empty.js'
        export function foo() { return [ns, ns.missing] }
        export function bar() { return [ns.missing] }
      `,
      "/empty.js": /* js */ `
        // This forces the module into ES6 mode without importing or exporting anything
        import.meta
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    run: [
      { file: "/out/a.js", stdout: "[{},null]" },
      { file: "/out/b.js", stdout: "[null]" },
    ],
    bundleWarnings: {
      "/common.js": [`Import "missing" will always be undefined because there is no matching export in "empty.js"`],
    },
  });
  itBundled("splitting/ReExportESBuildIssue273", {
    todo: true,
    files: {
      "/a.js": `export const a = { value: 1 }`,
      "/b.js": `export { a } from './a'`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    runtimeFiles: {
      "/test.js": /* js */ `
        import { a } from './out/a.js';
        import { a as a2 } from './out/b.js';
        console.log(a === a2, a.value, a2.value)
      `,
    },
    run: [{ file: "/test.js", stdout: "true 1 1" }],
  });
  itBundled("splitting/DynamicImportESBuildIssue272", {
    files: {
      "/a.js": `import('./b')`,
      "/b.js": `export default 1; console.log('imported')`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,

    run: [{ file: "/out/a.js", stdout: "imported" }],
    assertNotPresent: {
      "/out/a.js": "imported",
    },
  });
  itBundled("splitting/DynamicImportOutsideSourceTreeESBuildIssue264", {
    files: {
      "/Users/user/project/src/entry1.js": `import('package')`,
      "/Users/user/project/src/entry2.js": `import('package')`,
      "/Users/user/project/node_modules/package/index.js": `console.log('imported')`,
    },
    runtimeFiles: {
      "/both.js": /* js */ `
        import('./out/entry1.js');
        import('./out/entry2.js');
      `,
    },
    entryPoints: ["/Users/user/project/src/entry1.js", "/Users/user/project/src/entry2.js"],
    splitting: true,

    run: [
      { file: "/out/entry1.js", stdout: "imported" },
      { file: "/out/entry2.js", stdout: "imported" },
      { file: "/both.js", stdout: "imported" },
    ],
  });
  itBundled("splitting/CrossChunkAssignmentDependencies", {
    files: {
      "/a.js": /* js */ `
        import {setValue} from './shared'
        setValue(123)
      `,
      "/b.js": `import './shared'; console.log('b')`,
      "/c.js": /* js */ `
        import * as shared from './shared'
        globalThis.shared = shared;
      `,
      "/shared.js": /* js */ `
        var observer;
        var value;
        export function setObserver(cb) {
          observer = cb;
        }
        export function getValue() {
          return value;
        }
        export function setValue(next) {
          console.log('setValue', next)
          value = next;
          if (observer) observer();
        }
        console.log("side effects!", getValue);
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    target: "bun",
    runtimeFiles: {
      "/test.js": /* js */ `
        import './out/c.js';
        const { getValue, setObserver } = globalThis.shared;
        function observer() {
          console.log('observer', getValue());
        }
        setObserver(observer);
        await import('./out/a.js');
        await import('./out/b.js');
      `,
    },
    run: [
      { file: "/out/a.js", stdout: "side effects! [Function: getValue]\nsetValue 123" },
      { file: "/out/b.js", stdout: "side effects! [Function: getValue]\nb" },
      { file: "/test.js", stdout: "side effects! [Function: getValue]\nsetValue 123\nobserver 123\nb" },
    ],
  });
  itBundled("splitting/CrossChunkAssignmentDependenciesRecursive", {
    files: {
      "/a.js": /* js */ `
        import { setX } from './x'
        globalThis.a = { setX };
      `,
      "/b.js": /* js */ `
        import { setZ } from './z'
        globalThis.b = { setZ };
      `,
      "/c.js": /* js */ `
        import { setX2 } from './x'
        import { setY2 } from './y'
        import { setZ2 } from './z'
        globalThis.c = { setX2, setY2, setZ2 };
      `,
      "/x.js": /* js */ `
        let _x
        export function setX(v) { _x = v }
        export function setX2(v) { _x = v }
        globalThis.x = { setX, setX2 };
      `,
      "/y.js": /* js */ `
        import { setX } from './x'
        let _y
        export function setY(v) { _y = v }
        export function setY2(v) { setX(v); _y = v }
        globalThis.y = { setY, setY2 };
      `,
      "/z.js": /* js */ `
        import { setY } from './y'
        let _z
        export function setZ(v) { _z = v }
        export function setZ2(v) { setY(v); _z = v }
        globalThis.z = { setZ, setZ2, setY };
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,

    runtimeFiles: {
      "/test_all.js": /* js */ `
        import './out/a.js';
        import './out/b.js';
        import './out/c.js';
        try {
          a; b; c; x; y; z; // throw if not defined
        } catch (error) {
          throw new Error('chunks were not emitted right.')
        }
        import assert from 'assert';
        assert(a.setX === x.setX, 'a.setX');
        assert(b.setZ === z.setZ, 'b.setZ');
        assert(c.setX2 === x.setX2, 'c.setX2');
        assert(c.setY2 === y.setY2, 'c.setY2');
        assert(c.setZ2 === z.setZ2, 'c.setZ2');
        assert(z.setY === y.setY, 'z.setY');
      `,
      "/test_a_only.js": /* js */ `
        import './out/a.js';
        try {
          a; x; // throw if not defined
        } catch (error) {
          throw new Error('chunks were not emitted right.')
        }
        import assert from 'assert';
        assert(a.setX === x.setX, 'a.setX');
        assert(globalThis.b === undefined, 'b should not be loaded');
        assert(globalThis.c === undefined, 'c should not be loaded');
        assert(globalThis.y === undefined, 'y should not be loaded');
        assert(globalThis.z === undefined, 'z should not be loaded');
      `,
      "/test_b_only.js": /* js */ `
        import './out/b.js';
        try {
          b; x; y; z; // throw if not defined
        } catch (error) {
          throw new Error('chunks were not emitted right.')
        }
        import assert from 'assert';
        assert(globalThis.a === undefined, 'a should not be loaded');
        assert(globalThis.c === undefined, 'c should not be loaded');
      `,
      "/test_c_only.js": /* js */ `
        import './out/c.js';
        try {
          c; x; y; z; // throw if not defined
        } catch (error) {
          throw new Error('chunks were not emitted right.')
        }
        import assert from 'assert';
        assert(globalThis.a === undefined, 'a should not be loaded');
        assert(globalThis.b === undefined, 'b should not be loaded');
      `,
    },
    run: [
      { file: "/test_all.js" },
      { file: "/test_a_only.js" },
      { file: "/test_b_only.js" },
      { file: "/test_c_only.js" },
    ],
  });
  itBundled("splitting/DuplicateChunkCollision", {
    files: {
      "/a.js": `import "./ab"`,
      "/b.js": `import "./ab"`,
      "/c.js": `import "./cd"`,
      "/d.js": `import "./cd"`,
      "/ab.js": `console.log(123)`,
      "/cd.js": `console.log(123)`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js", "/d.js"],
    splitting: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      const files = readdirSync(api.outdir);
      expect(files.length).toBe(6);
    },
  });
  itBundled("splitting/MinifyIdentifiersCrashESBuildIssue437", {
    files: {
      "/a.js": /* js */ `
        import {foo} from "./shared"
        console.log(foo)
      `,
      "/b.js": /* js */ `
        import {foo} from "./shared"
        console.log(foo)
      `,
      "/c.js": `import "./shared"`,
      "/shared.js": `export function foo(bar) {}`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    minifyIdentifiers: true,
    run: [
      { file: "/out/a.js", stdout: "[Function: f]" },
      { file: "/out/b.js", stdout: "[Function: f]" },
    ],
  });
  itBundled("splitting/HybridESMAndCJSESBuildIssue617", {
    files: {
      "/a.js": `export let foo = 123`,
      "/b.js": `export let bar = require('./a')`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    assertNotPresent: {
      "/out/b.js": `123`,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import { foo } from './out/a.js'
        import { bar } from './out/b.js'
        console.log(JSON.stringify({ foo, bar }))
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"foo":123,"bar":{"foo":123}}',
    },
  });
  itBundled("splitting/PublicPathEntryName", {
    files: {
      "/a.js": `import("./b")`,
      "/b.js": `console.log('b')`,
    },
    outdir: "/out",
    splitting: true,
    publicPath: "/www/",
    onAfterBundle(api) {
      const t = new Bun.Transpiler();
      const imports = t.scanImports(api.readFile("/out/a.js"));
      expect(imports.length).toBe(1);
      expect(imports[0].kind).toBe("dynamic-import");
      assert(imports[0].path.startsWith("/www/"), `Expected path to start with "/www/" but got "${imports[0].path}"`);
    },
  });
  itBundled("splitting/ChunkPathDirPlaceholderImplicitOutbase", {
    files: {
      "/project/entry.js": `console.log(import('./output-path/should-contain/this-text/file'))`,
      "/project/output-path/should-contain/this-text/file.js": `console.log('file.js')`,
    },
    outdir: "/out",
    splitting: true,
    chunkNaming: "[dir]/[name]-[hash].[ext]",
    onAfterBundle(api) {
      assert(
        readdirSync(api.outdir + "/output-path/should-contain/this-text").length === 1,
        "Expected one file in out/output-path/should-contain/this-text/",
      );
    },
  });
  const EdgeCaseESBuildIssue2793WithSplitting = itBundled("splitting/EdgeCaseESBuildIssue2793WithSplitting", {
    files: {
      "/src/a.js": `export const A = 42;`,
      "/src/b.js": `export const B = async () => (await import(".")).A`,
      "/src/index.js": /* js */ `
        export * from "./a"
        export * from "./b"
      `,
    },
    outdir: "/out",
    entryPoints: ["/src/index.js"],
    splitting: true,
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        import { A, B } from './out/index.js'
        console.log(A, B() instanceof Promise, await B())
      `,
    },
    run: {
      file: "/test.js",
      stdout: "42 true 42",
    },
  });
  itBundled("splitting/EdgeCaseESBuildIssue2793WithoutSplitting", {
    ...EdgeCaseESBuildIssue2793WithSplitting.options,
    splitting: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import { A, B } from './out/index.js'
        console.log(A, B() instanceof Promise, await B())
      `,
    },
    run: {
      file: "/test.js",
      stdout: "42 true 42",
    },
  });
});
