import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "../aot/harness/commands";
import { run } from "../aot/harness/run";

const files = {
  "main.mjs": `import fs from "node:fs";
import path from "node:path";
const dir = path.join(import.meta.dirname, "client");
const file = path.join(dir, "hello.txt");
const streamed = (options, from = file) => new Promise((resolve, reject) => { let text = ""; fs.createReadStream(from, { encoding: "utf8", ...options }).on("data", chunk => (text += chunk)).on("end", () => resolve(text)).on("error", reject); });
const code = run => { try { run(); return "fine"; } catch (error) { return error.code; } };
// A path with an empty part, "." or ".." in it names what the path without them names.
const spelled = [dir + "/./hello.txt", dir + "/sub/../hello.txt", dir + "//hello.txt"];
const tries = {
  isStandalone: () => Bun.isStandaloneExecutable && file.startsWith("/$bunfs/"),
  createReadStream: () => streamed({}),
  range: () => streamed({ start: 2, end: 5 }),
  openSync: () => { const fd = fs.openSync(file, "r"); const bytes = Buffer.alloc(5); const stats = fs.fstatSync(fd); const read = fs.readSync(fd, bytes, 0, 5, 6); fs.closeSync(fd); return [stats.isFile(), stats.size, read, bytes.toString()].join(); },
  promisesOpen: async () => { const handle = await fs.promises.open(file); try { return [(await handle.stat()).size, (await handle.readFile("utf8"))].join(); } finally { await handle.close(); } },
  open: () => new Promise((resolve, reject) => fs.open(file, (error, fd) => (error ? reject(error) : (fs.closeSync(fd), resolve(typeof fd))))),
  script: () => new Promise((resolve, reject) => { let text = ""; fs.createReadStream(path.join(dir, "sub", "app.js"), "utf8").on("data", chunk => (text += chunk)).on("end", () => resolve(text)).on("error", reject); }),
  spelledOpenSync: () => spelled.map(from => { const fd = fs.openSync(from, "r"); const size = fs.fstatSync(fd).size; fs.closeSync(fd); return size; }).join(),
  spelledReadFileSync: () => spelled.map(from => fs.readFileSync(from, "utf8")).join(),
  spelledCreateReadStream: async () => (await Promise.all(spelled.map(from => streamed({}, from)))).join(),
  spelledStat: () => spelled.map(from => [fs.statSync(from).size, fs.existsSync(from), code(() => fs.accessSync(from))].join()).join(" "),
  spelledReaddirSync: () => ["/.", "/sub/..", "/./sub", "//sub"].map(rest => fs.readdirSync(dir + rest).sort().join("+")).join(),
  spelledForWriting: () => spelled.map(from => code(() => fs.writeFileSync(from, "x"))).join(),
  spelledRealpathNative: () => [...spelled.map(from => fs.realpathSync.native(from) === file), fs.realpathSync.native(dir + "/sub/..") === dir].join(),
  // The executable has no folder that the build left out, so ".." removes a name that it does not hold.
  pastAbsentName: () => [fs.readFileSync(dir + "/none/../hello.txt", "utf8"), fs.readdirSync(dir + "/none/..").sort().join("+")].join(),
  belowFile: () => ["/", "/.", "/..", "/../hello.txt", "/none/.."].map(rest => [code(() => fs.openSync(file + rest, "r")), code(() => fs.statSync(file + rest)), code(() => fs.readdirSync(file + rest))].join()).join(" "),
  outsideTheRoot: () => fs.existsSync(import.meta.dirname + "/../.." + process.execPath),
  pathAsWritten: () => { try { fs.openSync(dir + "/./none.txt", "r"); } catch (error) { return [error.path === dir + "/./none.txt", fs.readdirSync(dir + "/./sub", { withFileTypes: true })[0].parentPath === dir + "/./sub"].join(); } },
  forWriting: () => fs.openSync(file, "w"),
  forAppending: () => fs.openSync(file, "a"),
  missing: () => fs.openSync(path.join(dir, "none.txt"), "r"),
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
};

describe.skipIf(isWindows || unsupported).each([["--aot"]])("files embedded with --asset %s", (...flags) => {
  test("are opened, streamed and found by realpath", async () => {
    using dir = tempDir("compile-asset-streams", files);
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
spelledStat: 17,true,fine 17,true,fine 17,true,fine
spelledReaddirSync: hello.txt+sub,hello.txt+sub,app.js,app.js
spelledForWriting: EROFS,EROFS,EROFS
spelledRealpathNative: true,true,true,true
pastAbsentName: hello from a file,hello.txt+sub
belowFile: ENOTDIR,ENOTDIR,ENOTDIR ENOTDIR,ENOTDIR,ENOTDIR ENOTDIR,ENOTDIR,ENOTDIR ENOTDIR,ENOTDIR,ENOTDIR ENOTDIR,ENOTDIR,ENOTDIR
outsideTheRoot: false
pathAsWritten: true,true
forWriting: throws EROFS
forAppending: throws EROFS
missing: throws ENOENT
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
