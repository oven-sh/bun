import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isLinux, isWindows, tempDir } from "harness";
import { chmod, link, mkdir, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe.todoIf(isBroken && isWindows)("--watch works", async () => {
  for (const watchedFile of ["entry.js", "tmp.js"]) {
    test(`with ${watchedFile}`, async () => {
      await using tmpdir_ = tempDir("watch-fixture", {
        "tmp.js": "console.log('hello #1')",
        "entry.js": "import './tmp.js'",
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
      });
      await Bun.sleep(1000);
      const tmpfile = join(tmpdir_, "tmp.js");
      const process = spawn({
        cmd: [bunExe(), "--watch", join(tmpdir_, watchedFile)],
        cwd: tmpdir_,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const { stdout } = process;

      const iter = forEachLine(stdout);
      let { value: line, done } = await iter.next();
      expect(done).toBe(false);
      expect(line).toBe("hello #1");

      await writeFile(tmpfile, "console.log('hello #2')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #2");

      await writeFile(tmpfile, "console.log('hello #3')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #3");

      await writeFile(tmpfile, "console.log('hello #4')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #4");

      await writeFile(tmpfile, "console.log('hello #5')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #5");

      process.kill("SIGKILL");
      await process.exited;
    });
  }
});

// What vim and `sed -i` do: write a temporary file, then rename it over the target.
async function renameSave(path: string, content: string) {
  await writeFile(path + ".next", content);
  await rename(path + ".next", path);
}

async function nextEval(iter: AsyncIterator<string>): Promise<string> {
  while (true) {
    const { value, done } = await iter.next();
    if (done) throw new Error("stream ended before an EVAL line");
    if (value.startsWith("EVAL ")) return value;
  }
}

const counted = (rest: string) =>
  `globalThis.g = (globalThis.g ?? 0) + 1;\n` + `console.log("EVAL g=" + globalThis.g + " " + ${rest});\n`;
const counterEntry = (specifier: string) =>
  `import { sh } from ${JSON.stringify(specifier)};\n` + counted(`"shared=" + sh`);

async function watcherTrace(path: string): Promise<string[]> {
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .flatMap(line => Object.keys(JSON.parse(line).files));
}

// A rename over a file replaces its inode. The inotify watch of the file stays
// on the old inode, and the kernel reports nothing more for it while bun holds
// it open. Where no directory event leads back to the file, that save and each
// later save of the file were missed.
describe.skipIf(!isLinux)("a watched file that is replaced by rename is reloaded", () => {
  for (const flag of ["--watch", "--hot"] as const) {
    const g = (n: number) => (flag === "--hot" ? n : 1);

    test.concurrent(`${flag} a module outside cwd`, async () => {
      await using dir = tempDir("watch-outside-cwd", {
        "app/entry.ts": counterEntry("../shared/lib.ts"),
        "shared/lib.ts": `export const sh = "V0";\n`,
      });
      const sharedLib = join(String(dir), "shared", "lib.ts");

      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "entry.ts"],
        cwd: join(String(dir), "app"),
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const out = forEachLine(proc.stdout);

      expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

      await renameSave(sharedLib, `export const sh = "V1";\n`);
      expect(await nextEval(out)).toBe(`EVAL g=${g(2)} shared=V1`);

      // The watch has to be on the new inode now.
      await renameSave(sharedLib, `export const sh = "V2";\n`);
      expect(await nextEval(out)).toBe(`EVAL g=${g(3)} shared=V2`);
    });

    // The real-path directory of the package is inside cwd and is watched.
    // The resolver caches it under the `node_modules/lib/` spelling, so its
    // directory event finds no watched file.
    test.concurrent(`${flag} a workspace package imported by bare name through node_modules`, async () => {
      await using dir = tempDir("watch-workspace-bare-import", {
        "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
        "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { lib: "workspace:*" } }),
        "packages/app/entry.ts": counterEntry("lib/index.js"),
        "packages/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", main: "index.js" }),
        "packages/lib/index.js": `export const sh = "V0";\n`,
      });
      const root = String(dir);
      const libIndex = join(root, "packages", "lib", "index.js");
      await mkdir(join(root, "packages", "app", "node_modules"), { recursive: true });
      await symlink(join("..", "..", "lib"), join(root, "packages", "app", "node_modules", "lib"), "dir");

      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "packages/app/entry.ts"],
        cwd: root,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const out = forEachLine(proc.stdout);

      expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

      await renameSave(libIndex, `export const sh = "V1";\n`);
      expect(await nextEval(out)).toBe(`EVAL g=${g(2)} shared=V1`);

      await renameSave(libIndex, `export const sh = "V2";\n`);
      expect(await nextEval(out)).toBe(`EVAL g=${g(3)} shared=V2`);
    });

    test.concurrent(`${flag} the entry point, outside cwd`, async () => {
      const entry = (value: string) => counted(JSON.stringify("shared=" + value));
      await using dir = tempDir("watch-entry-outside-cwd", {
        "app/.keep": "",
        "scripts/entry.ts": entry("V0"),
      });
      const entryPath = join(String(dir), "scripts", "entry.ts");

      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "../scripts/entry.ts"],
        cwd: join(String(dir), "app"),
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const out = forEachLine(proc.stdout);

      expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

      await renameSave(entryPath, entry("V1"));
      expect(await nextEval(out)).toBe(`EVAL g=${g(2)} shared=V1`);

      await renameSave(entryPath, entry("V2"));
      expect(await nextEval(out)).toBe(`EVAL g=${g(3)} shared=V2`);
    });
  }

  // With a second hard link the replaced inode is neither removed nor
  // without a link, so only what its path names now tells that it was replaced.
  for (const hardLink of [false, true]) {
    const suffix = hardLink ? " and has a second hard link" : "";

    test.concurrent(`--hot a module that is behind a directory symlink${suffix}`, async () => {
      await using dir = tempDir("watch-symlink-outside-cwd", {
        "app/entry.ts": counterEntry("./link/dep.ts"),
        "realdir/dep.ts": `export const sh = "V0";\n`,
      });
      const appDir = join(String(dir), "app");
      const realDep = join(String(dir), "realdir", "dep.ts");
      await symlink(join(String(dir), "realdir"), join(appDir, "link"), "dir");
      if (hardLink) await link(realDep, realDep + ".hardlink");

      await using proc = spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
        cwd: appDir,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const out = forEachLine(proc.stdout);

      expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

      await renameSave(realDep, `export const sh = "V1";\n`);
      expect(await nextEval(out)).toBe("EVAL g=2 shared=V1");

      await renameSave(realDep, `export const sh = "V2";\n`);
      expect(await nextEval(out)).toBe("EVAL g=3 shared=V2");
    });
  }

  test.concurrent("--hot a module outside cwd that has a second hard link", async () => {
    await using dir = tempDir("watch-outside-cwd-hardlink", {
      "app/entry.ts": counterEntry("../shared/lib.ts"),
      "shared/lib.ts": `export const sh = "V0";\n`,
    });
    const sharedLib = join(String(dir), "shared", "lib.ts");
    await link(sharedLib, sharedLib + ".hardlink");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: join(String(dir), "app"),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

    await renameSave(sharedLib, `export const sh = "V1";\n`);
    expect(await nextEval(out)).toBe("EVAL g=2 shared=V1");
  });

  // Inside cwd the directory reports the file too. Both reports must count as one.
  test.concurrent("--hot evaluates once for three modules that are replaced in one batch", async () => {
    const dep = (name: string, value: string) => `export const ${name} = "${value}";\n`;
    await using dir = tempDir("hot-replace-batch", {
      "entry.ts":
        `import { a } from "./a.ts";\nimport { b } from "./b.ts";\nimport { c } from "./c.ts";\n` +
        counted("a + b + c"),
      "a.ts": dep("a", "a0"),
      "b.ts": dep("b", "b0"),
      "c.ts": dep("c", "c0"),
    });
    const path = (name: string) => join(String(dir), name + ".ts");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 a0b0c0");

    // The stopped process finds the three saves waiting and reads them as one batch.
    process.kill(proc.pid, "SIGSTOP");
    try {
      await renameSave(path("a"), dep("a", "a1"));
      await renameSave(path("b"), dep("b", "b1"));
      await renameSave(path("c"), dep("c", "c1"));
    } finally {
      process.kill(proc.pid, "SIGCONT");
    }
    expect(await nextEval(out)).toBe("EVAL g=2 a1b1c1");

    // A second evaluation for that batch would show here as g=3 with c1.
    await renameSave(path("c"), dep("c", "c2"));
    expect(await nextEval(out)).toBe("EVAL g=3 a1b1c2");
  });
});

// These pass without the check for a replaced file. They pin what it must not change.
describe.skipIf(!isLinux)("inotify file watch", () => {
  // The inode only gets another name and then its name back. Its watch must
  // survive the first move, or nothing reports the second.
  test.concurrent("--hot reloads when a dependency is moved away and then back", async () => {
    await using dir = tempDir("hot-move-away-and-back", {
      "entry.ts": counterEntry("./dep.ts"),
      "dep.ts": `export const sh = "V0";\n`,
    });
    const dep = join(String(dir), "dep.ts");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = forEachLine(proc.stdout);
    const err = forEachLine(proc.stderr);

    expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

    await rename(dep, dep + ".away");
    // The reload for the first move fails. Wait for it, so that the move back
    // is handled on its own.
    while (true) {
      const { value, done } = await err.next();
      if (done) throw new Error("stderr ended before the reload without dep.ts failed");
      if (value.includes("Cannot find module")) break;
    }

    await rename(dep + ".away", dep);
    expect(await nextEval(out)).toBe("EVAL g=2 shared=V0");
  });

  // The watcher handles events in order. In both cases the reload of the saved
  // entry shows that it has handled the change before it.
  test.concurrent("a metadata-only change of a watched file is not reported", async () => {
    await using dir = tempDir("watch-metadata-only", {
      "app/entry.ts": `import "./dep.ts";\n` + counted(`"entry"`),
      "app/dep.ts": `export const x = 1;\n`,
      "trace/.keep": "",
    });
    const appDir = join(String(dir), "app");
    const dep = join(appDir, "dep.ts");
    const entry = join(appDir, "entry.ts");
    const trace = join(String(dir), "trace", "events.jsonl");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: appDir,
      env: { ...bunEnv, BUN_WATCHER_TRACE: trace },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 entry");

    await chmod(dep, 0o600);
    await chmod(dep, 0o644);
    await utimes(dep, new Date(), new Date());
    await renameSave(entry, (await readFile(entry, "utf8")) + "// saved\n");
    expect(await nextEval(out)).toBe("EVAL g=2 entry");

    proc.kill("SIGKILL");
    await proc.exited;
    const reported = await watcherTrace(trace);
    expect(reported.some(path => path.endsWith("/app/"))).toBe(true);
    expect(reported.filter(path => path.endsWith("/dep.ts"))).toEqual([]);
  });

  // A removed module is not a replaced one. A program that removes a fixture
  // it imported from a temporary directory must not start again for that.
  test.concurrent("a removed file outside cwd is not reported", async () => {
    await using dir = tempDir("watch-removed-outside-cwd", {
      "app/entry.ts": counterEntry("../shared/lib.ts"),
      "shared/lib.ts": `export const sh = "V0";\n`,
      "trace/.keep": "",
    });
    const appDir = join(String(dir), "app");
    const trace = join(String(dir), "trace", "events.jsonl");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: appDir,
      env: { ...bunEnv, BUN_WATCHER_TRACE: trace },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

    await rm(join(String(dir), "shared", "lib.ts"));
    await renameSave(join(appDir, "entry.ts"), counted(`"without the import"`));
    expect(await nextEval(out)).toBe("EVAL g=2 without the import");

    proc.kill("SIGKILL");
    await proc.exited;
    const reported = await watcherTrace(trace);
    expect(reported.some(path => path.endsWith("/app/"))).toBe(true);
    expect(reported.filter(path => path.endsWith("/lib.ts"))).toEqual([]);
  });
});
