// Two builds of one program with --aot give the same executable, byte for byte. Nothing in the compiler may follow an address, a clock,
// the order in which threads finish or the folder that holds the program. The functions here keep more numbers alive across a loop than
// there are registers, so each of them moves several values between the stack and registers at the ends of its loop: the order of such
// moves once followed addresses.
import { describe, expect } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const numberOfFunctions = 150;

function search(index: number): string {
  return `
function search${index}(code: number, map: readonly number[], a: number, b: number, c: number, d: number, e: number, f: number): number {
  let lo = ${index % 3}, hi = map.length, mid = 0;
  const s0 = a * b, s1 = b * c, s2 = c * d, s3 = d * e, s4 = e * f, s5 = f * a, s6 = a + c, s7 = b + d;
  while (lo + 1 < hi) {
    mid = lo + (hi - lo) / 2;
    mid -= mid % 2;
    if (map[mid] <= code && code <= map[mid + 1]) return s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + mid;
    if (code < map[mid]) hi = mid;
    else lo = mid + 2;
  }
  return s0 - s1 + s2 - s3 + s4 - s5 + s6 - s7 + lo + hi + ${index};
}
total += search${index}(${index % 50}, map, 1.5, 2.5, 3.5, ${index}, 5.5, 6.5);
`;
}

const sources = {
  "entry.ts": `
const map = [1, 5, 9, 12, 20, 31, 40, 44];
let total = 0;
${Array.from({ length: numberOfFunctions }, (_, index) => search(index)).join("")}
console.log(total);
`,
};

const sourcesOfSeveralFiles = {
  "entry.ts": `
import name from "named";
import data from "./lib/data.json";
import { twice } from "./lib/twice";
const inner = require("./lib/inner.cjs");
console.log(twice(2), data.name, name, inner.file, import.meta.url, new Error("here").stack);
console.log(new Function("a", "return a * 2")(4), (0, eval)("(0, eval)('3 + 4')"));
console.log((await import("./lib/lazy.mjs")).default);
`,
  "lib/twice.ts": `export function twice(n: number) { return n * 2; }`,
  "lib/data.json": `{ "name": "data" }`,
  // Not `__filename`, `__dirname` or require.resolve(): they hold the folder of the build, as with `bun build --compile`.
  "lib/inner.cjs": `module.exports = { file: module.filename };`,
  "lib/lazy.mjs": `export default "lazy";`,
  "node_modules/named/package.json": `{ "name": "named", "main": "index.js" }`,
  "node_modules/named/index.js": `module.exports = "named";`,
};

describe.skipIf(!!unsupported)("compile/aot/two-builds-give-the-same-bytes", () => {
  const folder = String(tempDir("aot-same-bytes", sources));
  const folders = ["aot-same-bytes-short", "aot-same-bytes-in-a-folder-with-a-longer-name"].map(name =>
    String(tempDir(name, sourcesOfSeveralFiles)),
  );
  afterAll(() => [folder, ...folders].forEach(each => rmSync(each, { recursive: true, force: true })));

  test("three builds of one program are equal", async () => {
    await slot(async () => {
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const hashes: string[] = [];
      for (let build = 0; build < 3; build++) {
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
        rmSync(executable);
      }
      expect(hashes).toEqual([hashes[0], hashes[0], hashes[0]]);
    });
  }, 600_000);

  const importsUnderMadeName = `export const which = "right.ts";\nif (process.argv[2]) setTimeout(() => import([".", process.argv[2]].join("/")), 0);\n`;
  test.each([
    ["a program that loads nothing", `console.log("right");\n`, isWindows ? "right.exe" : "right", []],
    ["a program that imports under a made name", importsUnderMadeName, isWindows ? "right.exe" : "right", []],
    ["the same, and the executable has an extension", importsUnderMadeName, "right.exe", ["--outfile", "right.exe"]],
    [
      "a program that loads nothing, and the names differ in case",
      `console.log("right");\n`,
      "Right.exe",
      ["--outfile", "Right.exe"],
    ],
    [
      "the same without an extension",
      `console.log("right");\n`,
      isWindows ? "Right.exe" : "Right",
      ["--outfile", "Right"],
    ],
    [
      "a program whose computed path ends as the metafile does",
      `if (process.argv[2]) console.log(require("./" + process.argv[2] + ".json"));\n`,
      isWindows ? "right.exe" : "right",
      ["--metafile=meta.json"],
    ],
    [
      "a program whose computed path may name what lies beside an external source map",
      `if (process.argv[2]) import("./" + process.argv[2]);\n`,
      isWindows ? "right.exe" : "right",
      ["--sourcemap=external"],
    ],
  ])(
    "a build over the executable of the build before, which is named as the entry point, is equal: %s",
    async (_, text, executable, flags) => {
      await slot(async () => {
        using dir = tempDir("aot-same-bytes-over-the-first", { "right.ts": text });
        const hashes: string[] = [];
        for (let build = 0; build < 2; build++) {
          built(
            await spawned(
              [bunExe(), "build", "--compile", ...withoutDebugInformation, "--aot", "./right.ts", ...flags],
              String(dir),
              bunEnv,
            ),
          );
          hashes.push(Bun.hash(readFileSync(join(String(dir), executable))).toString(16));
        }
        expect(hashes[1]).toBe(hashes[0]);
      });
    },
    600_000,
  );

  test("an executable takes the place of no file of its program", async () => {
    await slot(async () => {
      const reads = `import data from "./app" with { type: "file" };\nconsole.log((await Bun.file(data).text()).trim());\n`;
      const files: Record<string, string> = {
        "beside/app.mjs": reads,
        "beside/app": "the data\n",
        "script/cli": `console.log("cli");\n`,
      };
      using dir = tempDir("aot-the-file-at-the-outfile-is-kept", files);
      const printed: string[] = [];
      for (const [folder, entry, name, role] of [
        ["beside", "./app.mjs", "app", "part of the program"],
        ["script", "./cli", "cli", "an entry point"],
      ]) {
        const directory = join(String(dir), folder);
        const command = [bunExe(), "build", "--compile", ...withoutDebugInformation, "--aot", entry];
        // The default path ends with ".exe" on Windows.
        if (!isWindows) {
          const refused = await spawned(command, directory, bunEnv);
          expect(refused.stderr).toContain(`error: the executable would overwrite ${name}, which is ${role}.`);
          expect(refused.exitCode).toBe(1);
        }
        built(await spawned([...command, "--outfile", "out"], directory, bunEnv));
        expect(readFileSync(join(directory, name), "utf8")).toBe(files[`${folder}/${name}`]);
        const ran = await spawned([join(directory, isWindows ? "out.exe" : "out")], directory, bunEnv);
        printed.push(ran.stdout.trim());
      }
      expect(printed).toEqual(["the data", "cli"]);
    });
  }, 600_000);

  // The time that the disk has for a folder moves with files that are no part of the program.
  const readsAt = (path: string) =>
    `console.log(require("node:fs").readFileSync(require("node:path").join(__dirname, "${path}"), "utf8"));\n`;
  const addTo = (folder: string) => writeFileSync(join(folder, "other.txt"), "of nobody");
  test.each([
    {
      name: "an asset below the entry point",
      files: { "app/entry.cjs": readsAt("data/deep/one.txt"), "app/data/deep/one.txt": "one" },
      flags: ["--asset", "data/deep/one.txt"],
      folders: ["", "app", "app/data", "app/data/deep"],
      change: addTo,
    },
    {
      name: "a folder given as an asset",
      files: { "app/entry.cjs": readsAt("data/deep/one.txt"), "app/data/deep/one.txt": "one" },
      flags: ["--asset", "data"],
      folders: ["", "app", "app/data", "app/data/deep"],
    },
    {
      name: "an asset above the entry point",
      files: { "app/entry.cjs": readsAt("../shared/deep/one.txt"), "shared/deep/one.txt": "one" },
      flags: ["--asset", "../shared/deep/one.txt"],
      folders: ["", "app", "shared", "shared/deep"],
      change: addTo,
    },
    {
      name: "the package.json above the entry point",
      files: { "app/src/entry.cjs": readsAt("../package.json"), "app/package.json": `{ "name": "app" }` },
      working: "app/src",
      folders: ["", "app", "app/src"],
      change: addTo,
    },
    {
      name: "the package.json of a package behind a link",
      files: {
        "app/entry.cjs": `console.log(require("linked"));\n`,
        "store/node_modules/linked/package.json": `{ "name": "linked", "version": "1.0.0" }`,
        "store/node_modules/linked/index.js": `module.exports = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "package.json"), "utf8")).version;\n`,
      },
      links: { "app/node_modules/linked": "store/node_modules/linked" },
      folders: ["", "app", "app/node_modules", "store", "store/node_modules", "store/node_modules/linked"],
      change: addTo,
    },
    {
      name: "data files under a made path",
      files: {
        "app/entry.cjs": `console.log(require("./locales/" + (process.argv[2] ?? "en") + ".json").hello);\n`,
        "app/locales/en.json": `{ "hello": "hello" }`,
        "app/locales/de.json": `{ "hello": "hallo" }`,
      },
      folders: ["", "app", "app/locales"],
    },
  ] as {
    name: string;
    files: Record<string, string>;
    flags?: string[];
    links?: Record<string, string>;
    working?: string;
    folders: string[];
    change?: (folder: string) => void;
  }[])(
    "a build whose embedded files lie in folders that have changed since the build before is equal: $name",
    async ({ files, flags = [], links = {}, working = "app", folders, change }) => {
      await slot(async () => {
        using dir = tempDir("aot-same-bytes-in-changed-folders", files);
        for (const [link, target] of Object.entries(links)) {
          mkdirSync(join(String(dir), link, ".."), { recursive: true });
          symlinkSync(join(String(dir), target), join(String(dir), link), "junction");
        }
        const executable = join(String(dir), isWindows ? "built.exe" : "built");
        const hashes: string[] = [];
        const printed: string[] = [];
        const exitCodes: (number | null)[] = [];
        for (let build = 1; build <= 2; build++) {
          for (const folder of folders) {
            if (build === 2) change?.(join(String(dir), folder));
            utimesSync(join(String(dir), folder), build * 100_000_000, build * 100_000_000);
          }
          const command = [
            bunExe(),
            "build",
            "--compile",
            ...withoutDebugInformation,
            "--aot",
            "./entry.cjs",
            ...flags,
          ];
          built(await spawned([...command, "--outfile", executable], join(String(dir), working), bunEnv));
          hashes.push(Bun.hash(readFileSync(executable)).toString(16));
          const ran = await spawned([executable], String(dir), bunEnv);
          printed.push(ran.stdout);
          exitCodes.push(ran.exitCode);
          rmSync(executable);
        }
        expect(printed[1]).toBe(printed[0]);
        expect(exitCodes).toEqual([0, 0]);
        expect(hashes[1]).toBe(hashes[0]);
      });
    },
    600_000,
  );

  test("builds of one program in two folders are equal", async () => {
    await slot(async () => {
      const hashes: string[] = [];
      for (const each of folders) {
        const executable = join(each, isWindows ? "compiled.exe" : "compiled");
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            each,
            bunEnv,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
      }
      expect(hashes[1]).toBe(hashes[0]);
    });
  }, 600_000);
});
