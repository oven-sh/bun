import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("bundler/__esmAsync wraps the files of an import cycle that reaches one async import", {
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
              if (parent.ready != ready && !parent.root.error && !--parent.pending) {
                parent.ready = ready;
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

        // StoreDependencyAsync.ts
        var somePromise;
        var init_StoreDependencyAsync = __esmAsync(() => {}, async () => {
          somePromise = await Promise.resolve("Hello World");
        }, 1);

        // StoreDependency.ts
        function StoreDependency() {
          return "A string from StoreFunc" + somePromise;
        }
        var init_StoreDependency = __esmAsync(() => {
          init_StoreDependencyAsync();
        }, () => {});

        // SecondElementImport.ts
        function SecondElementImport() {
          console.log("SecondElementImport called", formValue.key);
          return formValue.key;
        }
        var init_SecondElementImport = __esmAsync(() => {
          init_BaseElement();
        }, () => {});

        // BaseElementImport.ts
        function BaseElementImport() {
          console.log("BaseElementImport called", SecondElementImport());
          return SecondElementImport();
        }
        var init_BaseElementImport = __esmAsync(() => {
          init_SecondElementImport();
        }, () => {});

        // BaseElement.ts
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

        // AsyncEntryPoint.ts
        async function AsyncEntryPoint() {
          await (async () => __esmWait(init_BaseElement))();
          console.log("Launching AsyncEntryPoint", BaseElement());
        }

        // entry.ts
        await Promise.resolve();
        AsyncEntryPoint();

        //# debugId=35CEA106E08B5BA164756E2164756E21
        //# sourceMappingURL=out.js.map
        "
      `);

      // MUST have __esm because of circular dependency requiring wrapping
      expect(bundled).toContain("__esm");
      expect(bundled).toContain("var init_");

      // BaseElement has no await of its own: its body is a plain function that runs after StoreDependency.
      expect(bundled).toContain("var __esmAsync = ");
      expect(bundled).toMatch(
        /var init_BaseElement = __esmAsync\(\(\) => \{\s+init_StoreDependency\(\);\s+init_BaseElementImport\(\);\s+\}, \(\) => \{/,
      );
    },
  });

  itBundled("bundler/__esmAsync wraps a file with several async imports", {
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

      // Both async imports start before either is done.
      expect(bundled).toContain("var __esmAsync = ");
      expect(bundled).toMatch(
        /var init_BaseElement = __esmAsync\(\(\) => \{\s+init_StoreDependency\(\);\s+init_StoreDependency2\(\);\s+init_BaseElementImport\(\);\s+\}, \(\) => \{/,
      );
    },
  });

  itBundled("bundler/__esmAsync is tree-shaken when no async imports despite circular deps with __esm", {
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

      expect(bundled).not.toContain("__esmAsync");
      expect(bundled).not.toContain("__esmWait");
    },
  });

  const asyncPair = {
    "/t1.js": `console.log("t1 starts"); await null; console.log("t1 ends"); export const a = 1;`,
    "/t2.js": `console.log("t2 starts"); await null; console.log("t2 ends"); export const b = 2;`,
  };
  // entry.js is not in a wrapper. The import() calls put t1.js and t2.js in one each.
  itBundled("bundler/a file outside of a wrapper waits for two async wrappers", {
    files: {
      ...asyncPair,
      "/entry.js": /* js */ `
        import { a } from "./t1.js";
        import { b } from "./t2.js";
        console.log("entry", a, b);
        export const later = () => [import("./t1.js"), import("./t2.js")];
      `,
    },
    entryPoints: ["/entry.js"],
    format: "esm",
    run: { stdout: "t1 starts\nt2 starts\nt1 ends\nt2 ends\nentry 1 2" },
  });
  itBundled("bundler/a file outside of a wrapper waits for the async wrapper of an export star", {
    files: {
      ...asyncPair,
      "/entry.js": `import("./mid.js").then(ns => console.log("entry", ns.b));`,
      "/mid.js": /* js */ `
        import "./t1.js";
        export * from "./t2.js";
        console.log("mid");
      `,
      "/other.js": `import("./t1.js"); import("./t2.js");`,
    },
    entryPoints: ["/entry.js"],
    format: "esm",
    run: { stdout: "t1 starts\nt2 starts\nt1 ends\nt2 ends\nmid\nentry 2" },
  });
  // n.js and a1.js reach the await of d.js only through the cycle, so they run before it is done.
  itBundled("bundler/the files of an async import cycle run in the order of the source", {
    files: {
      "/entry.js": `import("./a2.js").then(() => console.log("entry"));`,
      "/a2.js": `import "./a1.js"; import "./d.js"; console.log("a2");`,
      "/a1.js": `import "./n.js"; import "./a2.js"; console.log("a1");`,
      "/n.js": `import "./a1.js"; console.log("n");`,
      "/d.js": `await 0; console.log("d");`,
    },
    format: "esm",
    run: { stdout: "n\na1\nd\na2\nentry" },
  });
  // user.js imports member.js, which is done. It waits for root.js all the same: they are one cycle.
  itBundled("bundler/an importer of one file of an async import cycle waits for the cycle", {
    files: {
      "/entry.js": `import("./x.js").then(() => console.log("entry"));`,
      "/x.js": `import "./root.js"; import "./user.js"; console.log("x");`,
      "/root.js": /* js */ `
        import { helper } from "./member.js";
        export const cfg = await Promise.resolve({ ok: 1 });
        console.log("root", typeof helper);
      `,
      "/member.js": `import { cfg } from "./root.js"; export function helper() { return cfg.ok; } console.log("member");`,
      "/user.js": `import { helper } from "./member.js"; console.log("user", helper());`,
    },
    format: "esm",
    run: { stdout: "member\nroot function\nuser 1\nx\nentry" },
  });
  // Several parents wait for t.js. They run in the order in which they were first visited, not by depth.
  itBundled("bundler/the parents of an async file run in the order of the source", {
    files: {
      "/entry.js": `import("./x.js").then(() => console.log("entry"));`,
      "/x.js": `import "./deep1.js"; import "./shallow.js"; console.log("x");`,
      "/deep1.js": `import "./deep2.js"; console.log("deep1");`,
      "/deep2.js": `import "./t.js"; console.log("deep2");`,
      "/shallow.js": `import "./t.js"; console.log("shallow");`,
      "/t.js": `await 0; console.log("t");`,
    },
    format: "esm",
    run: { stdout: "t\ndeep2\ndeep1\nshallow\nx\nentry" },
  });
  // The second import() finds the module done, and the third finds the error of the first.
  itBundled("bundler/import() of an async wrapper that is done, or has failed", {
    files: {
      "/entry.js": /* js */ `
        const first = await import("./t.js");
        const second = await import("./t.js");
        console.log(first === second, first.t);
        const errors = [];
        for (let i = 0; i < 2; i++) await import("./fails.js").catch(error => errors.push(error));
        console.log(errors[0] === errors[1], errors[0].message);
      `,
      "/t.js": `export const t = await 1;`,
      "/fails.js": `await 0; throw new Error("fails.js");`,
    },
    format: "esm",
    run: { stdout: "true 1\ntrue fails.js" },
  });
  // m1.js waits for m2.js, so m2.js cannot wait for m1.js, nor for m4.js, which is in a cycle with it.
  // Node stops here from source ("unsettled top-level await"). Bun runs it.
  itBundled("bundler/import() of a file that imports the import cycle of the importer", {
    files: {
      "/entry.js": `import("./m1.js").then(() => console.log("entry"));`,
      "/m1.js": /* js */ `
        import "./m4.js";
        console.log("m1 starts");
        await import("./m2.js");
        console.log("m1 ends");
      `,
      "/m2.js": `import "./m4.js"; console.log("m2");`,
      "/m4.js": `import "./m1.js"; console.log("m4");`,
    },
    format: "esm",
    run: { stdout: "m4\nm1 starts\nm2\nm1 ends\nentry" },
  });
  // When t.js is done, u1.js goes on first, and z.js waits for its turn. entry.js, which prints after
  // u1.js, asks for z.js in between.
  itBundled("bundler/a file waits for an async wrapper that is ready and has not run", {
    files: {
      "/entry.js": /* js */ `
        import "./first.js";
        import "./u1.js";
        import "./z.js";
        console.log("entry");
        export const later = () => import("./t.js");
      `,
      "/first.js": `queueMicrotask(() => import("./z.js"));`,
      "/u1.js": `import "./t.js"; console.log("u1");`,
      "/z.js": `import "./t.js"; console.log("z");`,
      "/t.js": `console.log("t starts"); await new Promise(resolve => setImmediate(resolve)); console.log("t ends");`,
    },
    format: "esm",
    target: "bun",
    run: { stdout: "t starts\nt ends\nu1\nz\nentry" },
  });
  // page.js waits for a.js and b.js at once. a.js has started when b.js throws, and ends after that.
  itBundled("bundler/an async wrapper ends after the file that waited for it has failed", {
    files: {
      "/run.js": /* js */ `
        process.on("unhandledRejection", error => console.log("unhandled", error.message));
        import("./page.js")
          .catch(error => console.log("caught", error.message))
          .then(() => new Promise(resolve => setImmediate(resolve)))
          .then(() => console.log("done"));
      `,
      "/page.js": `import "./a.js"; import "./b.js"; console.log("page");`,
      "/other.js": `import "./b.js"; import "./a.js";`,
      "/a.js": `console.log("a starts"); await new Promise(resolve => setImmediate(resolve)); console.log("a ends");`,
      "/b.js": `import "./boom.js"; import "./t.js"; console.log("b");`,
      "/t.js": `await 0;`,
      "/boom.js": `throw new Error("boom");`,
    },
    entryPoints: ["/run.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    target: "bun",
    run: { file: "/out/run.js", stdout: "a starts\ncaught boom\na ends\ndone" },
  });
  // A __commonJS wrapper returns module.exports at once, so it cannot wait for what it imports.
  itBundled("bundler/a CommonJS file cannot import a file that reaches a top-level await", {
    files: {
      "/entry.js": `import direct from "./direct.js"; import indirect from "./indirect.js"; console.log(direct, indirect);`,
      "/direct.js": `import { t } from "./t.js"; module.exports = { t };`,
      "/indirect.js": `import { mid } from "./mid.js"; module.exports = { mid };`,
      "/mid.js": `export { t as mid } from "./t.js";`,
      "/t.js": `export const t = await 1;`,
    },
    format: "esm",
    bundleErrors: {
      "/direct.js": [
        'This import is not allowed in a CommonJS module because the imported file "t.js" contains a top-level await',
      ],
      "/indirect.js": [
        'This import is not allowed in a CommonJS module because the imported file "mid.js" depends on a top-level await',
      ],
    },
  });
  // Nothing prints for an import that tree shaking drops.
  itBundled("bundler/a CommonJS file can import an async file that tree shaking drops", {
    files: {
      "/entry.js": `import c from "./c.js"; console.log(c.v);`,
      "/c.js": `import { unused } from "pure"; module.exports = { v: 1 };`,
      "/node_modules/pure/package.json": `{ "name": "pure", "main": "index.js", "sideEffects": false }`,
      "/node_modules/pure/index.js": `import { t } from "./t.js"; export const unused = t;`,
      "/node_modules/pure/t.js": `export const t = await 1;`,
    },
    format: "esm",
    run: { stdout: "1" },
  });
});
