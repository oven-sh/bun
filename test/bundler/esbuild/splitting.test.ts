import assert from "assert";
import { readdirSync } from "fs";
import { itBundled, testForFile } from "../expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

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
    files: {
      "/entry.js": `import("./foo.js").then(({bar}) => console.log(bar))`,
      "/foo.js": `export let bar = 123`,
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
      "/empty.js": [`Import "missing" will always be undefined because the file "empty.js" has no exports`],
    },
  });
  itBundled("splitting/ReExportESBuildIssue273", {
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
    runtimeFiles: {
      "/test.js": /* js */ `
        import './out/c.js';
        const { getValue, setObserver } = globalThis.shared;
        function observer() {
          console.log('observer', getValue());
        }
        setObserver(observer);
        import('./out/a.js');
        import('./out/b.js');
      `,
    },
    run: [
      { file: "/out/a.js", stdout: "side effects! [Function]\nsetValue 123" },
      { file: "/out/b.js", stdout: "side effects! [Function]\nb" },
      { file: "/test.js", stdout: "side effects! [Function]\nsetValue 123\nobserver 123\nb" },
    ],
  });
  itBundled("splitting/CrossChunkAssignmentDependenciesRecursive", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        import { setX } from './x'
        setX()
      `,
      "/b.js": /* js */ `
        import { setZ } from './z'
        setZ()
      `,
      "/c.js": /* js */ `
        import { setX2 } from './x'
        import { setY2 } from './y'
        import { setZ2 } from './z'
        setX2();
        setY2();
        setZ2();
      `,
      "/x.js": /* js */ `
        let _x
        export function setX(v) { _x = v }
        export function setX2(v) { _x = v }
      `,
      "/y.js": /* js */ `
        import { setX } from './x'
        let _y
        export function setY(v) { _y = v }
        export function setY2(v) { setX(v); _y = v }
      `,
      "/z.js": /* js */ `
        import { setY } from './y'
        let _z
        export function setZ(v) { _z = v }
        export function setZ2(v) { setY(v); _z = v }
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
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
      { file: "/out/a.js", stdout: "[Function]" },
      { file: "/out/b.js", stdout: "[Function]" },
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
    publicPath: "/www",
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
    chunkNames: "[dir]/[name]-[hash].[ext]",
    onAfterBundle(api) {
      assert(
        readdirSync(api.outdir + "/output-path/should-contain/this-text").length === 1,
        "Expected one file in out/output-path/should-contain/this-text/",
      );
    },
  });
  itBundled("splitting/EdgeCaseESBuildIssue2793WithSplitting", {
    // GENERATED
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
  });
  itBundled("splitting/EdgeCaseESBuildIssue2793WithoutSplitting", {
    // GENERATED
    files: {
      "/src/a.js": `export const A = 42;`,
      "/src/b.js": `export const B = async () => (await import(".")).A`,
      "/src/index.js": /* js */ `
        export * from "./a"
        export * from "./b"
      `,
    },
    entryPoints: ["/src/index.js"],

    outdir: "/out",
  });
});
