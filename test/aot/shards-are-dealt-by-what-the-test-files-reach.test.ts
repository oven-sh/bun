import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A compiled run builds what its test files reach before the first of them runs. So `--shard` puts the files that reach the same
// into the same shard: each part of the project is built in one shard, not in all.

const libraries = ["a", "b", "c"];
// Neither every third file nor four files in a row import the same.
const libraryOf = [0, 1, 2, 1, 2, 0, 2, 0, 1, 0, 1, 2];
const names = libraryOf.map((_, index) => `tests/t${String(index).padStart(2, "0")}.test.ts`);

// A comment weighs as code does where the files are dealt, and takes no time to compile.
const library = (name: string, bytes: number) => `// ${Buffer.alloc(bytes, "x")}\nexport const name = "${name}";\n`;
const testFile = (imported: string[]) =>
  `import { expect, test } from "bun:test";
${imported.map(name => `import { name as ${name} } from "../lib/${name}";`).join("\n")}
test("reads what it imports", () => expect([${imported.join(", ")}]).toEqual(${JSON.stringify(imported)}));
`;
const project = (importedBy: (index: number) => string[], more: Record<string, string> = {}) =>
  tempDir("aot-shards-are-dealt-by-what-the-test-files-reach", {
    "package.json": `{ "name": "shards" }`,
    ...Object.fromEntries(libraries.map(name => [`lib/${name}.ts`, library(name, 100_000)])),
    ...Object.fromEntries(names.map((name, index) => [name, testFile(importedBy(index))])),
    ...more,
  });

/** The test files that each shard runs. */
async function deal(dir: string, count: number, ...flags: string[]) {
  const shards = Array.from({ length: count }, (_, index) =>
    run([bunExe(), "test", ...flags, `--shard=${index + 1}/${count}`], dir, bunEnv),
  );
  return (await Promise.all(shards)).map(({ stdout, stderr, exitCode }) => {
    expect({ exitCode, failed: stderr.match(/^ *(\d+) fail$/m)?.[1] ?? "0" }).toEqual({ exitCode: 0, failed: "0" });
    return [...(stdout + stderr).matchAll(/^(tests\/t\d+\.test\.ts):$/gm)].map(match => match[1]).sort();
  });
}
const everyNth = (count: number) =>
  Array.from({ length: count }, (_, shard) => names.filter((_, index) => index % count === shard));

test("the files that reach the same go together, each file in one shard, and every machine deals alike", async () => {
  using dir = project(index => [libraries[libraryOf[index]]]);
  const [plain, compiled, again] = await Promise.all([
    deal(String(dir), 3),
    deal(String(dir), 3, "--aot"),
    deal(String(dir), 3, "--aot"),
  ]);
  expect(plain).toEqual(everyNth(3));
  expect(compiled.flat().sort()).toEqual(names);
  expect(again).toEqual(compiled);
  const reached = compiled.map(files => [...new Set(files.map(name => libraryOf[names.indexOf(name)]))]);
  expect(reached.map(libraries => libraries.length)).toEqual([1, 1, 1]);
  expect(compiled.map(files => files.length)).toEqual([4, 4, 4]);
}, 240_000);

test.each([1, 5, 14])(
  "%d shards: each file in one of them",
  async count => {
    using dir = project(index => [libraries[libraryOf[index]]]);
    const compiled = await deal(String(dir), count, "--aot");
    expect(compiled.flat().sort()).toEqual(names);
    // As even as without --aot.
    const most = Math.max(...compiled.map(files => files.length));
    expect(most).toBe(Math.ceil(names.length / count));
  },
  240_000,
);

test("where every file reaches everything the files are dealt as without --aot", async () => {
  using dir = project(() => libraries);
  const [plain, compiled] = await Promise.all([deal(String(dir), 3), deal(String(dir), 3, "--aot")]);
  expect(plain).toEqual(everyNth(3));
  expect(compiled).toEqual(plain);
}, 240_000);

test("what a preload reaches is built in every shard, so it brings no files together", async () => {
  using dir = project(index => [libraries[libraryOf[index]]], {
    "setup.ts": `import "./lib/a";\nimport "./lib/b";\nimport "./lib/c";\n`,
  });
  const flags = ["--preload", "./setup.ts"];
  const [plain, compiled] = await Promise.all([
    deal(String(dir), 3, ...flags),
    deal(String(dir), 3, "--aot", ...flags),
  ]);
  expect(compiled).toEqual(plain);
}, 240_000);

test("with --timings a shard that has more to build gets fewer files", async () => {
  // Four files reach a large library, eight reach nothing. By their times alone each shard would get six.
  const reachesLibrary = (index: number) => index % 3 === 0;
  using dir = project(index => (reachesLibrary(index) ? ["a"] : []), {
    "lib/a.ts": library("a", 4_000_000),
    "timings.json": JSON.stringify({
      version: 1,
      workers: 2,
      files: Object.fromEntries(names.map(name => [name, 10])),
    }),
  });
  const flags = ["--timings=timings.json", "--parallel=2"];
  const [plain, compiled] = await Promise.all([
    deal(String(dir), 2, ...flags),
    deal(String(dir), 2, "--aot", ...flags),
  ]);
  expect(plain.map(files => files.length)).toEqual([6, 6]);
  expect(compiled.flat().sort()).toEqual(names);
  const withLibrary = compiled.filter(files => files.some(name => reachesLibrary(names.indexOf(name))));
  expect(withLibrary.length).toBe(1);
  expect(withLibrary[0].length).toBeLessThan(6);
}, 240_000);

test("a file that takes long does not wait behind a long build", async () => {
  // Four files reach a large library. One reaches a small one and takes 3 s, seven reach nothing and take 2.9 s each. By the sums
  // of their times the shards are most equal with the file of 3 s behind the large library. But a shard isn't through before
  // its longest file is, and four files ran at once when the times were taken.
  const reachesLibrary = (index: number) => index % 3 === 0;
  const long = 1;
  const time = (index: number) => (reachesLibrary(index) ? 10 : index === long ? 3000 : 2900);
  using dir = project(index => (reachesLibrary(index) ? ["a"] : index === long ? ["b"] : []), {
    "lib/a.ts": library("a", 2_000_000),
    "lib/b.ts": library("b", 20_000),
    "timings.json": JSON.stringify({
      version: 1,
      workers: 4,
      files: Object.fromEntries(names.map((name, index) => [name, time(index)])),
    }),
  });
  const compiled = await deal(String(dir), 2, "--aot", "--timings=timings.json", "--parallel=4");
  expect(compiled.flat().sort()).toEqual(names);
  // Each machine deals for itself, and `--parallel=$(nproc)` is another number on another machine. A file that one gives to the
  // other's shard, and the other to the first's, would run on neither, and both would report success.
  for (const flags of [[], ["--parallel=1"], ["--parallel=8"], ["--parallel=16"], ["--parallel"]]) {
    expect(await deal(String(dir), 2, "--aot", "--timings=timings.json", ...flags)).toEqual(compiled);
  }
  const withLong = compiled.find(files => files.includes(names[long]))!;
  expect(withLong.filter(name => reachesLibrary(names.indexOf(name)))).toEqual([]);
}, 240_000);

test("files that are held back for their memory do not all wait for one another in one shard", async () => {
  // Four files reach the same library, so by what they reach they belong together. But each took 2 GB when it was last
  // measured, and a run starts such a file only when the one before it has ended: together they take 4 s whatever runs beside them.
  const isHeavy = (index: number) => index % 3 === 0;
  using dir = project(index => (isHeavy(index) ? ["a"] : []), {
    "timings.json": JSON.stringify({
      version: 1,
      workers: 4,
      files: Object.fromEntries(names.map((name, index) => [name, isHeavy(index) ? 1000 : 400])),
      memory: Object.fromEntries(names.filter((_, index) => isHeavy(index)).map(name => [name, 2000])),
    }),
  });
  const compiled = await deal(String(dir), 2, "--aot", "--timings=timings.json", "--parallel=4");
  expect(compiled.flat().sort()).toEqual(names);
  expect(compiled.map(files => files.filter(name => isHeavy(names.indexOf(name))).length)).toEqual([2, 2]);
}, 240_000);

test("one name means another file in another folder", async () => {
  // "./big" three times, a file of its own each time: that is what brings test files together. Taken for one file, all of them
  // would reach it, and the small files, which every third test file imports, would decide.
  const small = libraries.map(name => `small_${name}`);
  const folders = libraries.flatMap(name => [
    [`lib/${name}.ts`, `import "./${name}/index";\nexport const name = "${name}";\n`],
    [`lib/${name}/index.ts`, `import "./big";\n`],
    [`lib/${name}/big.ts`, library(name, 100_000)],
    [`lib/small_${name}.ts`, library(`small_${name}`, 3_000)],
  ]);
  using dir = project(index => [libraries[libraryOf[index]], small[index % 3]], Object.fromEntries(folders));
  const compiled = await deal(String(dir), 3, "--aot");
  expect(compiled.flat().sort()).toEqual(names);
  const reached = compiled.map(files => [...new Set(files.map(name => libraryOf[names.indexOf(name)]))]);
  expect(reached.map(libraries => libraries.length)).toEqual([1, 1, 1]);
}, 240_000);
