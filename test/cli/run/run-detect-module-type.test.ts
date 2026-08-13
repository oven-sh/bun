import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Which module format a file is evaluated as when its contents don't say:
//   .cjs/.cts and .mjs/.mts are decided by the extension alone,
//   .js/.ts by the nearest package.json "type",
//   anything else (.jsx/.tsx) by the contents, which for a file using neither
//   format's syntax means ESM.
// The answer must not depend on how the file is loaded. The entry point and
// require() transpile on the main thread; import, import() and --require
// preloads transpile on the thread pool (RuntimeTranspilerStore), which used to
// look at package.json only and so ignored the extension.

type Format = "commonjs" | "module";

const packageJson = {
  commonjs: `{ "type": "commonjs" }`,
  module: `{ "type": "module" }`,
  untyped: `{}`,
};

const expected: Record<keyof typeof packageJson, Record<string, Format>> = {
  commonjs: {
    "hello.cjs": "commonjs",
    "hello.cts": "commonjs",
    "hello.mjs": "module",
    "hello.mts": "module",
    "hello.js": "commonjs",
    "hello.ts": "commonjs",
    "hello.jsx": "module",
    "hello.tsx": "module",
    "has-import.cjs": "module",
  },
  module: {
    "hello.cjs": "commonjs",
    "hello.cts": "commonjs",
    "hello.mjs": "module",
    "hello.mts": "module",
    "hello.js": "module",
    "hello.ts": "module",
    "hello.jsx": "module",
    "hello.tsx": "module",
    "has-import.cjs": "module",
  },
  untyped: {
    "hello.cjs": "commonjs",
    "hello.cts": "commonjs",
    "hello.mjs": "module",
    "hello.mts": "module",
    "hello.js": "module",
    "hello.ts": "module",
    "hello.jsx": "module",
    "hello.tsx": "module",
    "has-import.cjs": "module",
  },
};

const fixtures = Object.keys(expected.untyped);

// Every fixture prints "<file> <format>". `module` is only mentioned inside
// eval, so the parser sees no CommonJS (or, except for has-import.cjs, ESM)
// syntax and the format can only come from the extension / package.json.
// An import statement in a .cjs file still wins over the extension.
function fixture(file: string): string {
  const prelude = file === "has-import.cjs" ? `import "node:fs";\n` : "";
  return `${prelude}console.log("${file}", eval("typeof module") === "undefined" ? "module" : "commonjs");\n`;
}

function scope(type: keyof typeof packageJson) {
  return tempDir(`module-type-${type}`, {
    "package.json": packageJson[type],
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

describe.concurrent("module format follows the extension, then package.json", () => {
  for (const type of Object.keys(packageJson) as (keyof typeof packageJson)[]) {
    describe(`package.json ${packageJson[type]}`, () => {
      test("as the entry point", async () => {
        using dir = scope(type);
        const results = await Promise.all(fixtures.map(file => run(String(dir), file)));
        expect(formats(results.map(r => r.stdout).join(""))).toEqual(expected[type]);
        expect(results.map(r => r.exitCode)).toEqual(fixtures.map(() => 0));
      });

      test("via require()", async () => {
        using dir = scope(type);
        const { stdout, stderr, exitCode } = await run(String(dir), "require-all.cjs");
        expect(formats(stdout)).toEqual(expected[type]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      test("via an import statement", async () => {
        using dir = scope(type);
        const { stdout, stderr, exitCode } = await run(String(dir), "static-import.mjs");
        expect(formats(stdout)).toEqual(expected[type]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      test("via import()", async () => {
        using dir = scope(type);
        const { stdout, stderr, exitCode } = await run(String(dir), "dynamic-import.mjs");
        expect(formats(stdout)).toEqual(expected[type]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      test("via --require", async () => {
        using dir = scope(type);
        const preloads = fixtures.flatMap(file => ["--require", `./${file}`]);
        const { stdout, stderr, exitCode } = await run(String(dir), ...preloads, "empty.mjs");
        expect(formats(stdout)).toEqual(expected[type]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });
    });
  }

  // The user-visible consequence of getting the format wrong: CommonJS is sloppy
  // mode, so a .cjs setup script may assign undeclared globals; evaluated as ESM
  // (strict mode) the same assignment is a ReferenceError.
  test("a .cjs file without CommonJS syntax is sloppy-mode CommonJS when preloaded or imported", async () => {
    using dir = tempDir("module-type-sloppy", {
      "setup.cjs": `implicitGlobal = "set by setup.cjs";\nconsole.log(implicitGlobal);\n`,
      "main.mjs": `import "./setup.cjs";\n`,
      "empty.mjs": "",
    });
    const [preloaded, imported] = await Promise.all([
      run(String(dir), "--require", "./setup.cjs", "empty.mjs"),
      run(String(dir), "main.mjs"),
    ]);
    expect(preloaded).toEqual({ stdout: "set by setup.cjs\n", stderr: "", exitCode: 0 });
    expect(imported).toEqual({ stdout: "set by setup.cjs\n", stderr: "", exitCode: 0 });
  });
});
