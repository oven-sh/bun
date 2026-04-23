import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";

// Test for https://github.com/oven-sh/bun/issues/28220
// `bun run` should not fatally error when ancestor directories are not readable
// (e.g. in Landlock sandboxed environments where only the CWD is accessible).

const isLinux = process.platform === "linux";

// A small C program that uses Landlock to restrict filesystem access, then execs a command.
// It grants full access to the specified directory and read/execute to system paths,
// but does NOT grant access to ancestor directories (/, /home, etc.).
// Usage: ./sandbox <allowed_cwd> <bun_dir> <cmd> [args...]
const LANDLOCK_HELPER_SRC = `
#define _GNU_SOURCE
#include <linux/landlock.h>
#include <sys/syscall.h>
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
    if (argc < 4) { fprintf(stderr, "Usage: %s <allowed_dir> <bun_dir> <cmd> [args...]\\n", argv[0]); return 1; }
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

    // Only grant access to the CWD, bun binary dir, and essential system paths.
    // Crucially, we do NOT grant access to ancestor directories of the CWD
    // (e.g., /, /home, /home/user) - this is the scenario from the bug report.
    add_path_rule(ruleset_fd, allowed_dir, all_access);
    add_path_rule(ruleset_fd, bun_dir, read_exec);
    add_path_rule(ruleset_fd, "/usr", read_exec);
    add_path_rule(ruleset_fd, "/lib", read_exec);
    add_path_rule(ruleset_fd, "/lib64", read_exec);
    add_path_rule(ruleset_fd, "/etc", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR);
    add_path_rule(ruleset_fd, "/proc", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR);
    add_path_rule(ruleset_fd, "/sys", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR);
    add_path_rule(ruleset_fd, "/dev", read_exec | LANDLOCK_ACCESS_FS_WRITE_FILE);

    if (syscall(__NR_landlock_restrict_self, ruleset_fd, 0)) {
        fprintf(stdout, "LANDLOCK_UNSUPPORTED\\n");
        return 0;
    }
    close(ruleset_fd);

    execvp(argv[3], &argv[3]);
    perror("execvp");
    return 1;
}
`;

// Use a path under /home where intermediate ancestors (/home, /home/bun-test-user)
// are NOT in the Landlock allow list. This triggers the bug because the resolver
// walks up to / and tries to openat each ancestor directory.
const TEST_BASE = "/home/bun-test-user/project";

describe.skipIf(!isLinux)("landlock sandbox", () => {
  let helperPath: string;
  let landlockSupported = true;

  // Compile the Landlock helper once before all tests
  test("compile landlock helper", () => {
    mkdirSync("/tmp/landlock-helper", { recursive: true });
    const srcPath = "/tmp/landlock-helper/landlock_sandbox.c";
    helperPath = "/tmp/landlock-helper/landlock_sandbox";

    writeFileSync(srcPath, LANDLOCK_HELPER_SRC);

    const result = Bun.spawnSync({
      cmd: ["gcc", "-o", helperPath, srcPath],
      env: bunEnv,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(helperPath)).toBe(true);

    // Check if Landlock is supported on this kernel
    mkdirSync(TEST_BASE, { recursive: true });
    writeFileSync(join(TEST_BASE, "check.js"), "console.log('ok');\n");
    const check = Bun.spawnSync({
      cmd: [helperPath, TEST_BASE, dirname(bunExe()), bunExe(), "-e", "console.log('test')"],
      env: bunEnv,
      cwd: TEST_BASE,
    });
    if (check.stdout.toString().includes("LANDLOCK_UNSUPPORTED")) {
      landlockSupported = false;
    }
  });

  test("bun run works when ancestor directories are not readable", () => {
    if (!landlockSupported) {
      console.log("Skipping: Landlock not supported on this kernel");
      return;
    }

    mkdirSync(TEST_BASE, { recursive: true });
    writeFileSync(join(TEST_BASE, "index.js"), "console.log('hello from sandbox');\n");

    const bunDir = dirname(bunExe());

    // Run bun inside Landlock sandbox: only CWD (/home/bun-test-user/project) is
    // fully accessible. Ancestor directories /, /home, /home/bun-test-user are
    // NOT accessible. Before the fix, this would fail with CouldntReadCurrentDirectory.
    const result = Bun.spawnSync({
      cmd: [helperPath, TEST_BASE, bunDir, bunExe(), "run", "index.js"],
      env: bunEnv,
      cwd: TEST_BASE,
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    expect(stdout).toBe("hello from sandbox\n");
    expect(stderr).not.toContain("CouldntReadCurrentDirectory");
    expect(stderr).not.toContain("error loading current directory");
    expect(result.exitCode).toBe(0);
  });

  test("bun run with require() works when ancestor directories are not readable", () => {
    if (!landlockSupported) {
      console.log("Skipping: Landlock not supported on this kernel");
      return;
    }

    mkdirSync(TEST_BASE, { recursive: true });
    writeFileSync(
      join(TEST_BASE, "main.js"),
      "const path = require('path');\nconsole.log(path.join('a', 'b', 'c'));\n",
    );

    const bunDir = dirname(bunExe());

    const result = Bun.spawnSync({
      cmd: [helperPath, TEST_BASE, bunDir, bunExe(), "run", "main.js"],
      env: bunEnv,
      cwd: TEST_BASE,
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    expect(stdout).toBe("a/b/c\n");
    expect(stderr).not.toContain("CouldntReadCurrentDirectory");
    expect(result.exitCode).toBe(0);
  });
});
