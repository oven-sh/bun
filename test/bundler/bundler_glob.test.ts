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
  // the bundled matches and the runtime fallback.
  itBundled("glob/ImportWithTypeOption", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const name = globalThis.__which ?? "a";
        const m = await import(\`./data/\${name}.txt\`, { with: { type: "text" } });
        console.log(m.default);
      `,
      "/data/a.txt": "hello-from-text",
    },
    run: { stdout: "hello-from-text" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`{ with: { type: "text" } }`);
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
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("zero-match glob should fall through to runtime require");
      }
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
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("bare package template should not be glob-bundled");
      }
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
      const out = api.readFile("/out.js");
      if (out.includes("file-c")) {
        throw new Error("mid-segment wildcard should not recurse into subdirectories");
      }
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
      const out = api.readFile("/out.js");
      if (out.includes("__glob")) {
        throw new Error("literal * in template should fall through to runtime require");
      }
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
