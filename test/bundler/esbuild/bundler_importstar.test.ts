import assert from "assert";
import { expectBundled, itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

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
      "/foo.js": `export const foo = "FAILED"`,
    },
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").includes("FAILED"), "should have tree shaken foo.js");
    },
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
      stdout: '{"foo":123} 123 234',
    },
  });
  return;
  itBundled("importstar/ImportStarNoCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
    },
  });
  itBundled("importstar/ImportStarExportImportStarUnused", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": /* js */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
  });
  itBundled("importstar/ImportStarExportImportStarNoCapture", {
    // GENERATED
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
  });
  itBundled("importstar/ImportStarExportImportStarCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": /* js */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
  });
  itBundled("importstar/ImportStarExportStarAsUnused", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * as ns from './foo'`,
    },
  });
  itBundled("importstar/ImportStarExportStarAsNoCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * as ns from './foo'`,
    },
  });
  itBundled("importstar/ImportStarExportStarAsCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * as ns from './foo'`,
    },
  });
  itBundled("importstar/ImportStarExportStarUnused", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * from './foo'`,
    },
  });
  itBundled("importstar/ImportStarExportStarNoCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * from './foo'`,
    },
  });
  itBundled("importstar/ImportStarExportStarCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
      "/bar.js": `export * from './foo'`,
    },
  });
  itBundled("importstar/ImportStarCommonJSUnused", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `exports.foo = 123`,
    },
  });
  itBundled("importstar/ImportStarCommonJSCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.js": `exports.foo = 123`,
    },
  });
  itBundled("importstar/ImportStarCommonJSNoCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.js": `exports.foo = 123`,
    },
  });
  itBundled("importstar/ImportStarAndCommonJS", {
    // GENERATED
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
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    mode: "transform",
  });
  itBundled("importstar/ImportStarNoBundleCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
    },
    mode: "transform",
  });
  itBundled("importstar/ImportStarNoBundleNoCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    mode: "transform",
  });
  itBundled("importstar/ImportStarMangleNoBundleUnused", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("importstar/ImportStarMangleNoBundleCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("importstar/ImportStarMangleNoBundleNoCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("importstar/ImportStarExportStarOmitAmbiguous", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './common'
        console.log(ns)
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
  });
  itBundled("importstar/ImportExportStarAmbiguousError", {
    // GENERATED
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
    /* TODO FIX expectedCompileLog: `entry.js: ERROR: Ambiguous import "y" has multiple matching exports
  foo.js: NOTE: One matching export is here:
  bar.js: NOTE: Another matching export is here:
  `, */
  });
  itBundled("importstar/ImportExportStarAmbiguousWarning", {
    // GENERATED
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
    /* TODO FIX expectedCompileLog: `entry.js: WARNING: Import "y" will always be undefined because there are multiple matching exports
  foo.js: NOTE: One matching export is here:
  bar.js: NOTE: Another matching export is here:
  `, */
  });
  itBundled("importstar/ReExportStarNameCollisionNotAmbiguousImport", {
    // GENERATED
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
  });
  itBundled("importstar/ReExportStarNameCollisionNotAmbiguousExport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export * from './a'
        export * from './b'
      `,
      "/a.js": `export * from './c'`,
      "/b.js": `export {x} from './c'`,
      "/c.js": `export let x = 1, y = 2`,
    },
    format: "esm",
  });
  itBundled("importstar/ReExportStarNameShadowingNotAmbiguous", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {x} from './a'
        console.log(x)
      `,
      "/a.js": /* js */ `
        export * from './b'
        export let x = 1
      `,
      "/b.js": `export let x = 2`,
    },
    format: "esm",
  });
  itBundled("importstar/ReExportStarNameShadowingNotAmbiguousReExport", {
    // GENERATED
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
      "/c.js": `export let x = 2`,
    },
    format: "esm",
  });
  itBundled("importstar/ImportStarOfExportStarAs", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as foo_ns from './foo'
        console.log(foo_ns)
      `,
      "/foo.js": `export * as bar_ns from './bar'`,
      "/bar.js": `export const bar = 123`,
    },
  });
  itBundled("importstar/ImportOfExportStar", {
    // GENERATED
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
  });
  itBundled("importstar/ImportOfExportStarOfImport", {
    // GENERATED
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
  });
  itBundled("importstar/ExportSelfIIFE", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "iife",
  });
  itBundled("importstar/ExportSelfIIFEWithName", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "iife",
  });
  itBundled("importstar/ExportSelfES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "esm",
  });
  itBundled("importstar/ExportSelfCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * from './entry'
      `,
    },
    format: "cjs",
  });
  itBundled("importstar/ExportSelfCommonJSMinified", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        module.exports = {foo: 123}
        console.log(require('./entry'))
      `,
    },
    minifyIdentifiers: true,
    format: "cjs",
  });
  itBundled("importstar/ImportSelfCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        exports.foo = 123
        import {foo} from './entry'
        console.log(foo)
      `,
    },
    format: "cjs",
  });
  itBundled("importstar/ExportSelfAsNamespaceES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * as ns from './entry'
      `,
    },
    format: "esm",
  });
  itBundled("importstar/ImportExportSelfAsNamespaceES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        import * as ns from './entry'
        export {ns}
      `,
    },
    format: "esm",
  });
  itBundled("importstar/ReExportOtherFileExportSelfAsNamespaceES6", {
    // GENERATED
    files: {
      "/entry.js": `export * from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        export * as ns from './foo'
      `,
    },
    format: "esm",
  });
  itBundled("importstar/ReExportOtherFileImportExportSelfAsNamespaceES6", {
    // GENERATED
    files: {
      "/entry.js": `export * from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        import * as ns from './foo'
        export {ns}
      `,
    },
    format: "esm",
  });
  itBundled("importstar/OtherFileExportSelfAsNamespaceUnusedES6", {
    // GENERATED
    files: {
      "/entry.js": `export {foo} from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        export * as ns from './foo'
      `,
    },
    format: "esm",
  });
  itBundled("importstar/OtherFileImportExportSelfAsNamespaceUnusedES6", {
    // GENERATED
    files: {
      "/entry.js": `export {foo} from './foo'`,
      "/foo.js": /* js */ `
        export const foo = 123
        import * as ns from './foo'
        export {ns}
      `,
    },
    format: "esm",
  });
  itBundled("importstar/ExportSelfAsNamespaceCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        export * as ns from './entry'
      `,
    },
    format: "cjs",
  });
  itBundled("importstar/ExportSelfAndRequireSelfCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export const foo = 123
        console.log(require('./entry'))
      `,
    },
    format: "cjs",
  });
  itBundled("importstar/ExportSelfAndImportSelfCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as x from './entry'
        export const foo = 123
        console.log(x)
      `,
    },
    format: "cjs",
  });
  itBundled("importstar/ExportOtherAsNamespaceCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * as ns from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
  });
  itBundled("importstar/ImportExportOtherAsNamespaceCommonJS", {
    // GENERATED
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
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns, ns.foo)
      `,
      "/foo.js": `export const x = 123`,
    },
    /* TODO FIX expectedCompileLog: `entry.js: DEBUG: Import "foo" will always be undefined because there is no matching export in "foo.js"
  `, */
  });
  itBundled("importstar/ExportOtherCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export {bar} from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
  });
  itBundled("importstar/ExportOtherNestedCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export {y} from './bar'`,
      "/bar.js": `export {x as y} from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
  });
  itBundled("importstar/NamespaceImportUnusedMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export const x = 123`,
    },
    /* TODO FIX expectedCompileLog: `entry.js: DEBUG: Import "foo" will always be undefined because there is no matching export in "foo.js"
  `, */
  });
  itBundled("importstar/NamespaceImportMissingCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns, ns.foo)
      `,
      "/foo.js": `exports.x = 123`,
    },
  });
  itBundled("importstar/NamespaceImportUnusedMissingCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `exports.x = 123`,
    },
  });
  itBundled("importstar/ReExportNamespaceImportMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './foo'
        console.log(ns, ns.foo)
      `,
      "/foo.js": `export * as ns from './bar'`,
      "/bar.js": `export const x = 123`,
    },
  });
  itBundled("importstar/ReExportNamespaceImportUnusedMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {ns} from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export * as ns from './bar'`,
      "/bar.js": `export const x = 123`,
    },
  });
  itBundled("importstar/NamespaceImportReExportMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns, ns.foo)
      `,
      "/foo.js": `export {foo} from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    /* TODO FIX expectedCompileLog: `foo.js: ERROR: No matching export in "bar.js" for import "foo"
  foo.js: ERROR: No matching export in "bar.js" for import "foo"
  `, */
  });
  itBundled("importstar/NamespaceImportReExportUnusedMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export {foo} from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    /* TODO FIX expectedCompileLog: `foo.js: ERROR: No matching export in "bar.js" for import "foo"
  foo.js: ERROR: No matching export in "bar.js" for import "foo"
  `, */
  });
  itBundled("importstar/NamespaceImportReExportStarMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns, ns.foo)
      `,
      "/foo.js": `export * from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    /* TODO FIX expectedCompileLog: `entry.js: DEBUG: Import "foo" will always be undefined because there is no matching export in "foo.js"
  `, */
  });
  itBundled("importstar/NamespaceImportReExportStarUnusedMissingES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.foo)
      `,
      "/foo.js": `export * from './bar'`,
      "/bar.js": `export const x = 123`,
    },
    /* TODO FIX expectedCompileLog: `entry.js: DEBUG: Import "foo" will always be undefined because there is no matching export in "foo.js"
  `, */
  });
  itBundled("importstar/ExportStarDefaultExportCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * from './foo'`,
      "/foo.js": /* js */ `
        export default 'default' // This should not be picked up
        export let foo = 'foo'
      `,
    },
    format: "cjs",
  });
  itBundled("importstar/Issue176", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as things from './folders'
        console.log(JSON.stringify(things))
      `,
      "/folders/index.js": `export * from "./child"`,
      "/folders/child/index.js": `export { foo } from './foo'`,
      "/folders/child/foo.js": `export const foo = () => 'hi there'`,
    },
  });
  itBundled("importstar/ReExportStarExternalIIFE", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "iife",
    globalName: "mod",
  });
  itBundled("importstar/ReExportStarExternalES6", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "esm",
  });
  itBundled("importstar/ReExportStarExternalCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "cjs",
  });
  itBundled("importstar/ReExportStarIIFENoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "iife",
    mode: "convertformat",
  });
  itBundled("importstar/ReExportStarES6NoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("importstar/ReExportStarCommonJSNoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("importstar/ReExportStarAsExternalIIFE", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "iife",
    globalName: "mod",
  });
  itBundled("importstar/ReExportStarAsExternalES6", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "esm",
  });
  itBundled("importstar/ReExportStarAsExternalCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "cjs",
  });
  itBundled("importstar/ReExportStarAsIIFENoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "iife",
    mode: "convertformat",
  });
  itBundled("importstar/ReExportStarAsES6NoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("importstar/ReExportStarAsCommonJSNoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("importstar/ImportDefaultNamespaceComboIssue446", {
    // GENERATED
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
    /* TODO FIX expectedCompileLog: `internal-def.js: DEBUG: Import "def" will always be undefined because there is no matching export in "internal.js"
  internal-ns-def.js: DEBUG: Import "def" will always be undefined because there is no matching export in "internal.js"
  `, */
  });
  itBundled("importstar/ImportDefaultNamespaceComboNoDefault", {
    // GENERATED
    files: {
      "/entry-default-ns-prop.js": `import def, * as ns from './foo'; console.log(def, ns, ns.default)`,
      "/entry-default-ns.js": `import def, * as ns from './foo'; console.log(def, ns)`,
      "/entry-default-prop.js": `import def, * as ns from './foo'; console.log(def, ns.default)`,
      "/entry-default.js": `import def from './foo'; console.log(def)`,
      "/entry-prop.js": `import * as ns from './foo'; console.log(ns.default)`,
      "/foo.js": `export let foo = 123`,
    },
    entryPoints: [
      "/entry-default-ns-prop.js",
      "/entry-default-ns.js",
      "/entry-default-prop.js",
      "/entry-default.js",
      "/entry-prop.js",
    ],
    /* TODO FIX expectedCompileLog: `entry-default-ns-prop.js: ERROR: No matching export in "foo.js" for import "default"
  entry-default-ns-prop.js: DEBUG: Import "default" will always be undefined because there is no matching export in "foo.js"
  entry-default-ns.js: ERROR: No matching export in "foo.js" for import "default"
  entry-default-prop.js: ERROR: No matching export in "foo.js" for import "default"
  entry-default-prop.js: DEBUG: Import "default" will always be undefined because there is no matching export in "foo.js"
  entry-default.js: ERROR: No matching export in "foo.js" for import "default"
  entry-prop.js: DEBUG: Import "default" will always be undefined because there is no matching export in "foo.js"
  `, */
  });
  itBundled("importstar/ImportNamespaceUndefinedPropertyEmptyFile", {
    // GENERATED
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
    /* TODO FIX expectedCompileLog: `entry-default.js: DEBUG: Import "default" will always be undefined because there is no matching export in "empty.mjs"
  entry-nope.js: WARNING: Import "nope" will always be undefined because the file "empty.js" has no exports
  entry-nope.js: WARNING: Import "nope" will always be undefined because the file "empty.mjs" has no exports
  entry-nope.js: WARNING: Import "nope" will always be undefined because the file "empty.cjs" has no exports
  `, */
  });
  itBundled("importstar/ImportNamespaceUndefinedPropertySideEffectFreeFile", {
    // GENERATED
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
    /* TODO FIX expectedCompileLog: `entry-default.js: DEBUG: Import "default" will always be undefined because there is no matching export in "foo/no-side-effects.mjs"
  entry-nope.js: WARNING: Import "nope" will always be undefined because the file "foo/no-side-effects.js" has no exports
  entry-nope.js: WARNING: Import "nope" will always be undefined because the file "foo/no-side-effects.mjs" has no exports
  entry-nope.js: WARNING: Import "nope" will always be undefined because the file "foo/no-side-effects.cjs" has no exports
  `, */
  });
  itBundled("importstar/ReExportStarEntryPointAndInnerFile", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export * from 'a'
        import * as inner from './inner.js'
        export { inner }
      `,
      "/inner.js": `export * from 'b'`,
    },
    format: "cjs",
  });
});
