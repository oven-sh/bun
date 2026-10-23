import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "../aot/harness/run";

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
  const executable = join(String(dir), "main");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", join(String(dir), "main.ts"), "--outfile", executable],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toMatchObject({ exitCode: 0 });
  const { stdout, stderr, exitCode } = await runCommand([executable], String(dir));
  expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    result: {
      chdir: "fine",
      cwdIsRoot: true,
      resolve: true,
      relativeRead: "hello asset",
      childStartsOutside: true,
      chdirIntoFile: "ENOTDIR",
      chdirNowhere: "ENOENT",
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
