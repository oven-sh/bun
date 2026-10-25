import type { DirectoryTree } from "harness";
import { delimiter, join } from "node:path";
import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type Answer = string | null | [onImport: string | null, onRequire: string | null];

function emptyFiles(paths: string[]): DirectoryTree {
  return Object.fromEntries(paths.map(path => [path, ""]));
}

function pinsFrom(from: string, answers: Record<string, Answer>): Pin[] {
  return Object.entries(answers).map(([specifier, answer]): Pin => {
    const [onImport, onRequire] = Array.isArray(answer) ? answer : [answer, answer];
    return [from, specifier, onImport, onRequire];
  });
}

function plainPackageFiles(): DirectoryTree {
  return { "package.json": JSON.stringify({ name: "plain", main: "./main.js" }), "main.js": "" };
}

function exportingPackageFiles(name: string): DirectoryTree {
  return {
    "package.json": JSON.stringify({ name, exports: { ".": "./main.js", "./sub": "./sub.js" } }),
    ...emptyFiles(["main.js", "sub.js"]),
  };
}

function globalDirectoryFiles(): DirectoryTree {
  return {
    "global-a/with-exports/package.json": JSON.stringify({ exports: { ".": "./exported.js" }, main: "./main.js" }),
    ...emptyFiles([
      "global-a/only-a/index.js",
      "global-a/both/index.js",
      "global-b/both/index.js",
      "global-b/only-b.js",
      "global-a/installed/index.js",
      "node_modules/installed/index.js",
      "global-a/@scope/pkg/index.js",
      "global-a/pair.ts",
      "global-a/pair.js",
      "global-c/only-c/index.js",
      "global-a/with-exports/exported.js",
      "global-a/with-exports/main.js",
      "global-a/with-exports/hidden.js",
    ]),
  };
}

const cases: ResolutionCase[] = [
  {
    name: "a package imports itself",
    files: {
      "package.json": JSON.stringify({
        name: "self",
        exports: {
          ".": "./main.js",
          "./feature": "./lib/feature.js",
          "./by-kind": { import: "./esm.mjs", require: "./cjs.cjs" },
        },
      }),
      ...emptyFiles(["main.js", "lib/feature.js", "esm.mjs", "cjs.cjs", "hidden.js"]),
      ...packageFiles("self", {}, ["index.js", "hidden.js"]),
    },
    pins: pinsFrom("src/deep/importer.js", {
      "self": "main.js",
      "self/feature": "lib/feature.js",
      "self/by-kind": ["esm.mjs", "cjs.cjs"],
      "self/package.json": "package.json",
      // A subpath that "exports" does not list is not searched for in node_modules/self.
      "self/hidden": null,
      "self/hidden.js": null,
      "self-other": null,
      "selfish/feature": null,
    }),
  },
  {
    name: "no exports, no self reference",
    files: plainPackageFiles(),
    pins: [["src/importer.js", "plain", null]],
  },
  {
    name: "no exports, the installed package",
    files: { ...plainPackageFiles(), "node_modules/plain/index.js": "" },
    pins: [["src/importer.js", "plain", "node_modules/plain/index.js"]],
  },
  {
    name: "a scoped name",
    files: exportingPackageFiles("@scope/self"),
    pins: pinsFrom("src/importer.js", {
      "@scope/self": "main.js",
      "@scope/self/sub": "sub.js",
      "@scope/other": null,
      "@scope": null,
    }),
  },
  {
    name: "the nearest package.json decides",
    files: { ...exportingPackageFiles("self"), "src/package.json": JSON.stringify({ type: "module" }) },
    pins: [
      ["src/importer.js", "self", null],
      ["lib/importer.js", "self", "main.js"],
    ],
  },
  {
    name: "inside node_modules",
    files: packageFiles("pkg", { exports: { ".": "./index.js", "./feature": "./feature.js" } }, [
      "index.js",
      "feature.js",
      "node_modules/pkg/index.js",
    ]),
    pins: pinsFrom("node_modules/pkg/lib/importer.js", {
      "pkg": "node_modules/pkg/index.js",
      "pkg/feature": "node_modules/pkg/feature.js",
    }),
  },
  {
    name: "NODE_PATH",
    files: globalDirectoryFiles(),
    child: root => ({
      env: {
        NODE_PATH: [
          join(root, "no-such-directory"),
          join(root, "global-a"),
          "",
          join(root, "global-b"),
          "global-c",
        ].join(delimiter),
      },
    }),
    pins: pinsFrom("app/importer.js", {
      "only-a": "global-a/only-a/index.js",
      "both": "global-a/both/index.js",
      "only-b": "global-b/only-b.js",
      "installed": "node_modules/installed/index.js",
      "@scope/pkg": "global-a/@scope/pkg/index.js",
      // The extension order outside node_modules.
      "pair": "global-a/pair.ts",
      // "exports" is not read in a NODE_PATH directory.
      "with-exports": "global-a/with-exports/main.js",
      "with-exports/hidden": "global-a/with-exports/hidden.js",
      // A relative entry starts at the working directory, which is the root.
      "only-c": "global-c/only-c/index.js",
      "nowhere": null,
      "./only-a": null,
    }),
  },
  {
    name: "no NODE_PATH",
    files: globalDirectoryFiles(),
    // The test runner may have a NODE_PATH of its own, so this case runs in a child as well.
    child: () => ({ env: { NODE_PATH: "" } }),
    pins: pinsFrom("app/importer.js", {
      "only-a": null,
      "only-b": null,
      "pair": null,
      "only-c": null,
      "installed": "node_modules/installed/index.js",
    }),
  },
];

describe("code resolution", () => testResolution(cases));
