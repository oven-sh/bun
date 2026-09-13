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
describe.skipIf(!isLinux)("getrandom(2) answers ENOSYS", () => {
  const ENOSYS = 38;

  // usage: block <cmd> [args...]
  // exit 77: the environment refuses the filter (skip). exit 78: the filter is
  // installed but getrandom still works, so the run would prove nothing.
  const helperSrc = `
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
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
  if (argc < 2) return 2;
  if (MY_AUDIT_ARCH == 0) return 77;

  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_getrandom, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (${ENOSYS} & SECCOMP_RET_DATA)),
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
  if (syscall(__NR_getrandom, &probe, 1, 0) != -1 || errno != ${ENOSYS}) {
    fprintf(stderr, "getrandom is not blocked\\n");
    return 78;
  }

  execvp(argv[1], &argv[1]);
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

  // Runs `bun ...args` in `cwd` with getrandom(2) blocked. Returns null if the
  // environment refuses the seccomp filter (skip).
  async function runWithoutGetrandom(cwd: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [helperBin!, bunExe(), ...args],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 77) return null;
    // 78: the filter does not block getrandom. 127: execvp failed.
    if (exitCode === 78 || exitCode === 127) {
      throw new Error(`seccomp helper exited with code ${exitCode}:\n${stderr}`);
    }
    return { stdout, stderr, exitCode };
  }

  const cases: Array<{
    name: string;
    args: string[];
    check: (out: { stdout: string; stderr: string; exitCode: number }, dir: string) => Promise<void> | void;
  }> = [
    {
      name: "bun build",
      args: ["build", "./index.ts", "--outdir", "./out"],
      check: async (out, dir) => {
        // The exit code goes first here: a build that failed wrote no file to read.
        expect(out.exitCode, out.stderr).toBe(0);
        expect(await Bun.file(join(dir, "out", "index.js")).text()).toContain("from-index");
      },
    },
    {
      name: "Bun.build()",
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
      args: ["test", "--randomize", "./seed.test.ts"],
      check: out => {
        expect(out.stderr).toContain("--seed=");
        expect(out.stderr).toContain("1 pass");
        expect(out.exitCode).toBe(0);
      },
    },
  ];

  for (const c of cases) {
    test.concurrent(`${c.name} falls back to /dev/urandom`, async () => {
      if (helperBin == null) {
        console.warn(`SKIP ${c.name}: cc or seccomp headers not available`);
        return;
      }

      using dir = tempDir("getrandom-enosys", {
        "index.ts": `console.log("from-index");`,
        "seed.test.ts": `import { test, expect } from "bun:test"; test("runs", () => { expect(1).toBe(1); });`,
      });

      const out = await runWithoutGetrandom(String(dir), c.args);
      if (out == null) {
        console.warn(`SKIP ${c.name}: seccomp not permitted in this environment`);
        return;
      }

      await c.check(out, String(dir));
    });
  }
});
