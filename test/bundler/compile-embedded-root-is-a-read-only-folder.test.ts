import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "../aot/harness/run";

/** Builds `main.ts` of `dir` into an executable with `bun build --compile` and runs it there. */
async function buildAndRun(dir: string) {
  const executable = join(dir, isWindows ? "main.exe" : "main");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", join(dir, "main.ts"), "--outfile", executable],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
  return runCommand([executable], dir);
}

// `bun build --compile` without any other flag: the folder that holds the embedded files acts like a folder of a
// read-only file system.
test.skipIf(isWindows)("the embedded root of an executable can be entered and cannot be written to", async () => {
  using dir = tempDir("compile-embedded-root", {
    "asset.txt": "hello asset",
    "main.ts": `
      import fs from "node:fs";
      import path from "node:path";
      import asset from "./asset.txt" with { type: "file" };
      const root = import.meta.dir;
      const code = (run: () => unknown) => { try { run(); return "fine"; } catch (error: any) { return error.code; } };
      const before = process.cwd();
      const result: Record<string, unknown> = {};
      result.chdir = code(() => process.chdir(root));
      result.cwdIsRoot = process.cwd() === root;
      result.resolve = path.resolve("x") === path.join(root, "x");
      result.relativeRead = fs.readFileSync(path.basename(asset), "utf8");
      result.childStartsOutside = String(Bun.spawnSync(["pwd"]).stdout).trim() === before;
      result.chdirIntoFile = code(() => process.chdir(asset));
      result.chdirNowhere = code(() => process.chdir(root + "/nowhere"));
      result.glob = [...new Bun.Glob("*.txt").scanSync()].map(name => fs.readFileSync(name, "utf8"));
      result.globInRelativeCwd = [...new Bun.Glob("*.txt").scanSync({ cwd: "." })].length;
      fs.symlinkSync("target.txt", path.join(before, "link"));
      result.symlinkTarget = fs.readlinkSync(path.join(before, "link"));
      result.chdirOutByRelativePath = code(() => process.chdir(path.relative(root, before)));
      result.outByRelativePath = process.cwd() === before;
      process.chdir(root);
      process.chdir(before);
      result.back = process.cwd() === before;
      result.writeFresh = code(() => fs.writeFileSync(root + "/fresh", "x"));
      result.writeOver = code(() => fs.writeFileSync(asset, "x"));
      result.mkdirFresh = code(() => fs.mkdirSync(root + "/fresh"));
      result.mkdirRoot = code(() => fs.mkdirSync(root));
      result.mkdirRootRecursive = code(() => fs.mkdirSync(root, { recursive: true }));
      result.mkdirDeepRecursive = code(() => fs.mkdirSync(root + "/a/b", { recursive: true }));
      result.unlink = code(() => fs.unlinkSync(asset));
      result.rmForce = code(() => fs.rmSync(asset, { force: true }));
      result.rmForceNothing = code(() => fs.rmSync(root + "/nowhere", { force: true }));
      result.rename = code(() => fs.renameSync(asset, asset + "2"));
      result.chmod = code(() => fs.chmodSync(asset, 0o600));
      result.bunWrite = await Bun.write(asset, "x").then(() => "fine", error => error.code);
      result.stillThere = fs.readFileSync(asset, "utf8");
      console.log(JSON.stringify(result));
    `,
  });
  const { stdout, stderr, exitCode } = await buildAndRun(String(dir));
  expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    result: {
      chdir: "fine",
      cwdIsRoot: true,
      resolve: true,
      relativeRead: "hello asset",
      childStartsOutside: true,
      chdirIntoFile: "ENOTDIR",
      chdirNowhere: "ENOENT",
      glob: ["hello asset"],
      globInRelativeCwd: 1,
      symlinkTarget: "target.txt",
      chdirOutByRelativePath: "fine",
      outByRelativePath: true,
      back: true,
      writeFresh: "EROFS",
      writeOver: "EROFS",
      mkdirFresh: "EROFS",
      mkdirRoot: "EEXIST",
      mkdirRootRecursive: "fine",
      mkdirDeepRecursive: "EROFS",
      unlink: "EROFS",
      rmForce: "EROFS",
      rmForceNothing: "fine",
      rename: "EROFS",
      chmod: "EROFS",
      bunWrite: "EROFS",
      stillThere: "hello asset",
    },
    stderr: "",
    exitCode: 0,
  });
});

// The argument of `fs.mkdtemp` is the start of a name: the system puts six characters of its own behind it, in the
// same component. Where the working directory is the embedded root, a relative one starts there as a path does, and
// an error names it as the program wrote it.
test("fs.mkdtemp takes a relative prefix from the embedded root as the start of a name", async () => {
  using dir = tempDir("compile-embedded-root-mkdtemp", {
    "over/work/keep.txt": "",
    "main.ts": `
      import fs from "node:fs";
      import path from "node:path";
      const root = import.meta.dir;
      const work = path.join(process.cwd(), "over", "work");
      // The end of a template. glibc leaves its own six characters there when it fails.
      const suffix = Buffer.alloc(6, "X").toString();
      const masked = (text: string) => text.replace(/[A-Za-z0-9]{6}(?='?$)/, suffix);
      // What a call made is removed again. It is named from the folder "work".
      const row = async (make: () => any) => {
        try {
          const made = await make();
          const real = fs.realpathSync(typeof made === "string" ? made : made.path);
          fs.rmdirSync(real);
          return { made: masked(path.relative(work, real)) };
        } catch (error: any) {
          return { code: error.code, syscall: error.syscall, path: masked(error.path), message: masked(error.message) };
        }
      };
      const forms: Record<string, (prefix: string) => unknown> = {
        "mkdtempSync": prefix => fs.mkdtempSync(prefix),
        "mkdtempSync, Buffer": prefix => fs.mkdtempSync(Buffer.from(prefix)),
        "mkdtemp": prefix => new Promise((resolve, reject) => fs.mkdtemp(prefix, (error, made) => (error ? reject(error) : resolve(made)))),
        "promises.mkdtemp": prefix => fs.promises.mkdtemp(prefix),
        "mkdtempDisposableSync": prefix => fs.mkdtempDisposableSync(prefix),
        "promises.mkdtempDisposable": prefix => fs.promises.mkdtempDisposable(prefix),
      };
      // On Windows the embedded root is on a drive of its own: no relative path leads from there to the disk.
      const toWork = path.relative(root, work);
      const leadsToDisk = !path.isAbsolute(toWork);
      const away = leadsToDisk ? toWork : "../..";
      const result: Record<string, unknown> = { away };
      result["on the disk"] = await row(() => fs.mkdtempSync(away + "/missing/tmp-"));
      process.chdir(root);
      for (const [name, mkdtemp] of Object.entries(forms)) result[name] = await row(() => mkdtemp(away + "/missing/tmp-"));
      result["ends in a separator"] = await row(() => fs.mkdtempSync(away + "/missing/"));
      if (leadsToDisk) {
        result["ends in ."] = await row(() => fs.mkdtempSync(away + "/."));
        result["ends in .."] = await row(() => fs.mkdtempSync(away + "/.."));
        result["ends in .. below nothing"] = await row(() => fs.mkdtempSync(away + "/nothing/.."));
      }
      result[".. from the embedded root"] = await row(() => fs.mkdtempSync(".."));
      result[".. from the embedded root, Buffer"] = await row(() => fs.mkdtempSync(Buffer.from("..")));
      result["in the embedded root"] = await row(() => fs.mkdtempSync("tmp-"));
      result["in a folder that the embedded root lacks"] = await row(() => fs.mkdtempSync("nothing/"));
      result["empty"] = await row(() => fs.mkdtempSync(""));
      console.log(JSON.stringify(result));
    `,
  });
  const { stdout, stderr, exitCode } = await buildAndRun(String(dir));
  const result = JSON.parse(stdout || "{}");
  const away: string = result.away;
  const suffix = Buffer.alloc(6, "X").toString();
  const failed = (code: string, text: string, path: string) => ({
    code,
    syscall: "mkdtemp",
    path,
    message: `${code}: ${text}, mkdtemp '${path}'`,
  });
  const nothingThere = failed("ENOENT", "no such file or directory", `${away}/missing/tmp-${suffix}`);
  const readOnly = (prefix: string) => failed("EROFS", "read-only file system", prefix + suffix);
  expect({ result, stderr, exitCode }).toEqual({
    result: {
      away: expect.stringMatching(/^\.\.\/\.\./),
      "on the disk": nothingThere,
      "mkdtempSync": nothingThere,
      "mkdtempSync, Buffer": nothingThere,
      "mkdtemp": nothingThere,
      "promises.mkdtemp": nothingThere,
      "mkdtempDisposableSync": nothingThere,
      "promises.mkdtempDisposable": nothingThere,
      "ends in a separator": failed("ENOENT", "no such file or directory", `${away}/missing/${suffix}`),
      ...(!isWindows && {
        "ends in .": { made: "." + suffix },
        "ends in ..": { made: ".." + suffix },
        "ends in .. below nothing": failed("ENOENT", "no such file or directory", `${away}/nothing/..${suffix}`),
      }),
      ".. from the embedded root": readOnly(".."),
      ".. from the embedded root, Buffer": readOnly(".."),
      "in the embedded root": readOnly("tmp-"),
      "in a folder that the embedded root lacks": failed("ENOENT", "no such file or directory", "nothing/" + suffix),
      "empty": failed("EINVAL", "invalid argument", suffix.slice(1)),
    },
    stderr: "",
    exitCode: 0,
  });
});
