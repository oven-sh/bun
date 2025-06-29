import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests for preserve_entry_signatures feature in code splitting
// This verifies how shared modules are handled with different preserve_entry_signatures settings

describe("bundler", () => {
  describe("preserve_entry_signatures", () => {
    // Test 1: Basic shared module with strict mode
    // In strict mode, shared modules should go to separate chunks
    itBundled("splitting/preserveEntrySignatures/strict-basic", {
      files: {
        "/entry-a.js": /* js */ `
          import { shared } from "./shared.js";
          export const a = "entry-a";
          console.log("Entry A:", shared);
        `,
        "/entry-b.js": /* js */ `
          import { shared } from "./shared.js";
          export const b = "entry-b";
          console.log("Entry B:", shared);
        `,
        "/shared.js": /* js */ `
          export const shared = "shared-value";
          console.log("Shared module loaded");
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "strict",
      run: [
        { file: "/out/entry-a.js", stdout: "Shared module loaded\nEntry A: shared-value" },
        { file: "/out/entry-b.js", stdout: "Shared module loaded\nEntry B: shared-value" },
      ],
      // In strict mode, the shared module should NOT be in the entry chunks
      assertNotPresent: {
        "/out/entry-a.js": "shared-value",
        "/out/entry-b.js": "shared-value",
      },
    });

    // Test 2: Same setup with allow-extension (default)
    // Shared modules can be merged into entry chunks
    itBundled("splitting/preserveEntrySignatures/allow-extension-basic", {
      files: {
        "/entry-a.js": /* js */ `
          import { shared } from "./shared.js";
          export const a = "entry-a";
          console.log("Entry A:", shared);
        `,
        "/entry-b.js": /* js */ `
          import { shared } from "./shared.js";
          export const b = "entry-b";
          console.log("Entry B:", shared);
        `,
        "/shared.js": /* js */ `
          export const shared = "shared-value";
          console.log("Shared module loaded");
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "allow-extension",
      run: [
        { file: "/out/entry-a.js", stdout: "Shared module loaded\nEntry A: shared-value" },
        { file: "/out/entry-b.js", stdout: "Shared module loaded\nEntry B: shared-value" },
      ],
      // With allow-extension, one of the entry chunks MAY contain the shared module
      // We can't assert presence/absence as it depends on the optimization
    });

    // Test 3: Multiple shared modules with complex dependencies
    itBundled("splitting/preserveEntrySignatures/strict-complex", {
      files: {
        "/entry-a.js": /* js */ `
          import { util1 } from "./util1.js";
          import { common } from "./common.js";
          export const a = util1 + common;
          console.log("A:", a);
        `,
        "/entry-b.js": /* js */ `
          import { util2 } from "./util2.js";
          import { common } from "./common.js";
          export const b = util2 + common;
          console.log("B:", b);
        `,
        "/entry-c.js": /* js */ `
          import { util1 } from "./util1.js";
          import { util2 } from "./util2.js";
          export const c = util1 + util2;
          console.log("C:", c);
        `,
        "/util1.js": /* js */ `
          import { common } from "./common.js";
          export const util1 = "util1-" + common;
        `,
        "/util2.js": /* js */ `
          import { common } from "./common.js";
          export const util2 = "util2-" + common;
        `,
        "/common.js": /* js */ `
          export const common = "common";
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js", "/entry-c.js"],
      splitting: true,
      preserveEntrySignatures: "strict",
      run: [
        { file: "/out/entry-a.js", stdout: "A: util1-commoncommon" },
        { file: "/out/entry-b.js", stdout: "B: util2-commoncommon" },
        { file: "/out/entry-c.js", stdout: "C: util1-commonutil2-common" },
      ],
      // In strict mode, shared modules should be in separate chunks
      assertNotPresent: {
        "/out/entry-a.js": ["util1-", "util2-"],
        "/out/entry-b.js": ["util1-", "util2-"],
        "/out/entry-c.js": ["common"],
      },
    });

    // Test 4: exports-only mode
    // Only the specific exports from the entry module are preserved
    itBundled("splitting/preserveEntrySignatures/exports-only", {
      files: {
        "/entry-a.js": /* js */ `
          import { shared } from "./shared.js";
          export const a = "entry-a";
          export function getShared() { return shared; }
          console.log("Entry A loaded");
        `,
        "/entry-b.js": /* js */ `
          import { shared } from "./shared.js";
          // No exports use shared
          console.log("Entry B:", shared);
        `,
        "/shared.js": /* js */ `
          export const shared = "shared-value";
          console.log("Shared loaded");
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "exports-only",
      runtimeFiles: {
        "/test.js": /* js */ `
          import { a, getShared } from "./out/entry-a.js";
          console.log("Imported a:", a);
          console.log("Shared via function:", getShared());
        `,
      },
      run: [
        { file: "/out/entry-a.js", stdout: "Shared loaded\nEntry A loaded" },
        { file: "/out/entry-b.js", stdout: "Shared loaded\nEntry B: shared-value" },
        { file: "/test.js", stdout: "Shared loaded\nEntry A loaded\nImported a: entry-a\nShared via function: shared-value" },
      ],
    });

    // Test 5: false mode - maximum optimization
    itBundled("splitting/preserveEntrySignatures/false", {
      files: {
        "/entry-a.js": /* js */ `
          import { shared } from "./shared.js";
          export const a = shared + "-a";
          console.log("A:", a);
        `,
        "/entry-b.js": /* js */ `
          import { shared } from "./shared.js";
          export const b = shared + "-b";
          console.log("B:", b);
        `,
        "/shared.js": /* js */ `
          export const shared = "shared";
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "false",
      run: [
        { file: "/out/entry-a.js", stdout: "A: shared-a" },
        { file: "/out/entry-b.js", stdout: "B: shared-b" },
      ],
      // With false, maximum optimization is allowed
    });

    // Test 6: Dynamic imports with different modes
    itBundled("splitting/preserveEntrySignatures/strict-dynamic", {
      files: {
        "/entry.js": /* js */ `
          export const entry = "main";
          import("./dynamic.js").then(m => console.log("Dynamic:", m.value));
        `,
        "/dynamic.js": /* js */ `
          import { shared } from "./shared.js";
          export const value = "dynamic-" + shared;
        `,
        "/shared.js": /* js */ `
          export const shared = "shared";
        `,
      },
      entryPoints: ["/entry.js"],
      splitting: true,
      outdir: "/out",
      preserveEntrySignatures: "strict",
      run: {
        file: "/out/entry.js",
        stdout: "Dynamic: dynamic-shared",
      },
      assertNotPresent: {
        "/out/entry.js": "shared",
      },
    });

    // Test 7: CommonJS interop with preserve_entry_signatures
    itBundled("splitting/preserveEntrySignatures/cjs-interop", {
      files: {
        "/entry-a.js": /* js */ `
          const { getValue } = require("./shared.cjs");
          export const a = "entry-a";
          console.log("A:", getValue());
        `,
        "/entry-b.js": /* js */ `
          const { getValue } = require("./shared.cjs");
          export const b = "entry-b";
          console.log("B:", getValue());
        `,
        "/shared.cjs": /* js */ `
          let value = 0;
          exports.getValue = () => ++value;
          console.log("Shared CJS loaded");
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "strict",
      runtimeFiles: {
        "/test.js": /* js */ `
          await import("./out/entry-a.js");
          await import("./out/entry-b.js");
        `,
      },
      run: {
        file: "/test.js",
        stdout: "Shared CJS loaded\nA: 1\nB: 2",
      },
    });

    // Test 8: Side effects preservation with different modes
    itBundled("splitting/preserveEntrySignatures/side-effects", {
      files: {
        "/entry-a.js": /* js */ `
          import "./side-effect.js";
          export const a = "a";
          console.log("Entry A");
        `,
        "/entry-b.js": /* js */ `
          import "./side-effect.js";
          export const b = "b";
          console.log("Entry B");
        `,
        "/side-effect.js": /* js */ `
          console.log("Side effect executed");
          globalThis.sideEffectCount = (globalThis.sideEffectCount || 0) + 1;
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "strict",
      runtimeFiles: {
        "/test.js": /* js */ `
          await import("./out/entry-a.js");
          await import("./out/entry-b.js");
          console.log("Side effect count:", globalThis.sideEffectCount);
        `,
      },
      run: {
        file: "/test.js",
        stdout: "Side effect executed\nEntry A\nEntry B\nSide effect count: 1",
      },
    });

    // Test 9: Circular dependencies with preserve_entry_signatures
    itBundled("splitting/preserveEntrySignatures/circular", {
      files: {
        "/entry-a.js": /* js */ `
          export * from "./module-a.js";
          console.log("Entry A");
        `,
        "/entry-b.js": /* js */ `
          export * from "./module-b.js";
          console.log("Entry B");
        `,
        "/module-a.js": /* js */ `
          export { b } from "./module-b.js";
          export const a = "a";
        `,
        "/module-b.js": /* js */ `
          export { a } from "./module-a.js";
          export const b = "b";
        `,
      },
      entryPoints: ["/entry-a.js", "/entry-b.js"],
      splitting: true,
      preserveEntrySignatures: "strict",
      runtimeFiles: {
        "/test.js": /* js */ `
          const modA = await import("./out/entry-a.js");
          const modB = await import("./out/entry-b.js");
          console.log("A exports:", Object.keys(modA).sort().join(","));
          console.log("B exports:", Object.keys(modB).sort().join(","));
          console.log("Values:", modA.a, modA.b, modB.a, modB.b);
        `,
      },
      run: {
        file: "/test.js",
        stdout: "Entry A\nEntry B\nA exports: a,b\nB exports: a,b\nValues: a b a b",
      },
    });

    // Test 10: Re-exports with different preserve modes
    itBundled("splitting/preserveEntrySignatures/reexports", {
      files: {
        "/entry.js": /* js */ `
          export { value as entryValue } from "./shared.js";
          export * from "./utils.js";
        `,
        "/another-entry.js": /* js */ `
          export { value } from "./shared.js";
          export { util1 } from "./utils.js";
        `,
        "/shared.js": /* js */ `
          export const value = "shared-value";
        `,
        "/utils.js": /* js */ `
          export const util1 = "util1";
          export const util2 = "util2";
        `,
      },
      entryPoints: ["/entry.js", "/another-entry.js"],
      splitting: true,
      preserveEntrySignatures: "exports-only",
      runtimeFiles: {
        "/test.js": /* js */ `
          const entry = await import("./out/entry.js");
          const another = await import("./out/another-entry.js");
          console.log("Entry exports:", Object.keys(entry).sort().join(","));
          console.log("Another exports:", Object.keys(another).sort().join(","));
        `,
      },
      run: {
        file: "/test.js",
        stdout: "Entry exports: entryValue,util1,util2\nAnother exports: util1,value",
      },
    });
  });
});