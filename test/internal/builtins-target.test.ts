// `bun build --target=bun_builtins` compiles src/js to the text JavaScriptCore loads as builtin code.
import { internalModuleBytecode } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInternalModuleRegistry } from "../../src/codegen/internal-module-registry-scanner";

const root = join(import.meta.dir, "..", "..");
const { moduleList, nativeStartIndex } = createInternalModuleRegistry(join(root, "src", "js"));
const modules = moduleList.slice(0, nativeStartIndex);

// These run a generator script and the bundler under the build being tested. A debug build takes seconds to load the
// script and minutes to bundle every internal module.
const generatorTimeout = 120_000;
const bundleTimeout = 600_000;

async function bun(...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd: root, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function expectSuccess({ stderr, exitCode }: { stderr: string; exitCode: number }) {
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
}

let dir: ReturnType<typeof tempDir>;
const manifest = (debug: string) => join(String(dir), `${debug}.manifest`);
const build = (debug: string) => [
  "build",
  "--target=bun_builtins",
  `--builtins-manifest=${manifest(debug)}`,
  ...(debug === "ON" ? [] : ["--minify-syntax", "--keep-names"]),
];

beforeAll(async () => {
  dir = tempDir("builtins-target", {});
  for (const debug of ["OFF", "ON"]) {
    expectSuccess(await bun("run", "src/codegen/builtins-manifest.ts", `--debug=${debug}`, manifest(debug)));
  }
}, generatorTimeout);

afterAll(() => dir[Symbol.dispose]());

async function compile(source: string, debug = "OFF") {
  using fixture = tempDir("builtins-target-fixture", { "fixture.ts": source });
  const outdir = join(String(fixture), "out");
  const { stderr, exitCode } = await bun(...build(debug), `--outdir=${outdir}`, join(String(fixture), "fixture.ts"));
  return { stderr, exitCode, text: exitCode === 0 ? readFileSync(join(outdir, "fixture.js"), "utf8") : "" };
}

describe.each(["OFF", "ON"])("src/js with --debug=%s", debug => {
  test(
    "every internal module compiles as builtin code",
    async () => {
      const outdir = join(String(dir), `out-${debug}`);
      const files = modules.map(file => `src/js/${file}`);
      expectSuccess(await bun(...build(debug), "--root=src/js", `--outdir=${outdir}`, ...files));

      const invalid: string[] = [];
      const logs: string[] = [];
      for (const file of modules) {
        const name = file.slice(0, -3) + ".js";
        const text = readFileSync(join(outdir, name), "utf8");
        if (!text.startsWith('(function (){"use strict";') || !text.endsWith("})\n")) {
          invalid.push(`${file}: not a strict function expression`);
        }
        if (text.includes("__intrinsic__") || text.includes("__no_intrinsic__")) {
          invalid.push(`${file}: a name kept its mark`);
        }
        if (text.includes("$debug_log(")) logs.push(file);
        if (text.includes("$debug_log(") !== text.includes("let $debug_log = ")) {
          invalid.push(`${file}: $debug_log is used or declared, not both`);
        }
        try {
          // Rejects every `@name` JavaScriptCore does not have.
          internalModuleBytecode(text, name);
        } catch (error) {
          invalid.push(`${file}: ${error}`);
        }
      }
      expect(invalid).toEqual([]);
      if (debug === "ON") expect(logs).toContain("node/net.ts");
      else expect(logs).toEqual([]);
    },
    bundleTimeout,
  );
});

describe("names", () => {
  test("$name is private where it is an identifier, and only there", async () => {
    const { text } = await compile(`
      const object = { $data: 1, "$data": 2 };
      const strings = ["$isCallable", \`$isCallable \${$isObject(object)}\`];
      export default [$isCallable(object), object.$data, object["$data"], strings];
    `);
    expect(text).toContain("@isCallable(object)");
    expect(text).toContain("@isObject(object)");
    expect(text).toContain("@data: 1");
    expect(text).toContain("$data: 2");
    expect(text).toContain("object.@data");
    expect(text).toContain("object.$data");
    expect(text).toContain('"$isCallable"');
    expect(text).toContain("`$isCallable ");
  });

  test("a name that is not in the manifest is an error", async () => {
    const { stderr, exitCode } = await compile(`export default $notABuiltinName;`);
    expect(stderr).toContain('"$notABuiltinName" is not a builtin name');
    expect(exitCode).toBe(1);
  });

  test("a hardened global is read through its private name unless it is shadowed or extended", async () => {
    const { text } = await compile(`
      class List extends Array {}
      export default [Array.isArray, function (Array) { return Array; }, List, Map];
    `);
    expect(text).toContain("@Array.isArray");
    expect(text).toContain("extends Array");
    expect(text).toContain("return Array");
    expect(text).not.toContain("@Map");
  });
});

describe("require", () => {
  test("a specifier becomes its registry id", async () => {
    const { text } = await compile(`
      export default [require("node:fs"), require("internal/validators"), require("bun:jsc"), require("bun:sqlite")];
    `);
    for (const file of ["node/fs.ts", "internal/validators.ts", "bun:jsc", "bun/sqlite.ts"]) {
      const id = moduleList.indexOf(file);
      expect(id).toBeGreaterThan(0);
      expect(text).toContain(`@getInternalField(@internalModuleRegistry, ${id}) || @createInternalModuleById(${id})`);
    }
  });

  test("what the registry does not have is an error", async () => {
    const { stderr, exitCode } = await compile(`export default require("left-pad");`);
    expect(stderr).toContain('Could not resolve "left-pad"');
    expect(exitCode).toBe(1);
  });

  test("a specifier that is not a literal is an error", async () => {
    const { stderr, exitCode } = await compile(`export default name => require(name);`);
    expect(stderr).toContain("Require with dynamic specifier not supported here.");
    expect(exitCode).toBe(1);
  });
});

describe("macros", () => {
  test("errors", async () => {
    const { text } = await compile(`
      export default function (a) {
        if (a === 1) throw new TypeError("one");
        if (a === 2) throw new RangeError("two");
        if (a === 3) throw $ERR_INVALID_ARG_TYPE("a", "number", a);
        return [new TypeError("four"), new RangeError("five")];
      };
    `);
    expect(text).toContain('@throwTypeError("one")');
    expect(text).toContain('@throwRangeError("two")');
    expect(text).toMatch(/throw @makeErrorWithCode\(\d+, "a", "number", a\)/);
    expect(text).toContain('@makeTypeError("four")');
    // The minifier drops the `new`. The constructor stays the public one.
    expect(text).toMatch(/[^@\w]RangeError\("five"\)/);
  });

  test("a native function becomes its id", async () => {
    const { text } = await compile(`export default $cpp("Path.cpp", "createNodePathBinding");`);
    expect(text).toMatch(/@lazy\(\d+\)/);
  });

  test("a native function no module of src/js calls is an error", async () => {
    const { stderr, exitCode } = await compile(`export default $cpp("Path.cpp", "createNothing");`);
    expect(stderr).toContain('This "$cpp" call is not in the builtins manifest');
    expect(exitCode).toBe(1);
  });

  const checks = `
    export default function (a) {
      $debug("called with", a);
      $assert(a === 1, "not one");
      return a;
    };
  `;

  test("$debug and $assert are nothing in a release build", async () => {
    const { text } = await compile(checks, "OFF");
    expect(text).not.toContain("called with");
    expect(text).not.toContain("not one");
  });

  test("$debug and $assert are calls in a debug build", async () => {
    const { text } = await compile(checks, "ON");
    expect(text).toContain('$debug_log("called with", a)');
    expect(text).toContain('$assert(a === 1, "a === 1", "not one")');
  });

  test("$bundleError is an error only where the code is reachable", async () => {
    const platform = JSON.stringify(process.platform);
    const dead = await compile(`export default process.platform === ${platform} ? 1 : $bundleError("unreachable");`);
    expectSuccess(dead);
    const live = await compile(`export default process.platform !== ${platform} ? 1 : $bundleError("reachable");`);
    expect(live.stderr).toContain("reachable");
    expect(live.exitCode).toBe(1);
  });
});

describe("strict mode", () => {
  test.each(["", '"use strict";'])("a function in a block has one name %s", async directive => {
    const { text } = await compile(`${directive}
      const list = [];
      {
        function inBlock() {}
        list.push(inBlock);
      }
      export default list;
    `);
    // The bundler writes every function of a block this way. In sloppy code it adds `var inBlock` and a second name.
    expect(text).toContain("let inBlock = function()");
    expect(text).not.toContain("inBlock2");
    expect(text).not.toContain("var inBlock");
    expect(text.match(/use strict/g)).toHaveLength(1);
  });

  test.each(["", '"use strict";'])("constants at the top are inlined in a release build %s", async directive => {
    const source = `${directive}
      const kLimit = 1234;
      export default a => a < kLimit;
    `;
    expect((await compile(source, "OFF")).text).toContain("a < 1234");
    expect((await compile(source, "ON")).text).toContain("a < kLimit");
  });

  test("a parameter may not occur twice", async () => {
    const { stderr, exitCode } = await compile(`export default function (a, a) {};`);
    expect(stderr).toContain('"a" cannot be bound multiple times in the same parameter list');
    expect(exitCode).toBe(1);
  });
});

describe("exports", () => {
  test("the default export is returned", async () => {
    const { text } = await compile(`
      function helper() {}
      export default class Value {
        static make() {
          return helper();
        }
      }
    `);
    expect(text).toMatch(/function helper\(\) \{\s*\}\s*return class Value \{[^]*\};\s*\}\)\s*$/);
    expect(text).not.toContain("$");
  });

  test.each(["value.late = true;", "function late() {}"])("%s after the default export is an error", async late => {
    const { stderr, exitCode } = await compile(`
      const value = {};
      export default value;
      ${late}
    `);
    expect(stderr).toContain("`export default` must be the last statement of a builtin module");
    expect(exitCode).toBe(1);
  });

  test("named exports are returned as an object", async () => {
    const { text } = await compile(`
      export function one() {}
      export const two = one();
    `);
    expect(text).toMatch(/return \{\s*one,\s*two\s*\};\s*\}\)\s*$/);
  });

  test("a default export beside named exports is an error", async () => {
    const { stderr, exitCode } = await compile(`
      export function one() {}
      export default one;
    `);
    expect(stderr).toContain("Using `export default` AND named exports together in builtin modules is unsupported");
    expect(exitCode).toBe(1);
  });

  test("a module without exports is an error", async () => {
    const { stderr, exitCode } = await compile(`console.log(1);`);
    expect(stderr).toContain("Internal modules must have at least one ESM export statement");
    expect(exitCode).toBe(1);
  });

  test("a type export is no export", async () => {
    const { text } = await compile(`
      export type One = 1;
      export interface Two {}
      export default 3;
    `);
    expect(text).toContain("3");
  });
});
