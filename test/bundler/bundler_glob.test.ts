import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Coverage for bundling `require("./dir/" + x)` / `import("./dir/" + x)` by
// glob-matching the pattern at build time, matching esbuild.
// https://github.com/oven-sh/bun/issues/13672

describe("bundler", () => {
  itBundled("glob/RequireTemplateLiteral", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const names = ["boa", "v8"];
        const out = [];
        for (const n of names) {
          const e = require(\`./engines/\${n}.js\`);
          out.push(e.id);
        }
        console.log(out.join(","));
      `,
      "/engines/boa.js": `module.exports = { id: "boa" };`,
      "/engines/v8.js": `module.exports = { id: "v8" };`,
    },
    run: { stdout: "boa,v8" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
      // Both matches bundled under the caller-visible relative key.
      api.expectFile("/out.js").toContain(`"./engines/boa.js"`);
      api.expectFile("/out.js").toContain(`"./engines/v8.js"`);
    },
  });

  itBundled("glob/RequireStringConcat", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        function load(name) {
          return require("./engines/" + name + ".js").id;
        }
        console.log(load("a") + "," + load("b"));
      `,
      "/engines/a.js": `module.exports = { id: "a" };`,
      "/engines/b.js": `module.exports = { id: "b" };`,
    },
    run: { stdout: "a,b" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
    },
  });

  itBundled("glob/ImportTemplateLiteral", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = "foo";
        const m = await import(\`./mods/\${name}.js\`);
        console.log(m.default);
      `,
      "/mods/foo.js": `export default "FOO";`,
      "/mods/bar.js": `export default "BAR";`,
    },
    run: { stdout: "FOO" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain(`"./mods/foo.js"`);
      api.expectFile("/out.js").toContain(`"./mods/bar.js"`);
    },
  });

  // An extensionless key (`"./engines/" + "boa"`) is not in the bundled map;
  // fall back to the runtime `require` so it resolves the same as before the
  // files were bundled. Running from the source directory so the fallback
  // can actually find the file on disk.
  itBundled("glob/ExtensionlessFallbackRequire", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = globalThis.__which ?? "boa";
        const e = require("./engines/" + name);
        console.log(e.id);
      `,
      "/engines/boa.js": `module.exports = { id: "boa" };`,
      "/engines/v8.js": `module.exports = { id: "v8" };`,
    },
    outfile: "/out.js",
    run: { stdout: "boa", setCwd: true },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__glob");
      api.expectFile("/out.js").toContain(`"./engines/boa.js"`);
    },
  });

  itBundled("glob/ExtensionlessFallbackImport", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = globalThis.__which ?? "boa";
        const e = await import("./engines/" + name);
        console.log(e.default.id);
      `,
      "/engines/boa.js": `export default { id: "boa" };`,
    },
    outfile: "/out.js",
    run: { stdout: "boa", setCwd: true },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("(p) => import(p)");
    },
  });

  // A second argument to `import()` carrying `with: { type }` must reach both
  // the bundled matches and the runtime fallback. `.html` defaults to a
  // non-text loader, so the raw-text output proves the attribute was applied.
  itBundled("glob/ImportWithTypeOption", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = globalThis.__which ?? "a";
        const m = await import(\`./data/\${name}.html\`, { with: { type: "text" } });
        console.log(m.default);
      `,
      "/data/a.html": "<b>hello-from-text</b>",
    },
    run: { stdout: "<b>hello-from-text</b>" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`{ with: { type: "text" } }`);
    },
  });

  // Both branches of a ternary argument get glob-bundled.
  itBundled("glob/RequireTernaryArg", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const n = "a";
        const which = globalThis.__y ? "y" : "x";
        const m = require(which === "y" ? \`./y/\${n}.js\` : \`./x/\${n}.js\`);
        console.log(m);
      `,
      "/x/a.js": `module.exports = "X";`,
      "/y/a.js": `module.exports = "Y";`,
    },
    run: { stdout: "X" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`"./x/a.js"`);
      api.expectFile("/out.js").toContain(`"./y/a.js"`);
    },
  });

  // A constant template part is folded into the head as a rope; the rope must
  // be flattened so the pattern is "./v2/**/*.js", not "./v*.js".
  itBundled("glob/TemplateFoldedConstantPart", {
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
      api.expectFile("/out.js").toContain(`"./v2/a.js"`);
    },
  });

  // The generated fallback parameter must not shadow a user binding that is
  // passed as the import options.
  itBundled("glob/FallbackParamNoShadow", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const p = { with: { type: "text" } };
        const name = globalThis.__which ?? "a";
        const m = await import(\`./data/\${name}.txt\`, p);
        console.log(m.default);
      `,
      "/data/a.txt": "hello",
    },
    run: { stdout: "hello" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import(p, p)");
    },
  });

  // A bare "./" prefix has no path component to anchor the glob; bundling
  // every sibling of the importer would be far too greedy (esbuild bails too).
  itBundled("glob/BareDotSlashFallsThrough", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = globalThis.__x ?? "a";
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
  itBundled("glob/BareDotDotSlashFallsThrough", {
    target: "bun",
    files: {
      "/nested/entry.js": /* js */ `
        const name = globalThis.__x ?? "a";
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

  // No files match the pattern: leave the call as a runtime `require` so
  // `allowUnresolved` still applies and runtime-created files can be loaded.
  itBundled("glob/NoMatchesFallThrough", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = globalThis.__x ?? "a";
        try { require(\`./nope/\${name}.js\`); } catch {}
        console.log("ok");
      `,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  itBundled("glob/IgnoresBarePackage", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = "fs";
        const fs = require(\`node:\${name}\`);
        console.log(typeof fs.readFileSync);
      `,
    },
    run: { stdout: "function" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // `./file-${x}.js` has its wildcard mid-segment, so it should not recurse
  // into subdirectories (`*`, not `**/*`).
  itBundled("glob/WildcardNotAfterSlash", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const n = "a";
        console.log(require(\`./file-\${n}.js\`));
      `,
      "/file-a.js": `module.exports = "A";`,
      "/file-b.js": `module.exports = "B";`,
      "/sub/file-c.js": `module.exports = "C";`,
    },
    run: { stdout: "A" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`"./file-a.js"`);
      api.expectFile("/out.js").toContain(`"./file-b.js"`);
      api.expectFile("/out.js").not.toContain("file-c");
    },
  });

  // `./engines/${f}` has its wildcard right after `/`, so it recurses.
  itBundled("glob/WildcardAfterSlashRecurses", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const p = "deep/inner";
        console.log(require(\`./engines/\${p}.js\`));
      `,
      "/engines/top.js": `module.exports = "TOP";`,
      "/engines/deep/inner.js": `module.exports = "INNER";`,
    },
    run: { stdout: "INNER" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`"./engines/top.js"`);
      api.expectFile("/out.js").toContain(`"./engines/deep/inner.js"`);
    },
  });

  itBundled("glob/ParentDirectory", {
    target: "bun",
    files: {
      "/nested/entry.js": /* js */ `
        const n = "x";
        console.log(require(\`../other/\${n}.js\`));
      `,
      "/other/x.js": `module.exports = "X";`,
    },
    entryPoints: ["/nested/entry.js"],
    run: { stdout: "X" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`"../other/x.js"`);
    },
  });

  // Literal `*` in a template segment would change glob semantics; bail to
  // the runtime require rather than mis-globbing.
  itBundled("glob/LiteralGlobCharsFallThrough", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = "a";
        try { require(\`./dir*/\${name}.js\`); } catch {}
        console.log("ok");
      `,
    },
    run: { stdout: "ok" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__glob");
    },
  });

  // The original #13672 scenario: readdir + require(`./engines/${f}`), run
  // as a compiled standalone executable from an unrelated cwd.
  itBundled("compile/GlobRequireReaddir#13672", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.js": /* js */ `
        const fs = require("fs");
        const path = require("path");
        const engines = {};
        for (const f of fs.readdirSync(path.join(__dirname, "engines"))) {
          if (!f.endsWith(".js")) continue;
          const e = require(\`./engines/\${f}\`);
          engines[e.id] = e;
        }
        console.log(Object.keys(engines).sort().join(","));
      `,
      "/engines/boa.js": `module.exports = { id: "boa" };`,
      "/engines/v8.js": `module.exports = { id: "v8" };`,
    },
    run: { stdout: "boa,v8", setCwd: false },
  });
});
