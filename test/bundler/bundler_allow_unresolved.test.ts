import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // 1. Default passes — dynamic import with no allowUnresolved → build succeeds
  itBundled("allow-unresolved/DefaultPasses", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./a/\${x}.js\`);
      `,
    },
    outdir: "/out",
  });

  // 2. Empty array rejects template
  itBundled("allow-unresolved/EmptyArrayRejectsTemplate", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./a/\${x}.js\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 3. Empty array rejects opaque
  itBundled("allow-unresolved/EmptyArrayRejectsOpaque", {
    files: {
      "/entry.js": /* js */ `
        function fn() { return "./foo.js"; }
        import(fn());
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 4. Matching pattern allows
  itBundled("allow-unresolved/MatchingPatternAllows", {
    files: {
      "/entry.js": /* js */ `
        const x = "en";
        import(\`./locales/\${x}.json\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: ["./locales/*.json"],
  });

  // 5. Non-matching pattern rejects
  itBundled("allow-unresolved/NonMatchingPatternRejects", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./vendor/\${x}.js\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: ["./locales/*"],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 6. Empty-string pattern allows opaque
  itBundled("allow-unresolved/EmptyStringPatternAllowsOpaque", {
    files: {
      "/entry.js": /* js */ `
        function getPath() { return "./foo.js"; }
        import(getPath());
      `,
    },
    outdir: "/out",
    allowUnresolved: [""],
  });

  // 7. Empty-string pattern still rejects templates
  itBundled("allow-unresolved/EmptyStringPatternRejectsTemplates", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./a/\${x}.js\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: [""],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 8. try/catch does NOT bypass
  itBundled("allow-unresolved/TryCatchDoesNotBypass", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        try { await import(\`./a/\${x}.js\`) } catch {}
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 9. .catch() does NOT bypass
  itBundled("allow-unresolved/DotCatchDoesNotBypass", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./a/\${x}.js\`).catch(() => {});
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 10. require() variant
  itBundled("allow-unresolved/RequireVariant", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        require(\`./a/\${x}.js\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 11. require() in try/catch does NOT bypass
  itBundled("allow-unresolved/RequireTryCatchDoesNotBypass", {
    files: {
      "/entry.js": /* js */ `
        const someVar = "./dynamic.js";
        try { require(someVar) } catch {}
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 12. require.resolve()
  itBundled("allow-unresolved/RequireResolve", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        require.resolve(\`./a/\${x}.js\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 13. Multiple interpolations
  itBundled("allow-unresolved/MultipleInterpolations", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo", y = "bar";
        import(\`./a/\${x}/b/\${y}.js\`);
      `,
    },
    outdir: "/out",
    allowUnresolved: ["./a/*/b/*.js"],
  });

  // 14. "*" anywhere collapses to .all
  itBundled("allow-unresolved/StarCollapsesToAll", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./a/\${x}.js\`);
        function fn() { return "./b.js"; }
        import(fn());
      `,
    },
    outdir: "/out",
    allowUnresolved: ["./locales/*", "*"],
  });

  // 15. CLI path: empty array rejects (--reject-unresolved)
  itBundled("allow-unresolved/CLIRejectUnresolved", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        import(\`./a/\${x}.js\`);
      `,
    },
    outdir: "/out",
    backend: "cli",
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 16. CLI path: matching pattern allows
  itBundled("allow-unresolved/CLIMatchingPatternAllows", {
    files: {
      "/entry.js": /* js */ `
        const x = "en";
        import(\`./locales/\${x}.json\`);
      `,
    },
    outdir: "/out",
    backend: "cli",
    allowUnresolved: ["./locales/*.json"],
  });

  // 17. String concatenation has a shape ("./a/*"), so it is not opaque.
  itBundled("allow-unresolved/ConcatShapeRejectedByEmptyString", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        require("./a/" + x);
      `,
    },
    outdir: "/out",
    allowUnresolved: [""],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 18. ... and a pattern that matches the concatenation's shape allows it.
  itBundled("allow-unresolved/ConcatShapeAllowedByPattern", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        require("./a/" + x);
      `,
    },
    outdir: "/out",
    allowUnresolved: ["./a/*"],
  });

  // 19. A const bound to a template carries the template's shape.
  itBundled("allow-unresolved/ConstBoundTemplateRejectedByEmptyString", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        const specifier = \`./a/\${x}.js\`;
        require(specifier);
      `,
    },
    outdir: "/out",
    allowUnresolved: [""],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });

  // 20. ... and matches a pattern like the template itself would.
  itBundled("allow-unresolved/ConstBoundTemplateAllowedByPattern", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        const specifier = \`./a/\${x}.js\`;
        require(specifier);
      `,
    },
    outdir: "/out",
    allowUnresolved: ["./a/*.js"],
  });

  // 21. require.resolve() with a concatenation is checked the same way. It is
  // never glob-bundled, so the pattern is the only way to allow it.
  itBundled("allow-unresolved/RequireResolveConcatRejectedByEmptyString", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        require.resolve("./a/" + x);
      `,
    },
    outdir: "/out",
    allowUnresolved: [""],
    bundleErrors: {
      "/entry.js": ["will not be bundled"],
    },
  });
  itBundled("allow-unresolved/RequireResolveConcatAllowedByPattern", {
    files: {
      "/entry.js": /* js */ `
        const x = "foo";
        require.resolve("./a/" + x);
      `,
      "/a/foo.js": `module.exports = 1;`,
    },
    outdir: "/out",
    allowUnresolved: ["./a/*"],
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").not.toContain("__glob");
    },
  });

  // 22. Strict mode with files on disk: the matches are bundled into a closed
  // __glob map with no runtime fallback, so nothing resolves at runtime.
  itBundled("allow-unresolved/StrictGlobIsClosedSet", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.NAME;
        try {
          console.log(require(\`./a/\${name}.js\`));
        } catch (e) {
          console.log(e.code, e.message.includes("in bundle"));
        }
      `,
      "/a/foo.js": `module.exports = "foo";`,
    },
    outdir: "/out",
    allowUnresolved: [],
    run: [
      { env: { NAME: "foo" }, stdout: "foo" },
      { env: { NAME: "bar" }, stdout: "MODULE_NOT_FOUND true" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__glob(");
      api.expectFile("/out/entry.js").not.toContain("__require");
      api.expectFile("/out/entry.js").not.toContain("import.meta.require");
    },
  });

  // A dynamic import() miss in the closed map rejects the Promise like native
  // import(), so .catch() observes it instead of a synchronous throw.
  itBundled("allow-unresolved/StrictGlobImportMissRejects", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.NAME;
        import(\`./a/\${name}.js\`)
          .then(m => console.log(m.default))
          .catch(e => console.log("caught", e.code));
      `,
      "/a/foo.js": `export default "foo";`,
    },
    outdir: "/out",
    allowUnresolved: [],
    run: [
      { env: { NAME: "foo" }, stdout: "foo" },
      { env: { NAME: "bar" }, stdout: "caught MODULE_NOT_FOUND" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__glob(");
    },
  });

  // 23. A pattern that allows the shape keeps the runtime fallback next to the
  // bundled matches.
  itBundled("allow-unresolved/PatternGlobKeepsFallback", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.NAME;
        console.log(require(\`./a/\${name}.js\`));
      `,
      "/a/foo.js": `module.exports = "foo";`,
    },
    outdir: "/out",
    allowUnresolved: ["./a/*.js"],
    run: { env: { NAME: "foo" }, stdout: "foo" },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__glob(");
      api.expectFile("/out/entry.js").toContain("__require");
    },
  });
});
