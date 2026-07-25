import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// esbuild-style glob imports: `require()` / `import()` whose argument is a
// relative-path template literal bundles every file matching the pattern and
// dispatches at runtime via a __glob({...}) lookup table.
//
// Also covers the `const specifier = <template>; require(specifier)` shape,
// which is how many native-addon loaders (e.g. tigerbeetle-node, issue #9951)
// pick a platform-specific .node file.
describe("bundler", () => {
  itBundled("glob-require/TemplateLiteralDirect", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH;
        console.log(require(\`./mods/\${which}.js\`));
      `,
      "/mods/a.js": `module.exports = "value-a";`,
      "/mods/b.js": `module.exports = "value-b";`,
    },
    run: [
      { env: { WHICH: "a" }, stdout: "value-a" },
      { env: { WHICH: "b" }, stdout: "value-b" },
    ],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain('"./mods/a.js"');
      api.expectFile("/out.js").toContain('"./mods/b.js"');
      if (out.includes("import.meta.require")) {
        throw new Error("expected template-literal require to be bundled, not deferred to runtime");
      }
    },
  });

  itBundled("glob-require/TemplateLiteralMiss", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "c";
        try {
          require(\`./mods/\${which}.js\`);
        } catch (e) {
          console.log(e.code, e.message);
        }
      `,
      "/mods/a.js": `module.exports = 1;`,
      "/mods/b.js": `module.exports = 2;`,
    },
    run: {
      stdout:
        "MODULE_NOT_FOUND Cannot find module './mods/c.js' in glob import map. Available: ./mods/a.js, ./mods/b.js",
    },
  });

  itBundled("glob-require/StringConcatenation", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH;
        console.log(require("./mods/" + which + ".js"));
      `,
      "/mods/a.js": `module.exports = "concat-a";`,
      "/mods/b.js": `module.exports = "concat-b";`,
    },
    run: { env: { WHICH: "b" }, stdout: "concat-b" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
    },
  });

  // Adjacent string literals are folded into a rope EString before the glob
  // check; the shape extractor must read every segment.
  itBundled("glob-require/StringConcatenationAdjacentLiterals", {
    target: "bun",
    minifySyntax: true,
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH;
        console.log(require("./mods" + "/" + which + ".js"));
      `,
      "/mods/a.js": `module.exports = "rope-a";`,
      "/mods/b.js": `module.exports = "rope-b";`,
    },
    run: { env: { WHICH: "a" }, stdout: "rope-a" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./mods/a.js"');
    },
  });

  // A self-referential const must not send the bundler into unbounded
  // recursion. The self-reference contributes a placeholder, so a map is
  // still emitted; the entry throws TDZ at runtime before the lookup.
  itBundled("glob-require/SelfReferentialConst", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        try {
          const a = \`./mods/\${a}.js\`;
          require(a);
        } catch (e) {
          console.log("caught");
        }
      `,
      "/mods/x.js": `module.exports = 1;`,
    },
    run: { stdout: "caught" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./mods/x.js"');
    },
  });

  // A literal NUL in a template's static content must not be confused with
  // the placeholder marker.
  itBundled("glob-require/LiteralNulNotGlobbed", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "a";
        try { require(\`./mods/\\0\${which}.js\`); } catch {}
        console.log("ok");
      `,
      "/mods/a.js": `module.exports = 1;`,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("literal NUL must not be treated as a glob placeholder");
      }
    },
  });

  // import() with a second argument (import attributes) is not glob-resolved;
  // it falls through to the runtime import so the attributes are preserved.
  itBundled("glob-require/DynamicImportWithOptionsNotGlobbed", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "a";
        const m = await import(\`./mods/\${which}.json\`, { with: { type: "json" } });
        void m;
        console.log("ok");
      `,
      "/mods/a.json": `{"a":1}`,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("import() with attributes must not be glob-resolved");
      }
    },
  });

  itBundled("glob-require/ConstIndirection", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH;
        const specifier = \`./mods/\${which}.js\`;
        console.log(require(specifier));
      `,
      "/mods/a.js": `module.exports = "indirect-a";`,
      "/mods/b.js": `module.exports = "indirect-b";`,
    },
    run: { env: { WHICH: "a" }, stdout: "indirect-a" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
    },
  });

  // A `let` binding may be reassigned, so the bundler must not treat its
  // initializer as the specifier shape.
  itBundled("glob-require/LetIndirectionNotBundled", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        let specifier = \`./mods/\${process.env.WHICH}.js\`;
        if (process.env.OVERRIDE) specifier = process.env.OVERRIDE;
        try { require(specifier); } catch {}
        console.log("ok");
      `,
      "/mods/a.js": `module.exports = 1;`,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("let-bound specifier should not be glob-resolved");
      }
    },
  });

  // Zero matches falls through to runtime require (same as before), so
  // bundling still succeeds and the call can be caught at runtime.
  itBundled("glob-require/ZeroMatchesFallsThrough", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        try {
          require(\`./nowhere/\${process.env.X}.js\`);
        } catch (e) {
          console.log("caught");
        }
      `,
    },
    run: { stdout: "caught" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("zero-match glob should fall through, not emit __glob");
      }
    },
  });

  itBundled("glob-require/DynamicImport", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH;
        const m = await import(\`./mods/\${which}.js\`);
        console.log(m.default);
      `,
      "/mods/a.js": `export default "import-a";`,
      "/mods/b.js": `export default "import-b";`,
    },
    run: { env: { WHICH: "b" }, stdout: "import-b" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
    },
  });

  itBundled("glob-require/SubdirectoryMatch", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const plat = process.env.PLAT;
        console.log(require(\`./bin/\${plat}/client.js\`));
      `,
      "/bin/x64-linux/client.js": `module.exports = "linux";`,
      "/bin/arm64-darwin/client.js": `module.exports = "darwin";`,
      "/bin/README.md": `not js`,
    },
    run: [
      { env: { PLAT: "x64-linux" }, stdout: "linux" },
      { env: { PLAT: "arm64-darwin" }, stdout: "darwin" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./bin/x64-linux/client.js"');
      api.expectFile("/out.js").toContain('"./bin/arm64-darwin/client.js"');
      api.expectFile("/out.js").not.toContain("README");
    },
  });

  // The tigerbeetle-node pattern: a const specifier built from several
  // interpolations, declared after control flow that computes one of the
  // pieces, inside an IIFE.
  itBundled("glob-require/NativeAddonLoaderPattern", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const binding = (() => {
          const { PLAT, ARCH } = process.env;
          let extra = "";
          if (PLAT === "linux") extra = "-gnu";
          const filename = \`./bin/\${ARCH}-\${PLAT}\${extra}/client.js\`;
          return require(filename);
        })();
        console.log(binding);
      `,
      "/bin/x64-linux-gnu/client.js": `module.exports = "linux-gnu";`,
      "/bin/x64-darwin/client.js": `module.exports = "darwin";`,
      "/bin/arm64-darwin/client.js": `module.exports = "arm-darwin";`,
    },
    run: [
      { env: { PLAT: "linux", ARCH: "x64" }, stdout: "linux-gnu" },
      { env: { PLAT: "darwin", ARCH: "x64" }, stdout: "darwin" },
      { env: { PLAT: "darwin", ARCH: "arm64" }, stdout: "arm-darwin" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain('"./bin/x64-linux-gnu/client.js"');
    },
  });

  // The #9951 scenario end to end: a platform-specific .node addon required
  // via a const template specifier is embedded in a --compile binary. We use
  // dummy addon bytes so the test does not need node-gyp; loading is expected
  // to fail at dlopen time, which is past the point the glob resolution and
  // asset embedding this PR adds have both succeeded.
  itBundled("glob-require/CompileEmbedsNodeAddon", {
    compile: true,
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        const binding = (() => {
          const plat = process.env.PLAT || "x64-linux";
          const filename = \`./bin/\${plat}/client.node\`;
          try {
            return require(filename);
          } catch (e) {
            // Embedding worked when we got as far as trying to dlopen the
            // dummy bytes; a resolver miss would be MODULE_NOT_FOUND instead.
            if (e.code === "ERR_DLOPEN_FAILED") return "dlopen-attempted";
            throw e;
          }
        })();
        const names = Bun.embeddedFiles.map(f => f.name).sort();
        console.log(JSON.stringify({ binding, count: names.length }));
      `,
      "/bin/x64-linux/client.node": Buffer.from("not a real addon"),
      "/bin/arm64-darwin/client.node": Buffer.from("not a real addon either"),
    },
    run: {
      setCwd: true,
      env: { PLAT: "x64-linux" },
      stdout: JSON.stringify({ binding: "dlopen-attempted", count: 2 }),
    },
  });

  // Bare specifiers (no `./` / `../`) must not be globbed.
  itBundled("glob-require/BareSpecifierNotGlobbed", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        try {
          require(\`some-pkg/\${process.env.X}\`);
        } catch {}
        console.log("ok");
      `,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("bare specifiers must not be glob-resolved");
      }
    },
  });
});
