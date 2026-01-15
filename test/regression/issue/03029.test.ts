import { describe, expect } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

describe("issue 3029 - JSX imports should be deduplicated", () => {
  itBundled("jsx-imports-deduplicated", {
    files: {
      "/index.js": `
        import { X } from "./a.js"
        const HelloWorld = () => (
          <>
            <X/>
            World
          </>
        );
        export { HelloWorld };
      `,
      "/a.js": `
        const X = () => <div>Hello</div>;
        export { X };
      `,
      // Mock react/jsx-dev-runtime
      "/node_modules/react/jsx-dev-runtime.js": `
        export function jsxDEV(type, props, key, source, self) {
          return { type, props, key, source, self };
        }
        export const Fragment = Symbol.for("react.fragment");
      `,
    },
    external: ["react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const content = api.readFile("/out.js");

      // Count import statements from react/jsx-dev-runtime
      const importMatches = content.match(/import\s*\{[^}]*\}\s*from\s*["']react\/jsx-dev-runtime["']/g);

      // Should have only ONE import statement for react/jsx-dev-runtime
      expect(importMatches?.length).toBe(1);

      // The single import should contain both jsxDEV and Fragment
      expect(importMatches?.[0]).toMatch(/jsxDEV/);
      expect(importMatches?.[0]).toMatch(/Fragment/);

      // Should NOT have jsxDEV2 or any numbered variants
      expect(content).not.toMatch(/jsxDEV\d/);
    },
  });

  itBundled("jsx-imports-deduplicated-multiple-files", {
    files: {
      "/index.js": `
        import { X } from "./a.js"
        import { Y } from "./b.js"
        const App = () => (
          <>
            <X/>
            <Y/>
          </>
        );
        export { App };
      `,
      "/a.js": `
        const X = () => <div>X</div>;
        export { X };
      `,
      "/b.js": `
        const Y = () => <span>Y</span>;
        export { Y };
      `,
      // Mock react/jsx-dev-runtime
      "/node_modules/react/jsx-dev-runtime.js": `
        export function jsxDEV(type, props, key, source, self) {
          return { type, props, key, source, self };
        }
        export const Fragment = Symbol.for("react.fragment");
      `,
    },
    external: ["react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const content = api.readFile("/out.js");

      // Count import statements from react/jsx-dev-runtime
      const importMatches = content.match(/import\s*\{[^}]*\}\s*from\s*["']react\/jsx-dev-runtime["']/g);

      // Should have only ONE import statement
      expect(importMatches?.length).toBe(1);

      // Should NOT have numbered variants like jsxDEV2, jsxDEV3
      expect(content).not.toMatch(/jsxDEV\d/);
    },
  });

  itBundled("jsx-imports-deduplicated-with-different-imports", {
    files: {
      "/index.js": `
        // This file uses jsxDEV and Fragment
        import { X } from "./a.js"
        const HelloWorld = () => (
          <>
            <X/>
          </>
        );
        export { HelloWorld };
      `,
      "/a.js": `
        // This file only uses jsxDEV
        const X = () => <div>Hello</div>;
        export { X };
      `,
      // Mock react/jsx-dev-runtime
      "/node_modules/react/jsx-dev-runtime.js": `
        export function jsxDEV(type, props, key, source, self) {
          return { type, props, key, source, self };
        }
        export const Fragment = Symbol.for("react.fragment");
      `,
    },
    external: ["react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const content = api.readFile("/out.js");

      // Count import statements from react/jsx-dev-runtime
      const importMatches = content.match(/import\s*\{[^}]*\}\s*from\s*["']react\/jsx-dev-runtime["']/g);

      // Should have only ONE import statement
      expect(importMatches?.length).toBe(1);

      // The single import should contain BOTH jsxDEV and Fragment
      // (Fragment is used in index.js even though a.js doesn't use it)
      expect(importMatches?.[0]).toMatch(/jsxDEV/);
      expect(importMatches?.[0]).toMatch(/Fragment/);
    },
  });
});
