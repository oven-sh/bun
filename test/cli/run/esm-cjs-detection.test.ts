import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// How a file is classified as CommonJS or ESM, and that `bun run` and
// `bun build` agree on it:
// - `export` or top-level `await` makes the file ESM. `module` and `exports`
//   are then plain globals, whatever else the file does with them.
// - Otherwise `module`, `exports`, or a top-level `return` make the file
//   CommonJS. The extension and the package "type" do not override the file's
//   own syntax.

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function bun(cwd: string, args: string[]): Promise<Result> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

type Format = "esm" | "cjs" | "iife";

/** `bun build --format=<format> <entry>` into `out/<format>.js`, then run that file. */
async function buildAndRun(cwd: string, entry: string, format: Format): Promise<{ build: Result; run: Result }> {
  const outfile = join("out", `${format}.js`);
  const build = await bun(cwd, ["build", entry, `--format=${format}`, `--outfile=${outfile}`]);
  if (build.exitCode !== 0) {
    return { build, run: { stdout: "", stderr: "", exitCode: -1 } };
  }
  return { build, run: await bun(cwd, [outfile]) };
}

const mixedLib = /* js */ `
  export const a = 1;
  export function fa() { return a }
  export default 9;
  if (typeof module !== "undefined") module.exports.b = 2;
`;
const mixedEntry = (lib: string) => /* js */ `
  import def, { a, fa } from "./${lib}";
  import * as ns from "./${lib}";
  console.log(JSON.stringify({ a, fa: typeof fa, def, keys: Object.keys(ns) }));
`;
const mixedStdout = '{"a":1,"fa":"function","def":9,"keys":["a","default","fa"]}\n';
const moduleIsGlobalWarning =
  'The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected';

const packageTypes = {
  none: null,
  module: `{ "type": "module" }`,
  commonjs: `{ "type": "commonjs" }`,
};

function withPackageJson(files: Record<string, string>, packageType: keyof typeof packageTypes) {
  const packageJson = packageTypes[packageType];
  return packageJson === null ? files : { ...files, "package.json": packageJson };
}

describe.concurrent("a file with export and module.exports is ESM", () => {
  test("bun run and every bundle format see the same exports", async () => {
    using dir = tempDir("esm-cjs-mixed", {
      "entry.js": mixedEntry("lib.js"),
      "lib.js": mixedLib,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe(mixedStdout);
    expect(source.exitCode).toBe(0);

    for (const format of ["esm", "cjs", "iife"] as const) {
      const { build, run } = await buildAndRun(cwd, "entry.js", format);
      expect(build.stderr).toContain(moduleIsGlobalWarning);
      expect(build.stderr).toContain('because of the "export" keyword here');
      expect(build.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe(mixedStdout);
      expect(run.exitCode).toBe(0);
    }
  });

  test("a named import of a module.exports property fails in both", async () => {
    using dir = tempDir("esm-cjs-mixed-named", {
      "entry.js": /* js */ `
        import { a, b } from "./lib.js";
        console.log(a, b);
      `,
      "lib.js": mixedLib,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toContain("Export named 'b' not found in module");
    expect(source.stdout).toBe("");
    expect(source.exitCode).toBe(1);

    const build = await bun(cwd, ["build", "entry.js", "--outfile=out/esm.js"]);
    expect(build.stderr).toContain('No matching export in "lib.js" for import "b"');
    expect(build.exitCode).toBe(1);
  });

  test("an unguarded module.exports throws ReferenceError in both", async () => {
    using dir = tempDir("esm-cjs-mixed-throws", {
      "lib.js": /* js */ `
        export const a = 1;
        module.exports.b = 2;
      `,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "lib.js"]);
    expect(source.stderr).toContain("ReferenceError: module is not defined");
    expect(source.exitCode).toBe(1);

    const { build, run } = await buildAndRun(cwd, "lib.js", "esm");
    expect(build.stderr).toContain(moduleIsGlobalWarning);
    expect(run.stderr).toContain("ReferenceError: module is not defined");
    expect(run.exitCode).toBe(1);
  });

  test("module and exports are globals: typeof reports the output file's environment", async () => {
    using dir = tempDir("esm-cjs-typeof", {
      "entry.js": /* js */ `
        export const x = 1;
        console.log(typeof module, typeof exports);
      `,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe("undefined undefined\n");

    // The CommonJS output file has a real `module` and `exports`. The IIFE output
    // has no ESM syntax and mentions both, so `bun` runs it as CommonJS too.
    const expected = { esm: "undefined undefined\n", cjs: "object object\n", iife: "object object\n" };
    for (const format of ["esm", "cjs", "iife"] as const) {
      const { build, run } = await buildAndRun(cwd, "entry.js", format);
      expect(build.stderr).not.toContain("warn:");
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe(expected[format]);
    }
  });

  test("top-level await with module.exports", async () => {
    using dir = tempDir("esm-cjs-tla", {
      "entry.js": /* js */ `
        await Promise.resolve();
        module.exports = { a: 1 };
        console.log("done");
      `,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toContain("ReferenceError: module is not defined");
    expect(source.exitCode).toBe(1);

    const { build, run } = await buildAndRun(cwd, "entry.js", "esm");
    expect(build.stderr).toContain(moduleIsGlobalWarning);
    expect(build.stderr).toContain('because of the top-level "await" keyword here');
    expect(run.stderr).toContain("ReferenceError: module is not defined");
    expect(run.exitCode).toBe(1);
  });

  test("require.main === module still becomes import.meta.main", async () => {
    using dir = tempDir("esm-cjs-require-main", {
      "entry.js": /* js */ `
        export const x = 1;
        console.log(require.main === module);
      `,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe("true\n");

    const build = await bun(cwd, ["build", "entry.js", "--target=bun", "--outfile=out/esm.js"]);
    expect(build.stderr).not.toContain("warn:");
    expect(build.exitCode).toBe(0);
    const run = await bun(cwd, ["out/esm.js"]);
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("true\n");
  });

  for (const ext of ["js", "mjs", "cjs"] as const) {
    for (const packageType of ["none", "module", "commonjs"] as const) {
      test(`the export keyword wins in lib.${ext} with package type ${packageType}`, async () => {
        using dir = tempDir(
          "esm-cjs-mixed-matrix",
          withPackageJson(
            {
              "entry.js": mixedEntry(`lib.${ext}`),
              [`lib.${ext}`]: mixedLib,
            },
            packageType,
          ),
        );
        const source = await bun(String(dir), ["run", "entry.js"]);
        expect(source.stderr).toBe("");
        expect(source.stdout).toBe(mixedStdout);
        expect(source.exitCode).toBe(0);
      });
    }
  }
});

describe.concurrent("a top-level return makes a file CommonJS", () => {
  const topLevelReturn = /* js */ `
    console.log(1);
    if (globalThis.foo === undefined) return;
    console.log(2);
  `;

  test("bun run and the bundle agree", async () => {
    using dir = tempDir("esm-cjs-return", { "entry.js": topLevelReturn });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe("1\n");
    expect(source.exitCode).toBe(0);

    for (const format of ["esm", "cjs"] as const) {
      const { build, run } = await buildAndRun(cwd, "entry.js", format);
      expect(build.stderr).not.toContain("warn:");
      expect(build.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe("1\n");
      expect(run.exitCode).toBe(0);
    }
  });

  for (const ext of ["js", "mjs", "cjs"] as const) {
    for (const packageType of ["none", "module", "commonjs"] as const) {
      test(`entry.${ext} with package type ${packageType}`, async () => {
        using dir = tempDir(
          "esm-cjs-return-matrix",
          withPackageJson({ [`entry.${ext}`]: topLevelReturn }, packageType),
        );
        const source = await bun(String(dir), ["run", `entry.${ext}`]);
        expect(source.stderr).toBe("");
        expect(source.stdout).toBe("1\n");
        expect(source.exitCode).toBe(0);
      });
    }
  }

  test("a required module keeps its exports.foo assignments around the return", async () => {
    using dir = tempDir("esm-cjs-return-exports", {
      "main.js": /* js */ `
        const lib = require("./lib.js");
        console.log(JSON.stringify(lib));
      `,
      "lib.js": /* js */ `
        exports.foo = 1;
        if (globalThis.skip) return;
        exports.bar = 2;
      `,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "main.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe('{"foo":1,"bar":2}\n');

    const { build, run } = await buildAndRun(cwd, "main.js", "esm");
    expect(build.stderr).not.toContain("warn:");
    expect(build.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe('{"foo":1,"bar":2}\n');
  });

  test("a top-level return next to an export is an error in both", async () => {
    using dir = tempDir("esm-cjs-return-export", {
      "entry.js": /* js */ `
        export const a = 1;
        return;
      `,
    });
    const cwd = String(dir);

    const source = await bun(cwd, ["run", "entry.js"]);
    expect(source.stderr).toContain("Top-level return cannot be used inside an ECMAScript module");
    expect(source.exitCode).toBe(1);

    const build = await bun(cwd, ["build", "entry.js", "--outfile=out/esm.js"]);
    expect(build.stderr).toContain("Top-level return cannot be used inside an ECMAScript module");
    expect(build.stderr).toContain('because of the "export" keyword here');
    expect(build.exitCode).toBe(1);
  });

  // `typeof arguments` is "object" inside the CommonJS wrapper and "undefined"
  // at the top level of an ES module.
  test("return inside a function does not make the file CommonJS", async () => {
    using dir = tempDir("esm-cjs-return-fn", {
      "entry.js": /* js */ `
        function f() { return 1; }
        console.log(f(), typeof arguments);
      `,
    });
    const source = await bun(String(dir), ["run", "entry.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe("1 undefined\n");
  });

  test("a top-level return without any other CommonJS syntax", async () => {
    using dir = tempDir("esm-cjs-return-only", {
      "entry.js": /* js */ `
        console.log(typeof arguments);
        if (globalThis.foo === undefined) return;
      `,
    });
    const source = await bun(String(dir), ["run", "entry.js"]);
    expect(source.stderr).toBe("");
    expect(source.stdout).toBe("object\n");
  });
});

describe.concurrent("a file with only CommonJS syntax is CommonJS", () => {
  for (const [label, files] of [
    ["lib.mjs", { "lib.mjs": `module.exports = { a: 1 };` }],
    [
      "lib.js in a type module package",
      { "lib.js": `module.exports = { a: 1 };`, "package.json": `{ "type": "module" }` },
    ],
  ] as const) {
    test(`module.exports in ${label}`, async () => {
      const lib = Object.keys(files)[0];
      using dir = tempDir("esm-cjs-cjs-only", {
        ...files,
        "entry.js": /* js */ `
          import lib from "./${lib}";
          console.log(JSON.stringify(lib));
        `,
      });
      const cwd = String(dir);

      const source = await bun(cwd, ["run", "entry.js"]);
      expect(source.stderr).toBe("");
      expect(source.stdout).toBe('{"a":1}\n');

      const { build, run } = await buildAndRun(cwd, "entry.js", "esm");
      expect(build.stderr).not.toContain("warn:");
      expect(build.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toBe('{"a":1}\n');
    });
  }
});
