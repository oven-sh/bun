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
          console.log(e.message);
        }
      `,
      "/mods/a.js": `module.exports = 1;`,
      "/mods/b.js": `module.exports = 2;`,
    },
    run: {
      stdout: "Cannot find module './mods/c.js' in glob import map. Available: ./mods/a.js, ./mods/b.js",
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
