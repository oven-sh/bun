import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_importstar_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/importstar

describe("bundler", () => {
  itBundled("importstar/ImportStarUnused", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.js": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("importstar/ImportStarCapture", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.js": `export const foo = 123`,
    },
    snapshot: true,
  });
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
  });
  itBundled("importstar/ExportOtherAsNamespaceCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * as ns from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
    snapshot: true,
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
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
  });
  itBundled("importstar/ExportOtherCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export {bar} from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
    snapshot: true,
  });
  itBundled("importstar/ExportOtherNestedCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export {y} from './bar'`,
      "/bar.js": `export {x as y} from './foo'`,
      "/foo.js": `exports.foo = 123`,
    },
    format: "cjs",
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    snapshot: true,
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
    snapshot: true,
  });
  itBundled("importstar/ReExportStarExternalIIFE", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "iife",
    globalName: "mod",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarExternalES6", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "esm",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarExternalCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "cjs",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarIIFENoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "iife",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarES6NoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "esm",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarCommonJSNoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * from "foo"`,
    },
    format: "cjs",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarAsExternalIIFE", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "iife",
    globalName: "mod",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarAsExternalES6", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "esm",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarAsExternalCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "cjs",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarAsIIFENoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "iife",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarAsES6NoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "esm",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("importstar/ReExportStarAsCommonJSNoBundle", {
    // GENERATED
    files: {
      "/entry.js": `export * as out from "foo"`,
    },
    format: "cjs",
    mode: "convertformat",
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    debugLogs: true,
    snapshot: true,
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
    snapshot: true,
  });
});
