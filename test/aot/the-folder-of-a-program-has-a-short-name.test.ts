// `bun build --compile` writes a temporary file into the working directory, and a program that is a folder is built from inside that folder. On Windows a path of 260
// characters is not found. The name of the temporary file takes 37 of them, and what stands in front of the topic about 45 for a program that is kept in ./programs
// and about 60 for one that is written out of a .programs file into the runner's temporary folder.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const programs = join(import.meta.dir, "programs");
const longest = { kept: 170, written: 150 };

test("the folder of a program is short enough to build in on Windows", () => {
  const folders = { kept: new Set<string>(), written: new Set<string>() };
  for (const found of readdirSync(programs, { recursive: true, encoding: "utf8" })) {
    const path = found.replaceAll("\\", "/");
    if (path.includes("/node_modules/")) continue;
    if (!path.endsWith(".programs")) folders.kept.add(dirname(path));
    else
      for (const [, name] of readFileSync(join(programs, path), "utf8").matchAll(/^\/\/\/\/ (\S+)/gm))
        folders.written.add(dirname(`${dirname(path)}/${name}`));
  }
  expect(Math.min(folders.kept.size, folders.written.size)).toBeGreaterThan(100);
  expect({
    kept: [...folders.kept].filter(folder => folder.length > longest.kept),
    written: [...folders.written].filter(folder => folder.length > longest.written),
  }).toEqual({ kept: [], written: [] });
});
