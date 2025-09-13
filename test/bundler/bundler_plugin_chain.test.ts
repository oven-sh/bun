import { describe, expect } from "bun:test";
import path from "node:path";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  describe("plugin chain behavior", () => {
    // Test that returning undefined/null/{} continues to next plugin
    itBundled("plugin/ResolveChainContinues", ({ root }) => {
      const callOrder: string[] = [];

      return {
        files: {
          "index.ts": /* ts */ `
            import { foo } from "./test.magic";
            console.log(foo);
          `,
          "test.ts": /* ts */ `
            export const foo = "resolved by plugin3";
          `,
        },
        plugins: [
          {
            name: "plugin1",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin1-resolve");
                // Return undefined - should continue to next plugin
                return undefined;
              });
            },
          },
          {
            name: "plugin2",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin2-resolve");
                // Return null - should continue to next plugin
                return null;
              });
            },
          },
          {
            name: "plugin3",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin3-resolve");
                // Return empty object - should continue to next plugin
                return {};
              });
            },
          },
          {
            name: "plugin4",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin4-resolve");
                // Actually resolve it
                return {
                  path: path.resolve(path.dirname(args.importer), "test.ts"),
                };
              });
            },
          },
        ],
        run: {
          stdout: "resolved by plugin3",
        },
        onAfterBundle() {
          // All plugins should have been called in order
          expect(callOrder).toEqual(["plugin1-resolve", "plugin2-resolve", "plugin3-resolve", "plugin4-resolve"]);
        },
      };
    });

    // Test that returning a path stops the chain
    itBundled("plugin/ResolveChainStops", ({ root }) => {
      const callOrder: string[] = [];

      return {
        files: {
          "index.ts": /* ts */ `
            import { foo } from "./test.magic";
            console.log(foo);
          `,
          "resolved-by-plugin2.ts": /* ts */ `
            export const foo = "plugin2 resolved";
          `,
          "resolved-by-plugin4.ts": /* ts */ `
            export const foo = "plugin4 resolved";
          `,
        },
        plugins: [
          {
            name: "plugin1",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin1-resolve");
                // Return undefined - continue to next
                return undefined;
              });
            },
          },
          {
            name: "plugin2",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin2-resolve");
                // Return a path - should stop chain here
                return {
                  path: path.resolve(path.dirname(args.importer), "resolved-by-plugin2.ts"),
                };
              });
            },
          },
          {
            name: "plugin3",
            setup(builder) {
              builder.onResolve({ filter: /\.magic$/ }, args => {
                callOrder.push("plugin3-resolve");
                // This should NOT be called
                return {
                  path: path.resolve(path.dirname(args.importer), "resolved-by-plugin4.ts"),
                };
              });
            },
          },
        ],
        run: {
          stdout: "plugin2 resolved",
        },
        onAfterBundle() {
          // Only first two plugins should have been called
          expect(callOrder).toEqual(["plugin1-resolve", "plugin2-resolve"]);
        },
      };
    });

    // Test entry point plugin chain behavior
    itBundled("plugin/EntryPointResolveChain", ({ root }) => {
      const callOrder: string[] = [];

      return {
        files: {
          "actual-entry.ts": /* ts */ `
            console.log("correct entry point");
          `,
        },
        entryPointsRaw: ["virtual-entry.ts"],
        plugins: [
          {
            name: "plugin1",
            setup(builder) {
              builder.onResolve({ filter: /virtual-entry\.ts$/ }, args => {
                expect(args.kind).toBe("entry-point-build");
                callOrder.push("plugin1-entry");
                // Return null - continue to next
                return null;
              });
            },
          },
          {
            name: "plugin2",
            setup(builder) {
              builder.onResolve({ filter: /virtual-entry\.ts$/ }, args => {
                expect(args.kind).toBe("entry-point-build");
                callOrder.push("plugin2-entry");
                // Return empty object - continue to next
                return {};
              });
            },
          },
          {
            name: "plugin3",
            setup(builder) {
              builder.onResolve({ filter: /virtual-entry\.ts$/ }, args => {
                expect(args.kind).toBe("entry-point-build");
                callOrder.push("plugin3-entry");
                // Resolve to actual file
                return {
                  path: path.join(root, "actual-entry.ts"),
                };
              });
            },
          },
        ],
        run: {
          file: "/out/virtual-entry.js",
          stdout: "correct entry point",
        },
        onAfterBundle(api) {
          // All plugins should have been called
          expect(callOrder).toEqual(["plugin1-entry", "plugin2-entry", "plugin3-entry"]);

          // Check what file was actually created
          try {
            api.readFile("/out/actual-entry.js");
            console.log("Found /out/actual-entry.js");
          } catch {}
          try {
            api.readFile("/out/virtual-entry.js");
            console.log("Found /out/virtual-entry.js");
          } catch {}
        },
      };
    });

    // Test with various return values that should continue chain
    for (const returnValue of [undefined, null, {}, { external: undefined }, { namespace: undefined }]) {
      const valueName = require("util").inspect(returnValue);

      itBundled(`plugin/ResolveChainContinuesWith\`${valueName}\``, ({ root }) => {
        let plugin2Called = false;

        return {
          files: {
            "index.ts": /* ts */ `
              import { value } from "./test.special";
              console.log(value);
            `,
            "test.ts": /* ts */ `
              export const value = "success";
            `,
          },
          plugins: [
            {
              name: "plugin1",
              setup(builder) {
                builder.onResolve({ filter: /\.special$/ }, args => {
                  // Return the test value - should continue to next plugin
                  return returnValue as any;
                });
              },
            },
            {
              name: "plugin2",
              setup(builder) {
                builder.onResolve({ filter: /\.special$/ }, args => {
                  plugin2Called = true;
                  return {
                    path: path.resolve(path.dirname(args.importer), "test.ts"),
                  };
                });
              },
            },
          ],
          run: {
            stdout: "success",
          },
          onAfterBundle() {
            expect(plugin2Called).toBe(true);
          },
        };
      });
    }

    // Test that primitives other than null/undefined should continue chain
    for (const value of [false, true, 0, 1, "string"]) {
      const valueName = JSON.stringify(value);

      itBundled(`plugin/ResolveChainContinuesWithPrimitive${valueName.replace(/[^a-zA-Z0-9]/g, "")}`, ({ root }) => {
        let plugin2Called = false;

        return {
          files: {
            "index.ts": /* ts */ `
              import { value } from "./test.primitive";
              console.log(value);
            `,
            "test.ts": /* ts */ `
              export const value = "handled";
            `,
          },
          plugins: [
            {
              name: "plugin1",
              setup(builder) {
                builder.onResolve({ filter: /\.primitive$/ }, args => {
                  // Return a primitive - should be treated as "not handled"
                  return value as any;
                });
              },
            },
            {
              name: "plugin2",
              setup(builder) {
                builder.onResolve({ filter: /\.primitive$/ }, args => {
                  plugin2Called = true;
                  return {
                    path: path.resolve(path.dirname(args.importer), "test.ts"),
                  };
                });
              },
            },
          ],
          run: {
            stdout: "handled",
          },
          onAfterBundle() {
            expect(plugin2Called).toBe(true);
          },
        };
      });
    }
  });
});
