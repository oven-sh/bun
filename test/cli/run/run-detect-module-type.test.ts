import { describe, expect, test } from "bun:test";
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

const expected: Record<Scope, Record<string, Format>> = Object.fromEntries(
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

function scopeDir(scope: Scope) {
  return tempDir(`module-type-${scope}`, {
    "package.json": packageJson[scope],
    ...jsxRuntimeStub,
    ...Object.fromEntries(fixtures.map(file => [file, fixture(file)])),
    "static-import.mjs": fixtures.map(file => `import "./${file}";`).join("\n") + "\n",
    "dynamic-import.mjs": `for (const file of ${JSON.stringify(fixtures)}) await import("./" + file);\n`,
    "require-all.cjs": fixtures.map(file => `require("./${file}");`).join("\n") + "\n",
    "empty.mjs": "",
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

describe.concurrent("module format follows the extension, then the nearest package.json", () => {
  for (const scope of Object.keys(packageJson) as Scope[]) {
    describe(`package.json ${packageJson[scope]}`, () => {
      test("as the entry point", async () => {
        using dir = scopeDir(scope);
        const results = await Promise.all(fixtures.map(file => run(String(dir), file)));
        expect(formats(results.map(r => r.stdout).join(""))).toEqual(expected[scope]);
        expect(results.map(r => r.stderr)).toEqual(fixtures.map(() => ""));
        expect(results.map(r => r.exitCode)).toEqual(fixtures.map(() => 0));
      });

      test("via require()", async () => {
        using dir = scopeDir(scope);
        const { stdout, stderr, exitCode } = await run(String(dir), "require-all.cjs");
        expect(formats(stdout)).toEqual(expected[scope]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      test("via an import statement", async () => {
        using dir = scopeDir(scope);
        const { stdout, stderr, exitCode } = await run(String(dir), "static-import.mjs");
        expect(formats(stdout)).toEqual(expected[scope]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      test("via import()", async () => {
        using dir = scopeDir(scope);
        const { stdout, stderr, exitCode } = await run(String(dir), "dynamic-import.mjs");
        expect(formats(stdout)).toEqual(expected[scope]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      test("via --require", async () => {
        using dir = scopeDir(scope);
        const preloads = fixtures.flatMap(file => ["--require", `./${file}`]);
        const { stdout, stderr, exitCode } = await run(String(dir), ...preloads, "empty.mjs");
        expect(formats(stdout)).toEqual(expected[scope]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });
    });
  }

  test("as a Worker's main module", async () => {
    // A Worker starts its own VM and transpiles its entry on that thread.
    // Two workers, not the whole table: each one costs about a second on a
    // debug build.
    using dir = tempDir("module-type-worker", {
      "esm/package.json": packageJson.module,
      "esm/hello.cjs": fixture("hello.cjs"),
      "cjs/package.json": packageJson.commonjs,
      "cjs/hello.mjs": fixture("hello.mjs"),
      "workers.mjs": `
        import { Worker } from "node:worker_threads";
        await Promise.all(["./esm/hello.cjs", "./cjs/hello.mjs"].map(file => {
          const worker = new Worker(new URL(file, import.meta.url));
          return new Promise((resolve, reject) => {
            worker.on("exit", resolve);
            worker.on("error", reject);
          });
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "workers.mjs");
    expect(formats(stdout)).toEqual({ "hello.cjs": "commonjs", "hello.mjs": "module" });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
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
    const entry = await run(String(dir), "src/hello.js");
    expect(entry).toEqual({ stdout: "hello.js commonjs\n", stderr: "", exitCode: 0 });
    const imported = await run(String(dir), "src/import.mjs");
    expect(imported).toEqual({ stdout: "hello.js commonjs\n", stderr: "", exitCode: 0 });
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
    const rendered = `{"type":"div","props":{"className":"x","children":"hi"}}\n`;
    expect(await run(String(dir), "main.cjs")).toEqual({ stdout: rendered, stderr: "", exitCode: 0 });
    expect(await run(String(dir), "main.mjs")).toEqual({ stdout: rendered, stderr: "", exitCode: 0 });
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
  const env = { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache") };
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
