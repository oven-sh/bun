import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { bunEnv, bunExe, isLinux, tempDir, tempDirWithFiles } from "harness";

// https://github.com/oven-sh/bun/issues/28220
//
// Reproduces a sandboxed environment where the cwd itself is accessible, but
// one or more ancestors are not. `bun run` should not fail just because
// parent directories are unreadable.

const LANDLOCK_HELPER_SRC = `
#define _GNU_SOURCE
#include <linux/landlock.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

#ifndef __NR_landlock_create_ruleset
#define __NR_landlock_create_ruleset 444
#endif
#ifndef __NR_landlock_add_rule
#define __NR_landlock_add_rule 445
#endif
#ifndef __NR_landlock_restrict_self
#define __NR_landlock_restrict_self 446
#endif

static int add_path_rule(int ruleset_fd, const char *path, __u64 access) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) return -1;
    struct landlock_path_beneath_attr attr = { .allowed_access = access, .parent_fd = fd };
    int ret = syscall(__NR_landlock_add_rule, ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &attr, 0);
    close(fd);
    return ret;
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "Usage: %s <allowed_dir> <bun_dir> <cmd> [args...]\\n", argv[0]);
        return 1;
    }

    const char *allowed_dir = argv[1];
    const char *bun_dir = argv[2];

    __u64 all_access =
        LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE |
        LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
        LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
        LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
        LANDLOCK_ACCESS_FS_MAKE_SYM;

    struct landlock_ruleset_attr ruleset_attr = { .handled_access_fs = all_access };
    int ruleset_fd = syscall(__NR_landlock_create_ruleset, &ruleset_attr, sizeof(ruleset_attr), 0);
    if (ruleset_fd < 0) {
        fprintf(stdout, "LANDLOCK_UNSUPPORTED\\n");
        return 0;
    }

    __u64 read_exec = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;

    add_path_rule(ruleset_fd, allowed_dir, all_access);
    add_path_rule(ruleset_fd, bun_dir, read_exec);
    add_path_rule(ruleset_fd, "/usr", read_exec);
    add_path_rule(ruleset_fd, "/lib", read_exec);
    add_path_rule(ruleset_fd, "/lib64", read_exec);
    add_path_rule(ruleset_fd, "/etc", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR);
    add_path_rule(ruleset_fd, "/proc", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR);
    add_path_rule(ruleset_fd, "/sys", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR);
    add_path_rule(ruleset_fd, "/dev", read_exec | LANDLOCK_ACCESS_FS_WRITE_FILE);

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
        fprintf(stdout, "LANDLOCK_UNSUPPORTED\\n");
        return 0;
    }

    if (syscall(__NR_landlock_restrict_self, ruleset_fd, 0)) {
        fprintf(stdout, "LANDLOCK_UNSUPPORTED\\n");
        return 0;
    }
    close(ruleset_fd);

    if (strcmp(argv[3], "--self-check") == 0) {
        int fd = open("/", O_RDONLY | O_DIRECTORY);
        if (fd < 0) {
            printf("/:ERR:%d\\n", errno);
        } else {
            printf("/:OK\\n");
            close(fd);
        }

        fd = open(allowed_dir, O_RDONLY | O_DIRECTORY);
        if (fd < 0) {
            printf("%s:ERR:%d\\n", allowed_dir, errno);
        } else {
            printf("%s:OK\\n", allowed_dir);
            close(fd);
        }
        return 0;
    }

    execvp(argv[3], &argv[3]);
    perror("execvp");
    return 1;
}
`;

function compileLandlockHelper(root: string) {
  const helperDir = join(root, "landlock-helper");
  const helperPath = join(helperDir, "landlock_sandbox");
  const srcPath = join(helperDir, "landlock_sandbox.c");

  mkdirSync(helperDir, { recursive: true });
  writeFileSync(srcPath, LANDLOCK_HELPER_SRC);

  const compiler = process.env.CC || "cc";
  const compile = Bun.spawnSync({
    cmd: [compiler, "-o", helperPath, srcPath],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const compileSupported = compile.exitCode === 0 && existsSync(helperPath);
  return { compileSupported, helperPath };
}

function prepareLandlockFixture(root: string) {
  const testBase = join(root, "parent", "project");
  const { compileSupported, helperPath } = compileLandlockHelper(root);
  if (!compileSupported) {
    return { compileSupported, helperPath, landlockSupported: false, testBase };
  }

  mkdirSync(testBase, { recursive: true });

  const check = Bun.spawnSync({
    cmd: [helperPath, testBase, dirname(bunExe()), "--self-check"],
    env: bunEnv,
    cwd: testBase,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = check.stdout.toString();
  const landlockSupported = !stdout.includes("LANDLOCK_UNSUPPORTED");
  if (landlockSupported) {
    // check exit code inside if block, so we still skip cleanly for unsupported systems
    expect(check.exitCode).toBe(0);
    expect(stdout).toContain("/:ERR:13");
    expect(stdout).toContain(`${testBase}:OK`);
  }

  return { compileSupported: true, helperPath, landlockSupported, testBase };
}

function canUseLandlock() {
  if (!isLinux) return false;

  const root = tempDirWithFiles("issue-28220-probe", {});
  try {
    const testBase = join(root, "parent", "project");
    const { compileSupported, helperPath } = compileLandlockHelper(root);
    if (!compileSupported) return false;

    mkdirSync(testBase, { recursive: true });
    const check = Bun.spawnSync({
      cmd: [helperPath, testBase, dirname(bunExe()), "--self-check"],
      env: bunEnv,
      cwd: testBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    return (
      check.exitCode === 0 &&
      !check.stdout.toString().includes("LANDLOCK_UNSUPPORTED")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const landlockSupported = canUseLandlock();

describe.skipIf(!landlockSupported)("issue #28220", () => {
  test("bun run works when ancestor directories are inaccessible", () => {
    using root = tempDir("issue-28220-run", {});
    const { helperPath, testBase } = prepareLandlockFixture(String(root));

    writeFileSync(
      join(testBase, "index.js"),
      "console.log('hello from sandbox');\n",
    );

    const result = Bun.spawnSync({
      cmd: [
        helperPath,
        testBase,
        dirname(bunExe()),
        bunExe(),
        "run",
        "index.js",
      ],
      env: bunEnv,
      cwd: testBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    expect(stderr).not.toContain("CouldntReadCurrentDirectory");
    expect(stderr).not.toContain("error loading current directory");
    expect(stdout).toBe("hello from sandbox\n");
    expect(result.exitCode).toBe(0);
  });

  test("bun run with require() works when ancestor directories are inaccessible", () => {
    using root = tempDir("issue-28220-run-require", {});
    const { helperPath, testBase } = prepareLandlockFixture(String(root));

    writeFileSync(
      join(testBase, "main.js"),
      "const path = require('path');\nconsole.log(path.join('a', 'b', 'c'));\n",
    );

    const result = Bun.spawnSync({
      cmd: [
        helperPath,
        testBase,
        dirname(bunExe()),
        bunExe(),
        "run",
        "main.js",
      ],
      env: bunEnv,
      cwd: testBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    expect(stderr).not.toContain("CouldntReadCurrentDirectory");
    expect(stderr).not.toContain("error loading current directory");
    expect(stdout).toBe("a/b/c\n");
    expect(result.exitCode).toBe(0);
  });

  test("bun test works when ancestor directories are inaccessible", () => {
    using root = tempDir("issue-28220-test", {});
    const { helperPath, testBase } = prepareLandlockFixture(String(root));

    writeFileSync(
      join(testBase, "sample.test.js"),
      "import { expect, test } from 'bun:test';\n\ntest('passes', () => {\n  expect(1 + 1).toBe(2);\n});\n",
    );

    const result = Bun.spawnSync({
      cmd: [
        helperPath,
        testBase,
        dirname(bunExe()),
        bunExe(),
        "test",
        "sample.test.js",
      ],
      env: bunEnv,
      cwd: testBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    const output = stdout + stderr;

    expect(stderr).not.toContain("CouldntReadCurrentDirectory");
    expect(stderr).not.toContain("error loading current directory");
    expect(output).toContain("1 pass");
    expect(result.exitCode).toBe(0);
  });

  test("bun run still fails when the target directory itself is inaccessible", {
    timeout: 15_000,
  }, () => {
    using root = tempDir("issue-28220-unreadable-target", {});
    const { helperPath } = prepareLandlockFixture(String(root));

    const allowedBase = join(String(root), "allowed");
    const blockedBase = join(String(root), "blocked");
    mkdirSync(allowedBase, { recursive: true });
    mkdirSync(blockedBase, { recursive: true });
    writeFileSync(
      join(blockedBase, "index.js"),
      "console.log('should not run');\n",
    );

    const result = Bun.spawnSync({
      cmd: [
        helperPath,
        allowedBase,
        dirname(bunExe()),
        bunExe(),
        "run",
        "index.js",
      ],
      env: bunEnv,
      cwd: blockedBase,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    expect(stdout).not.toContain("should not run");
    expect(stderr).toContain("CouldntReadCurrentDirectory");
    expect(stderr).toContain("error loading current directory");
    expect(result.exitCode).not.toBe(0);
  });
});
