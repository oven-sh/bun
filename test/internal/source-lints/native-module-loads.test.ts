import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadedByNativeCode } from "../../../src/codegen/internal-module-registry-scanner.ts";

// `bun build --compile --compile-exclude-features=node:http2` leaves a builtin module of JavaScript out of an executable, if Bun
// itself does not load it. What the builtin modules and functions load is read off their source. What native code loads is
// not, so it is written down: in `loadedByNativeCode` if it does so whatever the program does, and here if it does so because
// the program asked, in which case the exception that `requireId` throws without the module has to get to the program.
const becauseTheProgramAsked = [
  "BunSql", // Bun.sql, Bun.SQL
  "NodeTimersPromises", // setTimeout[util.promisify.custom]
  "NodeUtilTypes", // process.binding("util"). It is native code.
  "NodeWorkerThreads", // In a worker that the program made with it.
];

test("what native code loads of the builtin modules is accounted for", () => {
  const root = path.resolve(import.meta.dir, "..", "..", "..");
  const enumName = (file: string) =>
    file
      .replace(/\.ts$/, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  const known = new Set([
    ...loadedByNativeCode.map(enumName),
    ...becauseTheProgramAsked.map(name => name.toLowerCase()),
  ]);

  const loads: string[] = [];
  for (const file of new Glob("src/**/*.{cpp,h}").scanSync({ cwd: root })) {
    // One that is given a variable loads what the program named.
    const calls = readFileSync(path.join(root, file), "utf8").matchAll(
      /requireId\([^;]*?InternalModuleRegistry::(?:Field::)?(\w+)\)/g,
    );
    for (const [, name] of calls) loads.push(`${file.replaceAll("\\", "/")}: ${name}`);
  }
  expect(loads.length).toBeGreaterThan(0);
  expect(loads.filter(load => !known.has(load.split(": ")[1].toLowerCase()))).toEqual([]);
});
