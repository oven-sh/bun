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
describe("import a .json file containing comments/trailing commas", () => {
  const jsoncContent = `{
  // a comment
  "name": "example",
  "list": [1, 2, 3,],
}
`;
  const indexEsm = `import data from "./data.json";\nconsole.log(JSON.stringify(data));\n`;
  const indexCjs = `const data = require("./data.json");\nconsole.log(JSON.stringify(data));\n`;
  const expected = `{"name":"example","list":[1,2,3]}`;

  test.concurrent.each([
    [".json:jsonc", "esm"],
    [".json=jsonc", "esm"],
    [".json:jsonc", "cjs"],
  ])("with --loader %s (%s)", async (loaderArg, kind) => {
    using dir = tempDir("jsonc-loader-cli", {
      "data.json": jsoncContent,
      "index.ts": kind === "cjs" ? indexCjs : indexEsm,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--loader", loaderArg, join(String(dir), "index.ts")],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent('with bunfig [loader] ".json" = "jsonc"', async () => {
    using dir = tempDir("jsonc-loader-bunfig", {
      "data.json": jsoncContent,
      "index.ts": indexEsm,
      "bunfig.toml": `[loader]\n".json" = "jsonc"\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "./index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("with Bun.build loader option", async () => {
    using dir = tempDir("jsonc-loader-build", {
      "data.json": jsoncContent,
      "index.ts": indexEsm,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--loader", ".json:jsonc", "--target=bun", join(String(dir), "index.ts")],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain(`"example"`);
    expect(stdout).not.toContain("// a comment");
    expect(exitCode).toBe(0);
  });

  describe("without a loader override the error names the file", () => {
    test.concurrent.each(["esm", "cjs"])("(%s)", async kind => {
      using dir = tempDir("json-parse-error", {
        "data.json": jsoncContent,
        "index.ts": `try {
  ${kind === "cjs" ? `require("./data.json");` : `await import("./data.json");`}
  console.log("FAIL: did not throw");
} catch (e) {
  console.log(e.message);
}
`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "index.ts")],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const jsonPath = join(String(dir), "data.json").replaceAll("\\", "/");
      expect(stdout.trim().replaceAll("\\", "/")).toBe(`${jsonPath}: JSON Parse error: Unrecognized token '/'`);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });
});
