import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, libcPathForDlopen, tempDir, tempDirWithFiles } from "harness";
import { dirname, join } from "path";

let cwd: string;

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "dev"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
});

test.if(isWindows)("[windows] A file in drive root runs", () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});

const LANDLOCK_HELPER_SRC = (libcPath: string) => `
import { dlopen, ptr } from "bun:ffi";

const libc = dlopen(${JSON.stringify(libcPath)}, {
  syscall: { args: ["i64_fast", "usize", "usize", "usize", "usize", "usize", "usize"], returns: "i64_fast" },
  prctl: { args: ["int", "usize", "usize", "usize", "usize"], returns: "int" },
  open: { args: ["ptr", "int"], returns: "int" },
  close: { args: ["int"], returns: "int" },
}).symbols;

const SYS_landlock_create_ruleset = 444;
const SYS_landlock_add_rule = 445;
const SYS_landlock_restrict_self = 446;
const LANDLOCK_RULE_PATH_BENEATH = 1;
const PR_SET_NO_NEW_PRIVS = 38;
const O_RDONLY = 0;
const O_DIRECTORY = 0x10000;
const O_CLOEXEC = 0x80000;
const O_PATH = 0x200000;

const ACCESS_EXECUTE = 1n << 0n;
const ACCESS_WRITE_FILE = 1n << 1n;
const ACCESS_READ_FILE = 1n << 2n;
const ACCESS_READ_DIR = 1n << 3n;
const ACCESS_REMOVE_DIR = 1n << 4n;
const ACCESS_REMOVE_FILE = 1n << 5n;
const ACCESS_MAKE_CHAR = 1n << 6n;
const ACCESS_MAKE_DIR = 1n << 7n;
const ACCESS_MAKE_REG = 1n << 8n;
const ACCESS_MAKE_SOCK = 1n << 9n;
const ACCESS_MAKE_FIFO = 1n << 10n;
const ACCESS_MAKE_BLOCK = 1n << 11n;
const ACCESS_MAKE_SYM = 1n << 12n;
const allAccess =
  ACCESS_EXECUTE |
  ACCESS_WRITE_FILE |
  ACCESS_READ_FILE |
  ACCESS_READ_DIR |
  ACCESS_REMOVE_DIR |
  ACCESS_REMOVE_FILE |
  ACCESS_MAKE_CHAR |
  ACCESS_MAKE_DIR |
  ACCESS_MAKE_REG |
  ACCESS_MAKE_SOCK |
  ACCESS_MAKE_FIFO |
  ACCESS_MAKE_BLOCK |
  ACCESS_MAKE_SYM;
const readExec = ACCESS_EXECUTE | ACCESS_READ_FILE | ACCESS_READ_DIR;

function cstr(value) {
  return Buffer.from(value + "\\0");
}

function rulesetAttr(access) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, access, true);
  return buffer;
}

function pathBeneathAttr(access, fd) {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setBigUint64(0, access, true);
  view.setInt32(8, fd, true);
  return buffer;
}

function addPathRule(rulesetFd, path, access) {
  const pathBytes = cstr(path);
  const fd = libc.open(ptr(pathBytes), O_PATH | O_CLOEXEC);
  if (fd < 0) return;
  const attr = pathBeneathAttr(access, fd);
  libc.syscall(SYS_landlock_add_rule, rulesetFd, LANDLOCK_RULE_PATH_BENEATH, ptr(attr), 0, 0, 0);
  libc.close(fd);
}

function openDir(path) {
  const pathBytes = cstr(path);
  return libc.open(ptr(pathBytes), O_RDONLY | O_DIRECTORY);
}

function restrictTo(allowedDir, bunDir) {
  const ruleset = rulesetAttr(allAccess);
  const rulesetFd = libc.syscall(SYS_landlock_create_ruleset, ptr(ruleset), ruleset.byteLength, 0, 0, 0, 0);
  if (rulesetFd < 0) return false;

  addPathRule(rulesetFd, allowedDir, allAccess);
  addPathRule(rulesetFd, bunDir, readExec);
  addPathRule(rulesetFd, "/usr", readExec);
  addPathRule(rulesetFd, "/lib", readExec);
  addPathRule(rulesetFd, "/lib64", readExec);
  addPathRule(rulesetFd, "/etc", ACCESS_READ_FILE | ACCESS_READ_DIR);
  addPathRule(rulesetFd, "/proc", ACCESS_READ_FILE | ACCESS_READ_DIR);
  addPathRule(rulesetFd, "/sys", ACCESS_READ_FILE | ACCESS_READ_DIR);
  addPathRule(rulesetFd, "/dev", readExec | ACCESS_WRITE_FILE);

  if (libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) !== 0) return false;
  const rc = libc.syscall(SYS_landlock_restrict_self, rulesetFd, 0, 0, 0, 0, 0);
  libc.close(rulesetFd);
  return rc === 0;
}

const [allowedDir, bunDir, modeOrCommand, ...args] = process.argv.slice(2);
if (!restrictTo(allowedDir, bunDir)) {
  console.log("LANDLOCK_UNSUPPORTED");
  process.exit(0);
}

if (modeOrCommand === "--self-check") {
  const rootFd = openDir("/");
  const allowedFd = openDir(allowedDir);
  if (rootFd >= 0) libc.close(rootFd);
  if (allowedFd >= 0) libc.close(allowedFd);
  console.log(rootFd < 0 && allowedFd >= 0 ? "LANDLOCK_OK" : "LANDLOCK_UNSUPPORTED");
  process.exit(0);
}

const result = Bun.spawnSync({
  cmd: [modeOrCommand, ...args],
  cwd: process.cwd(),
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode ?? 1);
`;

function writeLandlockHelper(root: string) {
  const helperPath = join(root, "landlock-helper.js");
  writeFileSync(helperPath, LANDLOCK_HELPER_SRC(libcPathForDlopen()));
  return helperPath;
}

function prepareLandlockFixture(root: string) {
  const testBase = join(root, "parent", "project");
  const helperPath = writeLandlockHelper(root);

  mkdirSync(testBase, { recursive: true });

  const check = Bun.spawnSync({
    cmd: [bunExe(), helperPath, testBase, dirname(bunExe()), "--self-check"],
    env: bunEnv,
    cwd: testBase,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = check.stdout.toString();
  if (stdout.includes("LANDLOCK_OK")) {
    expect(check.exitCode).toBe(0);
  }

  return { helperPath, testBase };
}

function canUseLandlock() {
  if (!isLinux) return false;

  const root = tempDirWithFiles("run-landlock-probe", {});
  try {
    const testBase = join(root, "parent", "project");
    const helperPath = writeLandlockHelper(root);

    mkdirSync(testBase, { recursive: true });
    const check = Bun.spawnSync({
      cmd: [bunExe(), helperPath, testBase, dirname(bunExe()), "--self-check"],
      env: bunEnv,
      cwd: testBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    return check.exitCode === 0 && check.stdout.toString().includes("LANDLOCK_OK");
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
}

// https://github.com/oven-sh/bun/issues/30859
// `bun run` should work when cwd is readable but one or more ancestors are
// inaccessible, as can happen inside Landlock-style sandboxes.
describe.skipIf(!canUseLandlock())("bun run in a Landlock sandbox", () => {
  test("works when ancestor directories are inaccessible", () => {
    using root = tempDir("run-landlock-ancestors", {});
    const { helperPath, testBase } = prepareLandlockFixture(String(root));

    writeFileSync(join(testBase, "index.js"), "console.log(require('path').join('a', 'b', 'c'));\n");

    const result = Bun.spawnSync({
      cmd: [bunExe(), helperPath, testBase, dirname(bunExe()), bunExe(), "run", "index.js"],
      env: bunEnv,
      cwd: testBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stdout.toString()).toBe("a/b/c\n");
    expect(result.exitCode).toBe(0);
  });

  test("still fails when the target directory itself is inaccessible", () => {
    using root = tempDir("run-landlock-target", {});
    const { helperPath } = prepareLandlockFixture(String(root));

    const allowedBase = join(String(root), "allowed");
    const blockedBase = join(String(root), "blocked");
    mkdirSync(allowedBase, { recursive: true });
    mkdirSync(blockedBase, { recursive: true });
    writeFileSync(join(blockedBase, "index.js"), "console.log('should not run');\n");

    const result = Bun.spawnSync({
      cmd: [bunExe(), helperPath, allowedBase, dirname(bunExe()), bunExe(), "run", "index.js"],
      env: bunEnv,
      cwd: blockedBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stdout.toString()).toBeEmpty();
    expect(result.stderr.toString()).toContain("CouldntReadCurrentDirectory");
    expect(result.exitCode).not.toBe(0);
  });
});
