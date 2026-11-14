import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { join } from "path";
test.concurrent("empty jsonc - package.json", async () => {
  await using dir = tempDir("jsonc", {
    "package.json": ``,
    "index.ts": `
    import pkg from './package.json';
    if (JSON.stringify(pkg) !== '{}') throw new Error('package.json should be empty');
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("empty jsonc - tsconfig.json", async () => {
  await using dir = tempDir("jsonc", {
    "tsconfig.json": ``,
    "index.ts": `
    import tsconfig from './tsconfig.json';
    if (JSON.stringify(tsconfig) !== '{}') throw new Error('tsconfig.json should be empty');
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("import anything.jsonc as json", async () => {
  const jsoncFile = `{
    // comment
    "trailingComma": 0,
  }`;
  await using dir = tempDir("jsonc", {
    "anything.jsonc": jsoncFile,
    "index.ts": `
    import file from './anything.jsonc';
    const _file = ${jsoncFile}
    if (!Bun.deepEquals(file, _file)) throw new Error('anything.jsonc wasnt imported as jsonc');
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("imported JSON strings match JSON.parse exactly (escapes, lone surrogates, non-ASCII)", async () => {
  const json = `{"lone":"\\ud800","pair":"\\ud83d\\ude00","mix":"a\\udfffz","e":"caf\\u00e9\\ud800x","lit":"é🚀","esc\\nkey":"a\\n\\"b\\""}`;
  await using dir = tempDir("jsonc", {
    "weird.json": json,
    "weird.jsonc": json,
    "index.ts": `
    import w from "./weird.json";
    import c from "./weird.jsonc";
    const file = await Bun.file(import.meta.dir + "/weird.json").text();
    const expected = JSON.parse(file);
    const units = (o: any) => JSON.stringify(Object.entries(o).map(([k, v]) => [...(k + v as string)].map(s => s.codePointAt(0))));
    if (units(w) !== units(expected)) throw new Error("json import != JSON.parse: " + units(w) + " vs " + units(expected));
    if (units(c) !== units(expected)) throw new Error("jsonc import != JSON.parse");
    if (units(Bun.JSONC.parse(file)) !== units(expected)) throw new Error("Bun.JSONC.parse != JSON.parse");
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

// https://github.com/oven-sh/bun/issues/8524
describe("a loader map gives jsonc by its name to a file ending", () => {
  const imports = (file: string) => `import data from "./${file}";\nconsole.log(JSON.stringify(data));\n`;
  const requires = (file: string) => `console.log(JSON.stringify(require("./${file}")));\n`;

  test.concurrent.each([
    // [what names the loader, the data file, the entry point, flags, bunfig.toml]
    ["--loader .x:jsonc", "data.x", imports, ["--loader", ".x:jsonc"], undefined],
    ["--loader .json:jsonc", "data.json", imports, ["--loader", ".json:jsonc"], undefined],
    ["--loader .json=jsonc", "data.json", imports, ["--loader", ".json=jsonc"], undefined],
    ["--loader .txt:jsonc, by require()", "data.txt", requires, ["--loader", ".txt:jsonc"], undefined],
    [`[loader] ".x" = "jsonc" in bunfig.toml`, "data.x", imports, [], `[loader]\n".x" = "jsonc"\n`],
    [`[loader] ".json" = "jsonc" in bunfig.toml`, "data.json", requires, [], `[loader]\n".json" = "jsonc"\n`],
  ] as const)("%s", async (_, file, entry, flags, bunfig) => {
    using dir = tempDir("jsonc-by-name", {
      [file]: `// a comment\n{"a":[1,],}\n`,
      "index.js": entry(file),
      ...(bunfig && { "bunfig.toml": bunfig }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: `{"a":[1]}\n`, stderr: "", exitCode: 0 });
  });
});
