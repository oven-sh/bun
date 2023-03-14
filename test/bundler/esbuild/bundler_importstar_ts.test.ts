import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_importstar_ts_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/ts

describe("bundler", () => {
  itBundled("ts/TSImportStarUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportImportStarUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": /* ts */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportImportStarNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": /* ts */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportImportStarCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": /* ts */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportStarAsUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportStarAsNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportStarAsCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportStarUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportStarNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarExportStarCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarCommonJSUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarCommonJSCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarCommonJSNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarAndCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        const ns2 = require('./foo')
        console.log(ns.foo, ns2.foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    snapshot: true,
  });
  itBundled("ts/TSImportStarNoBundleUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    mode: "transform",
    snapshot: true,
  });
  itBundled("ts/TSImportStarNoBundleCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
    },
    mode: "transform",
    snapshot: true,
  });
  itBundled("ts/TSImportStarNoBundleNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    mode: "transform",
    snapshot: true,
  });
  itBundled("ts/TSImportStarMangleNoBundleUnused", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
    snapshot: true,
  });
  itBundled("ts/TSImportStarMangleNoBundleCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
    snapshot: true,
  });
  itBundled("ts/TSImportStarMangleNoBundleNoCapture", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
    snapshot: true,
  });
  itBundled("ts/TSReExportTypeOnlyFileES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './re-export'
        console.log(ns.foo)
      `,
      "/re-export.ts": /* ts */ `
        export * from './types1'
        export * from './types2'
        export * from './types3'
        export * from './values'
      `,
      "/types1.ts": /* ts */ `
        export interface Foo {}
        export type Bar = number
        console.log('some code')
      `,
      "/types2.ts": /* ts */ `
        import {Foo} from "./type"
        export {Foo}
        console.log('some code')
      `,
      "/types3.ts": /* ts */ `
        export {Foo} from "./type"
        console.log('some code')
      `,
      "/values.ts": `export let foo = 123`,
      "/type.ts": `export type Foo = number`,
    },
    snapshot: true,
  });
});
