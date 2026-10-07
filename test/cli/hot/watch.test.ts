import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isLinux, isWindows, tempDir } from "harness";
import { readdirSync, readlinkSync, realpathSync } from "node:fs";
import { chmod, link, mkdir, readFile, readlink, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
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

// The way most editors save: write a temporary file, then rename it over the target.
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

const counterEntry = (specifier: string) =>
  `import { sh } from ${JSON.stringify(specifier)};\n` +
  `globalThis.g = (globalThis.g ?? 0) + 1;\n` +
  `console.log("EVAL g=" + globalThis.g + " shared=" + sh);\n`;

// A rename-save replaces the inode. The per-file watch stays on the old inode,
// which bun holds open, so the kernel reports nothing more for it. These
// shapes had no other signal that reached the watched file: the save and every
// later save of the file were missed, and --hot kept serving the old source.
describe.skipIf(isWindows)("picks up atomic rename-save of a module outside cwd", () => {
  for (const flag of ["--watch", "--hot"] as const) {
    test.concurrent(flag, async () => {
      await using dir = tempDir("watch-outside-cwd", {
        "app/entry.ts": counterEntry("../shared/lib.ts"),
        "shared/lib.ts": `export const sh = "V0";\n`,
      });
      const appDir = join(String(dir), "app");
      const sharedLib = join(String(dir), "shared", "lib.ts");

      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "entry.ts"],
        cwd: appDir,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const iter = forEachLine(proc.stdout);

      expect(await nextEval(iter)).toBe("EVAL g=1 shared=V0");

      await renameSave(sharedLib, `export const sh = "V1";\n`);
      const g2 = flag === "--hot" ? "2" : "1";
      expect(await nextEval(iter)).toBe(`EVAL g=${g2} shared=V1`);

      // Second rename-save on the (now new) inode.
      await renameSave(sharedLib, `export const sh = "V2";\n`);
      const g3 = flag === "--hot" ? "3" : "1";
      expect(await nextEval(iter)).toBe(`EVAL g=${g3} shared=V2`);

      proc.kill("SIGKILL");
      await proc.exited;
    });
  }

  // A module reached through a directory symlink is watched under its real
  // path, which is outside cwd here.
  test.concurrent("--hot via an in-cwd directory symlink to an out-of-cwd dir", async () => {
    await using dir = tempDir("watch-symlink-outside-cwd", {
      "app/entry.ts": counterEntry("./link/dep.ts"),
      "realdir/dep.ts": `export const sh = "V0";\n`,
    });
    const appDir = join(String(dir), "app");
    const realDep = join(String(dir), "realdir", "dep.ts");
    await symlink(join(String(dir), "realdir"), join(appDir, "link"), "dir");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: appDir,
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const iter = forEachLine(proc.stdout);

    expect(await nextEval(iter)).toBe("EVAL g=1 shared=V0");

    await renameSave(realDep, `export const sh = "V1";\n`);
    expect(await nextEval(iter)).toBe("EVAL g=2 shared=V1");

    await renameSave(realDep, `export const sh = "V2";\n`);
    expect(await nextEval(iter)).toBe("EVAL g=3 shared=V2");

    proc.kill("SIGKILL");
    await proc.exited;
  });

  // Workspace package imported by bare name from the workspace root. Everything
  // is inside cwd and the real-path parent directory is watched. The resolver
  // caches that directory under the `node_modules/lib/` spelling, so the
  // directory event for the save finds no watched file. The watcher has to
  // report the replaced file itself.
  for (const flag of ["--watch", "--hot"] as const) {
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
      const iter = forEachLine(proc.stdout);

      expect(await nextEval(iter)).toBe("EVAL g=1 shared=V0");

      await renameSave(libIndex, `export const sh = "V1";\n`);
      const g2 = flag === "--hot" ? "2" : "1";
      expect(await nextEval(iter)).toBe(`EVAL g=${g2} shared=V1`);

      await renameSave(libIndex, `export const sh = "V2";\n`);
      const g3 = flag === "--hot" ? "3" : "1";
      expect(await nextEval(iter)).toBe(`EVAL g=${g3} shared=V2`);

      proc.kill("SIGKILL");
      await proc.exited;
    });
  }
});

// kqueue reports a replaced or moved file in another way, and its directory
// events carry no names. These cases pin what the inotify backend reports.
describe.skipIf(!isLinux)("inotify watcher", () => {
  // The replaced inode keeps a link, so the file watch cannot tell that the
  // path now names another file. Only the parent-directory watch reports it.
  test.concurrent("--hot a module outside cwd that has a second hard link", async () => {
    await using dir = tempDir("watch-outside-cwd-hardlink", {
      "app/entry.ts": counterEntry("../shared/lib.ts"),
      "shared/lib.ts": `export const sh = "V0";\n`,
    });
    const appDir = join(String(dir), "app");
    const sharedLib = join(String(dir), "shared", "lib.ts");
    await link(sharedLib, sharedLib + ".hardlink");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: appDir,
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const iter = forEachLine(proc.stdout);

    expect(await nextEval(iter)).toBe("EVAL g=1 shared=V0");

    await renameSave(sharedLib, `export const sh = "V1";\n`);
    expect(await nextEval(iter)).toBe("EVAL g=2 shared=V1");

    proc.kill("SIGKILL");
    await proc.exited;
  });

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

    proc.kill("SIGKILL");
    await proc.exited;
  });

  // What the kubelet does to a ConfigMap or Secret volume. `config.json` is a
  // link to `..data/config.json` and `..data` is a link to a directory. An
  // update renames a new `..data` link over the old one and removes the old
  // directory. The watched name never changes and no file is written in place.
  test.concurrent("--watch reloads a file behind a symlink that is swapped", async () => {
    await using dir = tempDir("watch-symlink-swap", {
      "app.cjs": `console.log("EVAL v" + require("./cfg/config.json").v);\n`,
      "cfg/..1/config.json": `{"v":1}`,
    });
    const cfg = join(String(dir), "cfg");
    await symlink("..1", join(cfg, "..data"), "dir");
    await symlink("..data/config.json", join(cfg, "config.json"));
    async function update(v: number) {
      await mkdir(join(cfg, `..${v}`));
      await writeFile(join(cfg, `..${v}`, "config.json"), `{"v":${v}}`);
      const old = await readlink(join(cfg, "..data"));
      await symlink(`..${v}`, join(cfg, "..data_next"), "dir");
      await rename(join(cfg, "..data_next"), join(cfg, "..data"));
      await rm(join(cfg, old), { recursive: true });
    }

    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "app.cjs"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL v1");

    await update(2);
    expect(await nextEval(out)).toBe("EVAL v2");

    await update(3);
    while ((await nextEval(out)) !== "EVAL v3");

    proc.kill("SIGKILL");
    await proc.exited;
  });

  test.concurrent("a metadata-only change of a watched file is not reported", async () => {
    await using dir = tempDir("watch-metadata-only", {
      "app/entry.ts":
        `import "./dep.ts";\n` +
        `globalThis.g = (globalThis.g ?? 0) + 1;\n` +
        `console.log("EVAL g=" + globalThis.g);\n`,
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

    expect(await nextEval(out)).toBe("EVAL g=1");

    await chmod(dep, 0o600);
    await chmod(dep, 0o644);
    await utimes(dep, new Date(), new Date());
    // The watcher handles events in order. Once this save is reloaded, it has
    // handled the changes above.
    await renameSave(entry, (await readFile(entry, "utf8")) + "// saved\n");
    expect(await nextEval(out)).toBe("EVAL g=2");

    proc.kill("SIGKILL");
    await proc.exited;

    const reported = (await readFile(trace, "utf8"))
      .split("\n")
      .filter(Boolean)
      .flatMap(line => Object.keys(JSON.parse(line).files));
    expect(reported.some(path => path.endsWith("/app/"))).toBe(true);
    expect(reported.filter(path => path.endsWith("/dep.ts"))).toEqual([]);
  });

  // The shim makes every directory watch fail with ENOSPC, which is what
  // inotify returns when fs.inotify.max_user_watches is used up.
  const cc = Bun.which("cc") ?? Bun.which("gcc") ?? Bun.which("clang");
  describe.skipIf(!cc)("when no directory can be watched", () => {
    async function startWithoutDirectoryWatches() {
      const dir = tempDir("watch-dir-watch-fails", {
        "shim.c": `
          #define _GNU_SOURCE
          #include <dlfcn.h>
          #include <errno.h>
          #include <stdint.h>
          #include <sys/inotify.h>

          int inotify_add_watch(int fd, const char *path, uint32_t mask) {
            static int (*real)(int, const char *, uint32_t);
            if (mask & IN_ONLYDIR) {
              errno = ENOSPC;
              return -1;
            }
            if (!real) real = (int (*)(int, const char *, uint32_t))dlsym(RTLD_NEXT, "inotify_add_watch");
            return real(fd, path, mask);
          }
        `,
        "app/entry.ts": `import "./a.ts";\nimport "./b.ts";\nimport "./c.ts";\n` + counterEntry("./dep.ts"),
        "app/a.ts": `export {};\n`,
        "app/b.ts": `export {};\n`,
        "app/c.ts": `export {};\n`,
        "app/dep.ts": `export const sh = "V0";\n`,
      });
      const appDir = realpathSync(join(String(dir), "app"));
      const shim = join(String(dir), "shim.so");
      {
        await using build = spawn({
          cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(String(dir), "shim.c"), "-ldl"],
          env: bunEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        if (exitCode !== 0) throw new Error(`the shim did not compile:\n${stdout}${stderr}`);
      }

      const proc = spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
        cwd: appDir,
        env: { ...bunEnv, LD_PRELOAD: shim },
        stdio: ["ignore", "pipe", "inherit"],
      });
      const out = forEachLine(proc.stdout);
      return {
        appDir,
        proc,
        out,
        async [Symbol.asyncDispose]() {
          proc.kill("SIGKILL");
          await proc.exited;
          dir[Symbol.dispose]();
        },
      };
    }

    test.concurrent("a file is still watched", async () => {
      await using run = await startWithoutDirectoryWatches();
      expect(await nextEval(run.out)).toBe("EVAL g=1 shared=V0");

      await writeFile(join(run.appDir, "dep.ts"), `export const sh = "V1";\n`);
      expect(await nextEval(run.out)).toBe("EVAL g=2 shared=V1");
    });

    // Each of the five modules asks for the directory watch.
    test.concurrent("no attempt leaves its descriptor of the directory open", async () => {
      await using run = await startWithoutDirectoryWatches();
      expect(await nextEval(run.out)).toBe("EVAL g=1 shared=V0");

      const fds = `/proc/${run.proc.pid}/fd`;
      const openOnAppDir = readdirSync(fds).filter(fd => {
        try {
          return readlinkSync(join(fds, fd)) === run.appDir;
        } catch {
          return false;
        }
      });
      expect(openOnAppDir.length).toBeLessThanOrEqual(1);
    });
  });
});
