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

  expect(bundled).toMatchInlineSnapshot(`
    "var __esmEvaluator = /* @__PURE__ */ (() => {
      var stack = [], index = 0, order = 0, importer;
      var executeAsync = (module) => {
        module.executing = 1;
        var promise = module.body();
        module.executing = 0;
        promise.then(() => {
          if (module.status == 3)
            return;
          module.order = -1;
          module.status = 3;
          var ready = [];
          gather(module, ready);
          execute(ready.sort((a, b) => a.order - b.order), 0);
        }, (error) => reject(module, error));
      };
      var gather = (module, ready) => {
        while (module.gathered < module.parents.length) {
          var parent = module.parents[module.gathered++];
          if (!ready.includes(parent) && !parent.root.error && !--parent.pending) {
            ready.push(parent);
            if (!parent.hasTLA)
              gather(parent, ready);
          }
        }
      };
      var execute = (ready, i) => {
        for (;i < ready.length; i++) {
          var module = ready[i];
          if (module.status == 3)
            continue;
          if (module.resolve) {
            module.status = 3;
            module.resolve();
            Promise.resolve().then(() => execute(ready, i + 1));
            return;
          }
          if (module.hasTLA)
            executeAsync(module);
          else
            try {
              module.body();
              module.order = -1;
              module.status = 3;
              gather(module, ready);
            } catch (error) {
              reject(module, error);
            }
        }
      };
      var reject = (module, error) => {
        if (module.status == 3)
          return;
        module.error = [error];
        module.order = -1;
        module.status = 3;
        for (var parent of module.parents)
          reject(parent, error);
        if (module.reject)
          module.reject(error);
      };
      var evaluateInner = (module) => {
        var parent = importer;
        module.status = 1;
        module.index = module.ancestor = index++;
        module.stack = stack;
        stack.push(module);
        importer = module;
        module.imports();
        importer = parent;
        if (module.pending || module.hasTLA) {
          module.order = order++;
          if (!module.pending)
            executeAsync(module);
        } else
          module.body();
        if (module.ancestor == module.index)
          do {
            var member = stack.pop();
            member.status = member.order === undefined ? 3 : 2;
            member.root = module;
          } while (member != module);
      };
      var evaluate = (module, parent) => {
        if (!module.status) {
          if (stack.length)
            evaluateInner(module);
          else
            try {
              evaluateInner(module);
            } catch (error) {
              for (var failed of stack) {
                failed.status = 3;
                failed.error = [error];
                failed.root = failed;
              }
              stack = [];
              importer = undefined;
              throw error;
            }
        }
        if (!parent)
          return;
        var required = module;
        if (module.status == 1) {
          if (module.stack != stack)
            return;
          parent.ancestor = Math.min(parent.ancestor, module.ancestor);
        } else if ((required = module.root).error)
          throw required.error[0];
        if (required.order >= 0 && !required.executing) {
          parent.pending++;
          required.parents.push(parent);
        }
      };
      return [
        (imports, body, hasTLA) => {
          var module = { imports, body, hasTLA, status: 0, pending: 0, parents: [], gathered: 0 };
          return (parent = importer) => evaluate(module, parent);
        },
        (...wrappers) => {
          var waiter = { hasTLA: 1, status: 2, pending: 0, parents: [] };
          waiter.root = waiter;
          var outerStack = stack, outerImporter = importer;
          stack = [];
          importer = undefined;
          try {
            for (var wrapper of wrappers)
              wrapper(waiter);
          } catch (error) {
            waiter.status = 3;
            waiter.error = [error];
            throw error;
          } finally {
            stack = outerStack;
            importer = outerImporter;
          }
          if (waiter.pending) {
            waiter.order = order++;
            return new Promise((resolve, reject) => {
              waiter.resolve = resolve;
              waiter.reject = reject;
            });
          }
        }
      ];
    })();
    var __esmAsync = /* @__PURE__ */ (() => __esmEvaluator[0])();
    var __esmWait = /* @__PURE__ */ (() => __esmEvaluator[1])();

    // src/RecursiveDependencies/StoreDependencyAsync.ts
    var somePromise;
    var init_StoreDependencyAsync = __esmAsync(() => {}, async () => {
      somePromise = await Promise.resolve("Hello World");
    }, 1);

    // src/RecursiveDependencies/StoreDependency.ts
    function StoreDependency() {
      return "A string from StoreFunc" + somePromise;
    }
    var init_StoreDependency = __esmAsync(() => {
      init_StoreDependencyAsync();
    }, () => {});

    // src/RecursiveDependencies/SecondElementImport.ts
    function SecondElementImport() {
      console.log("SecondElementImport called", formValue.key);
      return formValue.key;
    }
    var init_SecondElementImport = __esmAsync(() => {
      init_BaseElement();
    }, () => {});

    // src/RecursiveDependencies/BaseElementImport.ts
    function BaseElementImport() {
      console.log("BaseElementImport called", SecondElementImport());
      return SecondElementImport();
    }
    var init_BaseElementImport = __esmAsync(() => {
      init_SecondElementImport();
    }, () => {});

    // src/RecursiveDependencies/BaseElement.ts
    function BaseElement() {
      console.log("BaseElement called", BaseElementImport());
      return BaseElementImport();
    }
    var depValue, formValue, listValue;
    var init_BaseElement = __esmAsync(() => {
      init_StoreDependency();
      init_BaseElementImport();
    }, () => {
      depValue = StoreDependency();
      formValue = {
        key: depValue
      };
      listValue = {
        key: depValue + "value"
      };
    });

    // src/RecursiveDependencies/AsyncEntryPoint.ts
    async function AsyncEntryPoint() {
      await (async () => __esmWait(init_BaseElement))();
      console.log("Launching AsyncEntryPoint", BaseElement());
    }

    // src/entryBuild.ts
    await Promise.resolve();
    AsyncEntryPoint();

    //# debugId=398E057A1DA3A34464756E2164756E21
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
