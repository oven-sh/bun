import { spawn } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isDebug, isLinux, isWindows, tempDir } from "harness";
import { rmSync, writeFileSync } from "node:fs";
import { chmod, link, mkdir, readdir, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

// A debug build of bun takes about a second to start. These tests start it up to five times, and most of them run at the same time.
if (isDebug) setDefaultTimeout(30_000);

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

async function nextLineWith(iter: AsyncIterator<string>, text: string): Promise<string> {
  while (true) {
    const { value, done } = await iter.next();
    if (done) throw new Error(`stream ended before a line with ${JSON.stringify(text)}`);
    if (value.includes(text)) return value;
  }
}

const counted = (rest: string) =>
  `globalThis.g = (globalThis.g ?? 0) + 1;\n` + `console.log("EVAL g=" + globalThis.g + " " + ${rest});\n`;
const counterEntry = (specifier: string) =>
  `import { sh } from ${JSON.stringify(specifier)};\n` + counted(`"shared=" + sh`);
const lib = (value: string) => `export const sh = "${value}";\n`;

async function watcherTrace(path: string): Promise<string[]> {
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .flatMap(line => Object.keys(JSON.parse(line).files));
}

// SIGSTOP is handled asynchronously. This returns once every thread of `pid` is stopped.
async function stopped(pid: number) {
  const state = async (tid: string) => {
    try {
      const stat = await readFile(`/proc/${pid}/task/${tid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2)[0];
    } catch {
      // The thread exited after it was listed.
      return "T";
    }
  };
  while (true) {
    const states = await Promise.all((await readdir(`/proc/${pid}/task`)).map(state));
    if (states.every(s => s === "T")) return;
    await Bun.sleep(1);
  }
}

// A rename over a file replaces its inode, and an inotify watch follows the
// inode. The kernel reports the replaced inode as deleted once nothing holds
// it open. The watcher then watches what the path names now and reports a
// write. Where no directory event leads back to the file, that save and every
// later save of the file were missed.
describe.skipIf(!isLinux)("a watched file that is replaced by rename is reloaded", () => {
  for (const flag of ["--watch", "--hot"] as const) {
    const g = (n: number) => (flag === "--hot" ? n : 1);

    test.concurrent(`${flag} a module outside cwd`, async () => {
      await using dir = tempDir("watch-outside-cwd", {
        "app/entry.ts": counterEntry("../shared/lib.ts"),
        "shared/lib.ts": lib("V0"),
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

      await renameSave(sharedLib, lib("V1"));
      expect(await nextEval(out)).toBe(`EVAL g=${g(2)} shared=V1`);

      // The watch has to be on the new inode now. Under --watch a new process watches the file.
      if (flag === "--watch") return;
      await renameSave(sharedLib, lib("V2"));
      expect(await nextEval(out)).toBe("EVAL g=3 shared=V2");
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
        "packages/lib/index.js": lib("V0"),
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

      await renameSave(libIndex, lib("V1"));
      expect(await nextEval(out)).toBe(`EVAL g=${g(2)} shared=V1`);

      if (flag === "--watch") return;
      await renameSave(libIndex, lib("V2"));
      expect(await nextEval(out)).toBe("EVAL g=3 shared=V2");
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

      if (flag === "--watch") return;
      await renameSave(entryPath, entry("V2"));
      expect(await nextEval(out)).toBe("EVAL g=3 shared=V2");
    });
  }

  test.concurrent("--hot a module that is behind a directory symlink", async () => {
    await using dir = tempDir("watch-symlink-outside-cwd", {
      "app/entry.ts": counterEntry("./link/dep.ts"),
      "realdir/dep.ts": lib("V0"),
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
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

    await renameSave(realDep, lib("V1"));
    expect(await nextEval(out)).toBe("EVAL g=2 shared=V1");

    await renameSave(realDep, lib("V2"));
    expect(await nextEval(out)).toBe("EVAL g=3 shared=V2");
  });

  // The directory event names the file, but the reloader skips a name that starts with a dot.
  test.concurrent("--hot a module in cwd whose name starts with a dot", async () => {
    await using dir = tempDir("watch-dot-name", {
      "entry.ts": counterEntry("./.settings.ts"),
      ".settings.ts": lib("V0"),
    });
    const settings = join(String(dir), ".settings.ts");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

    await renameSave(settings, lib("V1"));
    expect(await nextEval(out)).toBe("EVAL g=2 shared=V1");

    await renameSave(settings, lib("V2"));
    expect(await nextEval(out)).toBe("EVAL g=3 shared=V2");
  });

  test.concurrent("test --watch a module outside cwd", async () => {
    await using dir = tempDir("test-watch-outside-cwd", {
      "app/main.test.ts":
        `import { test } from "bun:test";\nimport { sh } from "../shared/lib.ts";\n` +
        `test("eval", () => console.log("EVAL shared=" + sh));\n`,
      "shared/lib.ts": lib("V0"),
    });
    const sharedLib = join(String(dir), "shared", "lib.ts");

    await using proc = spawn({
      cmd: [bunExe(), "test", "--watch", "main.test.ts"],
      cwd: join(String(dir), "app"),
      env: bunEnv,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL shared=V0");

    await renameSave(sharedLib, lib("V1"));
    expect(await nextEval(out)).toBe("EVAL shared=V1");
  });

  test.concurrent("build --watch a module outside cwd", async () => {
    await using dir = tempDir("build-watch-outside-cwd", {
      "app/entry.ts": `import { sh } from "../shared/lib.ts";\nconsole.log("shared=" + sh);\n`,
      "shared/lib.ts": lib("V0"),
    });
    const appDir = join(String(dir), "app");
    const sharedLib = join(String(dir), "shared", "lib.ts");

    await using proc = spawn({
      cmd: [bunExe(), "build", "--watch", "--no-clear-screen", "entry.ts", "--outfile", "out.js"],
      cwd: appDir,
      env: bunEnv,
      stdio: ["ignore", "ignore", "inherit"],
    });
    // The bundle is written again for each build, so read it until it holds the value.
    const bundled = async (value: string) => {
      const outfile = join(appDir, "out.js");
      while (!(await readFile(outfile, "utf8").catch(() => "")).includes(`"${value}"`)) await Bun.sleep(10);
    };

    await bundled("V0");

    await renameSave(sharedLib, lib("V1"));
    await bundled("V1");

    await renameSave(sharedLib, lib("V2"));
    await bundled("V2");
  });

  // Both paths hold the watch of one inode. When that inode goes away, each
  // path gets the watch of what it names now.
  test.concurrent("--hot two watched paths of one inode, after both are replaced", async () => {
    await using dir = tempDir("watch-two-paths-one-inode", {
      "app/entry.ts":
        `import { sh as a } from "../shared/a.ts";\nimport { sh as b } from "../shared/b.ts";\n` +
        counted(`"a=" + a + " b=" + b`),
      "shared/a.ts": lib("V0"),
    });
    const a = join(String(dir), "shared", "a.ts");
    const b = join(String(dir), "shared", "b.ts");
    await link(a, b);

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: join(String(dir), "app"),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 a=V0 b=V0");

    // The inode keeps the link `a.ts`, so the kernel reports nothing yet.
    await renameSave(b, lib("V1"));
    await renameSave(a, lib("V1"));
    expect(await nextEval(out)).toBe("EVAL g=2 a=V1 b=V1");

    await renameSave(b, lib("V2"));
    expect(await nextEval(out)).toBe("EVAL g=3 a=V1 b=V2");
  });

  // A writer that does not rename removes the file and then creates it again
  // (git checkout). The path names nothing in between.
  test.concurrent("--hot a module outside cwd that is removed and created again at once", async () => {
    await using dir = tempDir("watch-unlink-create", {
      "app/entry.ts": counterEntry("../shared/lib.ts"),
      "shared/lib.ts": lib("V0"),
    });
    const sharedLib = join(String(dir), "shared", "lib.ts");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: join(String(dir), "app"),
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const out = forEachLine(proc.stdout);

    expect(await nextEval(out)).toBe("EVAL g=1 shared=V0");

    for (const [n, value] of [
      [2, "V1"],
      [3, "V2"],
    ] as const) {
      rmSync(sharedLib);
      writeFileSync(sharedLib, lib(value));
      expect(await nextEval(out)).toBe(`EVAL g=${n} shared=${value}`);
    }
  });

  // When the file comes back later, no event reports it. The next reload that
  // imports the module watches it again.
  test.concurrent("--hot a module outside cwd that is removed and created again later", async () => {
    const entryText = (mark: string) =>
      `import { sh } from "../shared/lib.ts";\nconsole.log("EVAL entry=${mark} shared=" + sh);\n`;
    await using dir = tempDir("watch-removed-then-created", {
      "app/entry.ts": entryText("first"),
      "shared/lib.ts": lib("V0"),
    });
    const entry = join(String(dir), "app", "entry.ts");
    const sharedLib = join(String(dir), "shared", "lib.ts");

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "entry.ts"],
      cwd: join(String(dir), "app"),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = forEachLine(proc.stdout);
    const err = forEachLine(proc.stderr);

    expect(await nextEval(out)).toBe("EVAL entry=first shared=V0");

    // The watcher handles events in order, so the failed reload of the entry
    // shows that it has handled the removal.
    await rm(sharedLib);
    await writeFile(entry, entryText("second"));
    await nextLineWith(err, "lib.ts");

    await writeFile(sharedLib, lib("V1"));
    await writeFile(entry, entryText("third"));
    await nextLineWith(out, "EVAL entry=third shared=V1");

    await renameSave(sharedLib, lib("V2"));
    await nextLineWith(out, "EVAL entry=third shared=V2");
  });

  // The replaced inode keeps a link, so the kernel reports nothing for the
  // file. Only IN_ATTRIB on the file or the name in its directory tells that
  // the path was replaced, and neither is watched outside cwd.
  test.todo("--hot a module outside cwd that has a second hard link", async () => {
    await using dir = tempDir("watch-outside-cwd-hardlink", {
      "app/entry.ts": counterEntry("../shared/lib.ts"),
      "shared/lib.ts": lib("V0"),
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

    await renameSave(sharedLib, lib("V1"));
    expect(await nextEval(out)).toBe("EVAL g=2 shared=V1");
  });
});

// These pass on main. They pin what the change must keep.
describe.skipIf(!isLinux)("inotify file watch", () => {
  // Inside cwd the directory reports each file too. Both reports must count as one.
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
      await stopped(proc.pid);
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

  // The inode only gets another name and then its name back. Its watch must
  // survive the first move, or nothing reports the second.
  test.concurrent("--hot reloads when a dependency is moved away and then back", async () => {
    await using dir = tempDir("hot-move-away-and-back", {
      "entry.ts": counterEntry("./dep.ts"),
      "dep.ts": lib("V0"),
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

    // The reload for the first move fails. Wait for it, so that the move back
    // is handled on its own.
    await rename(dep, dep + ".away");
    await nextLineWith(err, "Cannot find module");

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
      "shared/lib.ts": lib("V0"),
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
