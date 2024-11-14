import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_importstar_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/importstar

describe("bundler", () => {
  itBundled("importstar/ImportStarUnused", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = "FAIL"`,
    },
    dce: true,
    run: {
      stdout: "234",
    },
  });
  itBundled("importstar/ImportStarCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
    },
    run: {
      // esbuild:
      // stdout: '{"default":{"foo":123},"foo":123} 123 234',

      // bun:
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
    },
    run: {
      stdout: "123 123 234",
    },
  });
  itBundled("importstar/ImportStarExportImportStarUnused", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = 123; export const bar = "FAILED";`,
      "/bar.js": /* js */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    dce: true,
    run: {
      stdout: "234",
    },
  });
  itBundled("importstar/ImportStarExportImportStarNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": /* js */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    run: {
      stdout: "123 123 234",
    },
  });
  itBundled("importstar/ImportStarExportImportStarCapture", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": /* js */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarExportStarAsUnused", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = "FAILED"`,
      "/bar.js": `export * as ns from './foo'`,
    },
    dce: true,
    run: {
      stdout: "234",
    },
  });
  itBundled("importstar/ImportStarExportStarAsNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * as ns from './foo'`,
    },
    run: {
      stdout: "123 123 234",
    },
  });
  itBundled("importstar/ImportStarExportStarAsCapture", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * as ns from './foo'`,
    },
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarExportStarUnused", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = "FAILED"`,
      "/bar.js": `export * from './foo'`,
    },
    dce: true,
    run: {
      stdout: "234",
    },
  });
  itBundled("importstar/ImportStarExportStarNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * from './foo'`,
    },
    run: {
      stdout: "123 123 234",
    },
  });
  itBundled("importstar/ImportStarExportStarCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './bar'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * from './foo'`,
    },
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarCommonJSUnused", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `exports.foo = 123`,
    },
    run: {
      stdout: "234",
    },
  });
  itBundled("importstar/ImportStarCommonJSCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.js": `exports.foo = 123`,
    },
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarCommonJSNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `exports.foo = 123`,
    },
    run: {
      stdout: "123 123 234",
    },
  });
  itBundled("importstar/ImportStarAndCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        const ns2 = require('./foo')
        console.log(ns.foo, ns2.foo)
      `,
      "/foo.js": `export const foo = 123`,
    },
  });
  itBundled("importstar/ImportStarNoBundleUnused", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    runtimeFiles: {
      "/foo.js": `console.log('foo')`,
    },
    bundling: false,
    run: {
      stdout: "foo\n234",
    },
  });
  itBundled("importstar/ImportStarNoBundleCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
    },
    runtimeFiles: {
      "/foo.js": `export const foo = 123`,
    },
    external: ["./foo"],
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarNoBundleNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    external: ["./foo"],
    runtimeFiles: {
      "/foo.js": `export const foo = 123`,
    },
    run: {
      stdout: "123 123 234",
    },
  });
  itBundled("importstar/ImportStarMangleNoBundleUnused", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    minifySyntax: true,
    external: ["./foo"],
    runtimeFiles: {
      "/foo.js": `console.log('foo')`,
    },
    run: {
      stdout: "foo\n234",
    },
  });
  itBundled("importstar/ImportStarMangleNoBundleCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
    },
    minifySyntax: true,
    external: ["./foo"],
    runtimeFiles: {
      "/foo.js": `export const foo = 123`,
    },
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarMangleNoBundleNoCapture", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
    },
    minifySyntax: true,
    external: ["./foo"],
    runtimeFiles: {
      "/foo.js": `export const foo = 123`,
    },
    run: {
      stdout: '{"foo":123} 123 234',
    },
  });
  itBundled("importstar/ImportStarExportStarOmitAmbiguous", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './common'
        console.log(JSON.stringify(ns))
      `,
      "/common.js": /* js */ `
        export * from './foo'
        export * from './bar'
      `,
      "/foo.js": /* js */ `
        export const x = 1
        export const y = "FAILED"
      `,
      "/bar.js": /* js */ `
        export const y = "FAILED"
        export const z = 4
      `,
    },
    dce: true,
    run: {
      stdout: '{"z":4,"x":1}',
    },
  });
  itBundled("importstar/ImportExportStarAmbiguousError", {
    files: {
      "/entry.js": /* js */ `
        import {x, y, z} from './common'
        console.log(x, y, z)
      `,
      "/common.js": /* js */ `
        export * from './foo'
        export * from './bar'
      `,
      "/foo.js": /* js */ `
        export const x = 1
        export const y = 2
      `,
      "/bar.js": /* js */ `
        export const y = 3
        export const z = 4
      `,
    },
    bundleErrors: {
      "/entry.js": ['Ambiguous import "y" has multiple matching exports'],
    },
  });
  itBundled("importstar/ImportExportStarAmbiguous", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './common'
        console.log(ns.x, ns.y, ns.z)
      `,
      "/common.js": /* js */ `
        export * from './foo'
        export * from './bar'
      `,
      "/foo.js": /* js */ `
        export const x = 1
        export const y = 2
      `,
      "/bar.js": /* js */ `
        export const y = 3
        export const z = 4
      `,
    },
    bundleWarnings: {
      "/entry.js": ['Import "y" will always be undefined because there are multiple matching exports'],
    },
    run: {
      stdout: "1 undefined 4",
    },
  });
  itBundled("importstar/ReExportStarNameCollisionNotAmbiguousImport", {
    files: {
      "/entry.js": /* js */ `
        import {x, y} from './common'
        console.log(x, y)
      `,
      "/common.js": /* js */ `
        export * from './a'
        export * from './b'
      `,
      "/a.js": `export * from './c'`,
      "/b.js": `export {x} from './c'`,
      "/c.js": `export let x = 1, y = 2`,
    },
    run: {
      stdout: "1 2",
    },
  });
  itBundled("importstar/ReExportStarNameCollisionNotAmbiguousExport", {
    files: {
      "/entry.js": /* js */ `
        export * from './a'
        export * from './b'
      `,
      "/a.js": `export * from './c'`,
      "/b.js": `export {x} from './c'`,
      "/c.js": `export let x = 1, y = 2`,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import {x, y} from './entry.js'
        import assert from 'assert'
        assert.strictEqual(x, 1)
        assert.strictEqual(y, 2)
      `,
    },
    run: { file: "/test.js" },
  });
  itBundled("importstar/ReExportStarNameShadowingNotAmbiguous", {
    files: {
      "/entry.js": /* js */ `
        import {x} from './a'
        console.log(x)
      `,
      "/a.js": /* js */ `
        export * from './b'
        export let x = 1
      `,
      "/b.js": `export let x = "FAILED"`,
    },
    dce: true,
    run: {
      stdout: "1",
    },
  });
  itBundled("importstar/ReExportStarNameShadowingNotAmbiguousReExport", {
    files: {
      "/entry.js": /* js */ `
        import {x} from './a'
        console.log(x)
      `,
      "/a.js": `export * from './b'`,
      "/b.js": /* js */ `
        export * from './c'
        export let x = 1
      `,
      "/c.js": `export let x = "FAILED"`,
    },
    dce: true,
    run: {
      stdout: "1",
    },
  });
  itBundled("importstar/ImportStarOfExportStarAs", {
    files: {
      "/entry.js": /* js */ `
        import * as foo_ns from './foo'
        console.log(JSON.stringify(foo_ns))
      `,
      "/foo.js": `export * as bar_ns from './bar'`,
      "/bar.js": `export const bar = 123`,
    },
    run: {
      stdout: '{"bar_ns":{"bar":123}}',
    },
  });
  itBundled("importstar/ImportOfExportStar", {
    files: {
      "/entry.js": /* js */ `
        import {bar} from './foo'
        console.log(bar)
      `,
      "/foo.js": `export * from './bar'`,
      "/bar.js": /* js */ `
        // Add some statements to increase the part index (this reproduced a crash)
        statement()
        statement()
        statement()
        statement()
        export const bar = 123
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.statement = () => {}
        await import('./out.js')
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123",
    },
  });
  itBundled("importstar/ImportOfExportStarOfImport", {
    files: {
      "/entry.js": /* js */ `
        import {bar} from './foo'
        console.log(bar)
      `,
      "/foo.js": /* js */ `
        // Add some statements to increase the part index (this reproduced a crash)
        statement()
        statement()
        statement()
        statement()
        export * from './bar'
      `,
      "/bar.js": `export {value as bar} from './baz'`,
      "/baz.js": `export const value = 123`,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.statement = () => {}
        await import('./out.js')
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123",
    },
  });
  itBundled("importstar/ExportSelfIIFE", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "iife",
  });
  itBundled("importstar/ExportSelfIIFEWithName", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "iife",
    globalName: "someName",
    onAfterBundle(api) {
      api.appendFile("/out.js", "\nconsole.log(JSON.stringify(someName))");
    },
    run: {
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ExportSelfES6", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(JSON.stringify(foo));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ExportSelfCommonJS", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "cjs",

    runtimeFiles: {
      "/test.js": /* js */ `
        console.log(JSON.stringify(require("./out.js")));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ExportSelfCommonJSMinified", {
    files: {
      "/entry.js": /* js */ `
        module.exports = {foo: 123}
        console.log(JSON.stringify(require('./entry')))
      `,
    },
    minifyIdentifiers: true,
    format: "cjs",

    run: {
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ImportSelfCommonJS", {
    files: {
      "/entry.js": /* js */ `
        exports.foo = 123
        import {foo} from './entry'
        console.log('1', foo)
      `,
    },
    format: "cjs",

    runtimeFiles: {
      "/test.js": /* js */ `
        console.log('2', JSON.stringify(require("./out.js")));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '1 undefined\n2 {"foo":123}',
    },
  });
  itBundled("importstar/ExportSelfAsNamespaceES6", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * as ns from './entry'
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(foo.foo, foo.ns.ns.ns.foo, foo.ns.ns === foo.ns);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123 123 true",
    },
  });
  itBundled("importstar/ImportExportSelfAsNamespaceES6", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        import * as ns from './entry'
        export {ns}
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(foo.foo, foo.ns.ns.ns.foo, foo.ns.ns === foo.ns);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123 123 true",
    },
  });
  itBundled("importstar/ReExportOtherFileExportSelfAsNamespaceES6", {
    files: {
      "/entry.js": `export * from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        export * as ns from './foo'
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(foo.foo, foo.ns.ns.ns.foo, foo.ns.ns === foo.ns);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123 123 true",
    },
  });
  itBundled("importstar/ReExportOtherFileImportExportSelfAsNamespaceES6", {
    files: {
      "/entry.js": `export * from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        import * as ns from './foo'
        export {ns}
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(foo.foo, foo.ns.ns.ns.foo, foo.ns.ns === foo.ns);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123 123 true",
    },
  });
  itBundled("importstar/OtherFileExportSelfAsNamespaceUnusedES6", {
    files: {
      "/entry.js": `export {foo} from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        export * as FAILED from './foo'
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(JSON.stringify(foo));
      `,
    },
    dce: true,
    run: {
      file: "/test.js",
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/OtherFileImportExportSelfAsNamespaceUnusedES6", {
    files: {
      "/entry.js": `export {foo} from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        import * as FAILED from './foo'
        export {FAILED}
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as foo from './out.js'
        console.log(JSON.stringify(foo));
      `,
    },
    dce: true,
    run: {
      file: "/test.js",
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ExportSelfAsNamespaceCommonJS", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * as ns from './entry'
      `,
    },
    format: "cjs",

    runtimeFiles: {
      "/test.js": /* js */ `
        const foo = require('./out.js')
        console.log(foo.foo, foo.ns.ns.ns.foo, foo.ns.ns === foo.ns);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123 123 true",
    },
  });
  itBundled("importstar/ExportSelfAndRequireSelfCommonJS", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        console.log(JSON.stringify(require('./entry')))
      `,
    },
    format: "cjs",

    run: {
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ExportSelfAndImportSelfCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as x from './entry'
        export const foo = 123
        console.log(JSON.stringify(x))
      `,
    },
    format: "cjs",

    run: {
      stdout: '{"foo":123}',
    },
  });
  itBundled("importstar/ExportOtherAsNamespaceCommonJS", {
    files: {
      "/entry.js": `export * as ns from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",

    runtimeFiles: {
      "/test.js": /* js */ `
        const foo = require('./out.js')
        console.log(JSON.stringify(foo));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"ns":{"default":{"foo":123},"foo":123}}',
    },
  });
  itBundled("importstar/ImportExportOtherAsNamespaceCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        export {ns}
      `,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
  });
  itBundled("importstar/NamespaceImportMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(JSON.stringify(ns), ns.foo)
      `,
      "/foo.js": `export const x = 123`,
    },
    run: {
      stdout: '{"x":123} undefined',
    },
    bundleWarnings: {
      "/entry.js": [`Import "foo" will always be undefined because there is no matching export in "foo.js"`],
    },
  });
  itBundled("importstar/ExportOtherCommonJS", {
    files: {
      "/entry.js": `export {bar} from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",

    runtimeFiles: {
      "/test.js": /* js */ `
        const foo = require('./out.js')
        console.log(...Object.keys(foo));
        console.log(JSON.stringify(foo));
      `,
    },
    run: {
      file: "/test.js",
      stdout: "bar\n{}",
    },
  });
  itBundled("importstar/ExportOtherNestedCommonJS", {
    files: {
      "/entry.js": `export {y} from './bar'`,
      "/bar.js": `export {x as y} from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",

    runtimeFiles: {
      "/test.js": /* js */ `
        const foo = require('./out.js')
        console.log(...Object.keys(foo));
        console.log(JSON.stringify(foo));
      `,
    },
    run: {
      file: "/test.js",
      stdout: "y\n{}",
    },
  });
  itBundled("importstar/NamespaceImportUnusedMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export const x = "FAILED"`,
    },
    dce: true,
    run: {
      stdout: "undefined",
    },
    bundleWarnings: {
      "/entry.js": [`Import "foo" will always be undefined because there is no matching export in "foo.js"`],
    },
  });
  itBundled("importstar/NamespaceImportMissingCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(JSON.stringify(ns), ns.foo)
      `,
      "/foo.js": `exports.x = 123`,
    },
    format: "cjs",
    run: {
      stdout: '{"default":{"x":123},"x":123} undefined',
    },
  });
  itBundled("importstar/NamespaceImportUnusedMissingCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `exports.x = 123`,
    },
    run: {
      stdout: "undefined",
    },
  });
  itBundled("importstar/ReExportNamespaceImportMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './foo'
        console.log(JSON.stringify(ns), ns.foo)
      `,
      "/foo.js": `export * as ns from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    run: {
      stdout: '{"x":123} undefined',
    },
  });
  itBundled("importstar/ReExportNamespaceImportUnusedMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import {ns} from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export * as ns from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    run: {
      stdout: "undefined",
    },
  });
  itBundled("importstar/NamespaceImportReExportMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns, ns.foo)
      `,
      "/foo.js": `export {foo} from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    bundleErrors: {
      "/foo.js": [`No matching export in "bar.js" for import "foo"`],
    },
  });
  itBundled("importstar/NamespaceImportReExportUnusedMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export {foo} from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    bundleErrors: {
      "/foo.js": [`No matching export in "bar.js" for import "foo"`],
    },
  });
  itBundled("importstar/NamespaceImportReExportStarMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(JSON.stringify(ns), ns.foo)
      `,
      "/foo.js": `export * from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    bundleWarnings: {
      "/entry.js": [`Import "foo" will always be undefined because there is no matching export in "foo.js"`],
    },
    run: {
      stdout: '{"x":123} undefined',
    },
  });
  itBundled("importstar/NamespaceImportReExportStarUnusedMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export * from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    bundleWarnings: {
      "/entry.js": [`Import "foo" will always be undefined because there is no matching export in "foo.js"`],
    },
    run: {
      stdout: "undefined",
    },
  });
  itBundled("importstar/ExportStarDefaultExportCommonJS", {
    files: {
      "/entry.js": `export * from './foo'`,
      "/foo.js": /* js */ `
        export default 'FAILED' // This should not be picked up
        export let foo = 'foo'
      `,
    },
    format: "cjs",

    dce: true,
    runtimeFiles: {
      "/test.js": /* js */ `
        const foo = require('./out.js')
        console.log(JSON.stringify(foo));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"foo":"foo"}',
    },
  });
  itBundled("importstar/ESBuildIssue176", {
    files: {
      "/entry.js": /* js */ `
        import * as things from './folders'
        console.log(JSON.stringify(things), things.foo())
      `,
      "/folders/index.js": `export * from "./child"`,
      "/folders/child/index.js": `export { foo } from './foo'`,
      "/folders/child/foo.js": `export const foo = () => 'hi there'`,
    },
    run: {
      stdout: "{} hi there",
    },
  });
  itBundled("importstar/ReExportStarExternalIIFE", {
    todo: true,
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "iife",
    globalName: "mod",
    external: ["foo"],
    runtimeFiles: {
      "/node_modules/foo/index.js": /* js */ `
        export const foo = 'foo'
        export const bar = 'bar'
      `,
    },
    onAfterBundle(api) {
      api.appendFile("/out.js", "\nconsole.log(JSON.stringify(mod))");
    },
    run: {
      stdout: '{"bar":"bar","foo":"foo"}',
    },
  });
  itBundled("importstar/ReExportStarExternalES6", {
    files: {
      "/entry.js": `export * from "foo"`,
    },
    external: ["foo"],
    format: "esm",
    runtimeFiles: {
      "/node_modules/foo/index.js": /* js */ `
        export const foo = 'foo'
        export const bar = 'bar'
      `,
      "/test.js": /* js */ `
        import * as mod from './out.js'
        console.log(JSON.stringify(mod))
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"bar":"bar","foo":"foo"}',
    },
  });
  itBundled("importstar/ReExportStarExternalCommonJS", {
    files: {
      "/entry.js": `export * from "foo"`,
    },
    external: ["foo"],
    format: "cjs",

    runtimeFiles: {
      "/node_modules/foo/index.js": /* js */ `
        module.exports = { bar: 'bar', foo: 'foo' }
      `,
      "/test.js": /* js */ `
        console.log(JSON.stringify(require('./out.js')))
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"bar":"bar","foo":"foo"}',
    },
  });
  itBundled("importstar/ImportDefaultNamespaceComboESBuildIssue446", {
    todo: true,
    files: {
      "/external-default2.js": /* js */ `
        import def, {default as default2} from 'external'
        console.log(def, default2)
      `,
      "/external-ns.js": /* js */ `
        import def, * as ns from 'external'
        console.log(def, ns)
      `,
      "/external-ns-default.js": /* js */ `
        import def, * as ns from 'external'
        console.log(def, ns, ns.default)
      `,
      "/external-ns-def.js": /* js */ `
        import def, * as ns from 'external'
        console.log(def, ns, ns.def)
      `,
      "/external-default.js": /* js */ `
        import def, * as ns from 'external'
        console.log(def, ns.default)
      `,
      "/external-def.js": /* js */ `
        import def, * as ns from 'external'
        console.log(def, ns.def)
      `,
      "/internal-default2.js": /* js */ `
        import def, {default as default2} from './internal'
        console.log(def, default2)
      `,
      "/internal-ns.js": /* js */ `
        import def, * as ns from './internal'
        console.log(def, ns)
      `,
      "/internal-ns-default.js": /* js */ `
        import def, * as ns from './internal'
        console.log(def, ns, ns.default)
      `,
      "/internal-ns-def.js": /* js */ `
        import def, * as ns from './internal'
        console.log(def, ns, ns.def)
      `,
      "/internal-default.js": /* js */ `
        import def, * as ns from './internal'
        console.log(def, ns.default)
      `,
      "/internal-def.js": /* js */ `
        import def, * as ns from './internal'
        console.log(def, ns.def)
      `,
      "/internal.js": `export default 123`,

      "/test.js": /* js */ `
        import "./external-default2.js";
        import "./external-default.js";
        import "./external-def.js";
        import "./external-ns-default.js";
        import "./external-ns-def.js";
        import "./external-ns.js";
        import "./internal-default2.js";
        import "./internal-default.js";
        import "./internal-def.js";
        import "./internal-ns-default.js";
        import "./internal-ns-def.js";
        import "./internal-ns.js";
      `,
    },
    entryPoints: [
      "/external-default2.js",
      "/external-ns.js",
      "/external-ns-default.js",
      "/external-ns-def.js",
      "/external-default.js",
      "/external-def.js",
      "/internal-default2.js",
      "/internal-ns.js",
      "/internal-ns-default.js",
      "/internal-ns-def.js",
      "/internal-default.js",
      "/internal-def.js",
    ],
    external: ["external"],
    run: {
      file: "/test.js",
      stdout: `
        [Function: child] [Function: child]
        [Function: child] [Function: child]
        [Function: child] undefined
        [Function: child] [Function: child] [Function: child]
        [Function: child] [Function: child] undefined
        [Function: child] [Function: child]
        123 123
        123 123
        123 undefined
        123 Module {
          "default": 123
        } 123
        123 Module {
          "default": 123
        } undefined
        123 Module {
          "default": 123
        }
      `,
    },
  });
  const ImportDefaultNamespaceComboNoDefault = itBundled("importstar/ImportDefaultNamespaceComboNoDefault1", {
    files: {
      "/entry-default-ns-prop.js": `import def, * as ns from './foo'; console.log(def, ns, ns.default)`,
      "/entry-default-ns.js": `import def, * as ns from './foo'; console.log(def, ns)`,
      "/entry-default-prop.js": `import def, * as ns from './foo'; console.log(def, ns.default)`,
      "/entry-default.js": `import def from './foo'; console.log(def)`,
      "/entry-prop.js": `import * as ns from './foo'; console.log(ns.default)`,
      "/foo.js": `export let foo = 123`,
    },
    entryPoints: ["/entry-default-ns-prop.js"],
    bundleErrors: {
      "/entry-default-ns-prop.js": ['No matching export in "foo.js" for import "default"'],
    },
  });
  itBundled("importstar/ImportDefaultNamespaceComboNoDefault2", {
    ...ImportDefaultNamespaceComboNoDefault.options,
    entryPoints: ["/entry-default-ns.js"],
    bundleErrors: {
      "/entry-default-ns.js": ['No matching export in "foo.js" for import "default"'],
    },
  });
  itBundled("importstar/ImportDefaultNamespaceComboNoDefault3", {
    ...ImportDefaultNamespaceComboNoDefault.options,
    entryPoints: ["/entry-default-prop.js"],
    bundleErrors: {
      "/entry-default-prop.js": ['No matching export in "foo.js" for import "default"'],
    },
  });
  itBundled("importstar/ImportDefaultNamespaceComboNoDefault4", {
    ...ImportDefaultNamespaceComboNoDefault.options,
    entryPoints: ["/entry-default.js"],
    bundleErrors: {
      "/entry-default.js": ['No matching export in "foo.js" for import "default"'],
    },
  });
  itBundled("importstar/ImportDefaultNamespaceComboNoDefault5", {
    ...ImportDefaultNamespaceComboNoDefault.options,
    entryPoints: ["/entry-prop.js"],
    bundleErrors: undefined,
    bundleWarnings: {
      "/entry-prop.js": [`Import "default" will always be undefined because there is no matching export in "foo.js"`],
    },
  });
  itBundled("importstar/ImportNamespaceUndefinedPropertyEmptyFile", {
    files: {
      "/entry-nope.js": /* js */ `
        import * as js from './empty.js'
        import * as mjs from './empty.mjs'
        import * as cjs from './empty.cjs'
        console.log(
          js.nope,
          mjs.nope,
          cjs.nope,
        )
      `,
      "/entry-default.js": /* js */ `
        import * as js from './empty.js'
        import * as mjs from './empty.mjs'
        import * as cjs from './empty.cjs'
        console.log(
          js.default,
          mjs.default,
          cjs.default,
        )
      `,
      "/empty.js": ``,
      "/empty.mjs": ``,
      "/empty.cjs": ``,
    },
    entryPoints: ["/entry-nope.js", "/entry-default.js"],
    bundleWarnings: {
      "/entry-nope.js": [
        `Import "nope" will always be undefined because there is no matching export in "empty.js"`,
        `Import "nope" will always be undefined because there is no matching export in "empty.mjs"`,
        `Import "nope" will always be undefined because there is no matching export in "empty.cjs"`,
      ],
    },
    run: [
      {
        file: "/out/entry-nope.js",
        stdout: `undefined undefined undefined`,
      },
      {
        file: "/out/entry-default.js",
        stdout: `{} undefined {}`,
      },
    ],
  });
  itBundled("importstar/ImportNamespaceUndefinedPropertySideEffectFreeFile", {
    todo: true,
    files: {
      "/entry-nope.js": /* js */ `
        import * as js from './foo/no-side-effects.js'
        import * as mjs from './foo/no-side-effects.mjs'
        import * as cjs from './foo/no-side-effects.cjs'
        console.log(
          js.nope,
          mjs.nope,
          cjs.nope,
        )
      `,
      "/entry-default.js": /* js */ `
        import * as js from './foo/no-side-effects.js'
        import * as mjs from './foo/no-side-effects.mjs'
        import * as cjs from './foo/no-side-effects.cjs'
        console.log(
          js.default,
          mjs.default,
          cjs.default,
        )
      `,
      "/foo/package.json": `{ "sideEffects": false }`,
      "/foo/no-side-effects.js": `console.log('js')`,
      "/foo/no-side-effects.mjs": `console.log('mjs')`,
      "/foo/no-side-effects.cjs": `console.log('cjs')`,
    },
    entryPoints: ["/entry-nope.js", "/entry-default.js"],
    run: [
      {
        file: "/out/entry-nope.js",
        stdout: `js\ncjs\nundefined undefined undefined`,
      },
      {
        file: "/out/entry-default.js",
        stdout: `js\ncjs\n{} undefined {}`,
      },
    ],
    bundleWarnings: {
      "/foo/no-side-effects.js": [
        `Import "nope" will always be undefined because the file "foo/no-side-effects.js" has no exports`,
      ],
      "/foo/no-side-effects.mjs": [
        `Import "nope" will always be undefined because the file "foo/no-side-effects.mjs" has no exports`,
      ],
      "/foo/no-side-effects.cjs": [
        `Import "nope" will always be undefined because the file "foo/no-side-effects.cjs" has no exports`,
      ],
      "/entry-default.js": [
        `Import "default" will always be undefined because there is no matching export in "foo/no-side-effects.js"`,
        `Import "default" will always be undefined because there is no matching export in "foo/no-side-effects.mjs"`,
      ],
    },
  });
  itBundled("importstar/ReExportStarEntryPointAndInnerFileExternal", {
    files: {
      "/entry.js": /* js */ `
        export * from 'a'
        import * as inner from './inner.js'
        export { inner }
      `,
      "/inner.js": `export * from 'b'`,
    },
    format: "cjs",
    external: ["a", "b"],
    runtimeFiles: {
      "/test.js": /* js */ `
      console.log(JSON.stringify(require('./out.js')))
      `,
      "/node_modules/a/index.js": /* js */ `
       export const a = 123;
     `,
      "/node_modules/b/index.js": /* js */ `
       export const b = 456;
     `,
    },
    run: {
      file: "/test.js",
      stdout: '{"inner":{"b":456},"a":123,"b":456}',
    },
  });
  itBundled("importstar/ReExportStarEntryPointAndInnerFile", {
    files: {
      "/entry.js": /* js */ `
        export * from 'a'
        import * as inner from './inner.js'
        export { inner }
      `,
      "/inner.js": `export * from 'b'`,
      "/node_modules/a/index.js": /* js */ `
      export const a = 123;
    `,
      "/node_modules/b/index.js": /* js */ `
      export const b = 456;
    `,
    },
    format: "cjs",
    runtimeFiles: {
      "/test.js": /* js */ `
        console.log(JSON.stringify(require('./out.js')))
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"inner":{"b":456},"a":123}',
    },
  });
});
