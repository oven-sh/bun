import { test, describe } from "bun:test";
import { RUN_UNCHECKED_TESTS, itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_importstar_ts_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/ts

describe("bundler", () => {
  return;
  itBundled("ts/TSImportStarUnused", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
  });
  itBundled("ts/TSImportStarCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
  });
  itBundled("ts/TSImportStarNoCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
  });
  itBundled("ts/TSImportStarExportImportStarUnused", {
    // GENERATED
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
  });
  itBundled("ts/TSImportStarExportImportStarNoCapture", {
    // GENERATED
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
  });
  itBundled("ts/TSImportStarExportImportStarCapture", {
    // GENERATED
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
  });
  itBundled("ts/TSImportStarExportStarAsUnused", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
  });
  itBundled("ts/TSImportStarExportStarAsNoCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
  });
  itBundled("ts/TSImportStarExportStarAsCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
  });
  itBundled("ts/TSImportStarExportStarUnused", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
  });
  itBundled("ts/TSImportStarExportStarNoCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
  });
  itBundled("ts/TSImportStarExportStarCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
  });
  itBundled("ts/TSImportStarCommonJSUnused", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
  });
  itBundled("ts/TSImportStarCommonJSCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
  });
  itBundled("ts/TSImportStarCommonJSNoCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
  });
  itBundled("ts/TSImportStarAndCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        const ns2 = require('./foo')
        console.log(ns.foo, ns2.foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
  });
  itBundled("ts/TSImportStarNoBundleUnused", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    mode: "transform",
  });
  itBundled("ts/TSImportStarNoBundleCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
    },
    mode: "transform",
  });
  itBundled("ts/TSImportStarNoBundleNoCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    mode: "transform",
  });
  itBundled("ts/TSImportStarMangleNoBundleUnused", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("ts/TSImportStarMangleNoBundleCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("ts/TSImportStarMangleNoBundleNoCapture", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("ts/TSReExportTypeOnlyFileES6", {
    // GENERATED
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
  });
});
