import { itBundled } from "../expectBundled";

// Tests for CSS Module Scripts - https://web.dev/articles/css-module-scripts
// When importing CSS with `with { type: 'css' }`, the import should return a CSSStyleSheet object
describe("css-module-scripts", () => {
  // Mock CSSStyleSheet for testing since we're running in Bun, not a browser
  const env = {
    ...process.env,
    // Inject a mock CSSStyleSheet constructor
    BUN_DEBUG_QUIET_LOGS: "1",
  };

  itBundled("css-module-scripts/StaticImportWithTypeCSS", {
    files: {
      "/entry.js": /* js */ `
        import sheet from './styles.css' with { type: 'css' };
        console.log('sheet type:', typeof sheet);
        console.log('sheet instanceof CSSStyleSheet:', sheet instanceof CSSStyleSheet);
        console.log('cssRules length:', sheet.cssRules.length);
      `,
      "/styles.css": `.foo { color: red; }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      // Verify the output contains __cssModuleScript call
      const content = api.readFile("/out/entry.js");
      expect(content).toContain("__cssModuleScript");
      expect(content).toContain(".foo { color: red; }");
    },
  });

  itBundled("css-module-scripts/DynamicImportWithTypeCSS", {
    files: {
      "/entry.js": /* js */ `
        const module = await import('./styles.css', { with: { type: 'css' } });
        const sheet = module.default;
        console.log('sheet type:', typeof sheet);
        console.log('sheet instanceof CSSStyleSheet:', sheet instanceof CSSStyleSheet);
        console.log('cssRules length:', sheet.cssRules.length);
      `,
      "/styles.css": `.bar { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      // Verify the output contains __cssModuleScript call with CSS content
      const content = api.readFile("/out/entry.js");
      expect(content).toContain("__cssModuleScript");
      expect(content).toContain(".bar { color: blue; }");
    },
  });

  itBundled("css-module-scripts/DynamicImportWithAssertTypeCSS", {
    // Test the older `assert` syntax for backwards compatibility
    files: {
      "/entry.js": /* js */ `
        const module = await import('./styles.css', { assert: { type: 'css' } });
        const sheet = module.default;
        console.log('sheet type:', typeof sheet);
      `,
      "/styles.css": `.baz { color: green; }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      // Verify the output contains __cssModuleScript call
      const content = api.readFile("/out/entry.js");
      expect(content).toContain("__cssModuleScript");
    },
  });

  itBundled("css-module-scripts/CSSModuleWithTypeCSS", {
    // CSS Modules (*.module.css) should still work with type: 'css'
    // but return a CSSStyleSheet instead of the class name mapping
    files: {
      "/entry.js": /* js */ `
        import sheet from './styles.module.css' with { type: 'css' };
        console.log('sheet instanceof CSSStyleSheet:', sheet instanceof CSSStyleSheet);
      `,
      "/styles.module.css": `.myClass { color: purple; }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      const content = api.readFile("/out/entry.js");
      expect(content).toContain("__cssModuleScript");
    },
  });

  itBundled("css-module-scripts/PlainCSSImportWithoutType", {
    // Plain CSS imports without type should NOT return CSSStyleSheet
    // (existing behavior - either side-effect or object with class names)
    files: {
      "/entry.js": /* js */ `
        import './styles.css';
        console.log('CSS imported as side effect');
      `,
      "/styles.css": `.plain { color: black; }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      const content = api.readFile("/out/entry.js");
      // Should NOT contain CSSStyleSheet for plain imports
      expect(content).not.toContain("new CSSStyleSheet");
    },
  });

  itBundled("css-module-scripts/MultipleRules", {
    files: {
      "/entry.js": /* js */ `
        import sheet from './styles.css' with { type: 'css' };
        console.log('rules:', sheet.cssRules.length);
      `,
      "/styles.css": /* css */ `
        .a { color: red; }
        .b { color: blue; }
        .c { color: green; }
        @media (min-width: 768px) {
          .a { color: darkred; }
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    format: "esm",
    onAfterBundle(api) {
      const content = api.readFile("/out/entry.js");
      expect(content).toContain("__cssModuleScript");
      // The CSS content should be included as a string
      expect(content).toContain(".a");
      expect(content).toContain("color");
    },
  });
});
