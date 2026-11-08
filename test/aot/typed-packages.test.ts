import { describeCheckerQueries } from "bun:internal-for-testing";
import { afterAll, expect } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { installSmallRenderer } from "./typed-packages/small-renderer/install";
import { describe, test } from "./with-compiler";

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}
const told = ({ stdout, exitCode }: { stdout: string; exitCode: number }) => ({ stdout, exitCode });
function built(build: { stderr: string; exitCode: number }) {
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
}

// The file under the "aot" condition of the package small-renderer.
const typedFile = "node_modules/small-renderer/index.aot.ts";
// As the map file has it, where a backslash is written twice.
const typedModulePath = isWindows
  ? "B:\\\\~BUN\\\\root\\\\" + typedFile.replaceAll("/", "\\\\")
  : "/$bunfs/root/" + typedFile;
const flags = ["--outfile", "app"];

describe("compile/aot/typed-packages", () => {
  const folders: string[] = [];
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  function project(name: string) {
    const folder = String(tempDir(name, {}));
    folders.push(folder);
    installSmallRenderer(folder);
    return folder;
  }

  // Each unit of code has a row in the map: its bytes, the name of its function, its role (Body, SlowBody, ParameterGuard ..) and the file of the function.
  function compiledOf(map: string, modulePath: string) {
    const found = { bytes: 0, names: new Set<string>() };
    for (const line of readFileSync(map, "utf8").split("\n")) {
      const fields = line.split("\t");
      if (fields[0] !== "F" || fields[10] !== modulePath) continue;
      found.bytes += Number(fields[3]);
      found.names.add(fields[7]);
    }
    return found;
  }
  // What the compiler takes each file of the program for: its written types hold in a file that is "Checked"; of one that is "Inferred" it knows what it works out itself.
  function rolesOf(entryPoint: string) {
    const roles: Record<string, string> = {};
    for (const line of describeCheckerQueries(entryPoint, 1).split("\n")) {
      const [, file, role] = /^(.+):0 role `` = (\w+)$/.exec(line) ?? [];
      if (file !== undefined) roles[file.replaceAll("\\", "/")] = role;
    }
    return roles;
  }
  function expectTyped(folder: string, map: string) {
    expect(rolesOf(join(folder, "main.ts"))).toMatchObject({
      [typedFile]: "Checked",
      "node_modules/task-queue/index.js": "Inferred",
    });
    const compiled = compiledOf(map, typedModulePath);
    expect(compiled.bytes).toBeGreaterThan(30_000);
    expect([...compiled.names]).toContain("renderTree");
  }

  test("the package is compiled typed", async () => {
    const folder = project("aot-typed-package");
    const map = join(folder, "app.map");
    const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, {
      ...bunEnv,
      BUN_JSC_aotMapFilePath: map,
    });
    built(build);
    expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
    expectTyped(folder, map);
    const compiled = await spawned([join(folder, "app")], folder, {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect(compiled.signal).toBeNull();
    const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    expect(plain.stdout).toContain("commit <root><app>count 4<list 1,3>");
    expect(told(compiled)).toEqual(told(plain));
  });

  const typesInstalled: Record<string, (folder: string) => object> = {
    "a bun-types without int32": folder => {
      const types = join(folder, "node_modules", "@types", "bun");
      mkdirSync(types, { recursive: true });
      writeFileSync(
        join(types, "package.json"),
        JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
      );
      writeFileSync(join(types, "index.d.ts"), `declare module "bun" { function inspect(value: unknown): string; }\n`);
      return { types: ["bun"] };
    },
    "the bun-types of this repository": () => ({
      typeRoots: [join(import.meta.dir, "..", "..", "packages")],
      types: ["bun-types"],
    }),
  };
  for (const [installedTypes, install] of Object.entries(typesInstalled))
    test(`the package is compiled typed with ${installedTypes}`, async () => {
      const folder = project("aot-typed-package-types");
      expect(readFileSync(join(folder, typedFile), "utf8")).toContain(`import type { int32 } from "bun";`);
      const options = JSON.parse(readFileSync(join(folder, "tsconfig.json"), "utf8"));
      Object.assign(options.compilerOptions, install(folder));
      writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(options));
      const checked = await spawned([bunExe(), "check", "--aot", "--no-pretty", "main.ts"], folder, bunEnv);
      expect(checked.stdout + checked.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
      expect(checked.exitCode).toBe(0);
    });

  // Bun exports each top-level key of a data file by name, and the bun-types of this repository let those names through.
  // The two constants are type errors unless every name is `any` and the default import of an XML file keeps its type.
  const namedImportsOfDataFiles = () => ({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "Preserve",
        moduleResolution: "bundler",
        noEmit: true,
        ...typesInstalled["the bun-types of this repository"](""),
      },
    }),
    "config.toml": `[server]\nport = 3000\n`,
    "config.yaml": `server:\n  port: 3000\n`,
    "config.yml": `server:\n  port: 3000\n`,
    "config.jsonc": `{ "server": { "port": 3000 } } // a comment\n`,
    "config.json5": `{ server: { port: 3000 } }\n`,
    "config.xml": `<server port="3000"/>\n`,
    "main.ts": `import toml, { server as fromToml } from "./config.toml";
import { server as fromYaml } from "./config.yaml";
import { server as fromYml } from "./config.yml";
import { server as fromJsonc } from "./config.jsonc";
import { server as fromJson5 } from "./config.json5";
import xml, { server as fromXml } from "./config.xml";
type IsAny<T> = 0 extends 1 & T ? true : false;
type Names = typeof fromToml | typeof fromYaml | typeof fromYml | typeof fromJsonc | typeof fromJson5 | typeof fromXml;
const everyNameIsAny: IsAny<Names> = true;
const xmlDefaultIsAny: IsAny<typeof xml> = false;
console.log(toml.server.port, fromToml.port, fromYaml.port, fromYml.port, fromJsonc.port, fromJson5.port, fromXml["@port"]);
console.log(everyNameIsAny, xmlDefaultIsAny);
`,
  });
  const portsAndTypes = { stdout: "3000 3000 3000 3000 3000 3000 3000\ntrue false\n", exitCode: 0 };

  test("named imports of data files type check with the bun-types of this repository", async () => {
    const folder = String(tempDir("aot-named-imports-of-data-files-checked", namedImportsOfDataFiles()));
    folders.push(folder);
    const checked = await spawned([bunExe(), "check", "--no-pretty", "main.ts"], folder, bunEnv);
    expect({ errors: checked.stdout.match(/^.*error TS\d+.*$/gm), exitCode: checked.exitCode }).toEqual({
      errors: null,
      exitCode: 0,
    });
  });

  test("named imports of data files are built with the bun-types of this repository", async () => {
    const folder = String(tempDir("aot-named-imports-of-data-files-built", namedImportsOfDataFiles()));
    folders.push(folder);
    const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, bunEnv);
    built(build);
    expect(told(await spawned([join(folder, "app")], folder, bunEnv))).toEqual(portsAndTypes);
    expect(told(await spawned([bunExe(), "run", "main.ts"], folder, bunEnv))).toEqual(portsAndTypes);
  });

  test("the package runs as plain Bun beside look-alikes of its records", async () => {
    const folder = project("aot-typed-package-look-alikes");
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "with-look-alikes.ts"],
      folder,
      bunEnv,
    );
    built(build);
    expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
    const compiled = await spawned([join(folder, "app")], folder, {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect(compiled.signal).toBeNull();
    expect(told(compiled)).toEqual(told(await spawned([bunExe(), "run", "with-look-alikes.ts"], folder, bunEnv)));
  });

  test("a package with a type error is built, and the build says nothing of it", async () => {
    const folder = project("aot-typed-package-falls");
    appendFileSync(join(folder, typedFile), `\nexport const wrong: number = "a string";\n`);
    const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, bunEnv);
    built(build);
    const said = build.stdout + build.stderr;
    expect(said).not.toContain("TS2322");
    expect(said).not.toMatch(/compiled (untyped|without (its |their )?types)/);
    const compiled = await spawned([join(folder, "app")], folder, {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect(compiled.signal).toBeNull();
    expect(told(compiled)).toEqual(told(await spawned([bunExe(), "run", "main.ts"], folder, bunEnv)));
  });
});
