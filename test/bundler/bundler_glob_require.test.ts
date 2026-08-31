import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { itBundled } from "./expectBundled";

// esbuild-style glob imports: `require()` / `import()` whose argument is a
// relative-path template literal or string concatenation bundles every file
// matching the pattern and dispatches at runtime via a __glob({...}) lookup
// table (https://esbuild.github.io/api/#glob).
//
// Also covers the `const specifier = <template>; require(specifier)` shape,
// which is how many native-addon loaders (e.g. tigerbeetle-node, issue #9951)
// pick a platform-specific .node file, and the extensionless
// `require("./src/" + name)` shape shelljs uses (issue #12302).
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
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain('"./mods/a.js"');
      api.expectFile("/out.js").toContain('"./mods/b.js"');
    },
  });

  // A specifier that is not in the map goes to the runtime require, which
  // reports it the same way it did before the call was rewritten.
  itBundled("glob-require/TemplateLiteralMiss", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "c";
        try {
          require(\`./mods/\${which}.js\`);
        } catch (e) {
          console.log(e.code, e.message.includes("./mods/c.js"));
        }
      `,
      "/mods/a.js": `module.exports = 1;`,
      "/mods/b.js": `module.exports = 2;`,
    },
    run: { stdout: "MODULE_NOT_FOUND true" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
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

  // A constant template part is folded into the head as a rope; the rope must
  // be flattened so the pattern is "./v2/**/*.js", not "./v*.js".
  itBundled("glob-require/TemplateFoldedConstantPart", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = "a";
        console.log(require(\`./v\${2}/\${name}.js\`));
      `,
      "/v2/a.js": `module.exports = "V2A";`,
    },
    run: { stdout: "V2A" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./v2/a.js"');
    },
  });

  // The shelljs pattern (#12302): the directory is scanned and every file is
  // also reachable by its extensionless name, which is what the runtime string
  // holds. The alias resolves through the bundler like a hand-written
  // require("./src/cat"), so both keys share one module instance.
  itBundled("glob-require/TrailingPlaceholderExtensionlessKeys", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const commands = {};
        for (const name of ["cat", "ls"]) {
          commands[name] = require("./src/" + name);
        }
        console.log(commands.cat(), commands.ls(), require("./src/" + "cat.js") === commands.cat);
      `,
      "/src/cat.js": /* js */ `module.exports = () => "cat";`,
      "/src/ls.js": /* js */ `module.exports = () => "ls";`,
      "/src/rm.js": /* js */ `module.exports = () => "rm";`,
    },
    run: { stdout: "cat ls true" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain('"./src/cat"');
      api.expectFile("/out.js").toContain('"./src/cat.js"');
      api.expectFile("/out.js").toContain('"./src/rm.js"');
    },
  });

  // An ESM file required through the map gets the same CommonJS interop
  // wrapper a static require("./mods/a") gets.
  itBundled("glob-require/TrailingPlaceholderEsmTarget", {
    target: "bun",
    files: {
      "/app/entry.js": /* js */ `
        for (const name of ["a", "b"]) {
          console.log(require("./mods/" + name).value);
        }
      `,
      "/app/mods/a.js": /* js */ `export const value = "esm-a";`,
      "/app/mods/b.js": /* js */ `module.exports = { value: "cjs-b" };`,
    },
    entryPoints: ["/app/entry.js"],
    outfile: "/out.js",
    run: { stdout: "esm-a\ncjs-b" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toCommonJS");
    },
  });

  itBundled("glob-require/TemplateLiteralJson", {
    target: "bun",
    files: {
      "/app/entry.js": /* js */ `
        const pick = name => require(\`./lang/\${name}.json\`);
        console.log(pick("en").hello, pick("fr").hello);
      `,
      "/app/lang/en.json": /* json */ `{ "hello": "hi" }`,
      "/app/lang/fr.json": /* json */ `{ "hello": "salut" }`,
    },
    entryPoints: ["/app/entry.js"],
    outfile: "/out.js",
    run: { stdout: "hi salut" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("salut");
      // The runtime string always ends in ".json", so no extensionless alias.
      api.expectFile("/out.js").not.toContain('"./lang/en"');
    },
  });

  // A hidden file is not scanned, so it is not in the map; the miss goes to
  // the runtime require, which still loads it from disk.
  itBundled("glob-require/MissFallsBackToRuntimeRequire", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.PLUGIN;
        console.log(require("./plugins/" + name));
      `,
      "/plugins/a.js": `module.exports = "bundled-a";`,
      "/plugins/.local.js": `module.exports = "from-disk";`,
    },
    outfile: "/out.js",
    run: [
      { env: { PLUGIN: "a" }, stdout: "bundled-a", setCwd: true },
      { env: { PLUGIN: ".local.js" }, stdout: "from-disk", setCwd: true },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./plugins/a.js"');
      api.expectFile("/out.js").not.toContain(".local.js");
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
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // A literal NUL anywhere in the specifier expression poisons the shape. It
  // must not become a wildcard that globs the directory.
  itBundled("glob-require/LiteralNulOperandNotGlobbed", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "a";
        try { require("./mods/" + which + "\\0"); } catch { console.log("caught"); }
      `,
      "/mods/a.js": `module.exports = 1;`,
    },
    run: { stdout: "caught" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // A `..` segment in the static text is normalized away in the map keys, so
  // the runtime string could never equal a key. The call must stay a runtime
  // call.
  itBundled("glob-require/DotDotSegmentNotGlobbed", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "x";
        console.log(require(\`./a/../mods/\${which}.js\`));
      `,
      "/a/unused.js": `module.exports = 0;`,
      "/mods/x.js": `module.exports = 1;`,
    },
    run: { stdout: "1" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // A placeholder right after a `..` segment would otherwise glob the whole
  // source tree through the collapsed pattern ./a/../**/*.js.
  itBundled("glob-require/DotDotSegmentBeforePlaceholderNotGlobbed", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const which = process.env.WHICH || "mods/x";
        console.log(require(\`./a/../\${which}.js\`));
      `,
      "/a/unused.js": `module.exports = 0;`,
      "/mods/x.js": `module.exports = 2;`,
    },
    run: { stdout: "2" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // A second argument to `import()` carrying `with: { type }` must reach both
  // the bundled matches and the runtime fallback. `.html` defaults to a
  // non-text loader, so the raw-text output proves the attribute was applied.
  itBundled("glob-require/ImportWithTypeOption", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.WHICH || "a";
        const m = await import(\`./data/\${name}.html\`, { with: { type: "text" } });
        console.log(m.default);
      `,
      "/data/a.html": "<b>hello-from-text</b>",
    },
    run: { stdout: "<b>hello-from-text</b>" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain(`{ with: { type: "text" } }`);
    },
  });

  // The generated fallback parameter must not shadow a user binding that is
  // passed as the import options.
  itBundled("glob-require/FallbackParamNoShadow", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const specifier = { with: { type: "text" } };
        const name = process.env.WHICH || "a";
        const m = await import(\`./data/\${name}.txt\`, specifier);
        console.log(m.default);
      `,
      "/data/a.txt": "hello",
    },
    run: { stdout: "hello" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import(specifier, specifier)");
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
      api.expectFile("/out.js").not.toContain("__glob");
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
      api.expectFile("/out.js").not.toContain("__glob");
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

  // Both branches of a ternary argument get glob-bundled.
  itBundled("glob-require/RequireTernaryArg", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const n = "a";
        const which = process.env.WHICH;
        const m = require(which === "y" ? \`./y/\${n}.js\` : \`./x/\${n}.js\`);
        console.log(m);
      `,
      "/x/a.js": `module.exports = "X";`,
      "/y/a.js": `module.exports = "Y";`,
    },
    run: [
      { env: { WHICH: "x" }, stdout: "X" },
      { env: { WHICH: "y" }, stdout: "Y" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./x/a.js"');
      api.expectFile("/out.js").toContain('"./y/a.js"');
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

  // `./file-${x}.js` has its wildcard mid-segment, so it matches one path
  // segment only (`*`) and does not descend into subdirectories.
  itBundled("glob-require/WildcardNotAfterSlash", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const n = process.env.WHICH || "a";
        console.log(require(\`./file-\${n}.js\`));
      `,
      "/file-a.js": `module.exports = "A";`,
      "/file-b.js": `module.exports = "B";`,
      "/sub/file-c.js": `module.exports = "C";`,
    },
    run: { stdout: "A" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./file-a.js"');
      api.expectFile("/out.js").toContain('"./file-b.js"');
      api.expectFile("/out.js").not.toContain("file-c");
    },
  });

  // `./engines/${f}.js` has its wildcard right after `/`, so like esbuild it
  // becomes `**/*` and also matches files in subdirectories.
  itBundled("glob-require/WildcardAfterSlashRecurses", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const p = process.env.WHICH || "deep/inner";
        console.log(require(\`./engines/\${p}.js\`));
      `,
      "/engines/top.js": `module.exports = "TOP";`,
      "/engines/deep/inner.js": `module.exports = "INNER";`,
    },
    run: { stdout: "INNER" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./engines/top.js"');
      api.expectFile("/out.js").toContain('"./engines/deep/inner.js"');
    },
  });

  itBundled("glob-require/ParentDirectory", {
    target: "bun",
    files: {
      "/nested/entry.js": /* js */ `
        const n = process.env.WHICH || "x";
        console.log(require(\`../other/\${n}.js\`));
      `,
      "/other/x.js": `module.exports = "X";`,
    },
    entryPoints: ["/nested/entry.js"],
    run: { stdout: "X" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"../other/x.js"');
    },
  });

  // A bare "./" prefix has no path component to anchor the glob; bundling
  // every file under the importer's directory would be far too greedy.
  itBundled("glob-require/BareDotSlashFallsThrough", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.WHICH || "a";
        try { require(\`./\${name}\`); } catch {}
        console.log("ok");
      `,
      "/a.js": `module.exports = "A";`,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // Same for a bare "../" prefix: it would glob-bundle the entire parent tree.
  itBundled("glob-require/BareDotDotSlashFallsThrough", {
    target: "bun",
    files: {
      "/nested/entry.js": /* js */ `
        const name = process.env.WHICH || "a";
        try { require(\`../\${name}\`); } catch {}
        console.log("ok");
      `,
      "/a.js": `module.exports = "A";`,
    },
    entryPoints: ["/nested/entry.js"],
    run: { stdout: "ok" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // Literal `*` in a template segment would change glob semantics; bail to
  // the runtime require rather than mis-globbing.
  itBundled("glob-require/LiteralGlobCharsFallThrough", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = process.env.WHICH || "a";
        try { require(\`./dir*/\${name}.js\`); } catch {}
        console.log("ok");
      `,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // Glob-generated records carry the relative specifier, so onResolve
  // plugins can redirect them like a hand-written require.
  itBundled("glob-require/OnResolvePluginApplies", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const n = process.env.WHICH || "a";
        console.log(require(\`./engines/\${n}.js\`));
      `,
      "/engines/a.js": `module.exports = "ORIGINAL";`,
      "/redirected.js": `module.exports = "REDIRECTED";`,
    },
    plugins(builder) {
      builder.onResolve({ filter: /engines\/a\.js$/ }, args => {
        return { path: resolve(dirname(args.importer), "redirected.js") };
      });
    },
    run: { stdout: "REDIRECTED" },
  });

  // `--external` patterns match the relative specifier too, leaving the
  // matched file unbundled.
  itBundled("glob-require/ExternalPatternApplies", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const n = process.env.WHICH || "a";
        console.log(require(\`./engines/\${n}.js\`));
      `,
      "/engines/a.js": `module.exports = "FROM-DISK";`,
    },
    external: ["./engines/*"],
    outfile: "/out.js",
    run: { stdout: "FROM-DISK", setCwd: true },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`require("./engines/a.js")`);
      api.expectFile("/out.js").not.toContain("FROM-DISK");
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

  // An extensionless runtime string can name a native addon: target bun's
  // extension order probes .node. The stem key must exist in the closed map,
  // or the require throws MODULE_NOT_FOUND instead of reaching dlopen.
  itBundled("glob-require/NativeAddonExtensionlessStem", {
    target: "bun",
    allowUnresolved: [],
    files: {
      "/entry.js": /* js */ `
        const plat = process.env.PLAT || "x64-linux";
        try {
          require("./bin/" + plat);
        } catch (e) {
          console.log(e.code);
        }
      `,
      "/bin/x64-linux.node": Buffer.from("dummy addon bytes"),
    },
    run: { stdout: "ERR_DLOPEN_FAILED" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('"./bin/x64-linux"');
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

  // The #13672 (esvu) and #12302 (shelljs) shapes in a compiled executable run
  // from an unrelated cwd: the runtime string names the file with its
  // extension in one case and without it in the other.
  itBundled("glob-require/CompileTrailingPlaceholder", {
    compile: true,
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const engines = {};
        for (const f of ["boa.js", "v8.js"]) {
          const e = require(\`./engines/\${f}\`);
          engines[e.id] = e;
        }
        const commands = ["cat", "ls"].map(name => require("./src/" + name)());
        console.log(Object.keys(engines).sort().join(","), commands.join(","));
      `,
      "/engines/boa.js": `module.exports = { id: "boa" };`,
      "/engines/v8.js": `module.exports = { id: "v8" };`,
      "/src/cat.js": `module.exports = () => "cat";`,
      "/src/ls.js": `module.exports = () => "ls";`,
    },
    run: { stdout: "boa,v8 cat,ls", setCwd: false },
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
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });
});

// A symlinked file under the wildcard is followed and bundled like the
// resolver would. itBundled cannot create symlinks, so this one is manual.
test.skipIf(isWindows)("glob-require/SymlinkedFileIsBundled", async () => {
  using dir = tempDir("bundler-glob-symlink", {
    "entry.js": `const n = process.env.WHICH || "a";\nconsole.log(require(\`./engines/\${n}.js\`));`,
    "engines/b.js": `module.exports = "B";`,
    "real/a.js": `module.exports = "REAL-A";`,
  });
  symlinkSync(join(String(dir), "real", "a.js"), join(String(dir), "engines", "a.js"));

  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "./entry.js", "--outfile=out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildStderr).toBe("");
  expect(buildExitCode).toBe(0);

  const out = await Bun.file(join(String(dir), "out.js")).text();
  expect(out).toContain('"./engines/a.js"');

  await using proc = Bun.spawn({
    cmd: [bunExe(), "./out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("REAL-A\n");
  expect(exitCode).toBe(0);
});

// When a custom --extension-order cannot probe the matched extension, no stem
// alias is emitted: the build succeeds, the literal key still works, and the
// extensionless runtime string reaches the runtime require fallback.
test("glob-require/StemAliasCustomExtensionOrder", async () => {
  using dir = tempDir("bundler-glob-extorder", {
    "entry.js": `const which = process.env.WHICH || "foo.mjs";\nconsole.log(require("./mods/" + which));`,
    "mods/foo.mjs": `module.exports = "mjs";`,
  });

  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--extension-order", ".ts,.js", "./entry.js", "--outfile=out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildStderr).toBe("");
  expect(buildExitCode).toBe(0);

  const out = await Bun.file(join(String(dir), "out.js")).text();
  expect(out).toContain('"./mods/foo.mjs"');
  expect(out).not.toContain('"./mods/foo"');

  for (const which of ["foo.mjs", "foo"]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "./out.js"],
      env: { ...bunEnv, WHICH: which },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("mjs\n");
    expect(exitCode).toBe(0);
  }
});
