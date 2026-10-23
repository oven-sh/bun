// The walker reads a directory and opens the directories it listed later. One of them can
// be removed, or replaced by a file, in between. The walk continues without it, like Node's
// fs.glob (fast-glob does the same for ENOENT). Before the walk skips a directory that does
// not open, it looks at the path again. A directory that is still there is opened once more,
// and keeps its error if that fails too. The directory a walk starts in, and a directory
// that fails in another way, keep their errors.
import { Glob } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Linux fails the read of a directory that was removed after it was opened with ENOENT. A
// descriptor keeps such a directory reachable, and /proc/self/fd/<n> names it.
test.skipIf(!isLinux)("a followed link to a directory that was removed after its open is skipped", async () => {
  using dir = tempDir("glob-scan-removed-after-open", {
    "tree/top.txt": "",
    "tree/a/a.txt": "",
    "tree/z/z.txt": "",
  });
  const tree = path.join(String(dir), "tree");
  const removed = path.join(String(dir), "removed");
  fs.mkdirSync(removed);
  const fd = fs.openSync(removed, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.rmdirSync(removed);
    const removedDirectory = `/proc/self/fd/${fd}`;
    fs.symlinkSync(removedDirectory, path.join(tree, "link"));

    for (const throwErrorOnBrokenSymlink of [false, true]) {
      const options = { cwd: tree, followSymlinks: true, throwErrorOnBrokenSymlink };
      expect({
        scanSync: Array.from(new Glob("**/*.txt").scanSync(options)).sort(),
        scan: (await Array.fromAsync(new Glob("**/*.txt").scan(options))).sort(),
      }).toEqual({
        scanSync: ["a/a.txt", "top.txt", "z/z.txt"],
        scan: ["a/a.txt", "top.txt", "z/z.txt"],
      });
    }

    // The directory a walk starts in: the same read error still ends the scan.
    const errorOf = (scan: () => unknown) => {
      try {
        scan();
      } catch (e: any) {
        return { code: e.code, syscall: e.syscall };
      }
    };
    expect({
      cwd: errorOf(() => Array.from(new Glob("*.txt").scanSync({ cwd: removedDirectory }))),
      absolutePattern: errorOf(() => Array.from(new Glob(`${removedDirectory}/*.txt`).scanSync())),
    }).toEqual({
      cwd: { code: "ENOENT", syscall: "getdents64" },
      absolutePattern: { code: "ENOENT", syscall: "getdents64" },
    });
  } finally {
    fs.closeSync(fd);
  }
});

// An open can fail with ENOENT for a directory that is there: the file system is wrong for
// a moment, or another process removes the directory and makes it again. A supervisor plays
// both. It gets a seccomp notification before each open of a directory and before each stat
// of the command. Then it changes the file system and lets the kernel run the call, or it
// fails the call. bun issues these calls as raw syscalls, which LD_PRELOAD cannot interpose.
const superviseSource = /* c */ `
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

// Linux 5.5. Older kernel headers do not have it.
#ifndef SECCOMP_USER_NOTIF_FLAG_CONTINUE
  #define SECCOMP_USER_NOTIF_FLAG_CONTINUE (1UL << 0)
#endif

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

// usage: supervise [<open|stat>:<name>:<n>:<remove|mkdir|enoent>[:<path>]]... -- <cmd> [args...]
// Before the n-th open of a directory, or the n-th stat, of a path that ends with <name>
// (n = 0: before each one): remove the directory <path> and the file "v.txt" in it, or
// mkdir <path>, or fail the call with ENOENT. Exits with 77 when this machine cannot do that.
struct rule {
  int is_stat, n, count;
  const char *name, *action, *path;
};
static struct rule rules[32];
static int rule_count;

static int pass_listener(int sock, int *listener, int send) {
  char byte = 'x', control[CMSG_SPACE(sizeof(int))];
  struct iovec io = { &byte, 1 };
  struct msghdr msg = { .msg_iov = &io, .msg_iovlen = 1, .msg_control = control, .msg_controllen = sizeof control };
  memset(control, 0, sizeof control);
  if (send) {
    struct cmsghdr *header = CMSG_FIRSTHDR(&msg);
    header->cmsg_level = SOL_SOCKET;
    header->cmsg_type = SCM_RIGHTS;
    header->cmsg_len = CMSG_LEN(sizeof(int));
    memcpy(CMSG_DATA(header), listener, sizeof(int));
    return sendmsg(sock, &msg, 0) < 0 ? -1 : 0;
  }
  if (recvmsg(sock, &msg, 0) <= 0 || !CMSG_FIRSTHDR(&msg)) return -1;
  memcpy(listener, CMSG_DATA(CMSG_FIRSTHDR(&msg)), sizeof(int));
  return 0;
}

int main(int argc, char **argv) {
  int arg = 1;
  for (; arg < argc && strcmp(argv[arg], "--") != 0 && rule_count < 32; arg++) {
    struct rule *rule = &rules[rule_count++];
    rule->is_stat = strcmp(strtok(argv[arg], ":"), "stat") == 0;
    rule->name = strtok(NULL, ":");
    rule->n = atoi(strtok(NULL, ":"));
    rule->action = strtok(NULL, ":");
    rule->path = strtok(NULL, ":");
  }
  if (arg + 1 >= argc) return 2;
  if (MY_AUDIT_ARCH == 0) return 77;

  int sockets[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, sockets) != 0) return 77;
  pid_t child = fork();
  if (child == 0) {
    struct sock_filter filter[] = {
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_newfstatat, 5, 0),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_statx, 4, 0),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_openat, 0, 2),
      // openat(..., O_DIRECTORY | ...)
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
      BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, O_DIRECTORY, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF),
    };
    struct sock_fprog prog = { .len = sizeof filter / sizeof filter[0], .filter = filter };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) _exit(77);
    int listener = (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
    if (listener < 0 || pass_listener(sockets[1], &listener, 1) != 0) _exit(77);
    close(listener);
    execvp(argv[arg + 1], &argv[arg + 1]);
    perror("execvp");
    _exit(127);
  }

  close(sockets[1]);
  int listener, status, supervised = 1, exited = 0;
  struct seccomp_notif_sizes sizes;
  if (pass_listener(sockets[0], &listener, 0) != 0 || syscall(__NR_seccomp, SECCOMP_GET_NOTIF_SIZES, 0, &sizes) != 0) {
    waitpid(child, &status, 0);
    return 77;
  }
  struct seccomp_notif *request = calloc(1, sizes.seccomp_notif);
  struct seccomp_notif_resp *response = calloc(1, sizes.seccomp_notif_resp);
  for (;;) {
    struct pollfd poll_listener = { listener, POLLIN, 0 };
    int ready = poll(&poll_listener, 1, 100);
    if (ready < 0 && errno == EINTR) continue;
    if (ready == 0) {
      if (waitpid(child, &status, WNOHANG) != child) continue;
      exited = 1;
    }
    // The command is gone.
    if (ready <= 0 || !(poll_listener.revents & POLLIN)) break;
    memset(request, 0, sizes.seccomp_notif);
    if (ioctl(listener, SECCOMP_IOCTL_NOTIF_RECV, request) != 0) continue;

    char path[4096] = { 0 }, memory[64];
    snprintf(memory, sizeof memory, "/proc/%d/mem", (int)request->pid);
    int memory_fd = open(memory, O_RDONLY);
    if (memory_fd < 0) supervised = 0;
    else {
      if (pread(memory_fd, path, sizeof path - 1, (off_t)request->data.args[1]) < 0) path[0] = 0;
      close(memory_fd);
    }

    int is_stat = request->data.nr != __NR_openat, fail = 0;
    size_t path_length = strlen(path);
    for (int i = 0; i < rule_count; i++) {
      struct rule *rule = &rules[i];
      size_t name_length = strlen(rule->name);
      if (rule->is_stat != is_stat || path_length < name_length) continue;
      const char *end = path + path_length - name_length;
      if (strcmp(end, rule->name) != 0 || (end != path && end[-1] != '/')) continue;
      rule->count++;
      if (rule->n != 0 && rule->count != rule->n) continue;
      if (strcmp(rule->action, "remove") == 0) {
        char file[4096];
        snprintf(file, sizeof file, "%s/v.txt", rule->path);
        unlink(file);
        rmdir(rule->path);
      } else if (strcmp(rule->action, "mkdir") == 0) mkdir(rule->path, 0755);
      else fail = 1;
    }

    memset(response, 0, sizes.seccomp_notif_resp);
    response->id = request->id;
    if (fail) response->error = -ENOENT;
    else response->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE;
    // A kernel before 5.5 cannot let the call continue.
    if (ioctl(listener, SECCOMP_IOCTL_NOTIF_SEND, response) != 0 && errno == EINVAL) {
      kill(child, SIGKILL);
      supervised = 0;
    }
  }
  if (!exited) waitpid(child, &status, 0);
  if (!supervised) return 77;
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
`;

// The supervisor. It is undefined when this machine cannot build it or cannot run it, and
// the tests that need it are skipped. test.skipIf reads it when the file loads, so the
// build runs here. A build that fails in another way is an error that fails only those tests.
const superviseDir = isLinux && cc ? tempDir("glob-scan-supervise", { "supervise.c": superviseSource }) : undefined;
const supervise = ((): string | Error | undefined => {
  if (!superviseDir) return;
  try {
    const bin = path.join(String(superviseDir), "supervise");
    const compile = Bun.spawnSync({
      cmd: [cc!, "-o", bin, path.join(String(superviseDir), "supervise.c")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (compile.exitCode !== 0) {
      const output = compile.stderr.toString();
      // The kernel headers are not installed, or they are older than Linux 5.0.
      const headers =
        /fatal error: .?(linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h).?:? (No such file|file not found)|seccomp_notif|SECCOMP_/;
      if (headers.test(output)) return;
      return new Error(`Failed to build the seccomp supervisor:\n${output}`);
    }
    // "ls" opens a directory, so the supervisor gets a notification and lets the call continue.
    const probe = Bun.spawnSync({ cmd: [bin, "--", "ls", "/"], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    if (probe.exitCode === 77) return;
    if (probe.exitCode !== 0) return new Error(`The seccomp supervisor failed:\n${probe.stderr.toString()}`);
    return bin;
  } catch (e) {
    return e as Error;
  }
})();

async function runSupervised(rules: string[], cwd: string) {
  if (supervise instanceof Error) throw supervise;
  await using proc = Bun.spawn({
    cmd: [supervise!, ...rules, "--", bunExe(), "glob-fixture.js"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const superviseFixture = (body: string) => `
import { Glob } from "bun";
import fs from "node:fs";
import path from "node:path";

const styles = {
  "relative": root => ["**/*.txt", { cwd: root }],
  "absolute": root => ["**/*.txt", { cwd: root, absolute: true }],
  "absolute pattern": root => [root + "/**/*.txt", {}],
};
const modes = {
  scanSync: (pattern, options) => Array.from(new Glob(pattern).scanSync(options)),
  scan: (pattern, options) => Array.fromAsync(new Glob(pattern).scan(options)),
};
const out = {};
let trees = 0;
for (const [mode, scan] of Object.entries(modes)) {
  for (const [style, args] of Object.entries(styles)) {
    ${body}
  }
}
console.log(JSON.stringify(out));
`;

test.concurrent.skipIf(!supervise)("a directory that is still there is opened again", async () => {
  using dir = tempDir("glob-scan-open-again", {
    "glob-fixture.js": superviseFixture(`
    const i = trees++;
    const root = path.resolve("tree-" + i);
    const madeAgain = path.join(root, "made-again-" + i);
    let result;
    try {
      result = (await scan(...args(root))).map(match => path.relative(root, path.resolve(root, match))).sort();
    } catch (e) {
      result = { code: e.code, syscall: e.syscall };
    }
    out[mode + ", " + style] = {
      scan: result,
      madeAgain: !fs.existsSync(madeAgain) ? "missing" : fs.existsSync(madeAgain + "/v.txt") ? "not empty" : "empty",
    };`),
  });
  const root = fs.realpathSync(String(dir));
  const rules: string[] = [];
  const expected: Record<string, unknown> = {};
  let trees = 0;
  for (const mode of ["scanSync", "scan"]) {
    for (const style of ["relative", "absolute", "absolute pattern"]) {
      const i = trees++;
      const tree = path.join(root, `tree-${i}`);
      const madeAgain = path.join(tree, `made-again-${i}`);
      fs.mkdirSync(madeAgain, { recursive: true });
      fs.mkdirSync(path.join(tree, "keep"));
      fs.mkdirSync(path.join(tree, `fails-once-${i}`));
      for (const file of ["top.txt", "keep/k.txt", `made-again-${i}/v.txt`, `fails-once-${i}/f.txt`]) {
        fs.writeFileSync(path.join(tree, file), "");
      }
      rules.push(
        // Removed before its first open, and made again before the stat that follows.
        `open:made-again-${i}:1:remove:${madeAgain}`,
        `stat:made-again-${i}:0:mkdir:${madeAgain}`,
        // Its first open fails with ENOENT. The directory does not change.
        `open:fails-once-${i}:1:enoent`,
      );
      // The walk lists the directory that was made again, which has no "v.txt".
      expected[`${mode}, ${style}`] = {
        scan: [`fails-once-${i}/f.txt`, "keep/k.txt", "top.txt"],
        madeAgain: "empty",
      };
    }
  }

  const { stdout, stderr, exitCode } = await runSupervised(rules, root);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(expected);
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!supervise)("a directory that is still there and does not open keeps its error", async () => {
  using dir = tempDir("glob-scan-open-enoent", {
    "glob-fixture.js": superviseFixture(`
    const root = path.resolve("tree");
    try {
      out[mode + ", " + style] = await scan(...args(root));
    } catch (e) {
      out[mode + ", " + style] = { code: e.code, syscall: e.syscall, path: path.relative(root, path.resolve(root, e.path)) };
    }`),
    "tree/top.txt": "",
    "tree/sub/s.txt": "",
  });

  // Each open of "sub" fails with ENOENT.
  const { stdout, stderr, exitCode } = await runSupervised(["open:sub:0:enoent"], String(dir));
  expect(stderr).toBe("");

  const error = { code: "ENOENT", syscall: "open", path: "sub" };
  expect(JSON.parse(stdout)).toEqual({
    "scanSync, relative": error,
    "scanSync, absolute": error,
    "scanSync, absolute pattern": error,
    "scan, relative": error,
    "scan, absolute": error,
    "scan, absolute pattern": error,
  });
  expect(exitCode).toBe(0);
});

// A concurrent remover is a race, so a shim plays it from inside getdents64(2). Below the
// directory in SCAN_GONE_ROOT it really removes, replaces or renames the directories and
// links with the names below, and the kernel itself produces those errors. Only
// "fails-to-read" is an error that the shim makes up. bun issues getdents64 through libc's
// syscall(), which LD_PRELOAD can interpose.
const shimSource = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*next_syscall)(long, ...);

// Removes the sub-directory "name" of the directory that "fd" refers to.
static int remove_child(int fd, const char *name) {
  char file[NAME_MAX];
  snprintf(file, sizeof file, "%s/v.txt", name);
  unlinkat(fd, file, 0);
  snprintf(file, sizeof file, "%s/package.json", name);
  unlinkat(fd, file, 0);
  return unlinkat(fd, name, AT_REMOVEDIR);
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  if (nr != SYS_getdents64) return next_syscall(nr, a1, a2, a3, a4, a5, a6);

  int fd = (int)a1;
  char link[64], target[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, target, sizeof target - 1);
  const char *root = getenv("SCAN_GONE_ROOT");
  if (n <= 0 || !root) return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  target[n] = 0;
  if (strncmp(target, root, strlen(root)) != 0) return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  const char *base = strrchr(target, '/');
  base = base ? base + 1 : target;

  // Removed after it was opened and before its first read: that read fails with ENOENT.
  if (strcmp(base, "removed-before-read") == 0) rmdir(target);
  // The same, and a new directory takes the name.
  if (strcmp(base, "recreated-before-read") == 0) {
    unlinkat(fd, "v.txt", 0);
    if (rmdir(target) == 0) mkdir(target, 0755);
  }
  // A read that fails in another way.
  if (strcmp(base, "fails-to-read") == 0) {
    errno = EIO;
    return -1;
  }

  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);

  if (rc > 0) {
    // This read listed the directory. These children change before anything opens them.
    remove_child(fd, "removed-after-list");
    unlinkat(fd, "link-removed-after-list", 0);
    if (remove_child(fd, "replaced-by-file") == 0)
      close(openat(fd, "replaced-by-file", O_CREAT | O_WRONLY, 0644));
    // A link to itself: the open fails with ELOOP.
    if (remove_child(fd, "replaced-by-loop") == 0) symlinkat("replaced-by-loop", fd, "replaced-by-loop");
    // Removed once a read handed out its entries: the read that would report the end of
    // the directory fails with ENOENT. (After the rmdir the link reads "... (deleted)".)
    if (strcmp(base, "removed-mid-read") == 0) {
      unlinkat(fd, "inner.txt", 0);
      rmdir(target);
    }
  } else if (rc == 0 && strcmp(base, "renamed-after-list") == 0) {
    // The whole directory was listed. It gets another name before anything in it is opened.
    char renamed[PATH_MAX];
    snprintf(renamed, sizeof renamed, "%.*srenamed", (int)(base - target), target);
    rename(target, renamed);
  }
  return rc;
}
`;

let shimDir: ReturnType<typeof tempDir> | undefined;
let shim = "";

beforeAll(async () => {
  if (!isLinux || !cc) return;
  shimDir = tempDir("glob-scan-gone-directory-shim", { "shim.c": shimSource });
  shim = path.join(String(shimDir), "shim.so");
  await using compile = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shim, path.join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, exitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
  if (exitCode !== 0) throw new Error(`Failed to build the shim:\n${output}`);
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
  superviseDir?.[Symbol.dispose]();
});

// Runs bun with the shim preloaded. The shim acts below `root` only.
async function runWithShim(args: string[], cwd: string, root: string, env: typeof bunEnv = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: {
      ...bunEnv,
      ...env,
      SCAN_GONE_ROOT: fs.realpathSync(root),
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// What the shim does to the directory "parent/<kind>" of a tree. The walk skips the first five.
const gone = [
  "removed-after-list",
  "replaced-by-file",
  "removed-before-read",
  "recreated-before-read",
  "removed-mid-read",
];
const failing = { "replaced-by-loop": ["ELOOP", "open"], "fails-to-read": ["EIO", "getdents64"] };
const kinds = [...gone, ...Object.keys(failing)];
// The kernel resolves a ".." through a symlink, and the walker joins it as text. With one in
// the pattern, or in the cwd of an absolute scan, the walk has no path to look at again. So
// a directory or a link that does not open keeps its error.
const withDotDot = ["dot-dot", "absolute, .. in cwd"];
const openErrors = { "removed-after-list": ["ENOENT", "open"], "replaced-by-file": ["ENOTDIR", "open"] };

test.concurrent.skipIf(!isLinux || !cc)("Bun.Glob returns every match that is left", async () => {
  using dir = tempDir("glob-scan-gone-directory", {
    "glob-fixture.js": `
import { Glob } from "bun";
import fs from "node:fs";
import path from "node:path";

const write = (root, files) => {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "");
  }
};
// What a scan gave, and what is at the path that the shim acts on afterwards.
const outcome = async (root, marked, scan) => {
  const before = fs.lstatSync(marked);
  let result;
  try {
    result = (await scan()).map(match => path.relative(root, path.resolve(root, match))).sort();
  } catch (e) {
    result = { code: e.code, syscall: e.syscall };
  }
  const stat = fs.lstatSync(marked, { throwIfNoEntry: false });
  const after = !stat
    ? "missing"
    : stat.isSymbolicLink()
      ? "link"
      : !stat.isDirectory()
        ? "file"
        : stat.ino === before.ino
          ? "directory"
          : "another directory";
  return { scan: result, after };
};
const styles = {
  "relative": root => ["**/*.txt", { cwd: root }],
  "absolute": root => ["**/*.txt", { cwd: root, absolute: true }],
  "absolute pattern": root => [root + "/**/*.txt", {}],
  "directories": root => ["**", { cwd: root, onlyFiles: false }],
  "dot-dot": root => ["../" + path.basename(root) + "/**/*.txt", { cwd: root }],
  "absolute, .. in cwd": root => ["**/*.txt", { cwd: root + "/keep/..", absolute: true }],
  "relative, .. in cwd": root => ["**/*.txt", { cwd: root + "/keep/.." }],
};
const modes = {
  scanSync: (pattern, options) => Array.from(new Glob(pattern).scanSync(options)),
  scan: (pattern, options) => Array.fromAsync(new Glob(pattern).scan(options)),
};
// "removed-before-read" is removed with one rmdir, so it is empty.
const inside = {
  "removed-after-list": "v.txt",
  "replaced-by-file": "v.txt",
  "recreated-before-read": "v.txt",
  "removed-mid-read": "inner.txt",
  "replaced-by-loop": "v.txt",
  "fails-to-read": "v.txt",
};
// A link that a listing reported. With followSymlinks the walk opens it.
const links = { "link-removed-after-list": "../keep", "broken-link": "missing" };

const out = {};
let trees = 0;
for (const [mode, scan] of Object.entries(modes)) {
  for (const [style, args] of Object.entries(styles)) {
    for (const kind of ${JSON.stringify(kinds)}) {
      const root = path.resolve("tree-" + trees++);
      const marked = path.join(root, "parent", kind);
      write(root, ["top.txt", "keep/k.txt", "parent/p.txt"]);
      fs.mkdirSync(marked);
      if (inside[kind]) fs.writeFileSync(path.join(marked, inside[kind]), "");
      out[[mode, style, kind].join(", ")] = await outcome(root, marked, () => scan(...args(root)));
    }
    for (const [kind, target] of Object.entries(links)) {
      for (const throwErrorOnBrokenSymlink of [true, false]) {
        const root = path.resolve("tree-" + trees++);
        const marked = path.join(root, "parent", kind);
        write(root, ["top.txt", "keep/k.txt", "parent/p.txt"]);
        fs.symlinkSync(target, marked);
        const [pattern, options] = args(root);
        out[[mode, style, kind, "throw=" + throwErrorOnBrokenSymlink].join(", ")] = await outcome(root, marked, () =>
          scan(pattern, { ...options, followSymlinks: true, throwErrorOnBrokenSymlink }),
        );
      }
    }
  }

  // The directory a walk starts in is not skipped.
  let root = path.resolve("tree-" + trees++, "removed-before-read");
  fs.mkdirSync(root, { recursive: true });
  out[mode + ", start removed"] = await outcome(root, root, () => scan("**/*.txt", { cwd: root }));

  // The directory a walk starts in gets another name. A scan with absolute paths then fails
  // to open "keep" by its path, and "keep" is still there.
  for (const style of ["relative", "absolute", "absolute pattern"]) {
    root = path.resolve("tree-" + trees++, "renamed-after-list");
    write(root, ["top.txt", "keep/k.txt"]);
    out[[mode, "start renamed", style].join(", ")] = await outcome(root, root, () => scan(...styles[style](root)));
  }
}
console.log(JSON.stringify(out));
`,
  });

  const { stdout, stderr, exitCode } = await runWithShim(["glob-fixture.js"], String(dir), String(dir));
  expect(stderr).toBe("");

  const expected: Record<string, { scan: unknown; after: string }> = {};
  const styles = [
    "relative",
    "absolute",
    "absolute pattern",
    "directories",
    "dot-dot",
    "absolute, .. in cwd",
    "relative, .. in cwd",
  ];
  for (const mode of ["scanSync", "scan"]) {
    for (const style of styles) {
      // What the scan returns for a tree where the entry "parent/<kind>" is gone.
      const left = (kind: string) => {
        const matches = ["top.txt", "keep/k.txt", "parent/p.txt"];
        // The listing of "parent" reported the entry, so it is a match itself.
        if (style === "directories") matches.push("keep", "parent", `parent/${kind}`);
        return matches;
      };
      for (const kind of gone) {
        const matches = left(kind);
        // Its first read listed this file. The directory was removed after that.
        if (kind === "removed-mid-read") matches.push("parent/removed-mid-read/inner.txt");
        const error = withDotDot.includes(style) && openErrors[kind as keyof typeof openErrors];
        expected[`${mode}, ${style}, ${kind}`] = {
          scan: error ? { code: error[0], syscall: error[1] } : matches.sort(),
          // If the shim did not act, the first directory is still there.
          after: { "replaced-by-file": "file", "recreated-before-read": "another directory" }[kind] ?? "missing",
        };
      }
      for (const [kind, [code, syscall]] of Object.entries(failing)) {
        const after = kind === "replaced-by-loop" ? "link" : "directory";
        expected[`${mode}, ${style}, ${kind}`] = { scan: { code, syscall }, after };
      }

      const brokenLink = { code: "ENOENT", syscall: "open" };
      // A link that is gone is not a broken link. The option does not change the matches.
      expected[`${mode}, ${style}, link-removed-after-list, throw=true`] = {
        scan: withDotDot.includes(style) ? brokenLink : left("link-removed-after-list").sort(),
        after: "missing",
      };
      expected[`${mode}, ${style}, link-removed-after-list, throw=false`] = {
        scan: left("link-removed-after-list").sort(),
        after: "missing",
      };
      // A link that is there and leads nowhere is a broken link.
      expected[`${mode}, ${style}, broken-link, throw=true`] = { scan: brokenLink, after: "link" };
      expected[`${mode}, ${style}, broken-link, throw=false`] = { scan: left("broken-link").sort(), after: "link" };
    }

    expected[`${mode}, start removed`] = { scan: { code: "ENOENT", syscall: "getdents64" }, after: "missing" };
    expected[`${mode}, start renamed, relative`] = { scan: ["keep/k.txt", "top.txt"], after: "missing" };
    for (const style of ["absolute", "absolute pattern"]) {
      expected[`${mode}, start renamed, ${style}`] = { scan: { code: "ENOENT", syscall: "open" }, after: "missing" };
    }
  }
  expect(JSON.parse(stdout)).toEqual(expected);
  expect(exitCode).toBe(0);
});

// The shell and bun install drive the same walker.
test.concurrent.skipIf(!isLinux || !cc)("the shell expands a glob to every match that is left", async () => {
  // Two directories each lose a sub-directory after it was listed. A walk that stops at the
  // first one leaves out the file next to the second one.
  using dir = tempDir("glob-shell-gone-directory", {
    "shell-fixture.js": `
import { $ } from "bun";

const { stdout, stderr, exitCode } = await $\`echo **/*.txt\`.cwd("tree").nothrow().quiet();
console.log(JSON.stringify({ words: stdout.toString().trim().split(" ").sort(), stderr: stderr.toString(), exitCode }));
`,
    "tree/one/1.txt": "",
    "tree/one/removed-after-list/v.txt": "",
    "tree/two/2.txt": "",
    "tree/two/removed-after-list/v.txt": "",
  });

  const { stdout, stderr, exitCode } = await runWithShim(["shell-fixture.js"], String(dir), String(dir));
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ words: ["one/1.txt", "two/2.txt"], stderr: "", exitCode: 0 });
  expect(fs.readdirSync(path.join(String(dir), "tree", "one"))).toEqual(["1.txt"]);
  expect(fs.readdirSync(path.join(String(dir), "tree", "two"))).toEqual(["2.txt"]);
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!isLinux || !cc)("bun install resolves the workspaces that are left", async () => {
  using dir = tempDir("glob-install-gone-directory", {
    "project/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "project/packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    "project/packages/removed-after-list/package.json": JSON.stringify({ name: "removed", version: "1.0.0" }),
    "project/packages/z/package.json": JSON.stringify({ name: "z", version: "1.0.0" }),
  });
  const project = path.join(String(dir), "project");

  const { stderr, exitCode } = await runWithShim(["install"], project, project, {
    BUN_INSTALL_CACHE_DIR: path.join(String(dir), "cache"),
  });
  expect(stderr).not.toContain("error:");
  expect(fs.readdirSync(path.join(project, "packages")).sort()).toEqual(["a", "z"]);
  const lockfile = fs.readFileSync(path.join(project, "bun.lock"), "utf8");
  expect(lockfile.match(/"packages\/[^"]+"/g)?.sort()).toEqual(['"packages/a"', '"packages/z"']);
  expect(exitCode).toBe(0);
});
