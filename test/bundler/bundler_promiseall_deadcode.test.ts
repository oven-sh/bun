import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("bundler/__promiseAll is tree-shaken when only one async import exists but __esm remains", {
    files: {
      "/entry.ts": `
        const { AsyncEntryPoint } = await import("./AsyncEntryPoint");
        AsyncEntryPoint();
        export {};
      `,
      "/AsyncEntryPoint.ts": `
        export async function AsyncEntryPoint() {
          const { BaseElement } = await import("./BaseElement");
          console.log("Launching AsyncEntryPoint", BaseElement());
        }
      `,
      "/BaseElement.ts": `
        import { StoreDependency } from "./StoreDependency";
        import { BaseElementImport } from "./BaseElementImport";

        const depValue = StoreDependency();

        export const formValue = {
          key: depValue,
        };

        export const listValue = {
          key: depValue + "value",
        };

        export function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
      `,
      "/BaseElementImport.ts": `
        import { SecondElementImport } from "./SecondElementImport";
        export function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
      `,
      "/SecondElementImport.ts": `
        import { formValue } from "./BaseElement";
        export function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
      `,
      "/StoreDependency.ts": `
        import { somePromise } from "./StoreDependencyAsync";

        export function StoreDependency() {
          return "A string from StoreFunc" + somePromise;
        }
      `,
      "/StoreDependencyAsync.ts": `
        export const somePromise = await Promise.resolve("Hello World");
      `,
    },
    format: "esm",
    target: "browser",
    sourceMap: "linked",
    minifySyntax: false,
    minifyWhitespace: false,
    minifyIdentifiers: false,
    run: {
      partialStdout: "Launching AsyncEntryPoint",
      validate({ stderr }) {
        expect(stderr).not.toContain('await" can only be used inside an "async" function');
      },
    },
    onAfterBundle(api) {
      const bundled = api.readFile("out.js");

      expect(bundled).toMatchInlineSnapshot(`
        "var __esm = (fn, res, err) => () => {
          if (fn)
            try {
              res = fn(fn = 0);
            } catch (e) {
              err = [e];
            }
          if (err)
            throw err[0];
          return res;
        };
        var __promiseAll = (args) => Promise.all(args);

        // StoreDependencyAsync.ts
        var somePromise;
        var init_StoreDependencyAsync = __esm(async () => {
          somePromise = await Promise.resolve("Hello World");
        });

        // StoreDependency.ts
        function StoreDependency() {
          return "A string from StoreFunc" + somePromise;
        }
        var init_StoreDependency = __esm(async () => {
          await init_StoreDependencyAsync();
        });

        // SecondElementImport.ts
        function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
        var init_SecondElementImport = __esm(async () => {
          await init_BaseElement();
        });

        // BaseElementImport.ts
        function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
        var init_BaseElementImport = __esm(async () => {
          await init_SecondElementImport();
        });

        // BaseElement.ts
        function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
        var depValue, formValue, listValue;
        var init_BaseElement = __esm(async () => {
          await __promiseAll([
            init_StoreDependency(),
            init_BaseElementImport()
          ]);
          depValue = StoreDependency();
          formValue = {
            key: depValue
          };
          listValue = {
            key: depValue + "value"
          };
        });

        // AsyncEntryPoint.ts
        async function AsyncEntryPoint() {
          await init_BaseElement();
          console.log("Launching AsyncEntryPoint", BaseElement());
        }

        // entry.ts
        await Promise.resolve();
        AsyncEntryPoint();

        //# debugId=B9EF7E5F2ACBD11D64756E2164756E21
        //# sourceMappingURL=out.js.map
        "
      `);

      // MUST have __esm because of circular dependency requiring wrapping
      expect(bundled).toContain("__esm");
      expect(bundled).toContain("var init_");

      // Should have __promiseAll because BaseElement has multiple dependencies
      // even though only one is async (due to circular deps both need to be awaited)
      expect(bundled).toContain("__promiseAll");
      expect(bundled).toContain("var __promiseAll = ");

      // Verify it's used with both dependencies
      expect(bundled).toMatch(/await\s+__promiseAll\s*\(\s*\[/);
    },
  });

  itBundled("bundler/__promiseAll is included when multiple async imports exist with __esm", {
    files: {
      "/entry.ts": `
        const { AsyncEntryPoint } = await import("./AsyncEntryPoint");
        AsyncEntryPoint();
        export {};
      `,
      "/AsyncEntryPoint.ts": `
        export async function AsyncEntryPoint() {
          const { BaseElement } = await import("./BaseElement");
          console.log("Launching AsyncEntryPoint", BaseElement());
        }
      `,
      "/BaseElement.ts": `
        import { StoreDependency } from "./StoreDependency";
        import { StoreDependency2 } from "./StoreDependency2";
        import { BaseElementImport } from "./BaseElementImport";

        const depValue = StoreDependency();
        const depValue2 = StoreDependency2();

        export const formValue = {
          key: depValue + depValue2,
        };

        export const listValue = {
          key: depValue + "value",
        };

        export function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
      `,
      "/BaseElementImport.ts": `
        import { SecondElementImport } from "./SecondElementImport";
        export function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
      `,
      "/SecondElementImport.ts": `
        import { formValue } from "./BaseElement";
        export function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
      `,
      "/StoreDependency.ts": `
        import { somePromise } from "./StoreDependencyAsync";

        export function StoreDependency() {
          return "A string from StoreFunc" + somePromise;
        }
      `,
      "/StoreDependencyAsync.ts": `
        export const somePromise = await Promise.resolve("Hello World");
      `,
      "/StoreDependency2.ts": `
        import { somePromise2 } from "./StoreDependencyAsync2";

        export function StoreDependency2() {
          return "Another string" + somePromise2;
        }
      `,
      "/StoreDependencyAsync2.ts": `
        export const somePromise2 = await Promise.resolve(" World2");
      `,
    },
    format: "esm",
    target: "browser",
    sourceMap: "linked",
    minifySyntax: false,
    minifyWhitespace: false,
    minifyIdentifiers: false,
    run: {
      partialStdout: "Launching AsyncEntryPoint",
      validate({ stderr }) {
        expect(stderr).not.toContain('await" can only be used inside an "async" function');
      },
    },
    onAfterBundle(api) {
      const bundled = api.readFile("out.js");

      // MUST have __esm because of circular dependency requiring wrapping
      expect(bundled).toContain("__esm");
      expect(bundled).toContain("var init_");

      // MUST have __promiseAll since there are TWO async dependencies
      expect(bundled).toContain("__promiseAll");
      expect(bundled).toContain("var __promiseAll = ");

      // Verify it's actually used in the code with multiple async deps
      expect(bundled).toMatch(/await\s+__promiseAll\s*\(\s*\[/);
    },
  });

  itBundled("bundler/__promiseAll is tree-shaken when no async imports despite circular deps with __esm", {
    files: {
      "/entry.ts": `
        const { AsyncEntryPoint } = await import("./AsyncEntryPoint");
        AsyncEntryPoint();
        export {};
      `,
      "/AsyncEntryPoint.ts": `
        export async function AsyncEntryPoint() {
          const { BaseElement } = await import("./BaseElement");
          console.log("Launching AsyncEntryPoint", BaseElement());
        }
      `,
      "/BaseElement.ts": `
        import { BaseElementImport } from "./BaseElementImport";

        export const formValue = {
          key: "static value",
        };

        export const listValue = {
          key: "static list value",
        };

        export function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
      `,
      "/BaseElementImport.ts": `
        import { SecondElementImport } from "./SecondElementImport";
        export function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
      `,
      "/SecondElementImport.ts": `
        import { formValue } from "./BaseElement";
        export function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
      `,
    },
    format: "esm",
    target: "browser",
    sourceMap: "linked",
    minifySyntax: false,
    minifyWhitespace: false,
    minifyIdentifiers: false,
    run: {
      partialStdout: "Launching AsyncEntryPoint",
      validate({ stderr }) {
        expect(stderr).not.toContain('await" can only be used inside an "async" function');
      },
    },
    onAfterBundle(api) {
      const bundled = api.readFile("out.js");

      expect(bundled).toMatchInlineSnapshot(`
        "var __esm = (fn, res, err) => () => {
          if (fn)
            try {
              res = fn(fn = 0);
            } catch (e) {
              err = [e];
            }
          if (err)
            throw err[0];
          return res;
        };

        // SecondElementImport.ts
        function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
        var init_SecondElementImport = __esm(() => {
          init_BaseElement();
        });

        // BaseElementImport.ts
        function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
        var init_BaseElementImport = __esm(() => {
          init_SecondElementImport();
        });

        // BaseElement.ts
        function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
        var formValue;
        var init_BaseElement = __esm(() => {
          init_BaseElementImport();
          formValue = {
            key: "static value"
          };
        });

        // AsyncEntryPoint.ts
        async function AsyncEntryPoint() {
          await Promise.resolve().then(() => init_BaseElement());
          console.log("Launching AsyncEntryPoint", BaseElement());
        }

        // entry.ts
        await Promise.resolve();
        AsyncEntryPoint();

        //# debugId=6678C3B13A630A4064756E2164756E21
        //# sourceMappingURL=out.js.map
        "
      `);

      // MUST have __esm because of circular dependency requiring wrapping
      expect(bundled).toContain("__esm");
      expect(bundled).toContain("var init_");

      // Currently __promiseAll is always included with ESM wrappers (not tree-shaken)
      // but it shouldn't be used since there are no async dependencies
      expect(bundled).not.toContain("__promiseAll");
      expect(bundled).not.toContain("var __promiseAll = ");

      // Verify it's NOT actually used in any init functions
      expect(bundled).not.toMatch(/await\s+__promiseAll\s*\(/);
    },
  });

  // p.mjs and q.mjs are on an import cycle with r.mjs, and only r.mjs imports the
  // file with the top-level await. Each of the three wrappers has an `await`, so
  // each has to be `async`.
  itBundled("bundler/every __esm wrapper on an import cycle that reaches a top-level await is async", {
    files: {
      "/entry.mjs": `const m = await import("./r.mjs"); console.log(m.default);`,
      "/p.mjs": `import { q } from "./q.mjs"; export function p() { return typeof q; }`,
      "/q.mjs": `import { p } from "./p.mjs"; import r from "./r.mjs"; export function q() { return p(); } export const peekR = () => r;`,
      "/r.mjs": `import { q } from "./q.mjs"; import { tla } from "./dep.mjs"; export default q() + tla;`,
      "/dep.mjs": `export const tla = await Promise.resolve("x");`,
    },
    format: "esm",
    run: { stdout: "functionx" },
  });

  // https://github.com/evanw/esbuild/issues/4498
  itBundled("bundler/__esm wrappers of an import cycle with a top-level await behind import() are async", {
    files: {
      "/entry.mjs": `await import("./main.mjs");`,
      "/main.mjs": `import { a } from "./a.mjs"; console.log(a());`,
      "/a.mjs": `import { b } from "./b.mjs"; import { tla } from "./dep.mjs"; export function a() { return b() + tla; }`,
      "/b.mjs": `import { a } from "./a.mjs"; export function b() { return typeof a; }`,
      "/dep.mjs": `export const tla = await Promise.resolve("x");`,
    },
    format: "esm",
    run: { stdout: "functionx" },
  });

  // f.js imports p.js, which is on an import cycle that reaches a top-level
  // await, so f.js is async and may not fold into the chunk of x.js: that
  // chunk would wait for the await before it logs.
  itBundled("bundler/an importer of an async import cycle does not fold into a chunk that runs first", {
    files: {
      "/a.js": `import "./r.js"; import { f } from "./f.js"; console.log("a", f());`,
      "/b.js": `import { g } from "./g.js"; console.log("b", g());`,
      "/c.js": `import { x } from "./x.js"; import { f } from "./f.js"; console.log("c", x, f());`,
      "/d.js": `import { x } from "./x.js"; import { g } from "./g.js"; console.log("d", x, g());`,
      "/f.js": `import { p } from "./p.js"; import { x } from "./x.js"; export function f() { return p() + x; }`,
      "/g.js": `import { q } from "./q.js"; export function g() { return typeof q; }`,
      "/x.js": `console.log("eval x"); export const x = "x"; // ${Buffer.alloc(16 * 1024, "padding ").toString()}`,
      "/p.js": `import { q } from "./q.js"; export function p() { return typeof q; }`,
      "/q.js": `import { p } from "./p.js"; import { r } from "./r.js"; export function q() { return typeof p + typeof r; }`,
      "/r.js": `import { q } from "./q.js"; import { t } from "./t.js"; export function r() { return typeof q + t; }`,
      "/t.js": `console.log("pre t"); export const t = await Promise.resolve("t"); console.log("tla t");`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js", "/d.js"],
    splitting: true,
    minChunkSize: 1024 * 1024,
    outdir: "/out",
    format: "esm",
    run: [
      { file: "/out/a.js", stdout: "pre t\neval x\ntla t\na functionx" },
      { file: "/out/c.js", stdout: "eval x\npre t\ntla t\nc x functionx" },
      { file: "/out/d.js", stdout: "eval x\npre t\ntla t\nd x function" },
    ],
  });
});
