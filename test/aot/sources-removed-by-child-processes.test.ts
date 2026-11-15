import { describe, expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

// The executable answers for a source whose folder the disk does not have. Here the disk has the sources, and a process that the program starts removes some.
const ways = [
  'Bun.spawnSync(["rm", at("src/a.mjs"), at("lone/b.cjs")]);',
  'await Bun.spawn(["rm", "src/a.mjs", "src/deep/c.ts"], { cwd: __dirname }).exited;',
  'require("node:child_process").execSync(`mv ${at("src/a.mjs")} ${at("src/moved.mjs")}`);',
  'await Bun.$`sh -c ${"rm " + at("node_modules/pkg/index.js")}`.quiet();',
  'require("node:child_process").spawnSync("rm", ["src/a.mjs", "src/kept.mjs", "src/deep/c.ts", "lone/b.cjs"].map(at));',
  'Bun.spawnSync(["rm", at("src/a.mjs")]); fs.writeFileSync(at("src/a.mjs"), "new"); Bun.spawnSync(["rm", at("src/a.mjs")]);',
  'Bun.spawnSync(["rm", __filename, at("src/a.mjs")]);',
  'Bun.spawnSync(["rm", at("lib/a.cjs"), at("lib/b.cjs")]);',
];
const files = {
  "main.cjs": `const fs = require("node:fs"), path = require("node:path");
const at = name => path.join(__dirname, name);
const ways = [
${ways.map(way => `  async () => { ${way} },`).join("\n")}
];
const names = ["main.cjs", "lib/a.cjs", "lib/b.cjs", "lib/c.cjs", "src", "src/a.mjs", "src/deep", "src/deep/c.ts", "src/kept.mjs", "lone", "lone/b.cjs", "node_modules/pkg/index.js", "absent.ts"];
async function ask(name) {
  const code = run => { try { return run(); } catch (error) { return error.code; } };
  return [
    name, fs.existsSync(at(name)), fs.existsSync(path.relative(process.cwd(), at(name))),
    fs.statSync(at(name), { throwIfNoEntry: false })?.isFile(), code(() => fs.lstatSync(at(name)).isDirectory()),
    code(() => fs.accessSync(at(name))), await fs.promises.stat(at(name)).then(stat => stat.isFile(), error => error.code),
    await Bun.file(at(name)).stat().then(stat => stat.isFile(), error => error.code), code(() => fs.readdirSync(at(name)).length),
  ].join(" ");
}
(async () => {
  console.log(require("./src/a.mjs").a, require("./src/kept.mjs").kept, require("./lone/b.cjs").b, require("pkg").pkg);
  const before = [], behind = [];
  for (const name of names) before.push(await ask(name));
  if (process.argv[2] === "none") Bun.spawnSync(["true"]);
  else await ways[Number(process.argv[2])]();
  for (const name of names) behind.push(await ask(name));
  console.log(before.join("\\n"));
  console.log(behind.join("\\n"));
})();
`,
  "lib/a.cjs": `exports.a = 5;\n`,
  "lib/b.cjs": `exports.b = 6;\n`,
  "lib/c.cjs": `exports.c = 7;\n`,
  "src/a.mjs": `import { c } from "./deep/c.ts";\nexport const a = c;\n`,
  "src/deep/c.ts": `export const c: number = 1;\n`,
  "src/kept.mjs": `export const kept = 2;\n`,
  "lone/b.cjs": `exports.b = 3;\n`,
  "node_modules/pkg/package.json": `{"name":"pkg","version":"1.0.0","main":"index.js"}`,
  "node_modules/pkg/index.js": `exports.pkg = 4;\n`,
};

describe.skipIf(unsupported || isWindows)("a source that a child process removes", () => {
  test("is gone", async () => {
    await slot(async () => {
      using fresh = tempDir("sources-removed-by-child-processes", files);
      using dir = tempDir("sources-removed-by-child-processes", files);
      using out = tempDir("sources-removed-by-child-processes", {});
      const executable = join(String(out), "main");
      const entryPoints = ["main.cjs", "lib/a.cjs", "lib/b.cjs", "lib/c.cjs"];
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", ...entryPoints, "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      const restore = () => {
        for (const name of ["lib", "src", "lone", "node_modules"])
          rmSync(join(String(dir), name), { recursive: true, force: true });
        cpSync(String(fresh), String(dir), { recursive: true });
      };
      for (const way of [...ways.keys(), "none"]) {
        restore();
        const plain = await run([bunExe(), "--no-install", "main.cjs", String(way)], String(dir));
        restore();
        const compiled = await run([executable, String(way)], String(dir));
        expect({ way: ways[way] ?? way, stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
          way: ways[way] ?? way,
          stdout: plain.stdout,
          exitCode: 0,
        });
      }
    });
  });

  test("is there where its folder was not deployed", async () => {
    await slot(async () => {
      using dir = tempDir("sources-that-were-not-deployed", files);
      using out = tempDir("sources-that-were-not-deployed", {});
      const executable = join(String(out), "main");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      const there = (name: string) => `${name} true true true false  true true ENOENT`;
      const lines = async () => {
        const { stdout, stderr, exitCode } = await run([executable, "none"], String(dir));
        expect(exitCode, stderr).toBe(0);
        return stdout.split("\n");
      };
      rmSync(join(String(dir), "lone"), { recursive: true });
      rmSync(join(String(dir), "src/a.mjs"));
      const partly = await lines();
      expect(partly).toContain(there("lone/b.cjs"));
      expect(partly).toContain("src/a.mjs false false  ENOENT ENOENT ENOENT ENOENT ENOENT");
      for (const name of ["main.cjs", "src", "node_modules"]) rmSync(join(String(dir), name), { recursive: true });
      const moved = await lines();
      for (const name of ["main.cjs", "src/a.mjs", "lone/b.cjs", "node_modules/pkg/index.js"])
        expect(moved.filter(line => line === there(name))).toHaveLength(2);
    });
  });

  test("is gone where another is left and the program has no descriptor", async () => {
    await slot(async () => {
      const names = ["lib/a.cjs", "lib/b.cjs", "src/c.cjs"];
      using dir = tempDir("sources-without-descriptors", {
        "main.cjs": `const fs = require("node:fs"), path = require("node:path");
const ask = () => ${JSON.stringify(names)}.map(name => fs.existsSync(path.join(__dirname, name))).join();
const askWithoutDescriptors = () => {
  const open = [];
  try {
    for (;;) open.push(fs.openSync("/dev/null", "r"));
  } catch {}
  const answers = ask();
  for (const fd of open) fs.closeSync(fd);
  return answers;
};
askWithoutDescriptors();
console.log(${names.map(name => `require("./${name}").name`).join()}, ask());
console.log(askWithoutDescriptors());
`,
        ...Object.fromEntries(names.map(name => [name, `exports.name = "${name}";\n`])),
      });
      using out = tempDir("sources-without-descriptors", {});
      const executable = join(String(out), "main");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      for (const name of ["main.cjs", "lib/a.cjs", "src/c.cjs"]) rmSync(join(String(dir), name));
      const { stdout, exitCode } = await run(["sh", "-c", `ulimit -n 128 && exec ${executable}`], String(out));
      expect({ stdout, exitCode }).toEqual({
        stdout: "lib/a.cjs lib/b.cjs src/c.cjs false,true,false\nfalse,true,false\n",
        exitCode: 0,
      });
    });
  });
});
