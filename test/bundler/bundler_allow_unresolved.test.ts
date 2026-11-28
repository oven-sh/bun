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

  // 17. minifySyntax inlines `const` values. A specifier that the source
  // writes as an identifier is still not a string literal, so the result is
  // the same as without minifySyntax.
  itBundled("allow-unresolved/MinifySyntaxRejectsConstSpecifier", {
    files: {
      "/entry.js": /* js */ `
        const someVar = "./dynamic.js";
        import(someVar);
        require(someVar);
        require.resolve(someVar);
      `,
      "/dynamic.js": `module.exports = 1;`,
    },
    outdir: "/out",
    minifySyntax: true,
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": [
        "This import() expression will not be bundled",
        "This require() expression will not be bundled",
        "This require.resolve() expression will not be bundled",
      ],
    },
  });

  // 18. minifySyntax substitutes the single-use variable and visits the
  // ternary again. The import() is reported once, at the call.
  itBundled("allow-unresolved/MinifySyntaxReportsSubstitutedSpecifierOnce", {
    files: {
      "/entry.js": /* js */ `
        export function viaImport(c) { let name = "./dynamic.js"; return c ? import(name) : null; }
      `,
      "/dynamic.js": `module.exports = 1;`,
    },
    outdir: "/out",
    minifySyntax: true,
    allowUnresolved: [],
    bundleErrors: {
      "/entry.js": ["This import() expression will not be bundled"],
    },
  });

  // 19. minifySyntax: a specifier that is not a variable in the source is
  // still a string literal for the bundler.
  itBundled("allow-unresolved/MinifySyntaxAcceptsDefineAndLiteralSpecifier", {
    files: {
      "/entry.js": /* js */ `
        import(DEF);
        require(DEF);
        require.resolve(DEF);
        require(globalThis.c ? DEF : "./dynamic.js");
        require.resolve(globalThis.c ? DEF : "./dynamic.js");
      `,
      "/dynamic.js": `module.exports = 1;`,
    },
    outdir: "/out",
    minifySyntax: true,
    allowUnresolved: [],
    define: { DEF: '"./dynamic.js"' },
  });
});
