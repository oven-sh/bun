import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_importstar_ts_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/ts
describe("bundler", () => {
  itBundled("importstar_ts/Unused", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    run: { stdout: "234" },
  });
  itBundled("importstar_ts/Capture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/NoCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/ExportImportStarUnused", {
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
    run: { stdout: "234" },
  });
  itBundled("importstar_ts/ExportImportStarNoCapture", {
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
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/ExportImportStarCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": /* ts */ `
        import * as ns from './foo'
        export {ns}
      `,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/ExportStarAsUnused", {
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
  itBundled("importstar_ts/ExportStarAsNoCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/ExportStarAsCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import {ns} from './bar'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * as ns from './foo'`,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/ExportStarUnused", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
    run: { stdout: "234" },
  });
  itBundled("importstar_ts/ExportStarNoCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/ExportStarCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './bar'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.ts": `export const foo = 123`,
      "/bar.ts": `export * from './foo'`,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/CommonJSUnused", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
    run: { stdout: "234" },
  });
  itBundled("importstar_ts/CommonJSCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/CommonJSNoCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
      "/foo.ts": `exports.foo = 123`,
    },
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/TSAndCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        const ns2 = require('./foo')
        console.log(ns.foo, ns2.foo)
      `,
      "/foo.ts": `export const foo = 123`,
    },
    run: { stdout: "123 123" },
  });
  itBundled("importstar_ts/NoBundleUnused", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    target: "bun",
    bundling: false,
    run: { stdout: "234" },
  });
  itBundled("importstar_ts/NoBundleCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
    },
    target: "bun",
    bundling: false,
    runtimeFiles: {
      "/foo.js": `
        export const foo = 123
      `,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/NoBundleNoCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    target: "bun",
    bundling: false,
    runtimeFiles: {
      "/foo.js": `
        export const foo = 123
      `,
    },
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/MangleNoBundleUnused", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(foo)
      `,
    },
    minifySyntax: true,
    target: "bun",
    bundling: false,
    runtimeFiles: {
      "/foo.js": `
        export const foo = 123
      `,
    },
    run: { stdout: "234" },
  });
  itBundled("importstar_ts/MangleNoBundleCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(JSON.stringify(ns), ns.foo, foo)
      `,
    },
    minifySyntax: true,
    bundling: false,
    runtimeFiles: {
      "/foo.js": `
        export const foo = 123
      `,
    },
    run: { stdout: '{"foo":123} 123 234' },
  });
  itBundled("importstar_ts/MangleNoBundleNoCapture", {
    files: {
      "/entry.ts": /* ts */ `
        import * as ns from './foo'
        let foo = 234
        console.log(ns.foo, ns.foo, foo)
      `,
    },
    minifySyntax: true,
    bundling: false,
    runtimeFiles: {
      "/foo.js": `
        export const foo = 123
      `,
    },
    run: { stdout: "123 123 234" },
  });
  itBundled("importstar_ts/ReExportTypeOnlyFileES6", {
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
        export type Bar = number;
        console.log('some code')
      `,
      "/types2.ts": /* ts */ `
        import {Foo} from "./type"
        export {Foo}
        console.log('some code')
      `,
      "/types3.ts": /* ts */ `
        export {Foo} from "./type"
        console.log('some code');
      `,
      "/values.ts": `export let foo = 123`,
      "/type.ts": `export type Foo = number`,
    },
  });
});
