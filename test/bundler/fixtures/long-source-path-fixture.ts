// Bundles a source whose absolute path is `length` bytes long, from whatever
// cwd the test picked, and reports what the build said about it. Spawned as a
// separate process because the bug this covers was a crash.
//
//   bun long-source-path-fixture.ts <mode> <length> <dir>
//
// Modes:
//   entry          in-memory (`files`) entry point at the long path
//   asset          in-memory entry point importing an in-memory image at the long path
//   import         entry point on disk importing a file on disk at the long path
//   import-plugin  like `import`, with an onResolve plugin that declines every path
//                  (imports then reach the resolver through the plugin code path)
import type { BuildConfig } from "bun";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [mode, lengthArg, dir] = process.argv.slice(2);
const length = Number(lengthArg);

// `<prefix>/<directory segments, each well under NAME_MAX>/<padding><basename>`,
// exactly `length` bytes long.
function longPath(prefix: string, basename: string): string {
  const segment = Buffer.alloc(200, "d").toString();
  let path = prefix;
  while (path.length + 1 + segment.length + 1 + basename.length <= length) {
    path += "/" + segment;
  }
  const padding = length - (path.length + 1 + basename.length);
  if (padding < 0) throw new Error(`${prefix} leaves no room for a ${length} byte path`);
  return `${path}/${Buffer.alloc(padding, "e")}${basename}`;
}

// The filesystem root, without its trailing separator (`""` on POSIX, the
// cwd's drive on Windows), so that the in-memory paths are absolute everywhere.
const root = resolve("/").slice(0, -1);

let path: string;
let options: BuildConfig;

switch (mode) {
  case "entry": {
    path = longPath(root, "entry.js");
    options = { entrypoints: [path], files: { [path]: "console.log(1);" } };
    break;
  }
  case "asset": {
    path = longPath(root, "image.png");
    const entry = join(process.cwd(), "entry.js");
    options = {
      entrypoints: [entry],
      files: { [entry]: `import url from ${JSON.stringify(path)}; console.log(url);`, [path]: "not really a png" },
    };
    break;
  }
  case "import":
  case "import-plugin": {
    path = longPath(realpathSync(dir), "dep.js");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "export default 42;");
    writeFileSync("entry.js", `import value from ${JSON.stringify(path)}; console.log(value);`);
    options = {
      entrypoints: ["./entry.js"],
      plugins:
        mode === "import-plugin"
          ? [{ name: "declines everything", setup: build => build.onResolve({ filter: /.*/ }, () => undefined) }]
          : [],
    };
    break;
  }
  default:
    throw new Error(`unknown mode ${mode}`);
}

const result = await Bun.build({ ...options, metafile: true, sourcemap: "external", throw: false });
const map = result.outputs.find(output => output.path.endsWith(".map"));
console.log(
  JSON.stringify({
    success: result.success,
    logs: result.logs.map(String),
    cwd: process.cwd(),
    path,
    inputs: result.metafile ? Object.keys(result.metafile.inputs) : null,
    sources: map ? JSON.parse(await map.text()).sources : null,
    outputs: result.outputs.map(output => output.path),
  }),
);
