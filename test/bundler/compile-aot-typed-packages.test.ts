import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";

const installed = {
  "package.json": JSON.stringify({ name: "shapes", version: "1.2.3", type: "module", main: "index.js", types: "index.d.ts" }),
  "index.js": `export function area(w, h) {\n  const box = { w, h };\n  return box.w * box.h;\n}\nexport function where() {\n  return new Error("here").stack;\n}\n`,
  "index.d.ts": `export declare function area(w: number, h: number): number;\nexport declare function where(): string;\n`,
};
const typed = {
  "index.js": `export * from "./index.sound.ts";\n`,
  "index.sound.ts": `interface Box { w: number; h: number }\nexport function area(w: number, h: number): number {\n  const box: Box = { w, h };\n  return box.w * box.h;\n}\nexport function where(): string {\n  return new Error("here").stack!;\n}\n`,
};
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const manifest = (more: object = {}) => ({
  sound: 1,
  name: "shapes",
  version: "1.2.3",
  when: {},
  basis: {},
  lay: { "index.js": sha256(installed["index.js"]), "index.sound.ts": "new" },
  needs: [],
  ...more,
});

function write(folder: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}
function typedVersion(folder: string, more: object = {}) {
  write(folder, { "sound.json": JSON.stringify(manifest(more)), "lay/index.js": typed["index.js"], "lay/index.sound.ts": typed["index.sound.ts"] });
}
const folders: string[] = [];
afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));
function project(name: string) {
  const folder = String(tempDir(name, {}));
  folders.push(folder);
  write(folder, {
    "app.ts": `import { area, where } from "shapes";\nconsole.log(area(6, 7), /index(\\.sound)?\\.[jt]s/.exec(where())![0]);\n`,
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext", "dom"] } }),
    "package.json": JSON.stringify({ name: "app" }),
  });
  write(join(folder, "node_modules", "shapes"), installed);
  return folder;
}
async function spawned(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
async function built(folder: string, flags: string[] = ["--aot"]) {
  const build = await spawned([bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"], folder);
  const said = (build.stdout + build.stderr).split("\n").filter(line => /typed version/.test(line));
  expect(build.stderr).not.toContain("error");
  expect(build.exitCode).toBe(0);
  const run = await spawned([join(folder, "app")], folder);
  return { said, stdout: run.stdout, exitCode: run.exitCode };
}
const used = (home: string) => [`note: "shapes" 1.2.3 is compiled from its typed version in ${home}`];
const unused = (home: string, why: string) => [`warn: the typed version of "shapes" in ${home} is not used: ${why}: the package is compiled untyped`];

describe("compile/aot/TypedPackages", () => {
  test("without a typed version the package is compiled as installed", async () => {
    expect(await built(project("aot-typed-none"))).toEqual({ said: [], stdout: "42 index.js\n", exitCode: 0 });
  });

  test("the project's own folder", async () => {
    const folder = project("aot-typed-own");
    typedVersion(join(folder, ".sound", "shapes"));
    expect(await built(folder)).toEqual({ said: used(".sound/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.js")).text()).toBe(installed["index.js"]);
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.sound.ts")).exists()).toBe(false);
  });

  test("format 2: TypeScript text at the path of the JavaScript file", async () => {
    const folder = project("aot-typed-in-place");
    write(join(folder, ".sound", "shapes"), {
      "sound.json": JSON.stringify(manifest({ sound: 2, lay: { "index.js": sha256(installed["index.js"]) } })),
      "lay/index.js": typed["index.sound.ts"],
    });
    expect(await built(folder)).toEqual({ said: used(".sound/shapes"), stdout: "42 index.js\n", exitCode: 0 });
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.js")).text()).toBe(installed["index.js"]);
  });

  test("builds without --aot ignore it", async () => {
    const folder = project("aot-typed-no-aot");
    typedVersion(join(folder, ".sound", "shapes"));
    expect(await spawned([bunExe(), "build", "app.ts", "--target=bun", "--outfile", "app.js"], folder)).toMatchObject({ stderr: "", exitCode: 0 });
    const bundle = await Bun.file(join(folder, "app.js")).text();
    expect(bundle).toContain("node_modules/shapes/index.js");
    expect(bundle).not.toContain("index.sound.ts");
  });

  test("a companion package that the project lists", async () => {
    const folder = project("aot-typed-companion");
    typedVersion(join(folder, "node_modules", "@sound", "shapes"));
    write(folder, { "package.json": JSON.stringify({ name: "app", devDependencies: { "@sound/shapes": "1.2.3" } }) });
    expect(await built(folder)).toEqual({ said: used("node_modules/@sound/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
  });

  test("a companion package that the project does not list is ignored", async () => {
    const folder = project("aot-typed-unlisted");
    typedVersion(join(folder, "node_modules", "@sound", "shapes"));
    expect(await built(folder)).toEqual({ said: [], stdout: "42 index.js\n", exitCode: 0 });
  });

  test("the project's own folder wins", async () => {
    const folder = project("aot-typed-wins");
    typedVersion(join(folder, ".sound", "shapes"));
    write(folder, { "package.json": JSON.stringify({ name: "app", dependencies: { "@sound/shapes": "1.2.3" } }), "node_modules/@sound/shapes/sound.json": "{" });
    expect(await built(folder)).toEqual({ said: used(".sound/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
  });

  const mark = (typed = "index.sound.ts", javascript = installed["index.js"]) => `// @sound ${typed} ${sha256(javascript)}\n`;
  function shipped(folder: string, firstLine = mark()) {
    write(join(folder, "node_modules", "shapes"), { "index.d.ts": firstLine + installed["index.d.ts"], "index.sound.ts": typed["index.sound.ts"] });
  }

  test("the typed version that the package ships", async () => {
    const folder = project("aot-typed-shipped");
    shipped(folder);
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.js")).text()).toBe(installed["index.js"]);
  });

  test("the project's own folder wins over what the package ships, which wins over a companion", async () => {
    const folder = project("aot-typed-order");
    shipped(folder);
    write(folder, { "package.json": JSON.stringify({ name: "app", dependencies: { "@sound/shapes": "1.2.3" } }), "node_modules/@sound/shapes/sound.json": "{" });
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
    write(join(folder, ".sound", "shapes"), { "sound.json": "{" });
    expect(await built(folder)).toEqual({ said: unused(".sound/shapes", "its sound.json is not JSON"), stdout: "42 index.js\n", exitCode: 0 });
  });

  test.each([
    ["main and types", { main: "dist/index.js", types: "dist/index.d.ts" }],
    ["main alone", { main: "./dist/index.js" }],
    ["exports", { exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }],
  ])("what package.json names by %s may lie in a folder", async (_, fields) => {
    const folder = project("aot-typed-shipped-folder");
    const at = join(folder, "node_modules", "shapes");
    rmSync(join(at, "index.js"));
    rmSync(join(at, "index.d.ts"));
    write(at, {
      "package.json": JSON.stringify({ name: "shapes", version: "1.2.3", type: "module", ...fields }),
      "dist/index.js": installed["index.js"],
      "dist/index.d.ts": mark() + installed["index.d.ts"],
      "dist/index.sound.ts": typed["index.sound.ts"],
    });
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes/dist"), stdout: "42 index.sound.ts\n", exitCode: 0 });
  });

  test("a declaration file without the comment, or with half of it, says nothing", async () => {
    const folder = project("aot-typed-shipped-unmarked");
    shipped(folder, "");
    expect(await built(folder)).toEqual({ said: [], stdout: "42 index.js\n", exitCode: 0 });
    shipped(folder, "// @sound index.sound.ts\n");
    expect(await built(folder)).toEqual({ said: [], stdout: "42 index.js\n", exitCode: 0 });
    shipped(folder, "\n" + mark());
    expect(await built(folder)).toEqual({ said: [], stdout: "42 index.js\n", exitCode: 0 });
  });

  test("a default export goes through", async () => {
    const folder = project("aot-typed-shipped-default");
    const javascript = installed["index.js"] + "export default function twice(n) {\n  return n * 2;\n}\n";
    write(join(folder, "node_modules", "shapes"), {
      "index.js": javascript,
      "index.d.ts": mark("index.sound.ts", javascript) + installed["index.d.ts"] + "export default function twice(n: number): number;\n",
      "index.sound.ts": typed["index.sound.ts"] + "export default function twice(n: number): number {\n  return n * 2;\n}\n",
    });
    write(folder, { "app.ts": `import twice, { area, where } from "shapes";\nconsole.log(twice(area(3, 7)), /index(\\.sound)?\\.[jt]s/.exec(where())![0]);\n` });
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
  });

  const shippedMismatches: [string, (folder: string) => void, string][] = [
    ["the JavaScript has other bytes", folder => appendFileSync(join(folder, "node_modules", "shapes", "index.js"), "\n"), "the installed index.js differs from the published file that this typed version was made from (was the package patched?)"],
    ["the typed file holds other code", folder => write(join(folder, "node_modules", "shapes"), { "index.sound.ts": typed["index.sound.ts"].replace("box.w * box.h", "box.w + box.h") }), "index.sound.ts without its types is not index.js"],
    ["the typed file holds what cannot be erased", folder => write(join(folder, "node_modules", "shapes"), { "index.sound.ts": typed["index.sound.ts"] + "enum Kind { A }\n" }), "the types of index.sound.ts cannot be erased: an enum at offset " + typed["index.sound.ts"].length + " cannot be erased"],
    ["the typed file is missing", folder => rmSync(join(folder, "node_modules", "shapes", "index.sound.ts")), "it has no index.sound.ts"],
    ["the typed file is outside the package", folder => shipped(folder, mark("../index.sound.ts")), "the declaration file beside index.js names no typed file inside the package"],
    ["the typed file has another name", folder => shipped(folder, mark("other.sound.ts")), "the typed file of index.js is not index.sound.ts"],
  ];
  test.each(shippedMismatches)("what the package ships: %s: one warning, and the package as installed", async (_, change, why) => {
    const folder = project("aot-typed-shipped-mismatch");
    shipped(folder);
    change(folder);
    expect(await built(folder)).toEqual({ said: unused("node_modules/shapes", why), stdout: "42 index.js\n", exitCode: 0 });
  });

  test("a type error in what the package ships is a warning, and the package is compiled untyped", async () => {
    const folder = project("aot-typed-shipped-lie");
    shipped(folder);
    write(join(folder, "node_modules", "shapes"), { "index.sound.ts": typed["index.sound.ts"].replace("const box: Box = { w, h };", `const box: Box = { w, h: h as unknown as string };`) });
    const build = await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder);
    const said = build.stdout + build.stderr;
    expect(said).toContain("TS100009: 'shapes' has 1 type errors, the first at ");
    expect(said).not.toContain("TS100021");
    expect(said).not.toContain("error:");
    expect(build.exitCode).toBe(0);
    expect(await spawned([join(folder, "app")], folder)).toEqual({ stdout: "42 index.sound.ts\n", stderr: "", exitCode: 0 });
  });

  test("a package behind a symlink", async () => {
    const folder = project("aot-typed-symlink");
    typedVersion(join(folder, ".sound", "linked"), { name: "linked" });
    const store = join(folder, "node_modules", ".store", "linked@1.2.3", "node_modules", "linked");
    write(store, { ...installed, "package.json": JSON.stringify({ name: "linked", version: "1.2.3", type: "module", main: "index.js", types: "index.d.ts" }) });
    symlinkSync(join(".store", "linked@1.2.3", "node_modules", "linked"), join(folder, "node_modules", "linked"));
    write(folder, { "app.ts": `import { area, where } from "linked";\nconsole.log(area(6, 7), /index(\\.sound)?\\.[jt]s/.exec(where())![0]);\n` });
    expect(await built(folder)).toEqual({ said: [`note: "linked" 1.2.3 is compiled from its typed version in .sound/linked`], stdout: "42 index.sound.ts\n", exitCode: 0 });
  });

  const mismatches: [string, (folder: string) => void, string][] = [
    ["an installed file has other bytes", folder => appendFileSync(join(folder, "node_modules", "shapes", "index.js"), "\n"), "the installed index.js differs from the published file that this typed version was made from (was the package patched?)"],
    ["a file of the basis has other bytes", folder => typedVersion(join(folder, ".sound", "shapes"), { basis: { "index.d.ts": sha256("") } }), "the installed index.d.ts differs from the published file that this typed version was made from (was the package patched?)"],
    ["another version is installed", folder => write(join(folder, "node_modules", "shapes"), { "package.json": installed["package.json"].replace("1.2.3", "1.2.4") }), "it is for version 1.2.3, and 1.2.4 is installed (install the typed version for 1.2.4, or remove this one)"],
    ["a new file is installed already", folder => write(join(folder, "node_modules", "shapes"), { "index.sound.ts": "" }), "index.sound.ts is installed, and it was not when the package was typed"],
    ["a path leaves the package", folder => typedVersion(join(folder, ".sound", "shapes"), { lay: { "../other/index.js": "new" } }), `"../other/index.js" in its sound.json is no path inside the package`],
    ["package.json cannot be replaced", folder => typedVersion(join(folder, ".sound", "shapes"), { lay: { "package.json": sha256(installed["package.json"]) } }), `"package.json" in its sound.json is no path inside the package`],
    ["a replacement is missing", folder => typedVersion(join(folder, ".sound", "shapes"), { lay: { ...manifest().lay, "more.ts": "new" } }), "it has no lay/more.ts"],
    ["nothing is replaced", folder => typedVersion(join(folder, ".sound", "shapes"), { lay: {} }), "its sound.json lays nothing"],
    ["the build does not define what it is for", folder => typedVersion(join(folder, ".sound", "shapes"), { when: { "process.env.NODE_ENV": "production" } }), `it is for a build that defines process.env.NODE_ENV as "production" (pass --define 'process.env.NODE_ENV="production"')`],
    ["a needed typed version is not in use", folder => typedVersion(join(folder, ".sound", "shapes"), { needs: ["other"] }), `it needs the typed version of "other", which is not used`],
    ["what it needs is no package", folder => typedVersion(join(folder, ".sound", "shapes"), { needs: ["../x"] }), `"needs" of its sound.json is not a list of packages' names`],
    ["an unknown format", folder => typedVersion(join(folder, ".sound", "shapes"), { sound: 99 }), "its sound.json is of a format that this Bun does not know"],
    ["a manifest that is not JSON", folder => write(join(folder, ".sound", "shapes"), { "sound.json": "{" }), "its sound.json is not JSON"],
  ];
  test.each(mismatches)("%s: one warning, and the package as installed", async (_, change, why) => {
    const folder = project("aot-typed-mismatch");
    typedVersion(join(folder, ".sound", "shapes"));
    change(folder);
    expect(await built(folder)).toEqual({ said: unused(".sound/shapes", why), stdout: "42 index.js\n", exitCode: 0 });
  });

  test("what the build defines", async () => {
    const folder = project("aot-typed-when");
    typedVersion(join(folder, ".sound", "shapes"), { when: { "process.env.NODE_ENV": "production" } });
    expect(await built(folder, ["--aot", "--define", `process.env.NODE_ENV="production"`])).toEqual({ said: used(".sound/shapes"), stdout: "42 index.sound.ts\n", exitCode: 0 });
  });

  test("control characters in the manifest do not reach the terminal", async () => {
    const folder = project("aot-typed-control");
    typedVersion(join(folder, ".sound", "shapes"), { version: "1.2\u001b[31m.3" });
    expect((await built(folder)).said).toEqual(unused(".sound/shapes", "it is for version 1.2?[31m.3, and 1.2.3 is installed (install the typed version for 1.2.3, or remove this one)"));
  });

  test("a typed version that does not type check stops the build", async () => {
    const folder = project("aot-typed-lie");
    typedVersion(join(folder, ".sound", "shapes"));
    write(join(folder, ".sound", "shapes", "lay"), { "index.sound.ts": typed["index.sound.ts"].replace("const box: Box = { w, h };", `const box: Box = { w, h: h as unknown as string };`) });
    const build = await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder);
    const said = build.stdout + build.stderr;
    expect(said).toContain("error: TS100021: The typed version of 'shapes' in .sound/shapes has type errors (1), the first at ");
    expect(said).toContain("TS2322: Type 'string' is not assignable to type 'number'.");
    expect(said).toMatch(/index\.sound\.ts:3:\d+/);
    expect(said).not.toContain("TS100009");
    expect(build.exitCode).toBe(1);
    expect(existsSync(join(folder, "app"))).toBe(false);
    write(folder, {
      "build.ts": `const result = await Bun.build({ entrypoints: ["app.ts"], compile: { outfile: "./app", aot: true }, throw: false });\nconsole.log(result.success, result.logs.filter(log => log.level === "error").map(log => log.message.slice(0, 65)));\n`,
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({ stdout: `false [ "TS100021: The typed version of 'shapes' in .sound/shapes has type" ]\n`, stderr: "", exitCode: 0 });
    const run = await spawned([bunExe(), "run", "--aot", "app.ts"], folder);
    expect(run.stderr).toContain("error: TS100021: The typed version of 'shapes' in .sound/shapes has type errors (1), the first at ");
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("the host's lib, target and types do not count against it", async () => {
    const folder = project("aot-typed-host");
    typedVersion(join(folder, ".sound", "shapes"));
    write(join(folder, ".sound", "shapes", "lay"), { "index.sound.ts": typed["index.sound.ts"].replace("return box.w * box.h;", "return [box.w * box.h].at(-1)! + (typeof Temporal === typeof WeakRef ? 0 : 0);") });
    write(folder, {
      "app.ts": `declare const console: { log(...all: unknown[]): void };\nimport { area, where } from "shapes";\nconsole.log(area(6, 7), /index(\\.sound)?\\.[jt]s/.exec(where())![0]);\n`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "es2017", lib: ["es2017"], types: [], verbatimModuleSyntax: true, noUncheckedIndexedAccess: true } }),
    });
    const build = await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder);
    expect(build.stdout + build.stderr).not.toContain("TS100009");
    expect(build.exitCode).toBe(0);
    expect(await spawned([join(folder, "app")], folder)).toEqual({ stdout: "42 index.sound.ts\n", stderr: "", exitCode: 0 });
  });

  test("Bun.build has the note and the warning in its logs", async () => {
    const folder = project("aot-typed-api");
    typedVersion(join(folder, ".sound", "shapes"));
    write(folder, {
      "build.ts": `const result = await Bun.build({ entrypoints: ["app.ts"], compile: { outfile: "./app", aot: true } });\nconsole.log(JSON.stringify(result.logs.map(log => log.level + ": " + log.message)));\n`,
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({ stdout: JSON.stringify(used(".sound/shapes")) + "\n", stderr: "", exitCode: 0 });
    expect((await spawned([join(folder, "app")], folder)).stdout).toBe("42 index.sound.ts\n");
    appendFileSync(join(folder, "node_modules", "shapes", "index.js"), "\n");
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({
      stdout: JSON.stringify(unused(".sound/shapes", "the installed index.js differs from the published file that this typed version was made from (was the package patched?)")) + "\n",
      stderr: "",
      exitCode: 0,
    });
    expect((await spawned([join(folder, "app")], folder)).stdout).toBe("42 index.js\n");
  });

  test("an onResolve plugin that returns nothing is skipped", async () => {
    const folder = project("aot-typed-plugin");
    typedVersion(join(folder, ".sound", "shapes"));
    write(folder, {
      "build.ts": `const result = await Bun.build({ entrypoints: ["app.ts"], compile: { outfile: "./app", aot: true }, plugins: [{ name: "asks", setup(build) { build.onResolve({ filter: /.*/ }, () => undefined); } }] });\nconsole.log(JSON.stringify(result.logs.map(log => log.level + ": " + log.message)));\n`,
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({ stdout: JSON.stringify(used(".sound/shapes")) + "\n", stderr: "", exitCode: 0 });
    expect((await spawned([join(folder, "app")], folder)).stdout).toBe("42 index.sound.ts\n");
  });

  test("bun run --aot prints neither", async () => {
    const folder = project("aot-typed-run");
    typedVersion(join(folder, ".sound", "shapes"));
    expect(await spawned([bunExe(), "run", "--aot", "app.ts"], folder)).toEqual({ stdout: "42 index.sound.ts\n", stderr: "", exitCode: 0 });
    appendFileSync(join(folder, "node_modules", "shapes", "index.js"), "\n");
    expect(await spawned([bunExe(), "run", "--aot", "app.ts"], folder)).toEqual({ stdout: "42 index.js\n", stderr: "", exitCode: 0 });
  });
});
