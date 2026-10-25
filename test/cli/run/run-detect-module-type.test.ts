import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Which module format a file is evaluated as when its contents use neither
// CommonJS nor ESM syntax:
//   .cjs/.cts and .mjs/.mts are decided by the extension alone,
//   everything else by the nearest package.json "type" (with or without a
//   "name"), and with no "type" Bun defaults to ESM.
// The answer must not depend on how the file is loaded. The entry point,
// require() and a Worker's main module transpile on the JS thread; import,
// import() and --require preloads transpile on the work pool
// (RuntimeTranspilerStore). Both paths must apply the same rule, and so must
// the bundler.

type Format = "commonjs" | "module";
type Scope = "commonjs" | "module" | "untyped";

const packageJson: Record<Scope, string> = {
  commonjs: `{ "type": "commonjs" }`,
  module: `{ "type": "module" }`,
  untyped: `{}`,
};

const extensions = [".js", ".ts", ".jsx", ".tsx", ".cjs", ".cts", ".mjs", ".mts"];

function expectedFormat(scope: Scope, ext: string): Format {
  if (ext === ".cjs" || ext === ".cts") return "commonjs";
  if (ext === ".mjs" || ext === ".mts") return "module";
  return scope === "commonjs" ? "commonjs" : "module";
}

const matrix: Record<Scope, Record<string, Format>> = Object.fromEntries(
  (Object.keys(packageJson) as Scope[]).map(scope => [
    scope,
    Object.fromEntries(extensions.map(ext => [`hello${ext}`, expectedFormat(scope, ext)])),
  ]),
) as Record<Scope, Record<string, Format>>;

const fixtures = extensions.map(ext => `hello${ext}`);

// Every fixture prints "<file> <format>". `module` is only mentioned inside
// eval, so the parser sees neither CommonJS nor ESM syntax and the format can
// only come from the extension or package.json. The .jsx/.tsx fixtures also
// render an element: a CommonJS .jsx file needs the JSX runtime as a
// require(), an import statement inside the CommonJS wrapper is a syntax error.
function fixture(file: string): string {
  const jsx = file.endsWith("x") ? `const element = <div className="x">{${JSON.stringify(file)}}</div>;\n` : "";
  return `${jsx}console.log("${file}", eval("typeof module") === "undefined" ? "module" : "commonjs");\n`;
}

// A stand-in for react's JSX runtime so the fixtures stay offline.
const jsxRuntimeStub = {
  "node_modules/react/package.json": `{ "name": "react", "version": "0.0.0" }`,
  "node_modules/react/jsx-dev-runtime.js": `exports.jsxDEV = (type, props) => ({ type, props });\nexports.Fragment = "Fragment";\n`,
  "node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = (type, props) => ({ type, props });\nexports.Fragment = "Fragment";\n`,
};

// The files that load every one of `files` in another way than as the entry point.
function loaders(files: string[]) {
  return {
    "static-import.mjs": files.map(file => `import "./${file}";`).join("\n") + "\n",
    "dynamic-import.mjs": `for (const file of ${JSON.stringify(files)}) await import("./" + file);\n`,
    "require-all.cjs": files.map(file => `require("./${file}");`).join("\n") + "\n",
    "empty.mjs": "",
  };
}

function scopeDir(scope: Scope) {
  return tempDir(`module-type-${scope}`, {
    "package.json": packageJson[scope],
    ...jsxRuntimeStub,
    ...Object.fromEntries(fixtures.map(file => [file, fixture(file)])),
    ...loaders(fixtures),
    // An onLoad plugin that hands back each fixture's own contents.
    "plugin.mjs": `
      import { plugin } from "bun";
      import { readFileSync } from "node:fs";
      const loaders = { js: "js", cjs: "js", mjs: "js", jsx: "jsx", ts: "ts", cts: "ts", mts: "ts", tsx: "tsx" };
      plugin({
        name: "passthrough",
        setup(build) {
          build.onLoad({ filter: /hello\\.[a-z]+$/ }, ({ path }) => ({
            contents: readFileSync(path, "utf8"),
            loader: loaders[path.slice(path.lastIndexOf(".") + 1)],
          }));
        },
      });
    `,
  });
}

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Parses the "<file> <format>" lines the fixtures print (in any order) into a table. */
function formats(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter(Boolean)
      .map(line => line.split(" ")),
  );
}

/**
 * One test for each way to load `files`. Every way must print `expected`.
 * `cwd()` has the files and `loaders(files)`.
 */
function everyLoadPath(cwd: () => string, files: string[], expected: Record<string, Format>) {
  test("as the entry point", async () => {
    const results = await Promise.all(files.map(file => run(cwd(), file)));
    expect(formats(results.map(r => r.stdout).join(""))).toEqual(expected);
    expect(results.map(r => r.stderr)).toEqual(files.map(() => ""));
    expect(results.map(r => r.exitCode)).toEqual(files.map(() => 0));
  });

  const preloads = files.flatMap(file => ["--require", `./${file}`]);
  for (const [name, args] of [
    ["via require()", ["require-all.cjs"]],
    ["via an import statement", ["static-import.mjs"]],
    ["via import()", ["dynamic-import.mjs"]],
    ["via --require", [...preloads, "empty.mjs"]],
  ] as const) {
    test(name, async () => {
      const { stdout, stderr, exitCode } = await run(cwd(), ...args);
      expect(formats(stdout)).toEqual(expected);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  }
}

// Not concurrent with the tests below: a Worker starts its own VM, which is
// slow on a debug build unless it has a CPU to itself.
test("module format as a Worker's main module", async () => {
  using dir = tempDir("module-type-worker", {
    "esm/package.json": packageJson.module,
    "esm/hello.cjs": fixture("hello.cjs"),
    "cjs/package.json": packageJson.commonjs,
    "cjs/hello.mjs": fixture("hello.mjs"),
    "workers.mjs": `
      await Promise.all(["./esm/hello.cjs", "./cjs/hello.mjs"].map(file => {
        const worker = new Worker(new URL(file, import.meta.url));
        return new Promise((resolve, reject) => {
          worker.addEventListener("close", resolve);
          worker.addEventListener("error", reject);
        });
      }));
    `,
  });
  const { stdout, stderr, exitCode } = await run(String(dir), "workers.mjs");
  expect(formats(stdout)).toEqual({ "hello.cjs": "commonjs", "hello.mjs": "module" });
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

describe.concurrent("module format follows the extension, then the nearest package.json", () => {
  for (const scope of Object.keys(packageJson) as Scope[]) {
    describe(`package.json ${packageJson[scope]}`, () => {
      // The tests only read the fixtures, so a scope's tests share one directory.
      let dir: ReturnType<typeof scopeDir>;
      beforeAll(() => {
        dir = scopeDir(scope);
      });
      afterAll(() => dir?.[Symbol.dispose]());

      everyLoadPath(() => String(dir), fixtures, matrix[scope]);

      test("source from an onLoad plugin still runs", async () => {
        // The loader evaluates an onLoad plugin's source as an ES module
        // whatever the parser decides. A CommonJS wrapper from the path hint
        // would never be called, so that source gets no hint.
        const { stdout, stderr, exitCode } = await run(String(dir), "--preload", "./plugin.mjs", "static-import.mjs");
        expect(Object.keys(formats(stdout)).sort()).toEqual([...fixtures].sort());
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });
    });
  }
});

describe.concurrent('module syntax in the file decides before the extension and "type"', () => {
  // `import` makes a file ESM and `module.exports` makes it CommonJS, whatever
  // its extension and the package.json say. The path decides only for a file
  // with neither.
  const withImport = (file: string) => `import * as os from "node:os";\nos;\n${fixture(file)}`;
  const withExports = (file: string) => `module.exports = {};\n${fixture(file)}`;
  const expected: Record<string, Format> = {
    "with-import.cjs": "module",
    "with-exports.mjs": "commonjs",
    "commonjs/with-import.js": "module",
    "module/with-exports.js": "commonjs",
  };
  const files = Object.keys(expected);

  let dir: ReturnType<typeof tempDir>;
  beforeAll(() => {
    dir = tempDir("module-type-syntax", {
      "commonjs/package.json": packageJson.commonjs,
      "module/package.json": packageJson.module,
      ...Object.fromEntries(files.map(file => [file, (expected[file] === "module" ? withImport : withExports)(file)])),
      ...loaders(files),
    });
  });
  afterAll(() => dir?.[Symbol.dispose]());

  everyLoadPath(() => String(dir), files, expected);
});

describe.concurrent("the nearest package.json decides, with or without a name", () => {
  // A package.json without a "name" is not the package's root for bundling
  // (DirInfo.enclosing_package_json), but its "type" still applies to the
  // files below it. `dist/cjs/package.json` containing only
  // {"type":"commonjs"} inside a "type":"module" package is the common case.

  test('a nameless {"type":"commonjs"} in a parent directory applies to the runtime', async () => {
    using dir = tempDir("module-type-nameless", {
      "package.json": `{ "type": "commonjs" }`,
      "src/hello.js": fixture("hello.js"),
      "src/import.mjs": `import "./hello.js";\n`,
    });
    const [entry, imported] = await Promise.all([run(String(dir), "src/hello.js"), run(String(dir), "src/import.mjs")]);
    const commonjs = { stdout: "hello.js commonjs\n", stderr: "", exitCode: 0 };
    expect({ entry, imported }).toEqual({ entry: commonjs, imported: commonjs });
  });

  test('a nameless {"type":"commonjs"} in a parent directory applies to the bundler', async () => {
    using dir = tempDir("module-type-nameless-build", {
      "package.json": `{ "type": "commonjs" }`,
      "src/hello.js": `console.log("hello");\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "build", "src/hello.js", "--target=bun");
    expect(stdout).toContain("__commonJS(");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("a nested nameless scope overrides the named package root", async () => {
    using dir = tempDir("module-type-nested", {
      "package.json": `{ "name": "dual", "type": "module" }`,
      "dist/cjs/package.json": `{ "type": "commonjs" }`,
      "dist/cjs/lib/hello.js": fixture("hello.js"),
      "dist/esm/hello.js": fixture("hello.js"),
      "main.mjs": `import "./dist/cjs/lib/hello.js";\nimport "./dist/esm/hello.js";\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
    expect(stdout).toBe("hello.js commonjs\nhello.js module\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

test.concurrent("an empty file follows the same rule", async () => {
  // The parser does not run for an empty file, so the loader picks the format.
  using dir = tempDir("module-type-empty", {
    "package.json": packageJson.commonjs,
    "empty.cjs": "",
    "blank.cts": "\n",
    "empty.js": "",
    "empty.mjs": "",
    "import.mjs": `
      import cjs from "./empty.cjs";
      import cts from "./blank.cts";
      import js from "./empty.js";
      import * as mjs from "./empty.mjs";
      console.log(JSON.stringify({ cjs, cts, js, mjs: Object.keys(mjs) }));
    `,
    "dynamic-import.mjs": `
      const load = async file => (await import(file)).default;
      const [cjs, cts, js] = await Promise.all(["./empty.cjs", "./blank.cts", "./empty.js"].map(load));
      console.log(JSON.stringify({ cjs, cts, js, mjs: Object.keys(await import("./empty.mjs")) }));
    `,
    "require.cjs": `
      const [cjs, cts, js] = ["./empty.cjs", "./blank.cts", "./empty.js"].map(file => require(file));
      console.log(JSON.stringify({ cjs, cts, js, mjs: Object.keys(require("./empty.mjs")) }));
    `,
  });
  const entries = ["import.mjs", "dynamic-import.mjs", "require.cjs"];
  const results = await Promise.all(entries.map(entry => run(String(dir), entry)));
  const empty = { stdout: `{"cjs":{},"cts":{},"js":{},"mjs":[]}\n`, stderr: "", exitCode: 0 };
  expect(Object.fromEntries(entries.map((entry, i) => [entry, results[i]]))).toEqual(
    Object.fromEntries(entries.map(entry => [entry, empty])),
  );
});

describe.concurrent("JSX in a CommonJS module", () => {
  // The parser adds `import { jsxDEV } from "react/jsx-dev-runtime"` to a file
  // that uses JSX. Inside the CommonJS function wrapper that has to be a
  // require(), or the transpiled file is a syntax error.

  test("a .jsx file that assigns module.exports", async () => {
    using dir = tempDir("module-type-jsx-cjs", {
      ...jsxRuntimeStub,
      "component.jsx": `module.exports = function Component() {\n  return <div className="x">hi</div>;\n};\n`,
      "main.cjs": `console.log(JSON.stringify(require("./component.jsx")()));\n`,
      "main.mjs": `import Component from "./component.jsx";\nconsole.log(JSON.stringify(Component()));\n`,
    });
    const [required, imported] = await Promise.all([run(String(dir), "main.cjs"), run(String(dir), "main.mjs")]);
    const rendered = { stdout: `{"type":"div","props":{"className":"x","children":"hi"}}\n`, stderr: "", exitCode: 0 };
    expect({ required, imported }).toEqual({ required: rendered, imported: rendered });
  });

  test('a .test.tsx file with Jest globals under {"type":"commonjs"}', async () => {
    // No import from bun:test: the globals are injected with a require() in a
    // CommonJS file, the same way the JSX runtime must be.
    using dir = tempDir("module-type-jsx-test", {
      ...jsxRuntimeStub,
      "package.json": packageJson.commonjs,
      "element.test.tsx": `test("renders", () => {\n  expect(<span>{1}</span>).toEqual({ type: "span", props: { children: 1 } });\n});\n`,
    });
    const { stderr, exitCode } = await run(String(dir), "test", "./element.test.tsx");
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });
});

test.concurrent("a decorated class in a CommonJS module", async () => {
  // The decorator helpers come from "bun:wrap". Inside the CommonJS function
  // wrapper they have to be required, like the JSX runtime.
  const decorated = (file: string) => `function dec(target) {\n  return target;\n}\n@dec\nclass A {}\n${fixture(file)}`;
  using dir = tempDir("module-type-decorators", {
    "package.json": packageJson.commonjs,
    "hello.ts": decorated("hello.ts"),
    "hello.tsx": decorated("hello.tsx"),
    "hello.cts": decorated("hello.cts"),
    ...jsxRuntimeStub,
    "import.mjs": `import "./hello.ts";\nimport "./hello.tsx";\nimport "./hello.cts";\n`,
  });
  const all = { "hello.ts": "commonjs", "hello.tsx": "commonjs", "hello.cts": "commonjs" };
  const files = Object.keys(all);
  const [imported, ...entries] = await Promise.all([
    run(String(dir), "import.mjs"),
    ...files.map(file => run(String(dir), file)),
  ]);
  expect(Object.fromEntries(files.map((file, i) => [file, entries[i]]))).toEqual(
    Object.fromEntries(files.map(file => [file, { stdout: `${file} commonjs\n`, stderr: "", exitCode: 0 }])),
  );
  expect({ ...imported, stdout: formats(imported.stdout) }).toEqual({ stdout: all, stderr: "", exitCode: 0 });
});

test("the transpiler cache keys on the module type, not only the file contents", async () => {
  // The on-disk cache file is named after a hash of the source bytes and only
  // applies to files of 4 KiB or more. Identical bytes under "type":"module"
  // and "type":"commonjs" transpile to different formats, so the second scope
  // must not be served the first scope's entry.
  const padding = "// " + Buffer.alloc(4096, "x").toString() + "\n";
  using dir = tempDir("module-type-cache", {
    "cache/.keep": "",
    "esm/package.json": `{ "type": "module" }`,
    "esm/hello.js": padding + fixture("hello.js"),
    "cjs/package.json": `{ "type": "commonjs" }`,
    "cjs/hello.js": padding + fixture("hello.js"),
  });
  const env = {
    ...bunEnv,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache"),
    // A debug build only serves a cached entry with this set.
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };
  for (const [subdir, format] of [
    ["esm", "module"],
    ["cjs", "commonjs"],
  ]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "hello.js"],
      cwd: join(String(dir), subdir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: `hello.js ${format}\n`, stderr: "", exitCode: 0 });
  }
});

describe.concurrent('package.json "type" does not apply to', () => {
  // "type" governs .js and its TypeScript and JSX forms. These entries have no
  // such extension, so their contents decide, whatever the package.json says.
  const detect = `console.log(eval("typeof module") === "undefined" ? "module" : "commonjs");`;
  const usesRequire = `require("node:os");\n${detect}`;

  async function inEveryScope(files: Record<string, string>, args: string[], stdin?: string) {
    const scopes = Object.keys(packageJson) as Scope[];
    const results = await Promise.all(
      scopes.map(async scope => {
        using dir = tempDir(`module-type-no-ext-${scope}`, { "package.json": packageJson[scope], ...files });
        await using proc = Bun.spawn({
          cmd: [bunExe(), ...args],
          cwd: String(dir),
          env: bunEnv,
          stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      }),
    );
    return Object.fromEntries(scopes.map((scope, i) => [scope, results[i]]));
  }
  const everyScope = (stdout: string) => {
    const one = { stdout, stderr: "", exitCode: 0 };
    return { commonjs: one, module: one, untyped: one };
  };

  test("bun -e", async () => {
    expect(await inEveryScope({}, ["-e", detect])).toEqual(everyScope("module\n"));
  });

  test("a script on stdin", async () => {
    expect(await inEveryScope({}, ["run", "-"], detect)).toEqual(everyScope("module\n"));
  });

  test("a script with no extension", async () => {
    const [ambiguous, withRequire] = await Promise.all([
      inEveryScope({ "cli": detect }, ["cli"]),
      inEveryScope({ "cli": usesRequire }, ["cli"]),
    ]);
    expect(ambiguous).toEqual(everyScope("module\n"));
    expect(withRequire).toEqual(everyScope("commonjs\n"));
  });
});
