// Runs in a private mount namespace (see mv.test.ts), so its mounts are gone when this process exits.
// argv[2] is an empty directory. Prints one JSON line per layout: [layout name, result].
import { $ } from "bun";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

$.nothrow();

const root = process.argv[2];

function mount(...args: string[]) {
  const { exitCode, stderr } = Bun.spawnSync({ cmd: ["mount", ...args], stderr: "pipe" });
  if (exitCode !== 0) throw new Error(`mount ${args.join(" ")}: ${stderr.toString()}`);
}

// With 64 inodes, a runaway copy fails with ENOSPC after a few dozen levels.
const tmpfs = (at: string) => mount("-t", "tmpfs", "-o", "nr_inodes=64,size=1m", "tmpfs", at);
const bind = (from: string, at: string) => mount("--bind", from, at);

function make(cwd: string, dirs: string[], files: string[] = []) {
  for (const dir of dirs) mkdirSync(join(cwd, dir), { recursive: true });
  for (const file of files) writeFileSync(join(cwd, file), file);
}

const layouts: Record<string, (cwd: string) => Promise<unknown>> = {
  // `mv * out/` where `out` is a mount point.
  async mountPointOperand(cwd) {
    make(cwd, ["out"], ["f1", "f2"]);
    tmpfs(join(cwd, "out"));
    const r = await $`mv f1 f2 out out/`.cwd(cwd).quiet();
    return { stderr: r.stderr.toString(), tree: (readdirSync(cwd, { recursive: true }) as string[]).sort() };
  },

  // The destination is a new path on another file system mounted inside the source.
  async mountInsideNewPath(cwd) {
    make(cwd, ["a"]);
    tmpfs(join(cwd, "a"));
    make(cwd, ["a/sub/mnt"], ["a/sub/top"]);
    tmpfs(join(cwd, "a/sub/mnt"));
    const r = await $`mv a/sub a/sub/mnt/x`.cwd(cwd).quiet();
    return { stderr: r.stderr.toString(), tree: (readdirSync(join(cwd, "a"), { recursive: true }) as string[]).sort() };
  },

  // `b` is a bind mount of a directory inside `a/sub`, so `b`'s parents never reach `a/sub`.
  // Only walking `a/sub` finds the destination.
  async mountOfChild(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    make(cwd, ["a/sub/inner"], ["a/sub/inner/deep"]);
    bind(join(cwd, "a/sub/inner"), join(cwd, "b"));
    const r = await $`mv a/sub b`.cwd(cwd).quiet();
    return { stderr: r.stderr.toString() };
  },

  // A valid move. Both mounts are the same file system, so every entry has the destination's `st_dev`.
  async betweenTwoMounts(cwd) {
    make(cwd, ["a", "b"]);
    tmpfs(join(cwd, "a"));
    bind(join(cwd, "a"), join(cwd, "b"));
    make(cwd, ["a/sub/deep", "a/x"], ["a/sub/file", "a/sub/deep/file"]);
    const r = await $`mv a/sub b/x`.cwd(cwd).quiet();
    return { stderr: r.stderr.toString(), tree: (readdirSync(join(cwd, "a"), { recursive: true }) as string[]).sort() };
  },
};

for (const [name, run] of Object.entries(layouts)) {
  const cwd = join(root, name);
  mkdirSync(cwd);
  console.log(JSON.stringify([name, await run(cwd)]));
}
