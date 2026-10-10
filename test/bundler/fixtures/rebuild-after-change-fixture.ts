// Each case builds a project, changes it on disk with node:fs, and builds it
// again, all in this one process. The script prints what every build bundled
// (or its errors) as JSON. One process per build always gives these results:
// a build must not reuse what an earlier build, or the runtime, read from a
// directory.

import { mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.argv[2];

function write(path: string, contents: string) {
  path = join(root, path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

// The string that the entry point of `project` prints, or the build errors.
async function build(project: string, options: Partial<Bun.BuildConfig> = {}) {
  const result = await Bun.build({ entrypoints: [join(root, project, "index.ts")], throw: false, ...options });
  if (!result.success) return result.logs.map(log => log.message);
  return (await result.outputs[0].text()).match(/"from [^"]*"/)?.[0] ?? null;
}

const tsconfigPaths = (dir: string) => JSON.stringify({ compilerOptions: { paths: { "@lib/*": [`./${dir}/*`] } } });
const usesPackage = `import { from } from "pkg"; console.log(from);`;
const usesAlias = `import { from } from "@lib/mod"; console.log(from);`;
const exportsFrom = (name: string) => `export const from = "from ${name}";`;

const cases: Record<string, () => Promise<unknown[]>> = {
  async "tsconfig.json paths changed"() {
    write("paths/index.ts", usesAlias);
    write("paths/v1/mod.ts", exportsFrom("v1"));
    write("paths/v2/mod.ts", exportsFrom("v2"));
    write("paths/tsconfig.json", tsconfigPaths("v1"));
    const before = await build("paths");
    write("paths/tsconfig.json", tsconfigPaths("v2"));
    return [before, await build("paths")];
  },

  async "tsconfig.json created"() {
    write("created/index.ts", usesAlias);
    write("created/v1/mod.ts", exportsFrom("v1"));
    const before = await build("created");
    write("created/tsconfig.json", tsconfigPaths("v1"));
    return [before, await build("created")];
  },

  async "package.json main changed"() {
    write("main/index.ts", usesPackage);
    write("main/node_modules/pkg/a.js", exportsFrom("a"));
    write("main/node_modules/pkg/b.js", exportsFrom("b"));
    write("main/node_modules/pkg/package.json", `{ "name": "pkg", "main": "./a.js" }`);
    const before = await build("main");
    write("main/node_modules/pkg/package.json", `{ "name": "pkg", "main": "./b.js" }`);
    return [before, await build("main")];
  },

  async "package.json exports changed"() {
    write("exports/index.ts", usesPackage);
    write("exports/node_modules/pkg/a.js", exportsFrom("a"));
    write("exports/node_modules/pkg/b.js", exportsFrom("b"));
    write("exports/node_modules/pkg/package.json", `{ "name": "pkg", "exports": "./a.js" }`);
    const before = await build("exports");
    write("exports/node_modules/pkg/package.json", `{ "name": "pkg", "exports": "./b.js" }`);
    return [before, await build("exports")];
  },

  async "package installed"() {
    write("installed/index.ts", usesPackage);
    const before = await build("installed");
    write("installed/node_modules/pkg/index.js", exportsFrom("pkg"));
    write("installed/node_modules/pkg/package.json", `{ "name": "pkg", "main": "./index.js" }`);
    return [before, await build("installed")];
  },

  async "package removed"() {
    write("removed/index.ts", usesPackage);
    write("removed/node_modules/pkg/index.js", exportsFrom("pkg"));
    write("removed/node_modules/pkg/package.json", `{ "name": "pkg", "main": "./index.js" }`);
    const before = await build("removed");
    rmSync(join(root, "removed/node_modules"), { recursive: true });
    return [before, await build("removed")];
  },

  async "directory with an index file created"() {
    write("index-file/index.ts", `import { from } from "./lib"; console.log(from);`);
    const before = await build("index-file");
    write("index-file/lib/index.ts", exportsFrom("lib"));
    return [before, await build("index-file")];
  },

  async "file created, then removed"() {
    write("file/index.ts", `import { from } from "./generated"; console.log(from);`);
    const before = await build("file");
    write("file/generated.ts", exportsFrom("generated"));
    const created = await build("file");
    rmSync(join(root, "file/generated.ts"));
    return [before, created, await build("file")];
  },

  // The two builds read the same files. They differ in the main fields that
  // their target reads from package.json.
  async "target changed"() {
    write("target/index.ts", usesPackage);
    write("target/node_modules/pkg/main.js", exportsFrom("main"));
    write("target/node_modules/pkg/browser.js", exportsFrom("browser"));
    write("target/node_modules/pkg/package.json", `{ "name": "pkg", "main": "./main.js", "browser": "./browser.js" }`);
    return [await build("target", { target: "node" }), await build("target", { target: "browser" })];
  },
};

if (process.platform !== "win32") {
  cases["directory symlink retargeted"] = async () => {
    write("symlink/index.ts", `import { from } from "./link/mod"; console.log(from);`);
    write("symlink/v1/mod.ts", exportsFrom("v1"));
    write("symlink/v2/mod.ts", exportsFrom("v2"));
    symlinkSync("v1", join(root, "symlink/link"));
    const before = await build("symlink");
    unlinkSync(join(root, "symlink/link"));
    symlinkSync("v2", join(root, "symlink/link"));
    return [before, await build("symlink")];
  };
}

const seen: Record<string, unknown[]> = {};
for (const [name, run] of Object.entries(cases)) {
  seen[name] = await run();
}
console.log(JSON.stringify(seen));
