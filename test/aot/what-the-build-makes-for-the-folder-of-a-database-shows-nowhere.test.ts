// For a database that is looked up in the working directory the build makes a small module of its own, which keeps the folder. It is no file of the program: the
// metafile does not list it. And since one name is one database, a call for a name that a statement somewhere names too gets the database of the start, as `bun <file>` does.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const place = `query("select place from places").get().place`;
const statement = `import db from "./data.sqlite" with { type: "sqlite" };\n`;

function createDatabase(folder: string, place: string) {
  mkdirSync(folder, { recursive: true });
  const database = new Database(join(folder, "data.sqlite"));
  database.exec("create table places (place text)");
  database.query("insert into places values (?)").run(place);
  database.close();
}

test("the metafile", async () => {
  using sources = tempDir("aot-the-folder-of-a-database-in-the-metafile", {
    "main.mjs": `${statement}console.log(db.${place});\n`,
  });
  using output = tempDir("aot-the-folder-of-a-database-in-the-metafile-output", {});
  createDatabase(String(sources), "start");
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const metafile = join(String(output), "meta.json");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable, `--metafile=${metafile}`],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const text = readFileSync(metafile, "utf8");
  expect(Object.keys(JSON.parse(text).inputs).sort()).toEqual(["database:./data.sqlite", "main.mjs"]);
  expect(JSON.parse(text).inputs["main.mjs"].imports.map((it: { path: string }) => it.path)).toEqual([
    "database:./data.sqlite",
  ]);
  expect(text).not.toContain("folder-of-database");
});

test("a call behind a change of folder, beside a statement in a file that is never loaded", async () => {
  using sources = tempDir("aot-a-call-beside-a-statement-that-never-runs", {
    "rows.mjs": `${statement}export const place = () => db.${place};\n`,
    "main.mjs": `process.chdir("inner");\nif (process.argv.length > 9) await import("./rows.mjs");\nconst db = (await import("./data.sqlite", { with: { type: "sqlite" } })).default;\nconsole.log(db.${place});\n`,
  });
  using output = tempDir("aot-a-call-beside-a-statement-that-never-runs-output", {});
  createDatabase(String(sources), "start");
  createDatabase(join(String(sources), "inner"), "inner");
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "start\n", exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const ran = await run([executable], String(sources), bunEnv);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "start\n", exitCode: 0 });
});
