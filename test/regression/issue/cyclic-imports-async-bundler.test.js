import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("cyclic imports with async dependencies should generate async wrappers", async () => {
  await using dir = tempDir("cyclic-imports-async", {
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

  expect(
    bundled.slice(
      bundled.indexOf("// src/RecursiveDependencies/StoreDependencyAsync.ts"),
      bundled.indexOf("//# debugId"),
    ),
  ).toMatchInlineSnapshot(`
    "// src/RecursiveDependencies/StoreDependencyAsync.ts
    var somePromise;
    var init_StoreDependencyAsync = __tlaModule(async () => {
      somePromise = await Promise.resolve("Hello World");
    }, 1, () => {});

    // src/RecursiveDependencies/StoreDependency.ts
    function StoreDependency() {
      return "A string from StoreFunc" + somePromise;
    }
    var init_StoreDependency = __tlaModule(() => {}, 0, () => {
      __tlaVisit(init_StoreDependencyAsync);
    });

    // src/RecursiveDependencies/SecondElementImport.ts
    function SecondElementImport() {
      console.log("SecondElementImport called", formValue.key);
      return formValue.key;
    }
    var init_SecondElementImport = __tlaModule(() => {}, 0, () => {
      __tlaVisit(init_BaseElement);
    });

    // src/RecursiveDependencies/BaseElementImport.ts
    function BaseElementImport() {
      console.log("BaseElementImport called", SecondElementImport());
      return SecondElementImport();
    }
    var init_BaseElementImport = __tlaModule(() => {}, 0, () => {
      __tlaVisit(init_SecondElementImport);
    });

    // src/RecursiveDependencies/BaseElement.ts
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

    // src/RecursiveDependencies/AsyncEntryPoint.ts
    async function AsyncEntryPoint() {
      await __tlaImport(init_BaseElement);
      console.log("Launching AsyncEntryPoint", BaseElement());
    }

    // src/entryBuild.ts
    await Promise.resolve();
    AsyncEntryPoint();

    "
  `);

  // Check that there are no syntax errors like "await" in non-async functions
  // The bug would manifest as something like:
  // var init_BaseElement = __esm(() => {
  //   await init_StoreDependency();  // ERROR: await in non-async function
  // });

  // All wrappers that contain await should be async
  const esmWrapperRegex = /var\s+(\w+)\s*=\s*__(?:esm|tlaModule|tlaNode)\s*\((async\s*)?\(\)\s*=>\s*\{([^}]+)\}/g;
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
