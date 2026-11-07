import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Without code splitting, the modules behind an import() that reach a top-level await are `__tlaModule` records
  // (see bundler_tla.test.ts). Neither `__esm` nor `__promiseAll` is involved.
  itBundled("bundler/__promiseAll and __esm are not used for a cycle that reaches one top-level await", {
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

      expect(bundled.slice(bundled.indexOf("// StoreDependencyAsync.ts"), bundled.indexOf("//# debugId")))
        .toMatchInlineSnapshot(`
        "// StoreDependencyAsync.ts
        var somePromise;
        var init_StoreDependencyAsync = __tlaModule(async () => {
          somePromise = await Promise.resolve("Hello World");
        }, 1, () => {});

        // StoreDependency.ts
        function StoreDependency() {
          return "A string from StoreFunc" + somePromise;
        }
        var init_StoreDependency = __tlaModule(() => {}, 0, () => {
          __tlaVisit(init_StoreDependencyAsync);
        });

        // SecondElementImport.ts
        function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
        var init_SecondElementImport = __tlaModule(() => {}, 0, () => {
          __tlaVisit(init_BaseElement);
        });

        // BaseElementImport.ts
        function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
        var init_BaseElementImport = __tlaModule(() => {}, 0, () => {
          __tlaVisit(init_SecondElementImport);
        });

        // BaseElement.ts
        function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
        var depValue, formValue, listValue;
        var init_BaseElement = __tlaModule(() => {
          depValue = StoreDependency();
          formValue = {
            key: depValue
          };
          listValue = {
            key: depValue + "value"
          };
        }, 0, () => {
          __tlaVisit(init_StoreDependency);
          __tlaVisit(init_BaseElementImport);
        });

        // AsyncEntryPoint.ts
        async function AsyncEntryPoint() {
          await __tlaImport(init_BaseElement);
          console.log("Launching AsyncEntryPoint", BaseElement());
        }

        // entry.ts
        await Promise.resolve();
        AsyncEntryPoint();

        "
      `);

      expect(bundled).not.toContain("__esm");
      expect(bundled).not.toContain("__promiseAll");
    },
  });

  itBundled("bundler/__promiseAll and __esm are not used for a cycle that reaches two top-level awaits", {
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

      // The imports of BaseElement, in source order
      expect(bundled).toMatch(
        /\}, 0, \(\) => \{\s+__tlaVisit\(init_StoreDependency\);\s+__tlaVisit\(init_StoreDependency2\);\s+__tlaVisit\(init_BaseElementImport\);\s+\}\);/,
      );
      expect(bundled).not.toContain("__esm");
      expect(bundled).not.toContain("__promiseAll");
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
});
