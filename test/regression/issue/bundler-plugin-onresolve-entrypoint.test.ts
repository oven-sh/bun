import { describe } from "bun:test";
import path from "node:path";
import { itBundled } from "../../bundler/expectBundled";

describe("bundler plugin onResolve entry point", () => {
  itBundled("onResolve-entrypoint-modification", {
    files: {
      "entry.js": `console.log("original entry");`,
    },
    plugins(build) {
      const resolvedPaths = new Map();

      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind === "entry-point-build" || args.kind === "entry-point-run") {
          const modifiedPath = args.path + ".modified";
          resolvedPaths.set(modifiedPath, args.path);
          console.log(`onResolve: ${args.path} -> ${modifiedPath} (${args.kind})`);
          return { path: modifiedPath };
        }
      });

      build.onLoad({ filter: /.*/ }, args => {
        console.log(`onLoad: ${args.path}`);

        if (args.path.endsWith(".modified")) {
          return {
            contents: 'console.log("SUCCESS: Modified entry loaded");',
            loader: "js",
          };
        }

        for (const [modified, original] of resolvedPaths) {
          if (args.path === original) {
            return {
              contents: 'console.log("BUG: Original entry loaded");',
              loader: "js",
            };
          }
        }

        return {
          contents: 'console.log("Other file loaded");',
          loader: "js",
        };
      });
    },
    run: {
      stdout: "SUCCESS: Modified entry loaded",
    },
  });

  itBundled("onResolve-import-modification", {
    files: {
      "entry.js": `import "./foo.magic";`,
      "foo.js": `console.log("foo loaded");`,
    },
    plugins(build) {
      build.onResolve({ filter: /\.magic$/ }, args => {
        const newPath = args.path.replace(/\.magic$/, ".js");
        const resolvedPath = path.join(path.dirname(args.importer), newPath);
        console.log(`onResolve: ${args.path} -> ${resolvedPath} (${args.kind})`);
        return { path: resolvedPath };
      });

      build.onLoad({ filter: /foo\.js$/ }, args => {
        console.log(`onLoad: ${args.path}`);

        if (args.path.endsWith("foo.js")) {
          return {
            contents: 'console.log("SUCCESS: foo.js loaded via onResolve");',
            loader: "js",
          };
        }
      });
    },
    run: {
      stdout: "SUCCESS: foo.js loaded via onResolve",
    },
  });

  itBundled("onResolve-multiple-entrypoints", {
    files: {
      "entry1.js": `console.log("entry1");`,
      "entry2.js": `console.log("entry2");`,
      "entry3.js": `console.log("entry3");`,
    },
    entryPoints: ["entry1.js", "entry2.js", "entry3.js"],
    plugins(build) {
      const entryModifications = new Map();

      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind?.includes("entry-point")) {
          const modified = args.path + ".modified";
          entryModifications.set(args.path, modified);
          console.log(`onResolve: ${args.path} -> ${modified} (${args.kind})`);
          return { path: modified };
        }
      });

      build.onLoad({ filter: /.*/ }, args => {
        console.log(`onLoad: ${args.path}`);

        if (args.path.endsWith(".modified")) {
          const baseName = path.basename(args.path, ".js.modified");
          return {
            contents: `console.log("SUCCESS: ${baseName} modified");`,
            loader: "js",
          };
        }

        for (const [original] of entryModifications) {
          if (args.path === original) {
            const entryName = path.basename(args.path, ".js");
            return {
              contents: `console.log("BUG: ${entryName} original loaded");`,
              loader: "js",
            };
          }
        }
      });
    },
    outputPaths: ["out/entry1.js", "out/entry2.js", "out/entry3.js"],
    run: [
      { file: "out/entry1.js", stdout: "SUCCESS: entry1 modified" },
      { file: "out/entry2.js", stdout: "SUCCESS: entry2 modified" },
      { file: "out/entry3.js", stdout: "SUCCESS: entry3 modified" },
    ],
  });
});
