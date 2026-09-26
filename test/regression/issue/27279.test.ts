import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/27279
//
// Linux older than 3.17 (Synology NAS, RHEL 7: kernel 3.10) has no
// getrandom(2). The syscall answers ENOSYS. BoringSSL, c-ares and highway fall
// back to /dev/urandom. The seed of `bun_core::fast_random()` has to do the
// same, or everything that draws from it aborts with
// "panic: getrandom failed: errno 38": `bun build`, `Bun.build()`,
// `bun test --randomize`, package extraction in `bun install`.
//
// This test installs a seccomp filter that makes getrandom(2) fail with ENOSYS,
// which is what such a kernel answers, and runs those entry points under it.
// A seccomp policy that does not know getrandom(2) answers EPERM. BoringSSL
// aborts on that errno, so only `bun build` has an EPERM case.
describe.skipIf(!isLinux)("getrandom(2) is not available", () => {
  const errnos = { ENOSYS: 38, EPERM: 1 };

  // usage: block <errno> <cmd> [args...]
  // exit 77: the environment refuses the filter. exit 78: the filter is
  // installed but getrandom still works, so the run would prove nothing.
  const helperSrc = `
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  if (MY_AUDIT_ARCH == 0) return 77;
  unsigned int err = (unsigned int)atoi(argv[1]);

  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_getrandom, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA)),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("prctl(PR_SET_NO_NEW_PRIVS)");
    return 77;
  }
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) {
    perror("seccomp");
    return 77;
  }

  unsigned char probe;
  if (syscall(__NR_getrandom, &probe, 1, 0) != -1 || errno != (int)err) {
    fprintf(stderr, "getrandom is not blocked\\n");
    return 78;
  }

  execvp(argv[2], &argv[2]);
  perror("execvp");
  return 127;
}
`;

  // Returns the binary path, or null if the host cannot build it (no cc, no
  // kernel headers). Any other compile failure throws.
  const tryBuild = (): string | null => {
    const dir = tempDirWithFiles("getrandom-enosys-seccomp", {
      "block_getrandom.c": helperSrc,
    });
    const src = join(dir, "block_getrandom.c");
    const bin = join(dir, "block_getrandom");
    const compile = spawnSync("cc", ["-O0", "-o", bin, src], { stdio: "pipe" });

    if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;

    if (compile.status !== 0) {
      const stderr = compile.stderr?.toString() ?? "";
      if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
      throw new Error(`failed to compile seccomp helper:\n${stderr}`);
    }
    if (!existsSync(bin)) {
      throw new Error("seccomp helper compiled successfully but output binary is missing");
    }
    return bin;
  };

  // describe.skipIf still runs this callback on the other platforms.
  const helperBin = isLinux ? tryBuild() : null;
  // One run of the helper tells if this environment accepts the filter (exit 77 if not).
  const canFilter = helperBin != null && spawnSync(helperBin, [String(errnos.ENOSYS), "true"]).status === 0;

  // Runs `bun ...args` in `cwd` with getrandom(2) answering `errno`.
  async function runWithoutGetrandom(errno: number, cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [helperBin!, String(errno), bunExe(), ...args],
      env: { ...bunEnv, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // 77: the filter was refused. 78: it does not block getrandom. 127: execvp failed.
    if (exitCode === 77 || exitCode === 78 || exitCode === 127) {
      throw new Error(`seccomp helper exited with code ${exitCode}:\n${stderr}`);
    }
    return { stdout, stderr, exitCode };
  }

  type Output = { stdout: string; stderr: string; exitCode: number };
  const bunBuild = {
    name: "bun build",
    args: ["build", "./index.ts", "--outdir", "./out"],
    check: async (out: Output, dir: string) => {
      // The exit code goes first here: a build that failed wrote no file to read.
      expect(out.exitCode, out.stderr).toBe(0);
      expect(await Bun.file(join(dir, "out", "index.js")).text()).toContain("from-index");
    },
  };

  const cases: Array<{
    name: string;
    errno: keyof typeof errnos;
    args: string[];
    files?: Record<string, string>;
    env?: (dir: string) => Record<string, string>;
    check: (out: Output, dir: string) => Promise<void> | void;
  }> = [
    { ...bunBuild, errno: "ENOSYS" },
    { ...bunBuild, errno: "EPERM" },
    {
      name: "Bun.build()",
      errno: "ENOSYS",
      args: [
        "-e",
        `const result = await Bun.build({ entrypoints: ["./index.ts"] });
         console.log(result.success, (await result.outputs[0].text()).includes("from-index"));`,
      ],
      check: out => {
        expect(out.stdout.trim(), out.stderr).toBe("true true");
        expect(out.exitCode).toBe(0);
      },
    },
    {
      name: "bun test --randomize",
      errno: "ENOSYS",
      args: ["test", "--randomize", "./seed.test.ts"],
      check: out => {
        expect(out.stderr).toContain("--seed=");
        expect(out.stderr).toContain("1 pass");
        expect(out.exitCode).toBe(0);
      },
    },
    {
      name: "bun install",
      errno: "ENOSYS",
      args: ["install"],
      files: {
        "package.json": JSON.stringify({
          name: "p",
          version: "1.0.0",
          dependencies: { bar: join(import.meta.dir, "..", "..", "cli", "install", "bar-0.0.2.tgz") },
        }),
      },
      // A cold cache makes the install extract the tarball into a temporary directory.
      env: dir => ({ BUN_INSTALL_CACHE_DIR: join(dir, ".cache") }),
      check: async (out, dir) => {
        expect(out.stdout, out.stderr).toContain("bar@");
        expect(await Bun.file(join(dir, "node_modules", "bar", "package.json")).json()).toMatchObject({
          name: "bar",
          version: "0.0.2",
        });
        expect(out.exitCode).toBe(0);
      },
    },
  ];

  for (const c of cases) {
    // Skipped where the host has no cc or kernel headers, or refuses the seccomp filter.
    test
      .skipIf(!canFilter)
      .concurrent(`${c.name} reads /dev/urandom when getrandom(2) answers ${c.errno}`, async () => {
        using dir = tempDir("getrandom-enosys", {
          "index.ts": `console.log("from-index");`,
          "seed.test.ts": `import { test, expect } from "bun:test"; test("runs", () => { expect(1).toBe(1); });`,
          ...c.files,
        });

        const out = await runWithoutGetrandom(errnos[c.errno], String(dir), c.args, c.env?.(String(dir)));
        await c.check(out, String(dir));
      });
  }
});
