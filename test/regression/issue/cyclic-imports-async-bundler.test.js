import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("cyclic imports with async dependencies should generate async wrappers", async () => {
  const dir = tempDirWithFiles("cyclic-imports-async", {
    "build.ts": `
      import { build } from "bun";
      build({
        entrypoints: ["src/entryBuild.ts"],
        outdir: "dist",
        format: "esm",
        target: "browser",
        sourcemap: "linked",
        minify: false,
      }).then(() => {
        console.log("Build completed successfully.");
      }).catch((error) => {
        console.error("Build failed:", error);
      })
    `,
    "src/entryBuild.ts": `
      const { AsyncEntryPoint } = await import("./RecursiveDependencies/AsyncEntryPoint");
      AsyncEntryPoint();
      export {};
    `,
    "src/RecursiveDependencies/AsyncEntryPoint.ts": `
      export async function AsyncEntryPoint() {
        const { BaseElement } = await import("./BaseElement");
        console.log("Launching AsyncEntryPoint", BaseElement());
      }
    `,
    "src/RecursiveDependencies/BaseElement.ts": `
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
    "src/RecursiveDependencies/BaseElementImport.ts": `
      import { SecondElementImport } from "./SecondElementImport";
      export function BaseElementImport() {
        console.log("BaseElementImport called", SecondElementImport());
        return SecondElementImport();
      }
    `,
    "src/RecursiveDependencies/SecondElementImport.ts": `
      import { formValue } from "./BaseElement";
      export function SecondElementImport() {
        console.log("SecondElementImport called", formValue.key);
        return formValue.key;
      }
    `,
    "src/RecursiveDependencies/StoreDependency.ts": `
      import { somePromise } from "./StoreDependencyAsync";
      
      export function StoreDependency() {
        return "A string from StoreFunc" + somePromise;
      }
    `,
    "src/RecursiveDependencies/StoreDependencyAsync.ts": `
      export const somePromise = await Promise.resolve("Hello World");
    `,
  });

  // Build the project
  const buildResult = await Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await buildResult.exited;

  // Read the bundled output
  const bundledPath = join(dir, "dist", "entryBuild.js");
  const bundled = await Bun.file(bundledPath).text();

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

    // src/RecursiveDependencies/StoreDependencyAsync.ts
    var somePromise;
    var init_StoreDependencyAsync = __esm(async () => {
      somePromise = await Promise.resolve("Hello World");
    });

    // src/RecursiveDependencies/StoreDependency.ts
    function StoreDependency() {
      return "A string from StoreFunc" + somePromise;
    }
    var init_StoreDependency = __esm(async () => {
      await init_StoreDependencyAsync();
    });

    // src/RecursiveDependencies/SecondElementImport.ts
    function SecondElementImport() {
      console.log("SecondElementImport called", formValue.key);
      return formValue.key;
    }
    var init_SecondElementImport = __esm(async () => {
      await init_BaseElement();
    });

    // src/RecursiveDependencies/BaseElementImport.ts
    function BaseElementImport() {
      console.log("BaseElementImport called", SecondElementImport());
      return SecondElementImport();
    }
    var init_BaseElementImport = __esm(async () => {
      await init_SecondElementImport();
    });

    // src/RecursiveDependencies/BaseElement.ts
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

    // src/RecursiveDependencies/AsyncEntryPoint.ts
    var exports_AsyncEntryPoint = {};
    __export(exports_AsyncEntryPoint, {
      AsyncEntryPoint: () => AsyncEntryPoint
    });
    async function AsyncEntryPoint() {
      const { BaseElement: BaseElement2 } = await init_BaseElement().then(() => exports_BaseElement);
      console.log("Launching AsyncEntryPoint", BaseElement2());
    }

    // src/entryBuild.ts
    var { AsyncEntryPoint: AsyncEntryPoint2 } = await Promise.resolve().then(() => exports_AsyncEntryPoint);
    AsyncEntryPoint2();

    //# debugId=68A023AE1F6BCD1164756E2164756E21
    //# sourceMappingURL=entryBuild.js.map
    "
  `);

  // Check that there are no syntax errors like "await" in non-async functions
  // The bug would manifest as something like:
  // var init_BaseElement = __esm(() => {
  //   await init_StoreDependency();  // ERROR: await in non-async function
  // });

  // All __esm wrappers that contain await should be async
  const esmWrapperRegex = /var\s+(\w+)\s*=\s*__esm\s*\((async\s*)?\(\)\s*=>\s*\{([^}]+)\}/g;
  let match;

  while ((match = esmWrapperRegex.exec(bundled)) !== null) {
    const [fullMatch, varName, isAsync, body] = match;
    const hasAwait = body.includes("await ");

    if (hasAwait && !isAsync) {
      throw new Error(
        `Found await in non-async wrapper ${varName}:\n${fullMatch}\n\n` +
          `This indicates the cyclic import async propagation bug is present.`,
      );
    }
  }

  // Also verify the bundled code can execute without syntax errors
  const runResult = await Bun.spawn({
    cmd: [bunExe(), bundledPath],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(runResult.stdout).text(),
    new Response(runResult.stderr).text(),
    runResult.exited,
  ]);

  // Should not have syntax errors
  expect(stderr).not.toContain('await" can only be used inside an "async" function');
  expect(exitCode).toBe(0);
});
