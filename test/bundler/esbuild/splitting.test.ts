import { itBundled, testForFile } from "../expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_splitting_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/splitting

describe("bundler", () => {
  itBundled("splitting/SplittingSharedES6IntoES6", {
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
    format: "esm",
    run: [
      { file: "/out/a.js", stdout: "123" },
      { file: "/out/b.js", stdout: "123" },
    ],
    assertNotPresent: {
      "/out/a.js": "123",
      "/out/b.js": "123",
    },
  });
  return;
  itBundled("splitting/SplittingSharedCommonJSIntoES6", {
    // GENERATED
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
    format: "esm",
  });
  itBundled("splitting/SplittingDynamicES6IntoES6", {
    // GENERATED
    files: {
      "/entry.js": `import("./foo.js").then(({bar}) => console.log(bar))`,
      "/foo.js": `export let bar = 123`,
    },
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingDynamicCommonJSIntoES6", {
    // GENERATED
    files: {
      "/entry.js": `import("./foo.js").then(({default: {bar}}) => console.log(bar))`,
      "/foo.js": `exports.bar = 123`,
    },
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingDynamicAndNotDynamicES6IntoES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {bar as a} from "./foo.js"
        import("./foo.js").then(({bar: b}) => console.log(a, b))
      `,
      "/foo.js": `export let bar = 123`,
    },
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingDynamicAndNotDynamicCommonJSIntoES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {bar as a} from "./foo.js"
        import("./foo.js").then(({default: {bar: b}}) => console.log(a, b))
      `,
      "/foo.js": `exports.bar = 123`,
    },
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingAssignToLocal", {
    // GENERATED
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
        export let foo
        export function setFoo(value) {
          foo = value
        }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingSideEffectsWithoutDependencies", {
    // GENERATED
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
    format: "esm",
  });
  itBundled("splitting/SplittingNestedDirectories", {
    // GENERATED
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
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingCircularReferenceIssue251", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        export * from './b.js';
        export var p = 5;
      `,
      "/b.js": /* js */ `
        export * from './a.js';
        export var q = 6;
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingMissingLazyExport", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        import {foo} from './common.js'
        console.log(foo())
      `,
      "/b.js": /* js */ `
        import {bar} from './common.js'
        console.log(bar())
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
    format: "esm",
    /* TODO FIX expectedCompileLog: `common.js: WARNING: Import "missing" will always be undefined because the file "empty.js" has no exports
  `, */
  });
  itBundled("splitting/SplittingReExportIssue273", {
    // GENERATED
    files: {
      "/a.js": `export const a = 1`,
      "/b.js": `export { a } from './a'`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingDynamicImportIssue272", {
    // GENERATED
    files: {
      "/a.js": `import('./b')`,
      "/b.js": `export default 1`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingDynamicImportOutsideSourceTreeIssue264", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry1.js": `import('package')`,
      "/Users/user/project/src/entry2.js": `import('package')`,
      "/Users/user/project/node_modules/package/index.js": `console.log('imported')`,
    },
    entryPoints: ["/Users/user/project/src/entry1.js", "/Users/user/project/src/entry2.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingCrossChunkAssignmentDependencies", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        import {setValue} from './shared'
        setValue(123)
      `,
      "/b.js": `import './shared'`,
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
          value = next;
          if (observer) observer();
        }
        sideEffects(getValue);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingCrossChunkAssignmentDependenciesRecursive", {
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
    format: "esm",
  });
  itBundled("splitting/SplittingDuplicateChunkCollision", {
    // GENERATED
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
    format: "esm",
  });
  itBundled("splitting/SplittingMinifyIdentifiersCrashIssue437", {
    // GENERATED
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
    format: "esm",
  });
  itBundled("splitting/SplittingHybridESMAndCJSIssue617", {
    // GENERATED
    files: {
      "/a.js": `export let foo`,
      "/b.js": `export let bar = require('./a')`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
  });
  itBundled("splitting/SplittingPublicPathEntryName", {
    // GENERATED
    files: {
      "/a.js": `import("./b")`,
      "/b.js": `console.log('b')`,
    },
    splitting: true,
    format: "esm",
    publicPath: "/www",
  });
  itBundled("splitting/SplittingChunkPathDirPlaceholderImplicitOutbase", {
    // GENERATED
    files: {
      "/project/entry.js": `console.log(import('./output-path/should-contain/this-text/file'))`,
      "/project/output-path/should-contain/this-text/file.js": `console.log('file.js')`,
    },
    format: "esm",
    splitting: true,
  });
  itBundled("splitting/EdgeCaseIssue2793WithSplitting", {
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
    format: "esm",
    splitting: true,
  });
  itBundled("splitting/EdgeCaseIssue2793WithoutSplitting", {
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
    format: "esm",
    outdir: "/out",
  });
});
