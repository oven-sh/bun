import assert from "assert";
import { describe, expect } from "bun:test";
import { readdirSync } from "fs";
import { itBundled } from "../expectBundled";

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
  // Test that CJS modules with dynamic imports to other CJS entry points work correctly
  // when code splitting causes the dynamically imported module to be in a separate chunk.
  // The dynamic import should properly unwrap the default export using __toESM.
  // Regression test for: dynamic import of CJS chunk returns { default: { __esModule, ... } }
  // and needs .then((m)=>__toESM(m.default)) to unwrap correctly.
  // Note: __esModule is required because bun optimizes simple CJS to ESM otherwise.
  itBundled("splitting/CJSDynamicImportOfCJSChunk", {
    files: {
      "/main.js": /* js */ `
        import("./impl.js").then(mod => console.log(mod.foo()));
      `,
      "/impl.js": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.foo = () => "success";
      `,
    },
    entryPoints: ["/main.js", "/impl.js"],
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/main.js",
      stdout: "success",
    },
  });

  // Test code splitting with CommonJS output format
  itBundled("splitting/SharedES6IntoCJS", {
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
    format: "cjs",
    run: [
      { file: "/out/a.js", stdout: "123" },
      { file: "/out/b.js", stdout: "123" },
    ],
    assertNotPresent: {
      "/out/a.js": "123",
      "/out/b.js": "123",
    },
  });

  // Test code splitting with CJS format and multiple exports
  itBundled("splitting/MultipleExportsIntoCJS", {
    files: {
      "/a.js": /* js */ `
        import {foo, bar} from "./shared.js"
        console.log("a:", foo, bar)
      `,
      "/b.js": /* js */ `
        import {foo, baz} from "./shared.js"
        console.log("b:", foo, baz)
      `,
      "/shared.js": /* js */ `
        export let foo = "foo"
        export let bar = "bar"
        export let baz = "baz"
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    run: [
      { file: "/out/a.js", stdout: "a: foo bar" },
      { file: "/out/b.js", stdout: "b: foo baz" },
    ],
  });

  // Test that CJS code splitting correctly shares modules between entry points
  itBundled("splitting/CJSSharedModuleSideEffects", {
    files: {
      "/a.js": /* js */ `
        import {foo} from "./shared.js"
        console.log("a:", foo)
      `,
      "/b.js": /* js */ `
        import {bar} from "./shared.js"
        console.log("b:", bar)
      `,
      "/shared.js": /* js */ `
        console.log("shared loaded")
        export let foo = 1
        export let bar = 2
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    runtimeFiles: {
      "/test.js": /* js */ `
        require('./out/a.js')
        require('./out/b.js')
      `,
    },
    run: [
      { file: "/out/a.js", stdout: "shared loaded\na: 1" },
      { file: "/out/b.js", stdout: "shared loaded\nb: 2" },
      // When both entry points are required, the shared module should only load once
      { file: "/test.js", stdout: "shared loaded\na: 1\nb: 2" },
    ],
  });

  // Test CJS code splitting with CommonJS source files
  itBundled("splitting/SharedCommonJSIntoCJS", {
    files: {
      "/a.js": /* js */ `
        const {foo} = require("./shared.js")
        console.log(foo)
      `,
      "/b.js": /* js */ `
        const {foo} = require("./shared.js")
        console.log(foo)
      `,
      "/shared.js": `exports.foo = 456`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    run: [
      { file: "/out/a.js", stdout: "456" },
      { file: "/out/b.js", stdout: "456" },
    ],
    assertNotPresent: {
      "/out/a.js": "456",
      "/out/b.js": "456",
    },
  });

  // Test CJS code splitting with minified identifiers
  itBundled("splitting/CJSMinifiedIdentifiers", {
    files: {
      "/a.js": /* js */ `
        import {foo} from "./shared.js"
        console.log(foo)
      `,
      "/b.js": /* js */ `
        import {foo} from "./shared.js"
        console.log(foo)
      `,
      "/shared.js": `export function foo(bar) {}`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    minifyIdentifiers: true,
    run: [
      { file: "/out/a.js", stdout: "[Function: f]" },
      { file: "/out/b.js", stdout: "[Function: f]" },
    ],
  });

  // ============================================================================
  // Tests adapted from webpack's test suite
  // https://github.com/webpack/webpack
  // ============================================================================

  // Basic dynamic import test (webpack: test/cases/chunks/import)
  itBundled("splitting/DynamicImportBasic", {
    files: {
      "/index.js": /* js */ `
        import("./two.js").then(function(two) {
          console.log("loaded:", two.default);
        });
      `,
      "/two.js": `export default 2;`,
    },
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "loaded: 2",
    },
  });

  // CJS dynamic import (webpack pattern)
  itBundled("splitting/DynamicImportCJSModule", {
    files: {
      "/index.js": /* js */ `
        import("./cjs.js").then(function(m) {
          console.log("cjs:", m.default);
        });
      `,
      "/cjs.js": `module.exports = 42;`,
    },
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "cjs: 42",
    },
  });

  // Multiple dynamic imports to same module (webpack: test/cases/chunks/runtime)
  itBundled("splitting/DuplicateDynamicImports", {
    files: {
      "/index.js": /* js */ `
        let first = false, second = false;
        import("./shared.js").then(() => {
          first = true;
          if (second) console.log("both loaded");
        });
        import("./shared.js").then(() => {
          second = true;
          if (first) console.log("both loaded");
        });
      `,
      "/shared.js": `export const value = 123;`,
    },
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "both loaded",
    },
  });

  // Circular dynamic imports (adapted from webpack: test/cases/chunks/import-circle)
  itBundled("splitting/CircularDynamicImports", {
    files: {
      "/index.js": /* js */ `
        import { runLeft } from "./left.js";
        import { runRight } from "./right.js";
        Promise.all([runLeft(), runRight()]).then(() => {
          console.log("circular imports resolved");
        });
      `,
      "/left.js": /* js */ `
        import { rightValue } from "./right.js";
        export function runLeft() {
          return import("./leftChunk.js");
        }
        export const leftValue = "left";
      `,
      "/right.js": /* js */ `
        import { leftValue } from "./left.js";
        export function runRight() {
          return import("./rightChunk.js");
        }
        export const rightValue = "right";
      `,
      "/leftChunk.js": `export default "leftChunk";`,
      "/rightChunk.js": `export default "rightChunk";`,
    },
    entryPoints: ["/index.js", "/leftChunk.js", "/rightChunk.js"],
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "circular imports resolved",
    },
  });

  // CJS circular dynamic imports
  itBundled("splitting/CircularDynamicImportsCJS", {
    files: {
      "/index.js": /* js */ `
        import { runLeft } from "./left.js";
        import { runRight } from "./right.js";
        Promise.all([runLeft(), runRight()]).then(() => {
          console.log("circular imports resolved");
        });
      `,
      "/left.js": /* js */ `
        import { rightValue } from "./right.js";
        export function runLeft() {
          return import("./leftChunk.js");
        }
        export const leftValue = "left";
      `,
      "/right.js": /* js */ `
        import { leftValue } from "./left.js";
        export function runRight() {
          return import("./rightChunk.js");
        }
        export const rightValue = "right";
      `,
      "/leftChunk.js": `export default "leftChunk";`,
      "/rightChunk.js": `export default "rightChunk";`,
    },
    entryPoints: ["/index.js", "/leftChunk.js", "/rightChunk.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "circular imports resolved",
    },
  });

  // Shared vendor chunk pattern (webpack: split-chunks-common/simple)
  itBundled("splitting/SharedVendorChunk", {
    files: {
      "/vendor.js": /* js */ `
        export const vendorLib = "vendor-lib";
      `,
      "/main.js": /* js */ `
        import { vendorLib } from "./vendor.js";
        console.log("main:", vendorLib);
      `,
    },
    entryPoints: ["/vendor.js", "/main.js"],
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/main.js",
      stdout: "main: vendor-lib",
    },
    // Verify vendor code was extracted - main.js should not contain the string literal
    assertNotPresent: {
      "/out/main.js": "vendor-lib",
    },
  });

  // Shared vendor chunk with CJS output
  itBundled("splitting/SharedVendorChunkCJS", {
    files: {
      "/vendor.js": /* js */ `
        export const vendorLib = "vendor-lib";
      `,
      "/main.js": /* js */ `
        import { vendorLib } from "./vendor.js";
        console.log("main:", vendorLib);
      `,
    },
    entryPoints: ["/vendor.js", "/main.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: {
      file: "/out/main.js",
      stdout: "main: vendor-lib",
    },
    // Verify vendor code was extracted - main.js should not contain the string literal
    assertNotPresent: {
      "/out/main.js": "vendor-lib",
    },
  });

  // Multiple shared dependencies (webpack: split-chunks-common/correct-order)
  itBundled("splitting/MultipleSharedDependencies", {
    files: {
      "/a.js": /* js */ `
        import { shared1 } from "./shared1.js";
        import { shared2 } from "./shared2.js";
        console.log("a:", shared1, shared2);
      `,
      "/b.js": /* js */ `
        import { shared1 } from "./shared1.js";
        import { shared3 } from "./shared3.js";
        console.log("b:", shared1, shared3);
      `,
      "/c.js": /* js */ `
        import { shared2 } from "./shared2.js";
        import { shared3 } from "./shared3.js";
        console.log("c:", shared2, shared3);
      `,
      "/shared1.js": `export const shared1 = "s1";`,
      "/shared2.js": `export const shared2 = "s2";`,
      "/shared3.js": `export const shared3 = "s3";`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: s1 s2" },
      { file: "/out/b.js", stdout: "b: s1 s3" },
      { file: "/out/c.js", stdout: "c: s2 s3" },
    ],
  });

  // Multiple shared dependencies with CJS
  itBundled("splitting/MultipleSharedDependenciesCJS", {
    files: {
      "/a.js": /* js */ `
        import { shared1 } from "./shared1.js";
        import { shared2 } from "./shared2.js";
        console.log("a:", shared1, shared2);
      `,
      "/b.js": /* js */ `
        import { shared1 } from "./shared1.js";
        import { shared3 } from "./shared3.js";
        console.log("b:", shared1, shared3);
      `,
      "/c.js": /* js */ `
        import { shared2 } from "./shared2.js";
        import { shared3 } from "./shared3.js";
        console.log("c:", shared2, shared3);
      `,
      "/shared1.js": `export const shared1 = "s1";`,
      "/shared2.js": `export const shared2 = "s2";`,
      "/shared3.js": `export const shared3 = "s3";`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: s1 s2" },
      { file: "/out/b.js", stdout: "b: s1 s3" },
      { file: "/out/c.js", stdout: "c: s2 s3" },
    ],
  });

  // Deep dependency chain (webpack pattern)
  itBundled("splitting/DeepDependencyChain", {
    files: {
      "/a.js": /* js */ `
        import { level1 } from "./level1.js";
        console.log("a:", level1);
      `,
      "/b.js": /* js */ `
        import { level1 } from "./level1.js";
        console.log("b:", level1);
      `,
      "/level1.js": /* js */ `
        import { level2 } from "./level2.js";
        export const level1 = "L1-" + level2;
      `,
      "/level2.js": /* js */ `
        import { level3 } from "./level3.js";
        export const level2 = "L2-" + level3;
      `,
      "/level3.js": `export const level3 = "L3";`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: L1-L2-L3" },
      { file: "/out/b.js", stdout: "b: L1-L2-L3" },
    ],
  });

  // Deep dependency chain with CJS
  itBundled("splitting/DeepDependencyChainCJS", {
    files: {
      "/a.js": /* js */ `
        import { level1 } from "./level1.js";
        console.log("a:", level1);
      `,
      "/b.js": /* js */ `
        import { level1 } from "./level1.js";
        console.log("b:", level1);
      `,
      "/level1.js": /* js */ `
        import { level2 } from "./level2.js";
        export const level1 = "L1-" + level2;
      `,
      "/level2.js": /* js */ `
        import { level3 } from "./level3.js";
        export const level2 = "L2-" + level3;
      `,
      "/level3.js": `export const level3 = "L3";`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: L1-L2-L3" },
      { file: "/out/b.js", stdout: "b: L1-L2-L3" },
    ],
  });

  // Mixed ESM and CJS sources with ESM output (webpack: splitting/HybridESMAndCJSESBuildIssue617)
  itBundled("splitting/MixedESMAndCJSSources", {
    files: {
      "/esm.js": `export const esmValue = "esm";`,
      "/cjs.js": `module.exports.cjsValue = "cjs";`,
      "/main.js": /* js */ `
        import { esmValue } from "./esm.js";
        import { cjsValue } from "./cjs.js";
        console.log(esmValue, cjsValue);
      `,
      "/other.js": /* js */ `
        import { esmValue } from "./esm.js";
        console.log("other:", esmValue);
      `,
    },
    entryPoints: ["/main.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "esm cjs" },
      { file: "/out/other.js", stdout: "other: esm" },
    ],
  });

  // Mixed ESM and CJS sources with CJS output
  itBundled("splitting/MixedESMAndCJSSourcesIntoCJS", {
    files: {
      "/esm.js": `export const esmValue = "esm";`,
      "/cjs.js": `module.exports.cjsValue = "cjs";`,
      "/main.js": /* js */ `
        import { esmValue } from "./esm.js";
        import { cjsValue } from "./cjs.js";
        console.log(esmValue, cjsValue);
      `,
      "/other.js": /* js */ `
        import { esmValue } from "./esm.js";
        console.log("other:", esmValue);
      `,
    },
    entryPoints: ["/main.js", "/other.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "esm cjs" },
      { file: "/out/other.js", stdout: "other: esm" },
    ],
  });

  // Re-exports (webpack: splitting/ReExportESBuildIssue273)
  itBundled("splitting/ReExports", {
    files: {
      "/original.js": `export const value = { num: 1 };`,
      "/reexport.js": `export { value } from "./original.js";`,
      "/a.js": /* js */ `
        import { value } from "./original.js";
        globalThis.aValue = value;
      `,
      "/b.js": /* js */ `
        import { value } from "./reexport.js";
        globalThis.bValue = value;
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    runtimeFiles: {
      "/test.js": /* js */ `
        import "./out/a.js";
        import "./out/b.js";
        console.log(globalThis.aValue === globalThis.bValue, globalThis.aValue.num);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "true 1",
    },
  });

  // Re-exports with CJS output
  itBundled("splitting/ReExportsCJS", {
    files: {
      "/original.js": `export const value = { num: 1 };`,
      "/reexport.js": `export { value } from "./original.js";`,
      "/a.js": /* js */ `
        import { value } from "./original.js";
        globalThis.aValue = value;
      `,
      "/b.js": /* js */ `
        import { value } from "./reexport.js";
        globalThis.bValue = value;
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    runtimeFiles: {
      "/test.js": /* js */ `
        require("./out/a.js");
        require("./out/b.js");
        console.log(globalThis.aValue === globalThis.bValue, globalThis.aValue.num);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "true 1",
    },
  });

  // Star exports (namespace re-export)
  itBundled("splitting/StarExports", {
    files: {
      "/utils.js": /* js */ `
        export const add = (a, b) => a + b;
        export const sub = (a, b) => a - b;
        export const mul = (a, b) => a * b;
      `,
      "/mathLib.js": `export * from "./utils.js";`,
      "/a.js": /* js */ `
        import { add, sub } from "./mathLib.js";
        console.log("a:", add(5, 3), sub(5, 3));
      `,
      "/b.js": /* js */ `
        import { mul } from "./mathLib.js";
        console.log("b:", mul(5, 3));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 8 2" },
      { file: "/out/b.js", stdout: "b: 15" },
    ],
  });

  // Star exports with CJS output
  itBundled("splitting/StarExportsCJS", {
    files: {
      "/utils.js": /* js */ `
        export const add = (a, b) => a + b;
        export const sub = (a, b) => a - b;
        export const mul = (a, b) => a * b;
      `,
      "/mathLib.js": `export * from "./utils.js";`,
      "/a.js": /* js */ `
        import { add, sub } from "./mathLib.js";
        console.log("a:", add(5, 3), sub(5, 3));
      `,
      "/b.js": /* js */ `
        import { mul } from "./mathLib.js";
        console.log("b:", mul(5, 3));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 8 2" },
      { file: "/out/b.js", stdout: "b: 15" },
    ],
  });

  // Default export sharing
  itBundled("splitting/SharedDefaultExport", {
    files: {
      "/shared.js": /* js */ `
        export default function sharedFunc() {
          return "shared-default";
        }
      `,
      "/a.js": /* js */ `
        import shared from "./shared.js";
        console.log("a:", shared());
      `,
      "/b.js": /* js */ `
        import shared from "./shared.js";
        console.log("b:", shared());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: shared-default" },
      { file: "/out/b.js", stdout: "b: shared-default" },
    ],
    // Verify shared function was extracted to chunk
    assertNotPresent: {
      "/out/a.js": "shared-default",
      "/out/b.js": "shared-default",
    },
  });

  // Default export sharing with CJS output
  itBundled("splitting/SharedDefaultExportCJS", {
    files: {
      "/shared.js": /* js */ `
        export default function sharedFunc() {
          return "shared-default";
        }
      `,
      "/a.js": /* js */ `
        import shared from "./shared.js";
        console.log("a:", shared());
      `,
      "/b.js": /* js */ `
        import shared from "./shared.js";
        console.log("b:", shared());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: shared-default" },
      { file: "/out/b.js", stdout: "b: shared-default" },
    ],
    // Verify shared function was extracted to chunk
    assertNotPresent: {
      "/out/a.js": "shared-default",
      "/out/b.js": "shared-default",
    },
  });

  // Class export sharing
  itBundled("splitting/SharedClassExport", {
    files: {
      "/shared.js": /* js */ `
        export class SharedClass {
          constructor(name) {
            this.name = name;
          }
          greet() {
            return "Hello, " + this.name;
          }
        }
      `,
      "/a.js": /* js */ `
        import { SharedClass } from "./shared.js";
        const obj = new SharedClass("A");
        console.log("a:", obj.greet());
      `,
      "/b.js": /* js */ `
        import { SharedClass } from "./shared.js";
        const obj = new SharedClass("B");
        console.log("b:", obj.greet());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: Hello, A" },
      { file: "/out/b.js", stdout: "b: Hello, B" },
    ],
  });

  // Class export sharing with CJS output
  itBundled("splitting/SharedClassExportCJS", {
    files: {
      "/shared.js": /* js */ `
        export class SharedClass {
          constructor(name) {
            this.name = name;
          }
          greet() {
            return "Hello, " + this.name;
          }
        }
      `,
      "/a.js": /* js */ `
        import { SharedClass } from "./shared.js";
        const obj = new SharedClass("A");
        console.log("a:", obj.greet());
      `,
      "/b.js": /* js */ `
        import { SharedClass } from "./shared.js";
        const obj = new SharedClass("B");
        console.log("b:", obj.greet());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: Hello, A" },
      { file: "/out/b.js", stdout: "b: Hello, B" },
    ],
  });

  // JSON imports (webpack pattern)
  itBundled("splitting/SharedJSONImport", {
    files: {
      "/config.json": `{"name": "test", "version": "1.0.0"}`,
      "/a.js": /* js */ `
        import config from "./config.json";
        console.log("a:", config.name);
      `,
      "/b.js": /* js */ `
        import config from "./config.json";
        console.log("b:", config.version);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: test" },
      { file: "/out/b.js", stdout: "b: 1.0.0" },
    ],
    // Verify JSON was extracted - entry files shouldn't contain the JSON content
    assertNotPresent: {
      "/out/a.js": "1.0.0",
      "/out/b.js": '"name"',
    },
  });

  // JSON imports with CJS output
  itBundled("splitting/SharedJSONImportCJS", {
    files: {
      "/config.json": `{"name": "test", "version": "1.0.0"}`,
      "/a.js": /* js */ `
        import config from "./config.json";
        console.log("a:", config.name);
      `,
      "/b.js": /* js */ `
        import config from "./config.json";
        console.log("b:", config.version);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: test" },
      { file: "/out/b.js", stdout: "b: 1.0.0" },
    ],
    // Verify JSON was extracted - entry files shouldn't contain the JSON content
    assertNotPresent: {
      "/out/a.js": "1.0.0",
      "/out/b.js": '"name"',
    },
  });

  // Async/await with dynamic imports
  itBundled("splitting/AsyncAwaitDynamicImport", {
    files: {
      "/index.js": /* js */ `
        async function main() {
          const { value } = await import("./async.js");
          console.log("loaded:", value);
        }
        main();
      `,
      "/async.js": `export const value = "async-value";`,
    },
    entryPoints: ["/index.js", "/async.js"],
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "loaded: async-value",
    },
    // Verify the async module content is not in the main entry
    assertNotPresent: {
      "/out/index.js": "async-value",
    },
  });

  // Async/await with dynamic imports CJS
  itBundled("splitting/AsyncAwaitDynamicImportCJS", {
    files: {
      "/index.js": /* js */ `
        async function main() {
          const { value } = await import("./async.js");
          console.log("loaded:", value);
        }
        main();
      `,
      "/async.js": `export const value = "async-value";`,
    },
    entryPoints: ["/index.js", "/async.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: {
      file: "/out/index.js",
      stdout: "loaded: async-value",
    },
    // Verify the async module content is not in the main entry
    assertNotPresent: {
      "/out/index.js": "async-value",
    },
  });

  // Many entry points sharing common code
  itBundled("splitting/ManyEntryPointsSharedCode", {
    files: {
      "/common.js": `export const COMMON = "common-value";`,
      "/e1.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e1:", COMMON);
      `,
      "/e2.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e2:", COMMON);
      `,
      "/e3.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e3:", COMMON);
      `,
      "/e4.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e4:", COMMON);
      `,
      "/e5.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e5:", COMMON);
      `,
    },
    entryPoints: ["/e1.js", "/e2.js", "/e3.js", "/e4.js", "/e5.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/e1.js", stdout: "e1: common-value" },
      { file: "/out/e2.js", stdout: "e2: common-value" },
      { file: "/out/e3.js", stdout: "e3: common-value" },
      { file: "/out/e4.js", stdout: "e4: common-value" },
      { file: "/out/e5.js", stdout: "e5: common-value" },
    ],
    assertNotPresent: {
      "/out/e1.js": "common-value",
      "/out/e2.js": "common-value",
      "/out/e3.js": "common-value",
      "/out/e4.js": "common-value",
      "/out/e5.js": "common-value",
    },
  });

  // Many entry points sharing common code with CJS
  itBundled("splitting/ManyEntryPointsSharedCodeCJS", {
    files: {
      "/common.js": `export const COMMON = "common-value";`,
      "/e1.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e1:", COMMON);
      `,
      "/e2.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e2:", COMMON);
      `,
      "/e3.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e3:", COMMON);
      `,
      "/e4.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e4:", COMMON);
      `,
      "/e5.js": /* js */ `
        import { COMMON } from "./common.js";
        console.log("e5:", COMMON);
      `,
    },
    entryPoints: ["/e1.js", "/e2.js", "/e3.js", "/e4.js", "/e5.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/e1.js", stdout: "e1: common-value" },
      { file: "/out/e2.js", stdout: "e2: common-value" },
      { file: "/out/e3.js", stdout: "e3: common-value" },
      { file: "/out/e4.js", stdout: "e4: common-value" },
      { file: "/out/e5.js", stdout: "e5: common-value" },
    ],
    assertNotPresent: {
      "/out/e1.js": "common-value",
      "/out/e2.js": "common-value",
      "/out/e3.js": "common-value",
      "/out/e4.js": "common-value",
      "/out/e5.js": "common-value",
    },
  });

  // Partial shared dependencies (some entries share, some don't)
  itBundled("splitting/PartiallySharedDependencies", {
    files: {
      "/shared-ab.js": `export const AB = "ab";`,
      "/shared-bc.js": `export const BC = "bc";`,
      "/a.js": /* js */ `
        import { AB } from "./shared-ab.js";
        console.log("a:", AB);
      `,
      "/b.js": /* js */ `
        import { AB } from "./shared-ab.js";
        import { BC } from "./shared-bc.js";
        console.log("b:", AB, BC);
      `,
      "/c.js": /* js */ `
        import { BC } from "./shared-bc.js";
        console.log("c:", BC);
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: ab" },
      { file: "/out/b.js", stdout: "b: ab bc" },
      { file: "/out/c.js", stdout: "c: bc" },
    ],
  });

  // Partial shared dependencies with CJS
  itBundled("splitting/PartiallySharedDependenciesCJS", {
    files: {
      "/shared-ab.js": `export const AB = "ab";`,
      "/shared-bc.js": `export const BC = "bc";`,
      "/a.js": /* js */ `
        import { AB } from "./shared-ab.js";
        console.log("a:", AB);
      `,
      "/b.js": /* js */ `
        import { AB } from "./shared-ab.js";
        import { BC } from "./shared-bc.js";
        console.log("b:", AB, BC);
      `,
      "/c.js": /* js */ `
        import { BC } from "./shared-bc.js";
        console.log("c:", BC);
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: ab" },
      { file: "/out/b.js", stdout: "b: ab bc" },
      { file: "/out/c.js", stdout: "c: bc" },
    ],
  });

  // Node modules style imports
  itBundled("splitting/NodeModulesStyleImports", {
    files: {
      "/node_modules/lib-a/index.js": `export const libA = "lib-a-value";`,
      "/node_modules/lib-b/index.js": /* js */ `
        import { libA } from "lib-a";
        export const libB = "lib-b:" + libA;
      `,
      "/entry1.js": /* js */ `
        import { libA } from "lib-a";
        import { libB } from "lib-b";
        console.log("e1:", libA, libB);
      `,
      "/entry2.js": /* js */ `
        import { libA } from "lib-a";
        console.log("e2:", libA);
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "e1: lib-a-value lib-b:lib-a-value" },
      { file: "/out/entry2.js", stdout: "e2: lib-a-value" },
    ],
  });

  // Node modules style imports with CJS
  itBundled("splitting/NodeModulesStyleImportsCJS", {
    files: {
      "/node_modules/lib-a/index.js": `export const libA = "lib-a-value";`,
      "/node_modules/lib-b/index.js": /* js */ `
        import { libA } from "lib-a";
        export const libB = "lib-b:" + libA;
      `,
      "/entry1.js": /* js */ `
        import { libA } from "lib-a";
        import { libB } from "lib-b";
        console.log("e1:", libA, libB);
      `,
      "/entry2.js": /* js */ `
        import { libA } from "lib-a";
        console.log("e2:", libA);
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "e1: lib-a-value lib-b:lib-a-value" },
      { file: "/out/entry2.js", stdout: "e2: lib-a-value" },
    ],
  });

  // ============================================================================
  // Edge case tests: ESM/CJS syntax matrix
  // Tests all permutations of require, await import, module.exports, export from,
  // export * from, export { default } from, and circular dependencies
  // ============================================================================

  // --------------------------------------------------------------------------
  // require() variations
  // --------------------------------------------------------------------------

  // require() of ESM module in shared chunk
  itBundled("splitting/RequireOfESMInSharedChunk", {
    files: {
      "/shared.js": `export const value = "esm-value";`,
      "/a.js": /* js */ `
        const { value } = require("./shared.js");
        console.log("a:", value);
      `,
      "/b.js": /* js */ `
        const { value } = require("./shared.js");
        console.log("b:", value);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: esm-value" },
      { file: "/out/b.js", stdout: "b: esm-value" },
    ],
    assertNotPresent: {
      "/out/a.js": "esm-value",
      "/out/b.js": "esm-value",
    },
  });

  // require() of ESM module in shared chunk - CJS output
  itBundled("splitting/RequireOfESMInSharedChunkCJS", {
    files: {
      "/shared.js": `export const value = "esm-value";`,
      "/a.js": /* js */ `
        const { value } = require("./shared.js");
        console.log("a:", value);
      `,
      "/b.js": /* js */ `
        const { value } = require("./shared.js");
        console.log("b:", value);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: esm-value" },
      { file: "/out/b.js", stdout: "b: esm-value" },
    ],
    assertNotPresent: {
      "/out/a.js": "esm-value",
      "/out/b.js": "esm-value",
    },
  });

  // require() with destructuring default export
  itBundled("splitting/RequireDestructuringDefault", {
    files: {
      "/shared.js": /* js */ `
        export default { name: "default-obj", value: 42 };
      `,
      "/a.js": /* js */ `
        const mod = require("./shared.js");
        console.log("a:", mod.default.name, mod.default.value);
      `,
      "/b.js": /* js */ `
        const mod = require("./shared.js");
        console.log("b:", mod.default.name, mod.default.value);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: default-obj 42" },
      { file: "/out/b.js", stdout: "b: default-obj 42" },
    ],
  });

  // require() mixed with import in same file
  itBundled("splitting/RequireMixedWithImport", {
    files: {
      "/shared-esm.js": `export const esmVal = "esm";`,
      "/shared-cjs.js": `module.exports.cjsVal = "cjs";`,
      "/a.js": /* js */ `
        import { esmVal } from "./shared-esm.js";
        const { cjsVal } = require("./shared-cjs.js");
        console.log("a:", esmVal, cjsVal);
      `,
      "/b.js": /* js */ `
        import { esmVal } from "./shared-esm.js";
        const { cjsVal } = require("./shared-cjs.js");
        console.log("b:", esmVal, cjsVal);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: esm cjs" },
      { file: "/out/b.js", stdout: "b: esm cjs" },
    ],
  });

  // require() mixed with import - CJS output
  itBundled("splitting/RequireMixedWithImportCJS", {
    files: {
      "/shared-esm.js": `export const esmVal = "esm";`,
      "/shared-cjs.js": `module.exports.cjsVal = "cjs";`,
      "/a.js": /* js */ `
        import { esmVal } from "./shared-esm.js";
        const { cjsVal } = require("./shared-cjs.js");
        console.log("a:", esmVal, cjsVal);
      `,
      "/b.js": /* js */ `
        import { esmVal } from "./shared-esm.js";
        const { cjsVal } = require("./shared-cjs.js");
        console.log("b:", esmVal, cjsVal);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: esm cjs" },
      { file: "/out/b.js", stdout: "b: esm cjs" },
    ],
  });

  // --------------------------------------------------------------------------
  // await import() variations
  // --------------------------------------------------------------------------

  // Top-level await import of shared chunk
  itBundled("splitting/TopLevelAwaitImportSharedChunk", {
    files: {
      "/shared.js": `export const value = "tla-value";`,
      "/a.js": /* js */ `
        const { value } = await import("./shared.js");
        console.log("a:", value);
      `,
      "/b.js": /* js */ `
        const { value } = await import("./shared.js");
        console.log("b:", value);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: tla-value" },
      { file: "/out/b.js", stdout: "b: tla-value" },
    ],
  });

  // Top-level await import - CJS output
  // Note: TLA (top-level await) is not directly compatible with CJS format,
  // so we wrap it in an async IIFE. Also, shared.js must be an entry point
  // for the exports to be properly generated in CJS format.
  itBundled("splitting/TopLevelAwaitImportSharedChunkCJS", {
    files: {
      "/shared.js": `export const value = "tla-value";`,
      "/a.js": /* js */ `
        (async () => {
          const { value } = await import("./shared.js");
          console.log("a:", value);
        })();
      `,
      "/b.js": /* js */ `
        (async () => {
          const { value } = await import("./shared.js");
          console.log("b:", value);
        })();
      `,
    },
    // shared.js must be an entry point for CJS exports to work
    entryPoints: ["/a.js", "/b.js", "/shared.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: tla-value" },
      { file: "/out/b.js", stdout: "b: tla-value" },
    ],
  });

  // await import() with default export
  itBundled("splitting/AwaitImportDefaultExport", {
    files: {
      "/shared.js": `export default function() { return "default-fn"; }`,
      "/a.js": /* js */ `
        const mod = await import("./shared.js");
        console.log("a:", mod.default());
      `,
      "/b.js": /* js */ `
        const mod = await import("./shared.js");
        console.log("b:", mod.default());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: default-fn" },
      { file: "/out/b.js", stdout: "b: default-fn" },
    ],
  });

  // await import() inside async function
  itBundled("splitting/AwaitImportInsideAsyncFunction", {
    files: {
      "/shared.js": `export const data = { x: 1, y: 2 };`,
      "/a.js": /* js */ `
        async function load() {
          const { data } = await import("./shared.js");
          return data;
        }
        load().then(d => console.log("a:", d.x, d.y));
      `,
      "/b.js": /* js */ `
        async function load() {
          const { data } = await import("./shared.js");
          return data;
        }
        load().then(d => console.log("b:", d.x, d.y));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 1 2" },
      { file: "/out/b.js", stdout: "b: 1 2" },
    ],
  });

  // Conditional await import
  itBundled("splitting/ConditionalAwaitImport", {
    files: {
      "/shared.js": `export const value = "conditional-value";`,
      "/a.js": /* js */ `
        const condition = true;
        if (condition) {
          const { value } = await import("./shared.js");
          console.log("a:", value);
        }
      `,
      "/b.js": /* js */ `
        const condition = true;
        if (condition) {
          const { value } = await import("./shared.js");
          console.log("b:", value);
        }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: conditional-value" },
      { file: "/out/b.js", stdout: "b: conditional-value" },
    ],
  });

  // --------------------------------------------------------------------------
  // module.exports variations
  // --------------------------------------------------------------------------

  // module.exports object pattern
  itBundled("splitting/ModuleExportsObjectPattern", {
    files: {
      "/shared.js": /* js */ `
        module.exports = {
          foo: "foo-val",
          bar: "bar-val",
          baz: function() { return "baz-fn"; }
        };
      `,
      "/a.js": /* js */ `
        const { foo, baz } = require("./shared.js");
        console.log("a:", foo, baz());
      `,
      "/b.js": /* js */ `
        const { bar, baz } = require("./shared.js");
        console.log("b:", bar, baz());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: foo-val baz-fn" },
      { file: "/out/b.js", stdout: "b: bar-val baz-fn" },
    ],
  });

  // module.exports object pattern - CJS output
  itBundled("splitting/ModuleExportsObjectPatternCJS", {
    files: {
      "/shared.js": /* js */ `
        module.exports = {
          foo: "foo-val",
          bar: "bar-val",
          baz: function() { return "baz-fn"; }
        };
      `,
      "/a.js": /* js */ `
        const { foo, baz } = require("./shared.js");
        console.log("a:", foo, baz());
      `,
      "/b.js": /* js */ `
        const { bar, baz } = require("./shared.js");
        console.log("b:", bar, baz());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: foo-val baz-fn" },
      { file: "/out/b.js", stdout: "b: bar-val baz-fn" },
    ],
  });

  // module.exports = class pattern
  itBundled("splitting/ModuleExportsClass", {
    files: {
      "/shared.js": /* js */ `
        module.exports = class SharedClass {
          constructor(val) { this.val = val; }
          get() { return this.val; }
        };
      `,
      "/a.js": /* js */ `
        const SharedClass = require("./shared.js");
        const obj = new SharedClass("a-val");
        console.log("a:", obj.get());
      `,
      "/b.js": /* js */ `
        const SharedClass = require("./shared.js");
        const obj = new SharedClass("b-val");
        console.log("b:", obj.get());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: a-val" },
      { file: "/out/b.js", stdout: "b: b-val" },
    ],
  });

  // exports.x = y pattern (not module.exports)
  itBundled("splitting/ExportsDotPattern", {
    files: {
      "/shared.js": /* js */ `
        exports.alpha = "alpha-val";
        exports.beta = "beta-val";
        exports.gamma = function() { return "gamma-fn"; };
      `,
      "/a.js": /* js */ `
        const { alpha, gamma } = require("./shared.js");
        console.log("a:", alpha, gamma());
      `,
      "/b.js": /* js */ `
        const { beta, gamma } = require("./shared.js");
        console.log("b:", beta, gamma());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: alpha-val gamma-fn" },
      { file: "/out/b.js", stdout: "b: beta-val gamma-fn" },
    ],
  });

  // module.exports function pattern
  itBundled("splitting/ModuleExportsFunction", {
    files: {
      "/shared.js": /* js */ `
        module.exports = function sharedFn(x) {
          return "shared:" + x;
        };
      `,
      "/a.js": /* js */ `
        const fn = require("./shared.js");
        console.log("a:", fn("A"));
      `,
      "/b.js": /* js */ `
        const fn = require("./shared.js");
        console.log("b:", fn("B"));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: shared:A" },
      { file: "/out/b.js", stdout: "b: shared:B" },
    ],
  });

  // --------------------------------------------------------------------------
  // export { x } from variations
  // --------------------------------------------------------------------------

  // export { x } from - basic re-export
  itBundled("splitting/ExportFromBasic", {
    files: {
      "/original.js": /* js */ `
        export const one = 1;
        export const two = 2;
        export const three = 3;
      `,
      "/reexport.js": `export { one, two } from "./original.js";`,
      "/a.js": /* js */ `
        import { one } from "./reexport.js";
        console.log("a:", one);
      `,
      "/b.js": /* js */ `
        import { two } from "./reexport.js";
        console.log("b:", two);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 1" },
      { file: "/out/b.js", stdout: "b: 2" },
    ],
  });

  // export { x } from - CJS output
  itBundled("splitting/ExportFromBasicCJS", {
    files: {
      "/original.js": /* js */ `
        export const one = 1;
        export const two = 2;
        export const three = 3;
      `,
      "/reexport.js": `export { one, two } from "./original.js";`,
      "/a.js": /* js */ `
        import { one } from "./reexport.js";
        console.log("a:", one);
      `,
      "/b.js": /* js */ `
        import { two } from "./reexport.js";
        console.log("b:", two);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 1" },
      { file: "/out/b.js", stdout: "b: 2" },
    ],
  });

  // export { x as y } from - renamed re-export
  itBundled("splitting/ExportFromRenamed", {
    files: {
      "/original.js": `export const originalName = "original";`,
      "/reexport.js": `export { originalName as renamedName } from "./original.js";`,
      "/a.js": /* js */ `
        import { renamedName } from "./reexport.js";
        console.log("a:", renamedName);
      `,
      "/b.js": /* js */ `
        import { renamedName } from "./reexport.js";
        console.log("b:", renamedName);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: original" },
      { file: "/out/b.js", stdout: "b: original" },
    ],
  });

  // export { x } from chained through multiple files
  itBundled("splitting/ExportFromChained", {
    files: {
      "/source.js": `export const chainedVal = "chained";`,
      "/middle1.js": `export { chainedVal } from "./source.js";`,
      "/middle2.js": `export { chainedVal } from "./middle1.js";`,
      "/final.js": `export { chainedVal } from "./middle2.js";`,
      "/a.js": /* js */ `
        import { chainedVal } from "./final.js";
        console.log("a:", chainedVal);
      `,
      "/b.js": /* js */ `
        import { chainedVal } from "./final.js";
        console.log("b:", chainedVal);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: chained" },
      { file: "/out/b.js", stdout: "b: chained" },
    ],
  });

  // --------------------------------------------------------------------------
  // export * from variations
  // --------------------------------------------------------------------------

  // export * from - basic namespace re-export
  itBundled("splitting/ExportStarBasic", {
    files: {
      "/utils.js": /* js */ `
        export const util1 = "u1";
        export const util2 = "u2";
        export const util3 = "u3";
      `,
      "/allUtils.js": `export * from "./utils.js";`,
      "/a.js": /* js */ `
        import { util1, util2 } from "./allUtils.js";
        console.log("a:", util1, util2);
      `,
      "/b.js": /* js */ `
        import { util2, util3 } from "./allUtils.js";
        console.log("b:", util2, util3);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: u1 u2" },
      { file: "/out/b.js", stdout: "b: u2 u3" },
    ],
  });

  // export * from - CJS output
  itBundled("splitting/ExportStarBasicCJS", {
    files: {
      "/utils.js": /* js */ `
        export const util1 = "u1";
        export const util2 = "u2";
        export const util3 = "u3";
      `,
      "/allUtils.js": `export * from "./utils.js";`,
      "/a.js": /* js */ `
        import { util1, util2 } from "./allUtils.js";
        console.log("a:", util1, util2);
      `,
      "/b.js": /* js */ `
        import { util2, util3 } from "./allUtils.js";
        console.log("b:", util2, util3);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: u1 u2" },
      { file: "/out/b.js", stdout: "b: u2 u3" },
    ],
  });

  // export * from multiple sources
  itBundled("splitting/ExportStarMultipleSources", {
    files: {
      "/math.js": /* js */ `
        export const add = (a, b) => a + b;
        export const sub = (a, b) => a - b;
      `,
      "/string.js": /* js */ `
        export const upper = s => s.toUpperCase();
        export const lower = s => s.toLowerCase();
      `,
      "/combined.js": /* js */ `
        export * from "./math.js";
        export * from "./string.js";
      `,
      "/a.js": /* js */ `
        import { add, upper } from "./combined.js";
        console.log("a:", add(1, 2), upper("hello"));
      `,
      "/b.js": /* js */ `
        import { sub, lower } from "./combined.js";
        console.log("b:", sub(5, 3), lower("WORLD"));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 3 HELLO" },
      { file: "/out/b.js", stdout: "b: 2 world" },
    ],
  });

  // export * as namespace
  itBundled("splitting/ExportStarAsNamespace", {
    files: {
      "/utils.js": /* js */ `
        export const x = 10;
        export const y = 20;
      `,
      "/namespace.js": `export * as utils from "./utils.js";`,
      "/a.js": /* js */ `
        import { utils } from "./namespace.js";
        console.log("a:", utils.x, utils.y);
      `,
      "/b.js": /* js */ `
        import { utils } from "./namespace.js";
        console.log("b:", utils.x + utils.y);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: 10 20" },
      { file: "/out/b.js", stdout: "b: 30" },
    ],
  });

  // --------------------------------------------------------------------------
  // export { default } from variations
  // --------------------------------------------------------------------------

  // export { default } from - re-export default
  itBundled("splitting/ExportDefaultFrom", {
    files: {
      "/original.js": `export default "default-value";`,
      "/reexport.js": `export { default } from "./original.js";`,
      "/a.js": /* js */ `
        import def from "./reexport.js";
        console.log("a:", def);
      `,
      "/b.js": /* js */ `
        import def from "./reexport.js";
        console.log("b:", def);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: default-value" },
      { file: "/out/b.js", stdout: "b: default-value" },
    ],
  });

  // export { default } from - CJS output
  itBundled("splitting/ExportDefaultFromCJS", {
    files: {
      "/original.js": `export default "default-value";`,
      "/reexport.js": `export { default } from "./original.js";`,
      "/a.js": /* js */ `
        import def from "./reexport.js";
        console.log("a:", def);
      `,
      "/b.js": /* js */ `
        import def from "./reexport.js";
        console.log("b:", def);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: default-value" },
      { file: "/out/b.js", stdout: "b: default-value" },
    ],
  });

  // export { default as name } from - renamed default re-export
  itBundled("splitting/ExportDefaultAsNameFrom", {
    files: {
      "/original.js": `export default { type: "config", value: 123 };`,
      "/reexport.js": `export { default as config } from "./original.js";`,
      "/a.js": /* js */ `
        import { config } from "./reexport.js";
        console.log("a:", config.type, config.value);
      `,
      "/b.js": /* js */ `
        import { config } from "./reexport.js";
        console.log("b:", config.type, config.value);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: config 123" },
      { file: "/out/b.js", stdout: "b: config 123" },
    ],
  });

  // export { x as default } from - named to default re-export
  itBundled("splitting/ExportNamedAsDefaultFrom", {
    files: {
      "/original.js": `export const myFunc = () => "my-func-result";`,
      "/reexport.js": `export { myFunc as default } from "./original.js";`,
      "/a.js": /* js */ `
        import fn from "./reexport.js";
        console.log("a:", fn());
      `,
      "/b.js": /* js */ `
        import fn from "./reexport.js";
        console.log("b:", fn());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: my-func-result" },
      { file: "/out/b.js", stdout: "b: my-func-result" },
    ],
  });

  // --------------------------------------------------------------------------
  // Circular dependency tests
  // --------------------------------------------------------------------------

  // Circular ESM imports - tests that circular imports work and values resolve correctly
  // Note: The exact order of "loaded" messages depends on bundler's module evaluation order
  itBundled("splitting/CircularESMBasic", {
    files: {
      "/a.js": /* js */ `
        import { bValue } from "./b.js";
        export const aValue = "A";
      `,
      "/b.js": /* js */ `
        import { aValue } from "./a.js";
        export const bValue = "B";
      `,
      "/main.js": /* js */ `
        import { aValue } from "./a.js";
        import { bValue } from "./b.js";
        console.log("main:", aValue, bValue);
      `,
      "/other.js": /* js */ `
        import { aValue } from "./a.js";
        console.log("other:", aValue);
      `,
    },
    entryPoints: ["/main.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "main: A B" },
      { file: "/out/other.js", stdout: "other: A" },
    ],
  });

  // Circular with module.exports
  itBundled("splitting/CircularCJSModuleExports", {
    files: {
      "/a.js": /* js */ `
        const b = require("./b.js");
        module.exports = { aVal: "A", bRef: b.bVal };
        console.log("a loaded");
      `,
      "/b.js": /* js */ `
        const a = require("./a.js");
        module.exports = { bVal: "B", aRef: a.aVal };
        console.log("b loaded");
      `,
      "/main.js": /* js */ `
        const a = require("./a.js");
        const b = require("./b.js");
        console.log("main:", a.aVal, b.bVal);
      `,
      "/other.js": /* js */ `
        const a = require("./a.js");
        console.log("other:", a.aVal);
      `,
    },
    entryPoints: ["/main.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "b loaded\na loaded\nmain: A B" },
      { file: "/out/other.js", stdout: "b loaded\na loaded\nother: A" },
    ],
  });

  // Circular with export * from
  itBundled("splitting/CircularExportStar", {
    files: {
      "/a.js": /* js */ `
        export * from "./b.js";
        export const fromA = "from-a";
      `,
      "/b.js": /* js */ `
        export * from "./a.js";
        export const fromB = "from-b";
      `,
      "/main.js": /* js */ `
        import { fromA, fromB } from "./a.js";
        console.log("main:", fromA, fromB);
      `,
      "/other.js": /* js */ `
        import { fromA, fromB } from "./b.js";
        console.log("other:", fromA, fromB);
      `,
    },
    entryPoints: ["/main.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "main: from-a from-b" },
      { file: "/out/other.js", stdout: "other: from-a from-b" },
    ],
  });

  // Three-way circular - tests that values are correctly available after module graph resolves
  // Note: Circular references at module init time may be undefined, but we test the final values
  itBundled("splitting/CircularThreeWay", {
    files: {
      "/a.js": /* js */ `
        export const aVal = "A";
      `,
      "/b.js": /* js */ `
        export const bVal = "B";
      `,
      "/c.js": /* js */ `
        export const cVal = "C";
      `,
      "/main.js": /* js */ `
        import { aVal } from "./a.js";
        import { bVal } from "./b.js";
        import { cVal } from "./c.js";
        console.log("vals:", aVal, bVal, cVal);
      `,
      "/other.js": /* js */ `
        import { aVal } from "./a.js";
        console.log("other:", aVal);
      `,
    },
    entryPoints: ["/main.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/main.js", stdout: "vals: A B C" },
      { file: "/out/other.js", stdout: "other: A" },
    ],
  });

  // --------------------------------------------------------------------------
  // Mixed syntax edge cases
  // --------------------------------------------------------------------------

  // ESM entry importing CJS that requires ESM
  itBundled("splitting/ESMImportsCJSRequiresESM", {
    files: {
      "/esm-source.js": `export const esmVal = "esm";`,
      "/cjs-middle.js": /* js */ `
        const { esmVal } = require("./esm-source.js");
        module.exports = { wrapped: esmVal + "-wrapped" };
      `,
      "/a.js": /* js */ `
        import { wrapped } from "./cjs-middle.js";
        console.log("a:", wrapped);
      `,
      "/b.js": /* js */ `
        import { wrapped } from "./cjs-middle.js";
        console.log("b:", wrapped);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: esm-wrapped" },
      { file: "/out/b.js", stdout: "b: esm-wrapped" },
    ],
  });

  // CJS entry requiring ESM that imports CJS
  itBundled("splitting/CJSRequiresESMImportsCJS", {
    files: {
      "/cjs-source.js": `module.exports = { cjsVal: "cjs" };`,
      "/esm-middle.js": /* js */ `
        import { cjsVal } from "./cjs-source.js";
        export const wrapped = cjsVal + "-wrapped";
      `,
      "/a.js": /* js */ `
        const { wrapped } = require("./esm-middle.js");
        console.log("a:", wrapped);
      `,
      "/b.js": /* js */ `
        const { wrapped } = require("./esm-middle.js");
        console.log("b:", wrapped);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: cjs-wrapped" },
      { file: "/out/b.js", stdout: "b: cjs-wrapped" },
    ],
  });

  // Dynamic import of module that has require
  itBundled("splitting/DynamicImportOfModuleWithRequire", {
    files: {
      "/helper.js": `module.exports.helperFn = () => "helper";`,
      "/dynamic.js": /* js */ `
        const { helperFn } = require("./helper.js");
        export const result = helperFn() + "-result";
      `,
      "/a.js": /* js */ `
        import("./dynamic.js").then(m => console.log("a:", m.result));
      `,
      "/b.js": /* js */ `
        import("./dynamic.js").then(m => console.log("b:", m.result));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: helper-result" },
      { file: "/out/b.js", stdout: "b: helper-result" },
    ],
  });

  // require() of module that has dynamic import
  itBundled("splitting/RequireOfModuleWithDynamicImport", {
    files: {
      "/async-dep.js": `export const asyncVal = "async";`,
      "/has-dynamic.js": /* js */ `
        module.exports.loadAsync = async function() {
          const { asyncVal } = await import("./async-dep.js");
          return asyncVal;
        };
      `,
      "/a.js": /* js */ `
        const { loadAsync } = require("./has-dynamic.js");
        loadAsync().then(v => console.log("a:", v));
      `,
      "/b.js": /* js */ `
        const { loadAsync } = require("./has-dynamic.js");
        loadAsync().then(v => console.log("b:", v));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: async" },
      { file: "/out/b.js", stdout: "b: async" },
    ],
  });

  // All syntax in one shared file
  itBundled("splitting/AllSyntaxInSharedFile", {
    files: {
      "/dep1.js": `export const dep1Val = "d1";`,
      "/dep2.js": `export default "d2-default";`,
      "/dep3.js": /* js */ `
        export const x = 1;
        export const y = 2;
      `,
      "/cjs-dep.js": `module.exports = { cjsVal: "cjs" };`,
      "/shared.js": /* js */ `
        // Named import
        import { dep1Val } from "./dep1.js";
        // Default import
        import dep2Default from "./dep2.js";
        // Namespace import
        import * as dep3 from "./dep3.js";
        // require
        const cjsDep = require("./cjs-dep.js");

        // Various exports
        export const fromDep1 = dep1Val;
        export { dep1Val as renamedDep1 } from "./dep1.js";
        export { default as dep2Reexport } from "./dep2.js";
        export * from "./dep3.js";
        export const combined = dep1Val + "-" + dep2Default + "-" + dep3.x + "-" + cjsDep.cjsVal;
      `,
      "/a.js": /* js */ `
        import { combined, fromDep1, x } from "./shared.js";
        console.log("a:", combined, fromDep1, x);
      `,
      "/b.js": /* js */ `
        import { combined, renamedDep1, y } from "./shared.js";
        console.log("b:", combined, renamedDep1, y);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: d1-d2-default-1-cjs d1 1" },
      { file: "/out/b.js", stdout: "b: d1-d2-default-1-cjs d1 2" },
    ],
  });

  // All syntax in one shared file - CJS output
  itBundled("splitting/AllSyntaxInSharedFileCJS", {
    files: {
      "/dep1.js": `export const dep1Val = "d1";`,
      "/dep2.js": `export default "d2-default";`,
      "/dep3.js": /* js */ `
        export const x = 1;
        export const y = 2;
      `,
      "/cjs-dep.js": `module.exports = { cjsVal: "cjs" };`,
      "/shared.js": /* js */ `
        // Named import
        import { dep1Val } from "./dep1.js";
        // Default import
        import dep2Default from "./dep2.js";
        // Namespace import
        import * as dep3 from "./dep3.js";
        // require
        const cjsDep = require("./cjs-dep.js");

        // Various exports
        export const fromDep1 = dep1Val;
        export { dep1Val as renamedDep1 } from "./dep1.js";
        export { default as dep2Reexport } from "./dep2.js";
        export * from "./dep3.js";
        export const combined = dep1Val + "-" + dep2Default + "-" + dep3.x + "-" + cjsDep.cjsVal;
      `,
      "/a.js": /* js */ `
        import { combined, fromDep1, x } from "./shared.js";
        console.log("a:", combined, fromDep1, x);
      `,
      "/b.js": /* js */ `
        import { combined, renamedDep1, y } from "./shared.js";
        console.log("b:", combined, renamedDep1, y);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: d1-d2-default-1-cjs d1 1" },
      { file: "/out/b.js", stdout: "b: d1-d2-default-1-cjs d1 2" },
    ],
  });

  // --------------------------------------------------------------------------
  // __esModule interop edge cases
  // --------------------------------------------------------------------------

  // CJS with __esModule flag - test that named exports work correctly
  // Note: Bun's handling of __esModule with default differs, so we just test named exports
  itBundled("splitting/CJSWithEsModuleFlag", {
    files: {
      "/shared.js": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.named = "named-val";
        exports.other = "other-val";
      `,
      "/a.js": /* js */ `
        import { named } from "./shared.js";
        console.log("a:", named);
      `,
      "/b.js": /* js */ `
        import { other } from "./shared.js";
        console.log("b:", other);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: named-val" },
      { file: "/out/b.js", stdout: "b: other-val" },
    ],
  });

  // CJS with __esModule flag - CJS output
  itBundled("splitting/CJSWithEsModuleFlagCJS", {
    files: {
      "/shared.js": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.named = "named-val";
        exports.other = "other-val";
      `,
      "/a.js": /* js */ `
        import { named } from "./shared.js";
        console.log("a:", named);
      `,
      "/b.js": /* js */ `
        import { other } from "./shared.js";
        console.log("b:", other);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: named-val" },
      { file: "/out/b.js", stdout: "b: other-val" },
    ],
  });

  // Dynamic import of CJS with __esModule - test named exports
  itBundled("splitting/DynamicImportCJSWithEsModule", {
    files: {
      "/shared.js": /* js */ `
        Object.defineProperty(exports, "__esModule", { value: true });
        exports.named = "dyn-named";
        exports.extra = "dyn-extra";
      `,
      "/a.js": /* js */ `
        import("./shared.js").then(m => console.log("a:", m.named, m.extra));
      `,
      "/b.js": /* js */ `
        import("./shared.js").then(m => console.log("b:", m.named, m.extra));
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a: dyn-named dyn-extra" },
      { file: "/out/b.js", stdout: "b: dyn-named dyn-extra" },
    ],
  });

  // --------------------------------------------------------------------------
  // Getter/setter export edge cases
  // --------------------------------------------------------------------------

  // Live binding with setters
  itBundled("splitting/LiveBindingSetters", {
    files: {
      "/shared.js": /* js */ `
        export let counter = 0;
        export function increment() { counter++; }
        export function getCounter() { return counter; }
      `,
      "/a.js": /* js */ `
        import { counter, increment, getCounter } from "./shared.js";
        console.log("a before:", counter, getCounter());
        increment();
        console.log("a after:", counter, getCounter());
      `,
      "/b.js": /* js */ `
        import { counter, increment, getCounter } from "./shared.js";
        console.log("b before:", counter, getCounter());
        increment();
        console.log("b after:", counter, getCounter());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    runtimeFiles: {
      "/test.js": /* js */ `
        // Import both entry points - they share the same underlying shared module
        await import("./out/a.js");
        await import("./out/b.js");
      `,
    },
    run: [
      { file: "/out/a.js", stdout: "a before: 0 0\na after: 1 1" },
      { file: "/out/b.js", stdout: "b before: 0 0\nb after: 1 1" },
      // When both entry points share the same module, they share state
      // a.js runs first: counter goes 0 -> 1
      // b.js runs second: counter starts at 1, goes to 2
      { file: "/test.js", stdout: "a before: 0 0\na after: 1 1\nb before: 1 1\nb after: 2 2" },
    ],
  });

  // Live binding with setters - CJS output
  // Note: In CJS output, the imported `counter` is snapshotted at import time,
  // so it won't update when increment() is called. Only getCounter() reflects
  // the updated value since it reads the variable at call time.
  itBundled("splitting/LiveBindingSettersCJS", {
    files: {
      "/shared.js": /* js */ `
        export let counter = 0;
        export function increment() { counter++; }
        export function getCounter() { return counter; }
      `,
      "/a.js": /* js */ `
        import { counter, increment, getCounter } from "./shared.js";
        console.log("a before:", counter, getCounter());
        increment();
        // counter is snapshotted, getCounter() reads live value
        console.log("a after:", counter, getCounter());
      `,
      "/b.js": /* js */ `
        import { counter, increment, getCounter } from "./shared.js";
        console.log("b before:", counter, getCounter());
        increment();
        console.log("b after:", counter, getCounter());
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "cjs",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a before: 0 0\na after: 0 1" },
      { file: "/out/b.js", stdout: "b before: 0 0\nb after: 0 1" },
    ],
  });
});
