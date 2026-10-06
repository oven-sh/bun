// Runs in a private mount namespace (see mv.test.ts): the mounts made here end with this process.
// argv[2] is an empty directory. With no more arguments, every layout runs except `deepTree`.
// `deepTree <depth>` runs that one alone: without the fix it ends the process.
// Prints one line per layout: a JSON array of the layout name and its result.
import { $ } from "bun";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

$.nothrow();

const [root, only, depth] = process.argv.slice(2);

function mount(...args: string[]) {
  const { exitCode, stderr } = Bun.spawnSync({ cmd: ["mount", ...args], stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`mount ${args.join(" ")}: ${stderr.toString()}`);
}

// 64 inodes: a copy that does not stop ends with ENOSPC after a few dozen levels,
// under any limit on open files or stack size.
const tmpfs = (at: string, inodes = 64) => mount("-t", "tmpfs", "-o", `nr_inodes=${inodes},size=1m`, "tmpfs", at);
const bind = (from: string, at: string) => mount("--bind", from, at);

// Makes the directories, then the files. A file holds its own path.
function make(cwd: string, dirs: string[], files: string[] = []) {
  for (const dir of dirs) mkdirSync(join(cwd, dir), { recursive: true });
  for (const file of files) writeFileSync(join(cwd, file), file);
}

type Output = { stderr: Buffer; exitCode: number };

// Every path below `listed`.
function tree(r: Output, cwd: string, listed: string) {
  return {
    stderr: r.stderr.toString(),
    exitCode: r.exitCode,
    tree: (readdirSync(join(cwd, listed), { recursive: true }) as string[]).sort(),
  };
}

// The number of directories below `listed`, and every file with its content, wherever the file is now.
// The order of a directory listing decides which entries move before a refusal during the walk.
function census(r: Output, cwd: string, listed: string) {
  const entries = readdirSync(join(cwd, listed), { recursive: true, withFileTypes: true });
  return {
    stderr: r.stderr.toString(),
    exitCode: r.exitCode,
    dirs: entries.filter(entry => entry.isDirectory()).length,
    files: entries
      .filter(entry => entry.isFile())
      .map(entry => `${entry.name}: ${readFileSync(join(entry.parentPath, entry.name), "utf8")}`)
      .sort(),
  };
}

const layouts: Record<string, (cwd: string) => Promise<unknown>> = {
  // `b` is a second mount of `a`, so `b/sub` is `a/sub`.
  async secondMount(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    bind(join(cwd, "a"), join(cwd, "b"));
    make(cwd, ["a/sub"], ["a/sub/file"]);
    return tree(await $`mv a/sub b/sub`.cwd(cwd).quiet(), cwd, "a");
  },

  // The same mounts, to a new path: `b/sub/new` is `a/sub/new`.
  async secondMountNewPath(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    bind(join(cwd, "a"), join(cwd, "b"));
    make(cwd, ["a/sub"], ["a/sub/file"]);
    return tree(await $`mv a/sub b/sub/new`.cwd(cwd).quiet(), cwd, "a");
  },

  // `mv * out/`, and `out` is a mount point.
  async mountPointOperand(cwd) {
    make(cwd, ["out"], ["f1", "f2"]);
    tmpfs(join(cwd, "out"));
    return tree(await $`mv f1 f2 out out/`.cwd(cwd).quiet(), cwd, ".");
  },

  // A mount point to a new path inside itself.
  async mountPointNewPath(cwd) {
    make(cwd, ["vol"]);
    tmpfs(join(cwd, "vol"));
    make(cwd, [], ["vol/file"]);
    return tree(await $`mv vol vol/new`.cwd(cwd).quiet(), cwd, ".");
  },

  // Another file system is mounted inside the source, and the destination is that mount point.
  async mountInside(cwd) {
    make(cwd, ["a"]);
    tmpfs(join(cwd, "a"));
    make(cwd, ["a/proj/cache", "a/proj/src"], ["a/proj/top", "a/proj/src/main"]);
    tmpfs(join(cwd, "a/proj/cache"));
    return tree(await $`mv proj proj/cache/`.cwd(join(cwd, "a")).quiet(), cwd, "a");
  },

  // The same, and the destination is a new path on that file system.
  async mountInsideNewPath(cwd) {
    make(cwd, ["a"]);
    tmpfs(join(cwd, "a"));
    make(cwd, ["a/sub/mnt"], ["a/sub/top"]);
    tmpfs(join(cwd, "a/sub/mnt"));
    return tree(await $`mv a/sub a/sub/mnt/x`.cwd(cwd).quiet(), cwd, "a");
  },

  // A file system is mounted on a child of the source, but only under the second mount `b`.
  // The walk of `a/sub` does not reach it. The source still cannot go: it holds a mount point.
  async mountUnderSecondMount(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    bind(join(cwd, "a"), join(cwd, "b"));
    make(cwd, ["a/sub/p1"], ["a/sub/file"]);
    tmpfs(join(cwd, "b/sub/p1"));
    return tree(await $`mv a/sub b/sub/p1/x`.cwd(cwd).quiet(), cwd, "a");
  },

  // `b` is a mount of a child of the source, so `b/sub` is `a/sub/inner/sub`.
  // The parents of `b` do not lead to `a/sub`. Only the walk finds it.
  async mountOfChild(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    make(cwd, ["a/sub/inner", "a/sub/kept"], ["a/sub/top", "a/sub/kept/k", "a/sub/inner/deep"]);
    bind(join(cwd, "a/sub/inner"), join(cwd, "b"));
    return census(await $`mv a/sub b`.cwd(cwd).quiet(), cwd, "a");
  },

  // Not into itself: between two mounts of one file system, every entry has the `st_dev` of the destination.
  async betweenTwoMounts(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    bind(join(cwd, "a"), join(cwd, "b"));
    make(cwd, ["a/sub/deep", "a/x"], ["a/sub/file", "a/sub/deep/file"]);
    return tree(await $`mv a/sub b/x`.cwd(cwd).quiet(), cwd, "a");
  },

  // Not into itself: a chain of directories that is deeper than the stack of the thread that copies it.
  async deepTree(cwd) {
    const levels = Number(depth);
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"), 2 * levels);
    tmpfs(join(cwd, "b"), 2 * levels);
    make(cwd, [join("a/top", Buffer.alloc(2 * levels, "d/").toString())]);
    const r = await $`mv a/top b/`.cwd(cwd).quiet();
    return { stderr: r.stderr.toString(), exitCode: r.exitCode };
  },
};

for (const [name, run] of Object.entries(layouts)) {
  if (only ? name !== only : name === "deepTree") continue;
  const cwd = join(root, name);
  mkdirSync(cwd);
  console.log(JSON.stringify([name, await run(cwd)]));
}
