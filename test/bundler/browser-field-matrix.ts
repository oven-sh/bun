// The package.json "browser" map as a table. A layout is one import of one package: where the package is, how the
// key is spelled, whether its value is a file or `false`, and how the import is spelled. A bundler's answer for a
// layout is the set of files that its module graph reaches, read from the metafile, so every layout is built in one
// build and nothing is run.
//
// bundler_browser.test.ts pins Bun's table. scripts/browser-field-matrix.ts prints where it differs from esbuild's.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export type Layout = { group: string; name: string; files: Record<string, string> };
/** The answer for each layout: the files the entry point reaches, or "error" when the build fails on it. */
export type Table = Record<string, string>;

const file = (name: string) => `console.log(${JSON.stringify(name)});`;

function packageFiles(dir: string, packageJson: object, extra: Record<string, string> = {}) {
  return {
    [`${dir}/package.json`]: JSON.stringify(packageJson),
    [`${dir}/main.js`]: file("main.js"),
    [`${dir}/x.js`]: file("x.js"),
    [`${dir}/a.js`]: file("a.js"),
    [`${dir}/dir/index.js`]: file("dir/index.js"),
    [`${dir}/lib/inner.js`]: file("lib/inner.js"),
    ...extra,
  };
}

export function layouts(): Layout[] {
  const all: Layout[] = [];
  const keys = ["./x.js", "./x", "x.js", "x", "./dir/index.js", "./dir/index", "./dir", "dir", "./main.js", "./main"];
  const values: [string | false, string][] = [
    ["./a.js", "a file"],
    [false, "false"],
  ];

  // An import from outside the package.
  for (const [dir, name, where] of [
    ["node_modules/pkg", "pkg", "an unscoped"],
    ["node_modules/@s/pkg", "@s/pkg", "a scoped"],
  ])
    for (const key of keys)
      for (const [value, valueName] of values)
        for (const spec of ["P/x", "P/x.js", "P/dir", "P/dir/index.js", "P/dir/index", "P"])
          all.push({
            group: `import of ${where} package`,
            name: `key ${key} is ${valueName}, import ${spec.replace("P", name)}`,
            files: {
              "entry.js": `import ${JSON.stringify(spec.replace("P", name))};`,
              ...packageFiles(dir, { name: "pkg", main: "./main.js", browser: { [key]: value } }),
            },
          });

  // The same, for a package with "exports".
  for (const key of ["./x.js", "./x", "./main.js", "./lib/inner.js"])
    for (const spec of ["pkg", "pkg/x", "pkg/x.js", "pkg/inner"])
      all.push({
        group: "import of a package with exports",
        name: `key ${key} is a file, import ${spec}`,
        files: {
          "entry.js": `import ${JSON.stringify(spec)};`,
          ...packageFiles("node_modules/pkg", {
            name: "pkg",
            exports: { ".": "./main.js", "./x": "./x.js", "./x.js": "./x.js", "./inner": "./lib/inner.js" },
            browser: { [key]: "./a.js" },
          }),
        },
      });

  // A require() inside the package, from its root and from a subdirectory. No key may apply to "./x" from "lib/".
  for (const key of keys)
    for (const [value, valueName] of values)
      for (const spec of ["./x", "./x.js", "x", "x.js", "./dir", "dir", "../x", "../x.js"])
        for (const from of ["main.js", "lib/inner.js"]) {
          if (spec.startsWith("../") && from === "main.js") continue;
          all.push({
            group: `require in ${from} of the package`,
            name: `key ${key} is ${valueName}, require ${spec}`,
            files: {
              "entry.js": `import "pkg/${from}";`,
              ...packageFiles(
                "node_modules/pkg",
                { name: "pkg", main: "./main.js", browser: { [key]: value } },
                {
                  [`node_modules/pkg/${from}`]: `require(${JSON.stringify(spec)});`,
                  "node_modules/x/index.js": file("node_modules/x"),
                  "node_modules/x.js/index.js": file("node_modules/x.js"),
                  "node_modules/dir/index.js": file("node_modules/dir"),
                },
              ),
            },
          });
        }

  // The map of the project itself.
  for (const key of ["./x.js", "./x", "x", "./src/x.js"])
    for (const spec of ["./x", "./x.js", "x", "../x"])
      for (const from of ["entry.js", "src/deep.js"]) {
        if (spec.startsWith("../") && from === "entry.js") continue;
        const files: Record<string, string> = {
          "package.json": JSON.stringify({ name: "project", browser: { [key]: "./a.js" } }),
          "x.js": file("x.js"),
          "a.js": file("a.js"),
          "src/x.js": file("src/x.js"),
          "node_modules/x/index.js": file("node_modules/x"),
        };
        if (from === "entry.js") files["entry.js"] = `require(${JSON.stringify(spec)});`;
        else {
          files["entry.js"] = `import "./src/deep.js";`;
          files["src/deep.js"] = `require(${JSON.stringify(spec)});`;
        }
        all.push({ group: "require in the project", name: `key ${key} is a file, ${from} requires ${spec}`, files });
      }

  return all;
}

type Metafile = { inputs: Record<string, { imports: { path: string; external?: boolean }[] }> };
type BuildResult = { metafile?: Metafile; failedIn: string[] };
/** Builds the given entry points. `base` is the directory that the paths in the result are relative to. */
type Bundler = { base: string; build(entryPoints: string[]): Promise<BuildResult> };

const slashes = (path: string) => path.replaceAll("\\", "/");

/** Writes every layout to its own directory below `root` and builds them all with `bundler`. */
export async function table(root: string, all: Layout[], bundler: Bundler): Promise<Table> {
  const disabled = "(disabled):";
  const entry = (index: number) => join(root, String(index), "entry.js");
  // "3/node_modules/pkg/x.js" for a path below `root`.
  const below = (path: string) => {
    const absolute = resolve(bundler.base, path);
    return absolute.startsWith(root + sep) ? slashes(relative(root, absolute)) : undefined;
  };
  // The same with the "(disabled):" prefix kept. Any other path stays as it is.
  const key = (path: string) => {
    const prefix = path.startsWith(disabled) ? disabled : "";
    const inside = below(path.slice(prefix.length));
    return inside === undefined ? path : prefix + inside;
  };
  const layoutOf = (path: string) => {
    const index = Number(below(path)?.split("/")[0]);
    return index < all.length ? [index] : [];
  };

  for (let index = 0; index < all.length; index++)
    for (const [name, contents] of Object.entries(all[index].files)) {
      const path = join(root, String(index), name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }

  // A layout that fails stops the whole build, so build again without it.
  const failed = new Set<number>();
  let metafile: Metafile | undefined;
  while (!metafile) {
    const remaining = all.map((_, index) => index).filter(index => !failed.has(index));
    const result = await bundler.build(remaining.map(entry));
    if (result.metafile) {
      metafile = result.metafile;
      break;
    }
    const before = failed.size;
    for (const path of result.failedIn) for (const index of layoutOf(path)) failed.add(index);
    // An error with no position names no layout. Find the layouts that fail alone.
    if (failed.size === before)
      for (const index of remaining) if (!(await bundler.build([entry(index)])).metafile) failed.add(index);
    if (failed.size === before) throw new Error("the build fails, and no layout fails alone");
  }

  const imports = new Map(Object.entries(metafile.inputs).map(([path, input]) => [key(path), input.imports]));
  const answer: Table = {};
  for (let index = 0; index < all.length; index++) {
    if (failed.has(index)) {
      answer[all[index].name] = "error";
      continue;
    }
    const start = `${index}/entry.js`;
    const reached = new Set([start]);
    for (const path of reached)
      for (const record of imports.get(path) ?? [])
        reached.add((record.external ? "external:" : "") + key(record.path));
    reached.delete(start);
    answer[all[index].name] = [...reached]
      .map(path => path.replace(`${index}/`, ""))
      .sort()
      .join(" + ");
  }
  return answer;
}

/** The bun that runs this file, for `--target=browser`. */
export const bun: Bundler = {
  base: process.cwd(),
  async build(entrypoints) {
    const result = await Bun.build({ entrypoints, target: "browser", metafile: true, throw: false });
    if (result.success) return { metafile: result.metafile as Metafile, failedIn: [] };
    return { failedIn: result.logs.flatMap(log => (log.position ? [log.position.file] : [])) };
  },
};

/** esbuild, given its module (`await import("esbuild")`) and the directory that `table` writes to. */
export function esbuild(module: any, root: string): Bundler {
  return {
    base: root,
    async build(entryPoints) {
      try {
        const result = await module.build({
          entryPoints,
          bundle: true,
          platform: "browser",
          format: "esm",
          write: false,
          outdir: join(root, "out"),
          metafile: true,
          logLevel: "silent",
          absWorkingDir: root,
        });
        return { metafile: result.metafile, failedIn: [] };
      } catch (error: any) {
        return { failedIn: error.errors.flatMap((e: any) => (e.location ? [e.location.file] : [])) };
      }
    },
  };
}
