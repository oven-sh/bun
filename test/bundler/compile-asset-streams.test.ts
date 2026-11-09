import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/commands";
import { run } from "../aot/harness/run";

// A module of the program that `--asset ./client` embeds as a file too.
const shared = `export const shared = "compiled and embedded";\n`;

const files = {
  "main.mjs": `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./client/shared.mjs";
const dir = path.join(import.meta.dirname, "client");
const file = path.join(dir, "hello.txt");
const spelled = [dir + "/./hello.txt", dir + "/sub/../hello.txt", dir + "//hello.txt"];
const code = run => { try { return run(); } catch (error) { return error.code; } };
const streamed = (options, from = file) => new Promise((resolve, reject) => { let text = ""; fs.createReadStream(from, { encoding: "utf8", ...options }).on("data", chunk => (text += chunk)).on("end", () => resolve(text)).on("error", reject); });
const tries = {
  isStandalone: () => Bun.isStandaloneExecutable && file.startsWith("/$bunfs/"),
  createReadStream: () => streamed({}),
  range: () => streamed({ start: 2, end: 5 }),
  openSync: () => { const fd = fs.openSync(file, "r"); const bytes = Buffer.alloc(5); const stats = fs.fstatSync(fd); const read = fs.readSync(fd, bytes, 0, 5, 6); fs.closeSync(fd); return [stats.isFile(), stats.size, read, bytes.toString()].join(); },
  promisesOpen: async () => { const handle = await fs.promises.open(file); try { return [(await handle.stat()).size, (await handle.readFile("utf8"))].join(); } finally { await handle.close(); } },
  open: () => new Promise((resolve, reject) => fs.open(file, (error, fd) => (error ? reject(error) : (fs.closeSync(fd), resolve(typeof fd))))),
  script: () => new Promise((resolve, reject) => { let text = ""; fs.createReadStream(path.join(dir, "sub", "app.js"), "utf8").on("data", chunk => (text += chunk)).on("end", () => resolve(text)).on("error", reject); }),
  spelledOpenSync: () => spelled.map(file => { const fd = fs.openSync(file, "r"); const size = fs.fstatSync(fd).size; fs.closeSync(fd); return size; }).join(),
  spelledReadFileSync: () => spelled.map(file => fs.readFileSync(file, "utf8")).join(),
  spelledCreateReadStream: async () => (await Promise.all(spelled.map(file => streamed({}, file)))).join(),
  spelledStatSync: () => spelled.map(file => fs.statSync(file).size).join(),
  spelledExistsSync: () => spelled.map(file => fs.existsSync(file)).join(),
  spelledBunFile: async () => (await Promise.all(spelled.map(file => Bun.file(file).text()))).join(),
  spelledRealpath: async () => [fs.realpathSync(spelled[0]) === file, fs.realpathSync.native(spelled[1]) === file, (await fs.promises.realpath(spelled[2])) === file, fs.realpathSync.native(dir + "/sub/..") === dir, fs.realpathSync.native(dir + "/") === dir].join(),
  madeFromUrl: () => fs.readFileSync(fileURLToPath(new URL(".", import.meta.url)) + "/client/hello.txt", "utf8"),
  globbed: () => [...new Bun.Glob("./*.txt").scanSync({ cwd: dir })].map(name => name + ": " + fs.readFileSync(dir + "/" + name, "utf8")).join(),
  listedThenRead: () => [dir + "/.", dir + "/sub/.."].map(folder => fs.readdirSync(folder).filter(name => name.endsWith(".txt")).map(name => fs.readFileSync(folder + "/" + name, "utf8")).join()).join(),
  compiledAndEmbedded: () => [path.join(dir, "shared.mjs"), dir + "/./shared.mjs", dir + "/sub/../shared.mjs", dir + "//shared.mjs"].map(file => fs.statSync(file).size).join(),
  forWriting: () => fs.openSync(file, "w"),
  forAppending: () => fs.openSync(file, "a"),
  spelledForRemoval: () => fs.unlinkSync(spelled[0]),
  missing: () => fs.openSync(path.join(dir, "none.txt"), "r"),
  spelledMissing: () => fs.openSync(dir + "/./none.txt", "r"),
  belowSpelled: () => [spelled[0] + "/below", spelled[0] + "/.", spelled[0] + "/../hello.txt", spelled[0] + "/", file + "/"].map(file => code(() => fs.readFileSync(file, "utf8"))).join(),
  behindNoFolder: () => [dir + "/none/../hello.txt", file + "/../hello.txt", dir + "/sub/app.js/../../hello.txt", dir + "/none/../hello.txt/below"].map(file => code(() => fs.readFileSync(file, "utf8"))).join(),
  behindFolderThatWasEmpty: () => code(() => fs.readFileSync(dir + "/empty/../hello.txt", "utf8")),
  asFolder: () => [file + "/", spelled[0] + "/", spelled[0] + "/.", file + "/x/.."].map(file => fs.existsSync(file)).join(),
  backslash: () => [spelled[0] + "\\\\", dir + "/./x\\\\..\\\\hello.txt", dir + "\\\\hello.txt", dir + "/sub\\\\deep/../hello.txt"].map(file => fs.existsSync(file)).join(),
  realpathSync: () => fs.realpathSync(file) === file,
  realpathNative: () => fs.realpathSync.native(dir) === dir,
  realpathMissing: () => fs.realpathSync(path.join(dir, "none.txt")),
};
for (const [name, run] of Object.entries(tries)) {
  try { console.log(name + ":", await run()); } catch (error) { console.log(name + ": throws", error.code); }
}
`,
  "client/hello.txt": "hello from a file",
  "client/sub/app.js": `console.log("for the browser", window.location)`,
  "client/sub/deep/down.txt": "in a folder of a folder",
  "client/shared.mjs": shared,
};

describe.skipIf(isWindows || unsupported).each([["--aot"]])("files embedded with --asset %s", (...flags) => {
  test("are opened, streamed and found by realpath", async () => {
    using dir = tempDir("compile-asset-streams", files);
    // The executable holds no folder that is empty at the build.
    mkdirSync(join(String(dir), "client", "empty"));
    const { stderr: buildErrors, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", ...flags, "./main.mjs", "--asset", "./client", "--outfile", "built"],
      String(dir),
    );
    expect({ stderr: buildExitCode ? buildErrors : "", exitCode: buildExitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { stdout, stderr, exitCode } = await run([join(String(dir), "built")], "/");
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `isStandalone: true
createReadStream: hello from a file
range: llo 
openSync: true,17,5,from 
promisesOpen: 17,hello from a file
open: number
script: console.log("for the browser", window.location)
spelledOpenSync: 17,17,17
spelledReadFileSync: hello from a file,hello from a file,hello from a file
spelledCreateReadStream: hello from a file,hello from a file,hello from a file
spelledStatSync: 17,17,17
spelledExistsSync: true,true,true
spelledBunFile: hello from a file,hello from a file,hello from a file
spelledRealpath: true,true,true,true,true
madeFromUrl: hello from a file
globbed: ./hello.txt: hello from a file
listedThenRead: hello from a file,hello from a file
compiledAndEmbedded: ${shared.length},${shared.length},${shared.length},${shared.length}
forWriting: throws EROFS
forAppending: throws EROFS
spelledForRemoval: throws EROFS
missing: throws ENOENT
spelledMissing: throws ENOENT
belowSpelled: ENOTDIR,ENOTDIR,ENOTDIR,ENOTDIR,ENOTDIR
behindNoFolder: ENOENT,ENOTDIR,ENOTDIR,ENOENT
behindFolderThatWasEmpty: ENOENT
asFolder: false,false,false,false
backslash: false,false,false,false
realpathSync: true
realpathNative: true
realpathMissing: throws ENOENT
`,
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("are served in ranges", async () => {
    const program = `import path from "node:path";
const file = path.join(import.meta.dirname, "client", "hello.txt");
using server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(file)) });
for (const [path, method, range] of [["/", "GET", "bytes=2-5"], ["/", "GET", "bytes=-4"], ["/", "GET", "bytes=6-"], ["/", "GET", "bytes=99-"], ["/", "HEAD", "bytes=2-5"], ["/", "POST", "bytes=2-5"], ["/", "GET", undefined]]) {
  const response = await fetch(new URL(path, server.url), { method, headers: range ? { range } : {} });
  console.log(path, method, range, "->", response.status, response.headers.get("content-range"), response.headers.get("accept-ranges"), response.headers.get("content-length"), JSON.stringify(await response.text()));
}
`;
    using dir = tempDir("compile-asset-ranges", { ...files, "main.mjs": program });
    await using plain = Bun.spawn({
      cmd: [bunExe(), "run", "./main.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const expected = {
      stdout: await plain.stdout.text(),
      stderr: await plain.stderr.text(),
      exitCode: await plain.exited,
    };
    expect(expected.stdout).toStartWith(`/ GET bytes=2-5 -> 206 bytes 2-5/17 bytes 4 "llo "\n`);
    const { stderr: buildErrors, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", ...flags, "./main.mjs", "--asset", "./client", "--outfile", "built"],
      String(dir),
    );
    expect({ stderr: buildExitCode ? buildErrors : "", exitCode: buildExitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { stdout, stderr, exitCode } = await run([join(String(dir), "built")], "/");
    expect({ stdout, stderr, exitCode }).toEqual(expected);
  }, 120_000);
});

// On every platform the executable prints what `bun run` prints.
test.skipIf(unsupported)(
  "a file embedded with --asset --aot is found by a path with an empty part, a `.` or a `..` in it, as on disk",
  async () => {
    using dir = tempDir("compile-asset-parts", {
      "main.mjs": `import fs from "node:fs";
import path from "node:path";
const dir = path.join(import.meta.dirname, "client");
const file = path.join(dir, "hello.txt");
const attempt = run => { try { return run(); } catch (error) { return error.code; } };
for (const spelled of [dir + "/./hello.txt", dir + "/sub/../hello.txt", dir + "//hello.txt", [dir, ".", "hello.txt"].join(path.sep), [dir, "sub", "..", "hello.txt"].join(path.sep)]) {
  const descriptor = fs.openSync(spelled, "r");
  const size = fs.fstatSync(descriptor).size;
  fs.closeSync(descriptor);
  console.log([fs.readFileSync(spelled, "utf8"), size, fs.statSync(spelled).size, fs.existsSync(spelled), fs.accessSync(spelled) ?? "ok", await Bun.file(spelled).text(), fs.realpathSync.native(spelled) === fs.realpathSync.native(file)].join(" | "));
}
console.log("missing:", attempt(() => fs.readFileSync(dir + "/./none.txt", "utf8")));
console.log("below a file:", attempt(() => fs.readFileSync(dir + "/./hello.txt/below", "utf8")));
console.log("behind what is no folder:", attempt(() => fs.readFileSync(dir + "/none/../hello.txt", "utf8")), attempt(() => fs.readFileSync(file + "/../hello.txt", "utf8")));
`,
      "client/hello.txt": "hello from a file",
      "client/sub/app.js": `console.log("for the browser")`,
    });
    const plain = await run([bunExe(), "run", "./main.mjs"], String(dir));
    const found = "hello from a file | 17 | 17 | true | ok | hello from a file | true\n";
    expect(plain.stdout).toStartWith(found + found + found + found + found + "missing: ENOENT\n");
    // Windows takes a `..` out of the text of a path, so there the last line reads the file twice.
    if (!isWindows) {
      expect(plain.stdout).toEndWith("below a file: ENOTDIR\nbehind what is no folder: ENOENT ENOTDIR\n");
    }
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--asset", "./client", "--outfile", "built.exe"],
      String(dir),
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run([join(String(dir), "built.exe")], String(dir))).toEqual(plain);
  },
  120_000,
);
