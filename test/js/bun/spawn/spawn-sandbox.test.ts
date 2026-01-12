import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";

// BPF instruction that returns SECCOMP_RET_ALLOW (0x7fff0000)
// struct sock_filter { __u16 code; __u8 jt; __u8 jf; __u32 k; }
// BPF_RET | BPF_K = 0x0006, jt=0, jf=0, k=0x7fff0000
// Little-endian bytes: [0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f]
const ALLOW_ALL_FILTER = new Uint8Array([0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f]);

// BPF instruction that returns SECCOMP_RET_KILL_PROCESS (0x80000000)
// This will kill the process on any syscall
const KILL_ALL_FILTER = new Uint8Array([0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]);

// BPF filter that blocks write() syscall on x86_64 with EPERM
// This allows the process to continue but write() calls will fail with "Operation not permitted"
//
// BPF program logic:
//   0: Load arch from seccomp_data (offset 4)
//   1: If arch == AUDIT_ARCH_X86_64 (0xc000003e), continue; else jump to kill
//   2: Load syscall number (offset 0)
//   3: If syscall == write (1), jump to block with EPERM
//   4: Allow all other syscalls
//   5: Return ERRNO | EPERM (0x00050001)
//   6: Kill process (for wrong architecture)
//
// prettier-ignore
const BLOCK_WRITE_FILTER_X86_64 = new Uint8Array([
  // struct sock_filter { __u16 code; __u8 jt; __u8 jf; __u32 k; }
  // Byte order: [code_lo, code_hi, jt, jf, k_0, k_1, k_2, k_3]
  //
  // Instruction 0: Load architecture (BPF_LD | BPF_W | BPF_ABS, offset=4)
  0x20, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
  // Instruction 1: If arch == x86_64, continue (jt=0); else jump to instruction 6 (jf=4)
  0x15, 0x00, 0x00, 0x04, 0x3e, 0x00, 0x00, 0xc0,
  // Instruction 2: Load syscall number (offset=0)
  0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // Instruction 3: If syscall == 1 (write), jump to instruction 5 (jt=1); else continue (jf=0)
  0x15, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
  // Instruction 4: Allow (SECCOMP_RET_ALLOW = 0x7fff0000)
  0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x7f,
  // Instruction 5: Block with EPERM (SECCOMP_RET_ERRNO | 1 = 0x00050001)
  0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x05, 0x00,
  // Instruction 6: Kill (SECCOMP_RET_KILL_PROCESS = 0x80000000) for wrong arch
  0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
]);

// SBPL profile that allows everything (proper SBPL syntax)
const ALLOW_ALL_PROFILE = `(version 1)
(allow default)`;

// SBPL profile that denies network access
const DENY_NETWORK_PROFILE = `(version 1)
(allow default)
(deny network*)`;

// SBPL profile that denies file writes
const DENY_FILE_WRITE_PROFILE = `(version 1)
(allow default)
(deny file-write*)`;

describe("spawn sandbox (Linux)", () => {
  test.if(!isLinux)("sandbox.seccomp is silently ignored on non-Linux", async () => {
    // On non-Linux, sandbox.seccomp should be silently ignored
    // This allows users to specify all platform options at once
    await using proc = Bun.spawn({
      cmd: ["echo", "test"],
      sandbox: { seccomp: ALLOW_ALL_FILTER },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("test\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isLinux)("rejects filter with invalid length (not multiple of 8)", () => {
    expect(() => {
      Bun.spawn({
        cmd: ["echo", "test"],
        sandbox: { seccomp: new Uint8Array([0x06, 0x00, 0x00]) }, // 3 bytes, not multiple of 8
      });
    }).toThrow("multiple of 8 bytes");
  });

  test.if(isLinux)("rejects non-ArrayBuffer sandbox.seccomp value", () => {
    expect(() => {
      Bun.spawn({
        cmd: ["echo", "test"],
        sandbox: { seccomp: "not a buffer" as unknown as Uint8Array },
      });
    }).toThrow("ArrayBuffer or TypedArray");
  });

  test.if(isLinux)("accepts empty filter (no-op)", async () => {
    // Empty filter should be treated as no filter
    await using proc = Bun.spawn({
      cmd: ["echo", "hello"],
      sandbox: { seccomp: new Uint8Array(0) },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("hello\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isLinux)("spawn with allow-all filter works with echo", async () => {
    await using proc = Bun.spawn({
      cmd: ["echo", "sandboxed"],
      sandbox: { seccomp: ALLOW_ALL_FILTER },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("sandboxed\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isLinux)("spawnSync with allow-all filter works with echo", () => {
    const result = Bun.spawnSync({
      cmd: ["echo", "sync-sandboxed"],
      sandbox: { seccomp: ALLOW_ALL_FILTER },
    });

    expect(result.stdout.toString()).toBe("sync-sandboxed\n");
    expect(result.exitCode).toBe(0);
  });

  test.if(isLinux)("spawnSync with kill-all filter terminates process with SIGSYS", () => {
    const result = Bun.spawnSync({
      cmd: ["/bin/true"],
      sandbox: { seccomp: KILL_ALL_FILTER },
    });

    // Process is killed before it can do anything
    expect(result.stdout.toString()).toBe("");

    // When killed by signal, exitCode is null and signalCode contains the signal name
    expect(result.exitCode).toBeNull();
    expect(result.signalCode).toBe("SIGSYS");
    expect(result.success).toBe(false);
  });

  test.if(isLinux)("spawn with kill-all filter terminates process with SIGSYS", async () => {
    // The process should be killed immediately when it tries to make any syscall.
    // seccomp sends SIGSYS (signal 31) to terminate the process.
    await using proc = Bun.spawn({
      cmd: ["/bin/true"],
      sandbox: { seccomp: KILL_ALL_FILTER },
      stderr: "pipe",
    });

    await proc.exited;
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();

    // Process is killed before it can output anything
    expect(stdout).toBe("");
    expect(stderr).toBe("");

    // When killed by signal, exitCode is null and signalCode contains the signal name.
    // SIGSYS indicates seccomp blocked a syscall.
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBe("SIGSYS");
  });

  test.if(isLinux)("accepts ArrayBuffer", async () => {
    const buffer = ALLOW_ALL_FILTER.buffer.slice(
      ALLOW_ALL_FILTER.byteOffset,
      ALLOW_ALL_FILTER.byteOffset + ALLOW_ALL_FILTER.byteLength,
    );

    await using proc = Bun.spawn({
      cmd: ["echo", "arraybuffer"],
      sandbox: { seccomp: buffer },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("arraybuffer\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isLinux)("accepts different TypedArray types", async () => {
    // Test with Uint16Array (same bytes, different view)
    const uint16View = new Uint16Array(ALLOW_ALL_FILTER.buffer);

    await using proc = Bun.spawn({
      cmd: ["echo", "uint16"],
      sandbox: { seccomp: uint16View },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("uint16\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isLinux)("filter that blocks write() causes echo to fail", async () => {
    // echo uses write() to output to stdout
    // With write() blocked, echo should fail
    await using proc = Bun.spawn({
      cmd: ["echo", "this should not appear"],
      sandbox: { seccomp: BLOCK_WRITE_FILTER_X86_64 },
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await proc.stdout.text();

    // echo should fail to write and exit with error, or produce no output
    // The exact behavior depends on how echo handles write() errors
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test.if(isLinux)("filter that blocks write() allows /bin/true to succeed", async () => {
    // /bin/true doesn't write anything, it just exits with 0
    // So blocking write() shouldn't affect it
    await using proc = Bun.spawn({
      cmd: ["/bin/true"],
      sandbox: { seccomp: BLOCK_WRITE_FILTER_X86_64 },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test.if(isLinux)("filter that blocks write() causes /bin/false to exit non-zero", async () => {
    // /bin/false doesn't write anything, it just exits with 1
    // So blocking write() shouldn't affect it - it should still exit 1
    await using proc = Bun.spawn({
      cmd: ["/bin/false"],
      sandbox: { seccomp: BLOCK_WRITE_FILTER_X86_64 },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  });

  test.if(isLinux)("spawnSync filter that blocks write() causes echo to fail", () => {
    const result = Bun.spawnSync({
      cmd: ["echo", "this should not appear"],
      sandbox: { seccomp: BLOCK_WRITE_FILTER_X86_64 },
    });

    // echo should fail to write
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).not.toBe(0);
  });
});

describe("spawn sandbox (macOS)", () => {
  test.if(!isMac)("sandbox.seatbelt is silently ignored on non-macOS", async () => {
    // On non-macOS, sandbox.seatbelt should be silently ignored
    await using proc = Bun.spawn({
      cmd: ["echo", "test"],
      sandbox: { seatbelt: ALLOW_ALL_PROFILE },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("test\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("non-string sandbox.seatbelt value throws", () => {
    // When sandbox.seatbelt is not a string or object, the spawn itself throws
    expect(() => {
      Bun.spawn({
        cmd: ["echo", "test"],
        sandbox: { seatbelt: 12345 as unknown as string },
      });
    }).toThrow("Expected sandbox.seatbelt to be a string or object");
  });

  test.if(isMac)("spawn with allow-all profile works with echo", async () => {
    await using proc = Bun.spawn({
      cmd: ["echo", "sandboxed"],
      sandbox: { seatbelt: ALLOW_ALL_PROFILE },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("sandboxed\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("spawnSync with allow-all profile works with echo", () => {
    const result = Bun.spawnSync({
      cmd: ["echo", "sync-sandboxed"],
      sandbox: { seatbelt: ALLOW_ALL_PROFILE },
    });

    expect(result.stdout.toString()).toBe("sync-sandboxed\n");
    expect(result.exitCode).toBe(0);
  });

  test.if(isMac)("spawn with deny-network profile allows echo", async () => {
    // echo doesn't use network, so it should work
    await using proc = Bun.spawn({
      cmd: ["echo", "no-network"],
      sandbox: { seatbelt: DENY_NETWORK_PROFILE },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("no-network\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("spawn with deny-file-write profile allows /usr/bin/true", async () => {
    // /usr/bin/true doesn't write files, so it should work
    await using proc = Bun.spawn({
      cmd: ["/usr/bin/true"],
      sandbox: { seatbelt: DENY_FILE_WRITE_PROFILE },
    });

    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("spawnSync with deny-file-write profile allows /usr/bin/false", () => {
    // /usr/bin/false doesn't write files, it just exits with 1
    const result = Bun.spawnSync({
      cmd: ["/usr/bin/false"],
      sandbox: { seatbelt: DENY_FILE_WRITE_PROFILE },
    });

    expect(result.exitCode).toBe(1);
  });

  test("can specify both seccomp and seatbelt sandbox options", async () => {
    // This should work on all platforms - each platform uses its own option
    await using proc = Bun.spawn({
      cmd: ["echo", "cross-platform"],
      sandbox: {
        seccomp: ALLOW_ALL_FILTER,
        seatbelt: ALLOW_ALL_PROFILE,
      },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("cross-platform\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("invalid SBPL profile causes spawn to fail", () => {
    // An invalid sandbox profile causes the child to fail immediately with EINVAL
    expect(() => {
      Bun.spawn({
        cmd: ["/usr/bin/true"],
        sandbox: { seatbelt: "(invalid sbpl garbage)" },
      });
    }).toThrow("EINVAL: invalid argument, posix_spawn");
  });

  test.if(isMac)("object format with profile property works", async () => {
    // Test the object format { profile: "..." }
    await using proc = Bun.spawn({
      cmd: ["echo", "object-format"],
      sandbox: { seatbelt: { profile: ALLOW_ALL_PROFILE } },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("object-format\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("object format with profile and parameters works", async () => {
    // SBPL profile that uses param() function to get a value
    // This profile allows everything but demonstrates parameter passing
    const profileWithParams = `(version 1)
(allow default)
(deny file-write* (subpath (param "BLOCKED_PATH")))`;

    // Test the object format with parameters
    // We block writes to /nonexistent which shouldn't affect /usr/bin/true
    await using proc = Bun.spawn({
      cmd: ["/usr/bin/true"],
      sandbox: {
        seatbelt: {
          profile: profileWithParams,
          parameters: { BLOCKED_PATH: "/nonexistent" },
        },
      },
    });

    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("spawnSync with profile and parameters works", () => {
    const profileWithParams = `(version 1)
(allow default)
(deny file-write* (subpath (param "BLOCKED_PATH")))`;

    const result = Bun.spawnSync({
      cmd: ["/usr/bin/true"],
      sandbox: {
        seatbelt: {
          profile: profileWithParams,
          parameters: { BLOCKED_PATH: "/nonexistent" },
        },
      },
    });

    expect(result.exitCode).toBe(0);
  });

  test.if(isMac)("specifying both profile and namedProfile throws error", () => {
    expect(() => {
      Bun.spawn({
        cmd: ["/usr/bin/true"],
        sandbox: {
          seatbelt: {
            profile: ALLOW_ALL_PROFILE,
            namedProfile: "pfd",
          } as unknown as string,
        },
      });
    }).toThrow("sandbox.seatbelt cannot have both 'profile' and 'namedProfile'");
  });

  test.if(isMac)("empty parameters object is allowed", async () => {
    await using proc = Bun.spawn({
      cmd: ["echo", "empty-params"],
      sandbox: {
        seatbelt: {
          profile: ALLOW_ALL_PROFILE,
          parameters: {},
        },
      },
    });

    const stdout = await proc.stdout.text();
    expect(stdout).toBe("empty-params\n");
    expect(await proc.exited).toBe(0);
  });

  test.if(isMac)("seatbelt object without profile or namedProfile throws error", () => {
    expect(() => {
      Bun.spawn({
        cmd: ["/usr/bin/true"],
        sandbox: {
          seatbelt: { parameters: { KEY: "VALUE" } } as unknown as string,
        },
      });
    }).toThrow("Expected sandbox.seatbelt to be a object with 'profile' or 'namedProfile'");
  });

  test.if(isMac)("namedProfile with non-existent profile throws EINVAL", () => {
    // A non-existent named profile should fail with EINVAL
    expect(() => {
      Bun.spawn({
        cmd: ["/usr/bin/true"],
        sandbox: {
          seatbelt: { namedProfile: "this-profile-does-not-exist-12345" },
        },
      });
    }).toThrow("EINVAL: invalid argument, posix_spawn");
  });

  test.if(isMac)("namedProfile restricts process execution", () => {
    // First verify ls works without sandbox
    const withoutSandbox = Bun.spawnSync({
      cmd: ["/bin/ls", "/"],
    });
    expect(withoutSandbox.stdout.toString()).toContain("usr");
    expect(withoutSandbox.exitCode).toBe(0);

    // The "pfd" (packet filter daemon) profile only allows executing /usr/libexec/pfd
    // So /bin/ls should fail with EPERM (Operation not permitted)
    // The sandbox blocks execve, which causes spawn to throw
    expect(() => {
      Bun.spawnSync({
        cmd: ["/bin/ls", "/"],
        sandbox: {
          seatbelt: { namedProfile: "pfd" },
        },
      });
    }).toThrow("EPERM: operation not permitted, posix_spawn");
  });

  test.if(isMac)("namedProfile restricts file writes during execution", () => {
    using dir = tempDir("named-profile-test", {});
    const testFile = `${dir}/test.txt`;

    // First verify file write works without sandbox
    const withoutSandbox = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}" && rm "${testFile}"`],
    });
    expect(withoutSandbox.exitCode).toBe(0);

    // The "quicklookd" profile allows exec and file reads, but blocks file writes
    // The process spawns successfully, but the write operation fails
    const withSandbox = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}"`],
      sandbox: {
        seatbelt: { namedProfile: "quicklookd" },
      },
      stderr: "pipe",
    });

    // The shell runs but write fails with "Operation not permitted", exit code 1
    expect(withSandbox.stderr.toString()).toContain("Operation not permitted");
    expect(withSandbox.exitCode).toBe(1);
  });

  test.if(isMac)("SBPL parameters successfully block specified path", () => {
    // Create a temporary directory
    using dir = tempDir("sbpl-param-test", {});
    const testFile = `${dir}/test.txt`;

    // SBPL profile that blocks writes to the path specified by parameter
    const profileWithParams = `(version 1)
(allow default)
(deny file-write* (subpath (param "BLOCKED_PATH")))`;

    // First verify write works without sandbox
    const withoutSandbox = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}" && rm "${testFile}"`],
    });
    expect(withoutSandbox.exitCode).toBe(0);

    // With sandbox blocking the temp directory - should fail
    const withSandboxBlocking = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithParams,
          parameters: { BLOCKED_PATH: String(dir) },
        },
      },
      stderr: "pipe",
    });
    expect(withSandboxBlocking.stderr.toString()).toContain("Operation not permitted");
    expect(withSandboxBlocking.exitCode).toBe(1);

    // With sandbox blocking a different path - should succeed
    const withSandboxAllowing = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}" && rm "${testFile}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithParams,
          parameters: { BLOCKED_PATH: "/nonexistent" },
        },
      },
      stderr: "pipe",
    });
    expect(withSandboxAllowing.exitCode).toBe(0);
  });

  test.if(isMac)("SBPL profile with multiple parameters", () => {
    using dir1 = tempDir("sbpl-multi-param-1", {});
    using dir2 = tempDir("sbpl-multi-param-2", {});
    const testFile1 = `${dir1}/test.txt`;
    const testFile2 = `${dir2}/test.txt`;

    // SBPL profile that blocks writes to two different paths via parameters
    const profileWithMultipleParams = `(version 1)
(allow default)
(deny file-write* (subpath (param "BLOCKED_PATH_1")))
(deny file-write* (subpath (param "BLOCKED_PATH_2")))`;

    // Both paths blocked - writes to dir1 should fail
    const result1 = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile1}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithMultipleParams,
          parameters: {
            BLOCKED_PATH_1: String(dir1),
            BLOCKED_PATH_2: String(dir2),
          },
        },
      },
      stderr: "pipe",
    });
    expect(result1.stderr.toString()).toContain("Operation not permitted");
    expect(result1.exitCode).toBe(1);

    // Both paths blocked - writes to dir2 should also fail
    const result2 = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile2}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithMultipleParams,
          parameters: {
            BLOCKED_PATH_1: String(dir1),
            BLOCKED_PATH_2: String(dir2),
          },
        },
      },
      stderr: "pipe",
    });
    expect(result2.stderr.toString()).toContain("Operation not permitted");
    expect(result2.exitCode).toBe(1);

    // Only dir1 blocked - writes to dir2 should succeed
    const result3 = Bun.spawnSync({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile2}" && cat "${testFile2}" && rm "${testFile2}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithMultipleParams,
          parameters: {
            BLOCKED_PATH_1: String(dir1),
            BLOCKED_PATH_2: "/nonexistent",
          },
        },
      },
    });
    expect(result3.stdout.toString()).toBe("hello\n");
    expect(result3.exitCode).toBe(0);
  });

  test.if(isMac)("async spawn with namedProfile blocking file writes", async () => {
    using dir = tempDir("async-named-profile-test", {});
    const testFile = `${dir}/test.txt`;

    // First verify write works without sandbox
    await using procWithout = Bun.spawn({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}" && rm "${testFile}"`],
    });
    expect(await procWithout.exited).toBe(0);

    // The "quicklookd" profile blocks file writes
    await using procWith = Bun.spawn({
      cmd: ["/bin/sh", "-c", `echo hello > "${testFile}"`],
      sandbox: {
        seatbelt: { namedProfile: "quicklookd" },
      },
      stderr: "pipe",
    });

    const stderr = await procWith.stderr.text();
    const exitCode = await procWith.exited;

    expect(stderr).toContain("Operation not permitted");
    expect(exitCode).toBe(1);
  });

  test.if(isMac)("async spawn with SBPL profile blocking writes", async () => {
    using dir = tempDir("async-sbpl-test", {});
    const testFile = `${dir}/test.txt`;

    const profileWithParams = `(version 1)
(allow default)
(deny file-write* (subpath (param "BLOCKED_PATH")))`;

    // Blocked write
    await using procBlocked = Bun.spawn({
      cmd: ["/bin/sh", "-c", `echo blocked > "${testFile}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithParams,
          parameters: { BLOCKED_PATH: String(dir) },
        },
      },
      stderr: "pipe",
    });

    const stderrBlocked = await procBlocked.stderr.text();
    const exitCodeBlocked = await procBlocked.exited;

    expect(stderrBlocked).toContain("Operation not permitted");
    expect(exitCodeBlocked).toBe(1);

    // Allowed write (different path blocked)
    await using procAllowed = Bun.spawn({
      cmd: ["/bin/sh", "-c", `echo allowed > "${testFile}" && cat "${testFile}" && rm "${testFile}"`],
      sandbox: {
        seatbelt: {
          profile: profileWithParams,
          parameters: { BLOCKED_PATH: "/nonexistent" },
        },
      },
      stderr: "pipe",
    });

    const stdoutAllowed = await procAllowed.stdout.text();
    const exitCodeAllowed = await procAllowed.exited;

    expect(stdoutAllowed).toBe("allowed\n");
    expect(exitCodeAllowed).toBe(0);
  });

  test.if(isMac)("async spawn with deny-file-write profile blocks writes", async () => {
    using dir = tempDir("async-deny-write-test", {});
    const testFile = `${dir}/test.txt`;

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `echo test > "${testFile}"`],
      sandbox: { seatbelt: DENY_FILE_WRITE_PROFILE },
      stderr: "pipe",
    });

    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stderr).toContain("Operation not permitted");
    expect(exitCode).toBe(1);
  });
});
