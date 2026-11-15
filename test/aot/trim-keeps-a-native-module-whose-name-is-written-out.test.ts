// A `require` that was handed on takes any name. --trim keeps the modules whose names the program writes out as values for it.
// That has to hold for a module of native code too, like "bun:jsc": no file of the library stands for it, so nothing but the written name speaks of it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { tempDirForAotBuilds } from "../bundler/compile-trim-features";
import { without } from "./harness/capabilities";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

const asks = (name: string) => `const load = [require][JSON.parse("0")];
try {
  console.log(typeof load(${name}));
} catch (error) {
  console.log(error.code);
}
`;

// The name stands as the key of a literal alone, and Object.keys() hands it on.
const asksForKeyOf = (literal: string) => asks(`Object.keys(${literal})[0]`);

const nativeModules = [
  ["bun:jsc", "bun:jsc (bun-jsc)"],
  ["bun:test", "bun:test and node:test (test)"],
  ["bun:test/vitest", "bun:test and node:test (test)"],
  ["node:sqlite", "bun:sqlite and node:sqlite (sqlite)"],
] as const;

async function saysOf(feature: string, text: string) {
  using dir = tempDir("aot-trim-native-module", { "main.cjs": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.cjs"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return ["kept", "removed"].filter(word => stderr.includes(`\naot: trim: ${word} ${feature}:`));
}

describe.concurrent("a native module whose name is written out for a require that was handed on", () => {
  test.each(nativeModules)("%s is kept", async (name, feature) => {
    expect(await saysOf(feature, asks(JSON.stringify(name)))).toEqual(["kept"]);
  });

  test.each(nativeModules)("%s is kept where it is the key of a literal", async (name, feature) => {
    expect(await saysOf(feature, asksForKeyOf(`{ ${JSON.stringify(name)}: 1 }`))).toEqual(["kept"]);
  });

  test.each([
    ["a store", `(held => ((held["bun:jsc"] = 1), held))({})`],
    ["a field of a class", `new (class { "bun:jsc" = 1 })()`],
    ["a static member of a class", `class { static "bun:jsc" = 1 }`],
    ["a key joined of two texts", `{ ["bun:" + "jsc"]: 1 }`],
  ])("bun:jsc is kept where it is the key of %s", async (_, made) => {
    expect(await saysOf("bun:jsc (bun-jsc)", asksForKeyOf(made))).toEqual(["kept"]);
  });

  test("a key of one word is a field of the program's own and keeps none", async () => {
    expect(await saysOf("undici", asks(`"undici"`))).toEqual(["kept"]);
    expect(await saysOf("undici", asksForKeyOf(`{ undici: 1 }`))).toEqual(["removed"]);
  });

  test("a name that comes at run time keeps none", async () => {
    expect(await saysOf("bun:jsc (bun-jsc)", asks("process.argv[2]"))).toEqual(["removed"]);
  });

  test("a name that is written out where nothing loads under a name that nobody knows keeps none", async () => {
    expect(await saysOf("bun:jsc (bun-jsc)", `console.log("bun:jsc");`)).toEqual(["removed"]);
  });
});

describe.skipIf(!!without("a Bun that trims"))("in a trimmed executable", () => {
  async function shownBy(text: string, flags: string[], ...operands: string[]) {
    using dir = tempDirForAotBuilds("aot-trim-native-module", { "main.cjs": text });
    const folder = String(dir);
    const build = [bunExe(), "build", "--compile", "--aot", ...flags, "main.cjs", "--outfile", "main"];
    expect(await spawned(build, folder, bunEnv)).toMatchObject({ exitCode: 0 });
    const { stdout, exitCode } = await spawned([join(folder, "main"), ...operands], folder, bunEnv);
    return { stdout, exitCode };
  }

  test.concurrent.each(nativeModules)(
    "%s answers",
    async name => {
      expect(await shownBy(asks(JSON.stringify(name)), ["--trim"])).toEqual({ stdout: "object\n", exitCode: 0 });
    },
    600_000,
  );

  test.concurrent.each([...nativeModules.map(([name]) => name), "node:zlib"])(
    "%s answers where it is the key of a literal",
    async name => {
      const text = asksForKeyOf(`{ ${JSON.stringify(name)}: 1 }`);
      expect(await shownBy(text, ["--trim"])).toEqual({ stdout: "object\n", exitCode: 0 });
    },
    600_000,
  );

  test("a member of the module that is read off the answer works", async () => {
    const text = `const load = [require][JSON.parse("0")];\nconsole.log(typeof load("bun:jsc").heapSize(), typeof load("bun:test").expect(1).toBe);\n`;
    expect(await shownBy(text, ["--trim"])).toEqual({ stdout: "number function\n", exitCode: 0 });
  }, 600_000);

  test("a name that comes at run time is not found, and the error can be caught", async () => {
    expect(await shownBy(asks("process.argv[2]"), ["--trim"], "bun:jsc")).toEqual({
      stdout: "MODULE_NOT_FOUND\n",
      exitCode: 0,
    });
  }, 600_000);
});
