// Which tools read the file that a package names under the "aot" condition.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import * as esbuild from "esbuild";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { slot, unsupported } from "../../aot/harness/commands";
import { withoutDebugInformation } from "../../aot/harness/without-debug-information";

setDefaultTimeout(120_000);

async function run(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const bun = (cwd: string, ...args: string[]) => run(cwd, [bunExe(), ...args]);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const slashes = (path: string) => path.replaceAll("\\", "/");

const node = Bun.which("node");
const nodeSays = (expression: string) =>
  node
    ? Bun.spawnSync({ cmd: [node, "-p", expression], env: bunEnv })
        .stdout.toString()
        .trim()
    : "";
const nodeRequiresModules = nodeSays("process.features.require_module") === "true";

const compilerOptions = {
  strict: true,
  module: "esnext",
  moduleResolution: "bundler",
  target: "esnext",
  types: [],
  // tsc checks every declaration file that it reads, and those of "dom" take it three times as long as everything else.
  lib: ["esnext"],
  skipLibCheck: false,
  noEmit: true,
};

const javascriptOfPackage = (inputs: Iterable<string>) =>
  [...inputs]
    .map(slashes)
    .filter(path => path.includes("node_modules/"))
    .map(path => path.slice(path.lastIndexOf("node_modules/")))
    .sort();

const executable = (folder: string, name: string) => join(folder, process.platform === "win32" ? name + ".exe" : name);

async function compileAheadOfTime(app: string, entry: string) {
  const [compiled, meta] = [`compiled-${entry}`, `meta-${entry}.json`];
  const flags = [
    "--compile",
    "--aot",
    "--explain",
    ...withoutDebugInformation,
    entry,
    "--outfile",
    compiled,
    `--metafile=${meta}`,
  ];
  const built = await slot(() => bun(app, "build", ...flags));
  expect({ said: built.stderr.match(/^(?:warn|error): .*$/gm), exitCode: built.exitCode }).toEqual({
    said: null,
    exitCode: 0,
  });
  return {
    read: javascriptOfPackage(Object.keys(json(join(app, meta)).inputs)),
    accessesOfPackages: built.stderr.match(/^Dependencies: .* of property accesses are one load: (.*) \(\d+\)$/m)?.[1],
    ran: await run(app, [executable(app, compiled)]),
  };
}

describe.concurrent("the file under the aot condition", () => {
  const files = {
    "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "node_modules/tells/package.json": JSON.stringify({
      name: "tells",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" } },
    }),
    "node_modules/tells/index.js": `export const read = "index.js";\n`,
    "node_modules/tells/index.aot.ts": `export const read: string = "index.aot.ts";\n`,
    "node_modules/tells/index.d.ts": `export declare const read: string;\n`,
    "app.ts": `import { read } from "tells";\nconsole.log(read);\n`,
    "app.mjs": `import { read } from "tells";\nconsole.log(read);\n`,
    "app.cjs": `console.log(require("tells").read);\n`,
    "app.test.ts": `import { expect, test } from "bun:test";\nimport { read } from "tells";\ntest("read", () => expect(read).toBe("index.js"));\n`,
    "typed.test.ts": `import { expect, test } from "bun:test";\nimport { read } from "tells";\ntest("read", () => expect(read).toBe("index.aot.ts"));\n`,
  };
  const nested = { aot: "./index.aot.ts", default: "./index.js" };
  const javascript = { stdout: "index.js\n", stderr: "", exitCode: 0 };
  const typed = { stdout: "index.aot.ts\n", stderr: "", exitCode: 0 };

  test("is not what bun run, bun test and bun build read", async () => {
    using dir = tempDir("library-condition-bun", files);
    for (const entry of ["app.ts", "app.mjs", "app.cjs"]) expect(await bun(String(dir), entry)).toEqual(javascript);
    expect(await bun(String(dir), "test", "app.test.ts")).toMatchObject({ exitCode: 0 });
    expect(await bun(String(dir), "test", "typed.test.ts")).toMatchObject({ exitCode: 1 });
    for (const target of ["browser", "node", "bun"]) {
      expect(await bun(String(dir), "build", "app.ts", "--target", target, "--outfile", `${target}.js`)).toMatchObject({
        stderr: "",
        exitCode: 0,
      });
      expect(await bun(String(dir), `${target}.js`)).toEqual(javascript);
    }
  });

  test("is not what bun build --compile reads", async () => {
    using dir = tempDir("library-condition-compile", files);
    expect(
      await bun(String(dir), "build", "--compile", ...withoutDebugInformation, "app.ts", "--outfile", "plain"),
    ).toMatchObject({ exitCode: 0 });
    expect(await run(String(dir), [executable(String(dir), "plain")])).toEqual(javascript);
  });

  test.skipIf(!node)("is not what Node.js reads", async () => {
    using dir = tempDir("library-condition-node", files);
    expect(await run(String(dir), [node!, "app.mjs"])).toEqual(javascript);
    if (nodeRequiresModules) expect(await run(String(dir), [node!, "app.cjs"])).toMatchObject({ stdout: "index.js\n" });
  });

  test("is not what esbuild reads", async () => {
    using dir = tempDir("library-condition-esbuild", files);
    await esbuild.build({
      absWorkingDir: String(dir),
      entryPoints: ["app.ts"],
      bundle: true,
      format: "esm",
      outfile: "out.js",
      logLevel: "silent",
    });
    expect(await bun(String(dir), "out.js")).toEqual(javascript);
  });

  test("is what --conditions=aot asks for", async () => {
    using dir = tempDir("library-condition-asked-for", files);
    expect(await bun(String(dir), "--conditions=aot", "app.ts")).toEqual(typed);
  });

  test.skipIf(!!unsupported)("is what bun run --aot and bun test --aot read", async () => {
    using dir = tempDir("library-condition-run-aot", files);
    for (const entry of ["app.ts", "app.mjs", "app.cjs"]) {
      expect(await bun(String(dir), "run", "--aot", entry)).toEqual(typed);
      expect(await bun(String(dir), "--aot", entry)).toEqual(typed);
    }
    expect(await bun(String(dir), "test", "--aot", "typed.test.ts")).toMatchObject({ exitCode: 0 });
    expect(await bun(String(dir), "test", "--aot", "app.test.ts")).toMatchObject({ exitCode: 1 });
  });

  test.skipIf(!!unsupported).each(["app.ts", "app.mjs", "app.cjs"])(
    "is what bun build --compile --aot %s compiles",
    async entry => {
      using dir = tempDir("library-condition-compile-aot", files);
      expect(await compileAheadOfTime(String(dir), entry)).toEqual({
        read: ["node_modules/tells/index.aot.ts"],
        accessesOfPackages: undefined,
        ran: typed,
      });
    },
  );

  test.skipIf(!!unsupported)("is what bun compile compiles", async () => {
    using dir = tempDir("library-condition-bun-compile", files);
    expect(await bun(String(dir), "compile", "app.ts", "--outfile", "compiled")).toMatchObject({ exitCode: 0 });
    expect(await run(String(dir), [executable(String(dir), "compiled")])).toEqual(typed);
  });

  test.skipIf(!!unsupported).each([
    ["types before aot", { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" }],
    ["aot before types", { aot: "./index.aot.ts", types: "./index.d.ts", default: "./index.js" }],
    ["aot below import and require", { types: "./index.d.ts", import: nested, require: nested }],
  ])("is what the type checker reads under --aot, and the file under types is not: %s", async (_, conditions) => {
    using dir = tempDir("library-condition-types", {
      ...files,
      "tsconfig.json": JSON.stringify({ compilerOptions, files: ["console.d.ts", "app.ts"] }),
      "console.d.ts": `declare const console: { log(...values: unknown[]): void };\n`,
      "node_modules/tells/package.json": JSON.stringify({
        name: "tells",
        version: "1.0.0",
        type: "module",
        exports: { ".": conditions },
      }),
      "node_modules/tells/index.aot.ts": `export const read: "index.aot.ts" = "index.aot.ts";\n`,
      "node_modules/tells/index.d.ts": `export declare const read: "index.d.ts";\n`,
      "app.ts": `import { read } from "tells";\nconst text: "index.aot.ts" = read;\nconsole.log(text);\n`,
    });
    const mismatch = `app.ts(2,7): error TS2322: Type '"index.d.ts"' is not assignable to type '"index.aot.ts"'.`;
    for (const check of [["check"], [require.resolve("typescript/bin/tsc")]]) {
      const { stdout, stderr } = await bun(String(dir), ...check, "-p", "tsconfig.json", "--pretty", "false");
      expect((stdout + stderr).match(/^.*error TS.*$/gm)).toEqual([mismatch]);
    }
    expect(await bun(String(dir), "check", "--aot", "app.ts")).toMatchObject({ exitCode: 0 });
    expect(await bun(String(dir), "run", "--aot", "app.ts")).toEqual(typed);
    expect(await compileAheadOfTime(String(dir), "app.ts")).toEqual({
      read: ["node_modules/tells/index.aot.ts"],
      accessesOfPackages: undefined,
      ran: typed,
    });
  });
});
