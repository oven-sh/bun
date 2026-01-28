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
        "var __defProp = Object.defineProperty;
        var __export = (target, all) => {
          for (var name in all)
            __defProp(target, name, {
              get: all[name],
              enumerable: true,
              configurable: true,
              set: (newValue) => all[name] = () => newValue
            });
        };
        var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
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
        var exports_BaseElement = {};
        __export(exports_BaseElement, {
          listValue: () => listValue,
          formValue: () => formValue,
          BaseElement: () => BaseElement
        });
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
        var exports_AsyncEntryPoint = {};
        __export(exports_AsyncEntryPoint, {
          AsyncEntryPoint: () => AsyncEntryPoint
        });
        async function AsyncEntryPoint() {
          const { BaseElement: BaseElement2 } = await init_BaseElement().then(() => exports_BaseElement);
          console.log("Launching AsyncEntryPoint", BaseElement2());
        }

        // entry.ts
        var { AsyncEntryPoint: AsyncEntryPoint2 } = await Promise.resolve().then(() => exports_AsyncEntryPoint);
        AsyncEntryPoint2();

        //# debugId=741426CCC2D50C3364756E2164756E21
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
        "var __defProp = Object.defineProperty;
        var __export = (target, all) => {
          for (var name in all)
            __defProp(target, name, {
              get: all[name],
              enumerable: true,
              configurable: true,
              set: (newValue) => all[name] = () => newValue
            });
        };
        var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

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
        var exports_BaseElement = {};
        __export(exports_BaseElement, {
          listValue: () => listValue,
          formValue: () => formValue,
          BaseElement: () => BaseElement
        });
        function BaseElement() {
          console.log("BaseElement called", BaseElementImport());
          return BaseElementImport();
        }
        var formValue, listValue;
        var init_BaseElement = __esm(() => {
          init_BaseElementImport();
          formValue = {
            key: "static value"
          };
          listValue = {
            key: "static list value"
          };
        });

        // AsyncEntryPoint.ts
        var exports_AsyncEntryPoint = {};
        __export(exports_AsyncEntryPoint, {
          AsyncEntryPoint: () => AsyncEntryPoint
        });
        async function AsyncEntryPoint() {
          const { BaseElement: BaseElement2 } = await Promise.resolve().then(() => (init_BaseElement(), exports_BaseElement));
          console.log("Launching AsyncEntryPoint", BaseElement2());
        }

        // entry.ts
        var { AsyncEntryPoint: AsyncEntryPoint2 } = await Promise.resolve().then(() => exports_AsyncEntryPoint);
        AsyncEntryPoint2();

        //# debugId=27B6A8D5F1ED83DA64756E2164756E21
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
