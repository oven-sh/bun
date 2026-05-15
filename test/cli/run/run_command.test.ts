import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, tempDir, tempDirWithFiles } from "harness";
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

  return {
    compileSupported: compile.exitCode === 0 && existsSync(helperPath),
    helperPath,
  };
}

function prepareLandlockFixture(root: string) {
  const testBase = join(root, "parent", "project");
  const { compileSupported, helperPath } = compileLandlockHelper(root);
  if (!compileSupported) {
    return { helperPath, testBase };
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
  if (!stdout.includes("LANDLOCK_UNSUPPORTED")) {
    expect(stdout).toContain("/:ERR:13");
    expect(stdout).toContain(`${testBase}:OK`);
    expect(check.exitCode).toBe(0);
  }

  return { helperPath, testBase };
}

function canUseLandlock() {
  if (!isLinux) return false;

  const root = tempDirWithFiles("run-landlock-probe", {});
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

    const stdout = check.stdout.toString();
    return check.exitCode === 0 && stdout.includes("/:ERR:13") && stdout.includes(`${testBase}:OK`);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
}

// https://github.com/oven-sh/bun/issues/28220
// `bun run` should work when cwd is readable but one or more ancestors are
// inaccessible, as can happen inside Landlock-style sandboxes.
describe.skipIf(!canUseLandlock())("bun run in a Landlock sandbox", () => {
  test("works when ancestor directories are inaccessible", () => {
    using root = tempDir("run-landlock-ancestors", {});
    const { helperPath, testBase } = prepareLandlockFixture(String(root));

    writeFileSync(join(testBase, "index.js"), "console.log(require('path').join('a', 'b', 'c'));\n");

    const result = Bun.spawnSync({
      cmd: [helperPath, testBase, dirname(bunExe()), bunExe(), "run", "index.js"],
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
      cmd: [helperPath, allowedBase, dirname(bunExe()), bunExe(), "run", "index.js"],
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
