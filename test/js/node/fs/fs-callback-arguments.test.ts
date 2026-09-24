/**
 * The argument list a node:fs callback gets on success, and the value fs.accessSync() and
 * fs.promises.access() give.
 *
 * Node completes a callback operation in FSReqCallback::Resolve, which passes `null` alone when
 * the result is `undefined`:
 * https://github.com/nodejs/node/blob/v26.3.0/src/node_file.cc#L736-L741
 * Rest parameters and arguments.length see a trailing `undefined`: async's waterfall hands it to
 * the next task as its first argument.
 *
 * Two operations pass `undefined` as a result, through JS wrappers:
 * fs.stat with throwIfNoEntry: false (makeStatsCallback)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L186-L194
 * and fs.cp (util.callbackify)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L1098
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`,
 * which is where the expected values come from. It cannot import from "harness" for the same
 * reason, so it manages its own temporary directory.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

type Callback = (...args: unknown[]) => void;

let root: string;
let caseCount = 0;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-callback-arguments-"));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// Every case runs in a fresh directory holding file.txt and an empty subdir/.
function freshDir(): string {
  const dir = path.join(root, "case-" + caseCount++);
  fs.mkdirSync(path.join(dir, "subdir"), { recursive: true });
  fs.writeFileSync(path.join(dir, "file.txt"), "data");
  return dir;
}

function argumentsPassedTo(run: (cb: Callback) => void): Promise<unknown[]> {
  return new Promise(resolve => run((...args) => resolve(args)));
}

async function withFd(dir: string, run: (fd: number, cb: Callback) => void): Promise<unknown[]> {
  const fd = fs.openSync(path.join(dir, "file.txt"), "r+");
  try {
    return await argumentsPassedTo(cb => run(fd, cb));
  } finally {
    fs.closeSync(fd);
  }
}

describe("the callback of an operation with no result gets (null) alone", () => {
  const file = (dir: string) => path.join(dir, "file.txt");
  const voidOps: Record<string, (dir: string) => Promise<unknown[]>> = {
    access: dir => argumentsPassedTo(cb => fs.access(file(dir), cb)),
    "access (with mode)": dir => argumentsPassedTo(cb => fs.access(file(dir), fs.constants.R_OK, cb)),
    "symlink (3 arguments)": dir => argumentsPassedTo(cb => fs.symlink(file(dir), path.join(dir, "link-3"), cb)),
    "symlink (4 arguments)": dir =>
      argumentsPassedTo(cb => fs.symlink(file(dir), path.join(dir, "link-4"), "file", cb)),
    appendFile: dir => argumentsPassedTo(cb => fs.appendFile(file(dir), "more", cb)),
    "appendFile (file descriptor)": dir => withFd(dir, (fd, cb) => fs.appendFile(fd, "more", cb)),
    writeFile: dir => argumentsPassedTo(cb => fs.writeFile(path.join(dir, "written.txt"), "data", cb)),
    "writeFile (file descriptor)": dir => withFd(dir, (fd, cb) => fs.writeFile(fd, "data", cb)),
    copyFile: dir => argumentsPassedTo(cb => fs.copyFile(file(dir), path.join(dir, "copy.txt"), cb)),
    rename: dir => argumentsPassedTo(cb => fs.rename(file(dir), path.join(dir, "renamed.txt"), cb)),
    link: dir => argumentsPassedTo(cb => fs.link(file(dir), path.join(dir, "hardlink.txt"), cb)),
    unlink: dir => argumentsPassedTo(cb => fs.unlink(file(dir), cb)),
    rm: dir => argumentsPassedTo(cb => fs.rm(file(dir), cb)),
    "rm (recursive)": dir => argumentsPassedTo(cb => fs.rm(path.join(dir, "subdir"), { recursive: true }, cb)),
    rmdir: dir => argumentsPassedTo(cb => fs.rmdir(path.join(dir, "subdir"), cb)),
    mkdir: dir => argumentsPassedTo(cb => fs.mkdir(path.join(dir, "created"), cb)),
    "mkdir (recursive, directory already exists)": dir =>
      argumentsPassedTo(cb => fs.mkdir(path.join(dir, "subdir"), { recursive: true }, cb)),
    truncate: dir => argumentsPassedTo(cb => fs.truncate(file(dir), cb)),
    chmod: dir => argumentsPassedTo(cb => fs.chmod(file(dir), 0o644, cb)),
    // uid/gid -1 leaves ownership unchanged, so these succeed unprivileged.
    chown: dir => argumentsPassedTo(cb => fs.chown(file(dir), -1, -1, cb)),
    lchown: dir => argumentsPassedTo(cb => fs.lchown(file(dir), -1, -1, cb)),
    utimes: dir => argumentsPassedTo(cb => fs.utimes(file(dir), 1, 1, cb)),
    lutimes: dir => argumentsPassedTo(cb => fs.lutimes(file(dir), 1, 1, cb)),
    fchmod: dir => withFd(dir, (fd, cb) => fs.fchmod(fd, 0o644, cb)),
    fchown: dir => withFd(dir, (fd, cb) => fs.fchown(fd, -1, -1, cb)),
    fsync: dir => withFd(dir, (fd, cb) => fs.fsync(fd, cb)),
    fdatasync: dir => withFd(dir, (fd, cb) => fs.fdatasync(fd, cb)),
    ftruncate: dir => withFd(dir, (fd, cb) => fs.ftruncate(fd, cb)),
    futimes: dir => withFd(dir, (fd, cb) => fs.futimes(fd, 1, 1, cb)),
    close: dir => argumentsPassedTo(cb => fs.close(fs.openSync(file(dir), "r"), cb)),
  };
  if (fs.lchmod) {
    voidOps.lchmod = dir => argumentsPassedTo(cb => fs.lchmod(file(dir), 0o644, cb));
  }
  // Node 26 removed the `recursive` option of rmdir (DEP0147) and throws. Bun keeps it working through rm.
  if (process.versions.bun) {
    voidOps["rmdir (recursive)"] = dir =>
      argumentsPassedTo(cb => fs.rmdir(path.join(dir, "subdir"), { recursive: true }, cb));
  }

  for (const [name, run] of Object.entries(voidOps)) {
    test(`${name} calls back with [null]`, async () => {
      assert.deepStrictEqual(await run(freshDir()), [null]);
    });
  }
});

describe("the callback of an operation with a result gets (null, result)", () => {
  test("mkdir (recursive) passes the first directory it created", async () => {
    const first = path.join(freshDir(), "a");
    const args = await argumentsPassedTo(cb => fs.mkdir(path.join(first, "b", "c"), { recursive: true }, cb));
    assert.deepStrictEqual(args, [null, path.toNamespacedPath(first)]);
  });

  for (const bigint of [false, true]) {
    test(`stat with throwIfNoEntry: false passes undefined as the result (bigint: ${bigint})`, async () => {
      const missing = path.join(freshDir(), "missing.txt");
      const args = await argumentsPassedTo(cb => fs.stat(missing, { throwIfNoEntry: false, bigint }, cb));
      assert.deepStrictEqual(args, [null, undefined]);
    });
  }

  test("cp passes undefined as the result", async () => {
    const dir = freshDir();
    const copied = await argumentsPassedTo(cb => fs.cp(path.join(dir, "file.txt"), path.join(dir, "copy.txt"), cb));
    assert.deepStrictEqual(copied, [null, undefined]);
    const tree = await argumentsPassedTo(cb =>
      fs.cp(path.join(dir, "subdir"), path.join(dir, "subdir-copy"), { recursive: true }, cb),
    );
    assert.deepStrictEqual(tree, [null, undefined]);
  });
});

describe("a failed operation calls back with the error alone", () => {
  test("access", async () => {
    const args = await argumentsPassedTo(cb => fs.access(path.join(freshDir(), "missing.txt"), cb));
    assert.strictEqual(args.length, 1);
    const { code, syscall } = args[0] as NodeJS.ErrnoException;
    assert.deepStrictEqual({ code, syscall }, { code: "ENOENT", syscall: "access" });
  });

  test("symlink", async () => {
    const dir = freshDir();
    const taken = path.join(dir, "taken.txt");
    fs.writeFileSync(taken, "");
    const args = await argumentsPassedTo(cb => fs.symlink(path.join(dir, "file.txt"), taken, cb));
    assert.strictEqual(args.length, 1);
    const { code, syscall } = args[0] as NodeJS.ErrnoException;
    assert.deepStrictEqual({ code, syscall }, { code: "EEXIST", syscall: "symlink" });
  });
});

describe("fs.accessSync() and fs.promises.access() give undefined", () => {
  test("accessSync", () => {
    const dir = freshDir();
    assert.strictEqual(fs.accessSync(path.join(dir, "file.txt")), undefined);
    assert.strictEqual(fs.accessSync(path.join(dir, "file.txt"), fs.constants.R_OK), undefined);
    assert.strictEqual(fs.accessSync(dir), undefined);
  });

  test("promises.access", async () => {
    const dir = freshDir();
    assert.strictEqual(await fs.promises.access(path.join(dir, "file.txt")), undefined);
    assert.strictEqual(await fs.promises.access(path.join(dir, "file.txt"), fs.constants.R_OK), undefined);
    assert.strictEqual(await fs.promises.access(dir), undefined);
  });
});
